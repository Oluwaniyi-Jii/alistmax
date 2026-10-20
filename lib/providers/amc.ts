import type {
  Showtime,
  ShowtimeProvider,
  TheatreOption,
} from "@/lib/types";

const AMC_API = "https://api.amctheatres.com";
const NOMINATIM_API = "https://nominatim.openstreetmap.org/search";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_SHOWTIME_PAGES = 50;

let geocodeQueue: Promise<void> = Promise.resolve();
let lastGeocodeStartedAt = 0;

export type ProviderErrorCode =
  | "credentials_missing"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function asPositiveMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function asZonedDateTime(value: unknown): string | null {
  const dateTime = asString(value);
  if (
    !dateTime ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(dateTime) ||
    !Number.isFinite(Date.parse(dateTime))
  ) {
    return null;
  }
  return dateTime;
}

function isValidTimeZone(value: string | null): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function asAMCImageUrl(value: unknown): string | null {
  const urlValue =
    typeof value === "string"
      ? value
      : isRecord(value)
        ? asString(value.url) ?? asString(value.href)
        : null;
  if (!urlValue) return null;
  try {
    const url = new URL(urlValue);
    return url.protocol === "https:" &&
      (url.hostname === "amctheatres.com" ||
        url.hostname.endsWith(".amctheatres.com") ||
        url.hostname === "amc-theatres-res.cloudinary.com")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function moviePoster(record: JsonRecord): string | null {
  const movie = isRecord(record.movie) ? record.movie : {};
  for (const source of [record, movie]) {
    const media = isRecord(source.media) ? source.media : {};
    for (const field of [
      "posterUrl",
      "moviePosterUrl",
      "poster",
      "moviePoster",
      "posterDynamic",
    ]) {
      const posterUrl = asAMCImageUrl(source[field]);
      if (posterUrl) return posterUrl;
      const mediaPoster = asAMCImageUrl(media[field]);
      if (mediaPoster) return mediaPoster;
    }
  }
  const movieId = asId(record.movieId) ?? asId(movie.id);
  return movieId && /^\d+$/.test(movieId)
    ? `https://amc-theatres-res.cloudinary.com/image/upload/v1/amc-cdn/movies/${movieId}/poster.jpg`
    : null;
}

function normalizeShowtimes(payload: unknown): Showtime[] {
  if (!isRecord(payload) || !isRecord(payload._embedded)) {
    throw new ProviderError(
      "invalid_response",
      "AMC returned an unexpected showtime response.",
    );
  }
  const records = payload._embedded.showtimes;
  if (!Array.isArray(records)) {
    throw new ProviderError(
      "invalid_response",
      "AMC's showtime collection was missing.",
    );
  }

  return records.flatMap((record): Showtime[] => {
    if (!isRecord(record)) return [];
    const id = asId(record.id);
    const theatreId = asId(record.theatreId);
    const title = asString(record.movieName);
    if (!id || !theatreId || !title) return [];

    const attributes = Array.isArray(record.attributes)
      ? record.attributes.flatMap((attribute) =>
          isRecord(attribute)
            ? [asString(attribute.name) ?? asString(attribute.code)].filter(
                (value): value is string => Boolean(value),
              )
            : [],
        )
      : [];
    const purchaseUrl = asString(record.purchaseUrl);

    return [
      {
        id: `${theatreId}:${id}`,
        movieId: asId(record.movieId),
        movieTitle: title,
        posterUrl: moviePoster(record),
        runtimeMinutes: asPositiveMinutes(record.runTime),
        listedStartUtc: asZonedDateTime(record.showDateTimeUtc),
        providerLocalStart: asString(record.showDateTimeLocal),
        actualFeatureStartUtc: null,
        theatreId,
        theatreName: `AMC theatre ${theatreId}`,
        theatreTimeZone: null,
        theatreUtcOffset: asString(record.utcOffset),
        address: null,
        city: null,
        state: null,
        format: attributes,
        ticketUrl:
          purchaseUrl && isAMCWebUrl(purchaseUrl) ? purchaseUrl : null,
      },
    ];
  });
}

function isAMCWebUrl(value: string): boolean {
  try {
    return new URL(value).hostname === "www.amctheatres.com";
  } catch {
    return false;
  }
}

function parseTheatres(payload: unknown): Map<string, Partial<Showtime>> {
  if (!isRecord(payload) || !isRecord(payload._embedded)) {
    throw new ProviderError(
      "invalid_response",
      "AMC returned an unexpected theatre response.",
    );
  }
  const theatres = payload._embedded.theatres;
  if (!Array.isArray(theatres)) {
    throw new ProviderError(
      "invalid_response",
      "AMC's theatre collection was missing.",
    );
  }

  const result = new Map<string, Partial<Showtime>>();
  for (const item of theatres) {
    if (!isRecord(item)) continue;
    const id = asId(item.id);
    if (!id) continue;
    const location = isRecord(item.location) ? item.location : {};
    const timezone = asString(item.timezone);
    result.set(id, {
      theatreName: asString(item.name) ?? `AMC theatre ${id}`,
      theatreTimeZone: isValidTimeZone(timezone) ? timezone : null,
      theatreUtcOffset: asString(item.utcOffset),
      address: asString(location.addressLine1),
      city: asString(location.city),
      state: asString(location.state),
    });
  }
  return result;
}

function safeNextPage(value: unknown): URL | null {
  if (!isRecord(value) || !isRecord(value._links)) return null;
  const links = value._links;
  if (!isRecord(links.next) || typeof links.next.href !== "string") return null;
  try {
    const url = new URL(links.next.href, AMC_API);
    return url.origin === AMC_API ? url : null;
  } catch {
    return null;
  }
}

export async function requestAMCJson(
  url: URL,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  if (url.origin !== AMC_API) {
    throw new ProviderError(
      "invalid_response",
      "AMC returned a link outside its documented API host.",
    );
  }

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        "X-AMC-Vendor-Key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ProviderError(
        "timeout",
        "AMC did not respond in time. Please try again.",
      );
    }
    throw new ProviderError(
      "unavailable",
      "AMC showtimes are temporarily unavailable. Please try again.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderError(
      "unauthorized",
      "AMC rejected the API key. Check that the server-side vendor key is valid and enabled.",
    );
  }
  if (response.status === 429) {
    throw new ProviderError(
      "rate_limited",
      "AMC's request limit was reached. Please wait before searching again.",
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      "unavailable",
      `AMC could not complete the search (HTTP ${response.status}). Please try again.`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderError(
      "invalid_response",
      "AMC returned data that could not be read.",
    );
  }
}

