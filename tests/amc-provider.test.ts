import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  amcProviderInternals,
  AMCTheatresProvider,
  ProviderError,
  requestAMCJson,
} from "@/lib/providers/amc";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AMC provider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fails clearly when the server-side AMC key is missing", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new AMCTheatresProvider("", fetcher);
    await expect(provider.search("10001", "2026-10-17")).rejects.toMatchObject({
      code: "credentials_missing",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("caches ZIP geocoding by ZIP for 30 days", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(200, [{ lat: "40.75", lon: "-73.99" }]));

    await expect(
      amcProviderInternals.geocodeZip("10001", fetcher),
    ).resolves.toEqual({ latitude: 40.75, longitude: -73.99 });

    const [requestUrl, requestOptions] = fetcher.mock.calls[0];
    expect(new URL(String(requestUrl)).searchParams.get("postalcode")).toBe("10001");
    expect(requestOptions).toMatchObject({
      cache: "force-cache",
      next: { revalidate: 2_592_000 },
    });
  });

  it("maps unauthorized and rate-limit responses without exposing credentials", async () => {
    const unauthorized = vi.fn<typeof fetch>().mockResolvedValue(response(401, {}));
    await expect(
      requestAMCJson(new URL("https://api.amctheatres.com/v2/theatres"), "not-a-real-key", unauthorized),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const limited = vi.fn<typeof fetch>().mockResolvedValue(response(429, {}));
    await expect(
      requestAMCJson(new URL("https://api.amctheatres.com/v2/theatres"), "not-a-real-key", limited),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("rejects unexpected AMC response data rather than reporting fabricated results", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, [{ lat: "40.75", lon: "-73.99" }]))
      .mockResolvedValueOnce(response(200, { unexpected: [] }));
    const provider = new AMCTheatresProvider("test-key", fetcher);

    await expect(provider.search("10001", "2026-10-17")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("does not treat a timezone-less timestamp as a valid AMC showtime", () => {
    const normalized = amcProviderInternals.normalizeShowtimes({
      _embedded: {
        showtimes: [
          {
            id: 1,
            theatreId: 1,
            movieName: "Example",
            showDateTimeUtc: "2026-10-17T18:00:00",
            runTime: 90,
          },
        ],
      },
    });
    expect(normalized[0].listedStartUtc).toBeNull();
  });

  it("reads poster artwork from AMC showtime records", () => {
    const normalized = amcProviderInternals.normalizeShowtimes({
      _embedded: {
        showtimes: [
          {
            id: 1,
            theatreId: 1,
            movieName: "Example",
            posterUrl: "https://www.amctheatres.com/assets/example-poster.jpg",
            showDateTimeUtc: "2026-10-17T18:00:00Z",
          },
        ],
      },
    });
    expect(normalized[0].posterUrl).toBe(
      "https://www.amctheatres.com/assets/example-poster.jpg",
    );
  });

  it("uses AMC's movie poster path when the showtime includes a numeric movie id", () => {
    const normalized = amcProviderInternals.normalizeShowtimes({
      _embedded: {
        showtimes: [
          {
            id: 1,
            theatreId: 1,
            movieId: 73482,
            movieName: "Example",
          },
        ],
      },
    });
    expect(normalized[0].posterUrl).toBe(
      "https://amc-theatres-res.cloudinary.com/image/upload/v1/amc-cdn/movies/73482/poster.jpg",
    );
  });

  it("requests only the selected theatre's showtimes after theatre selection", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          _embedded: {
            showtimes: [
              {
                id: 1,
                theatreId: 42,
                movieName: "Selected movie",
                movieId: 101,
                runTime: 100,
                showDateTimeUtc: "2026-10-17T18:00:00Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          _embedded: {
            theatres: [
              {
                id: 42,
                name: "AMC Selected Theatre",
                location: { city: "New York", state: "NY" },
              },
            ],
          },
        }),
      );
    const provider = new AMCTheatresProvider("test-key", fetcher);

    const showtimes = await provider.search("10001", "2026-10-17", "42");

    expect(showtimes).toHaveLength(1);
    expect(showtimes[0].theatreName).toBe("AMC Selected Theatre");
    expect(String(fetcher.mock.calls[0][0])).toContain(
      "/v2/theatres/42/showtimes/2026-10-17",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("loads more than five pages for a single-day search", async () => {
    const pageResponse = (page: number) =>
      response(200, {
        _embedded: { showtimes: [] },
        _links:
          page < 6
            ? {
                next: {
                  href: `https://api.amctheatres.com/v2/showtimes?page-number=${page + 1}`,
                },
              }
            : {},
      });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, [{ lat: "40.75", lon: "-73.99" }]))
      .mockResolvedValueOnce(pageResponse(1))
      .mockResolvedValueOnce(pageResponse(2))
      .mockResolvedValueOnce(pageResponse(3))
      .mockResolvedValueOnce(pageResponse(4))
      .mockResolvedValueOnce(pageResponse(5))
      .mockResolvedValueOnce(pageResponse(6));
    const provider = new AMCTheatresProvider("test-key", fetcher);

    await expect(provider.search("10001", "2026-10-17")).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it("lists only theatres with returned showtimes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, [{ lat: "40.75", lon: "-73.99" }]))
      .mockResolvedValueOnce(
        response(200, {
          _embedded: {
            showtimes: [
              {
                id: 1,
                theatreId: 42,
                movieName: "Example",
                showDateTimeUtc: "2026-10-17T18:00:00Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          _embedded: {
            theatres: [
              {
                id: 42,
                name: "AMC Midtown",
                location: { addressLine1: "123 Main St", city: "New York", state: "NY" },
              },
            ],
          },
        }),
      );
    const provider = new AMCTheatresProvider("test-key", fetcher);

    await expect(provider.searchTheatres("10001", "2026-10-17")).resolves.toEqual([
      {
        id: "42",
        name: "AMC Midtown",
        address: "123 Main St",
        city: "New York",
        state: "NY",
      },
    ]);
  });

  it("maps AMC service failures to an explicit provider error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, [{ lat: "40.75", lon: "-73.99" }]))
      .mockResolvedValueOnce(response(503, {}));
    const provider = new AMCTheatresProvider("test-key", fetcher);

    await expect(provider.search("10001", "2026-10-17")).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});
