export type Showtime = {
  id: string;
  movieId: string | null;
  movieTitle: string;
  posterUrl: string | null;
  runtimeMinutes: number | null;
  listedStartUtc: string | null;
  providerLocalStart: string | null;
  actualFeatureStartUtc?: string | null;
  theatreId: string;
  theatreName: string;
  theatreTimeZone: string | null;
  theatreUtcOffset: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  format: string[];
  ticketUrl: string | null;
};

export type TheatreOption = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
};

export type TheatreSearchResponse = {
  zip: string;
  date: string;
  theatres: TheatreOption[];
};

export type ShowtimeSearchResponse = {
  zip: string;
  date: string;
  results: Showtime[];
};

export type SearchErrorCode =
  | "invalid_zip"
  | "invalid_date"
  | "invalid_search"
  | "credentials_missing"
  | "unauthorized"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_provider_response";

export type SearchError = {
  error: SearchErrorCode;
  message: string;
};

export type PlannerSettings = {
  trailerBufferMinutes: number;
  transitionBufferMinutes: number;
  travelTimeMinutes: number;
  creditsAllowanceMinutes: number;
};

export type TransitionStatus = "feasible" | "tight" | "infeasible" | "unverified";

export type ItineraryEntry = {
  showtime: Showtime;
  featureStartUtc: string | null;
  featureEndUtc: string | null;
  transition: {
    status: TransitionStatus;
    availableGapMinutes: number | null;
    requiredGapMinutes: number | null;
    creditsMissedMinutes: number;
    reason: string;
  } | null;
};

export type ShowtimeProvider = {
  search(zip: string, date: string, theatreId?: string): Promise<Showtime[]>;
  searchTheatres(zip: string, date: string): Promise<TheatreOption[]>;
};