async function geocodeZip(zip: string, fetcher: typeof fetch): Promise<{
  latitude: number;
  longitude: number;
}> {
  const url = new URL(NOMINATIM_API);
  url.searchParams.set("postalcode", zip);
  url.searchParams.set("country", "United States");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const request = geocodeQueue.then(async () => {
    const waitMs = Math.max(0, 1_000 - (Date.now() - lastGeocodeStartedAt));
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    lastGeocodeStartedAt = Date.now();
    return fetcher(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Alistmax/1.0 (personal AMC showtime finder)",
      },
      cache: "force-cache",
      next: { revalidate: 2_592_000 },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  });
  geocodeQueue = request.then(
    () => undefined,
    () => undefined,
  );

  let response: Response;
  try {
    response = await request;
  } catch {
    throw new ProviderError(
      "unavailable",
      "ZIP-code lookup is temporarily unavailable. Please try again.",
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      "unavailable",
      "ZIP-code lookup is temporarily unavailable. Please try again.",
    );
  }

  let results: unknown;
  try {
    results = await response.json();
  } catch {
    throw new ProviderError(
      "invalid_response",
      "ZIP-code lookup returned unreadable data.",
    );
  }
  if (!Array.isArray(results) || !isRecord(results[0])) {
    throw new ProviderError(
      "invalid_response",
      "No location could be resolved for that ZIP code.",
    );
  }
  const latitude = Number(results[0].lat);
  const longitude = Number(results[0].lon);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new ProviderError(
      "invalid_response",
      "ZIP-code lookup returned invalid coordinates.",
    );
  }
  return { latitude, longitude };
}

export class AMCTheatresProvider implements ShowtimeProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async searchTheatres(zip: string, date: string): Promise<TheatreOption[]> {
    const showtimes = await this.loadShowtimes(zip, date);
    const theatres = await this.loadTheatreDetails(showtimes);
    const seen = new Set<string>();
    return showtimes
      .flatMap((showtime): TheatreOption[] => {
        if (seen.has(showtime.theatreId)) return [];
        seen.add(showtime.theatreId);
        const theatre = theatres.get(showtime.theatreId);
        if (!theatre) return [];
        return [
          {
            id: showtime.theatreId,
            name: theatre.theatreName ?? `AMC theatre ${showtime.theatreId}`,
            address: theatre.address ?? null,
            city: theatre.city ?? null,
            state: theatre.state ?? null,
          },
        ];
      });
  }

  async search(
    zip: string,
    date: string,
    theatreId?: string,
  ): Promise<Showtime[]> {
    const showtimes = theatreId
      ? await this.loadTheatreShowtimes(theatreId, date)
      : await this.loadShowtimes(zip, date);
    const selectedShowtimes = theatreId
      ? showtimes.filter((showtime) => showtime.theatreId === theatreId)
      : showtimes;
    const theatres = await this.loadTheatreDetails(selectedShowtimes);
    return selectedShowtimes.flatMap((showtime): Showtime[] => {
      const theatre = theatres.get(showtime.theatreId);
      if (!theatre) return [];
      return [{ ...showtime, ...theatre }];
    }).sort((a, b) => {
      const aStart = Date.parse(a.listedStartUtc ?? "");
      const bStart = Date.parse(b.listedStartUtc ?? "");
      if (Number.isFinite(aStart) && Number.isFinite(bStart)) {
        return aStart - bStart;
      }
      if (Number.isFinite(aStart)) return -1;
      if (Number.isFinite(bStart)) return 1;
      return a.movieTitle.localeCompare(b.movieTitle);
    });
  }

  private async loadShowtimes(zip: string, date: string): Promise<Showtime[]> {
    if (!this.apiKey.trim()) {
      throw new ProviderError(
        "credentials_missing",
        "Add AMC_VENDOR_API_KEY to the server environment to search live AMC showtimes.",
      );
    }

    const { latitude, longitude } = await geocodeZip(zip, this.fetcher);
    const searchDate = `${date}T12:00:00.000Z`;
    const url = new URL(
      `/v2/showtimes/views/current-location/${encodeURIComponent(searchDate)}/${latitude}/${longitude}`,
      AMC_API,
    );
    url.searchParams.set("page-number", "1");
    url.searchParams.set("page-size", "100");

    return this.loadShowtimePages(url);
  }

  private async loadTheatreShowtimes(
    theatreId: string,
    date: string,
  ): Promise<Showtime[]> {
    if (!this.apiKey.trim()) {
      throw new ProviderError(
        "credentials_missing",
        "Add AMC_VENDOR_API_KEY to the server environment to search live AMC showtimes.",
      );
    }
    const url = new URL(
      `/v2/theatres/${encodeURIComponent(theatreId)}/showtimes/${encodeURIComponent(date)}`,
      AMC_API,
    );
    url.searchParams.set("page-number", "1");
    url.searchParams.set("page-size", "100");
    return this.loadShowtimePages(url);
  }

  private async loadShowtimePages(url: URL): Promise<Showtime[]> {
    const showtimes: Showtime[] = [];
    const visitedPages = new Set<string>();
    let page: URL | null = url;
    let pageCount = 0;
    while (page && pageCount < MAX_SHOWTIME_PAGES) {
      if (visitedPages.has(page.href)) {
        throw new ProviderError(
          "invalid_response",
          "AMC returned a repeated showtime page link.",
        );
      }
      visitedPages.add(page.href);
      const payload = await requestAMCJson(page, this.apiKey, this.fetcher);
      const currentPage = normalizeShowtimes(payload);
      showtimes.push(...currentPage);
      page = safeNextPage(payload);
      pageCount += 1;
    }
    if (page) {
      throw new ProviderError(
        "invalid_response",
        `AMC returned more showtime pages than Alistmax can safely load (${MAX_SHOWTIME_PAGES} pages). Try another ZIP code or retry later.`,
      );
    }

    return showtimes;
  }

  private async loadTheatreDetails(
    showtimes: Showtime[],
  ): Promise<Map<string, Partial<Showtime>>> {
    const theatreIds = [...new Set(showtimes.map((showtime) => showtime.theatreId))];
    if (theatreIds.length === 0) return new Map();

    const theatreUrl = new URL("/v2/theatres", AMC_API);
    theatreUrl.searchParams.set("ids", theatreIds.join(","));
    theatreUrl.searchParams.set("page-number", "1");
    theatreUrl.searchParams.set("page-size", "100");
    const theatreData = await requestAMCJson(
      theatreUrl,
      this.apiKey,
      this.fetcher,
    );
    return parseTheatres(theatreData);
  }
}

export function createAMCProvider(
  apiKey = process.env.AMC_VENDOR_API_KEY ?? "",
): ShowtimeProvider {
  return new AMCTheatresProvider(apiKey);
}

export const amcProviderInternals = {
  normalizeShowtimes,
  parseTheatres,
  geocodeZip,
};
