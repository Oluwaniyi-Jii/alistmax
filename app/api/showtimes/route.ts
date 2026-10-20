import { NextResponse } from "next/server";
import { createAMCProvider, ProviderError } from "@/lib/providers/amc";
import { validateSearchDate, validateZipCode } from "@/lib/validation";

export const runtime = "nodejs";

function apiError(status: number, error: string, message: string) {
  return NextResponse.json(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const zip = validateZipCode(params.get("zip") ?? "");
  const date = validateSearchDate(params.get("date") ?? "");
  const mode = params.get("mode");
  const theatreId = params.get("theatreId");

  if (!zip) {
    return apiError(400, "invalid_zip", "Enter a valid five-digit US ZIP code.");
  }
  if (!date) {
    return apiError(400, "invalid_date", "Choose a valid search date.");
  }
  if (
    (mode !== null && mode !== "theatres") ||
    (theatreId !== null && !/^[\w-]{1,40}$/.test(theatreId)) ||
    (mode === "theatres" && theatreId !== null)
  ) {
    return apiError(400, "invalid_search", "Choose a valid theatre search.");
  }

  const apiKey = process.env.AMC_VENDOR_API_KEY;
  if (!apiKey) {
    return apiError(
      503,
      "credentials_missing",
      process.env.NODE_ENV === "development"
        ? "AMC API key is missing. Add AMC_VENDOR_API_KEY to .env.local and restart the dev server."
        : "AMC API key is missing. Set AMC_VENDOR_API_KEY in the server environment.",
    );
  }

  try {
    const provider = createAMCProvider(apiKey);
    if (mode === "theatres") {
      const theatres = await provider.searchTheatres(zip, date);
      return NextResponse.json(
        { zip, date, theatres },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const results = await provider.search(zip, date, theatreId ?? undefined);
    return NextResponse.json(
      { zip, date, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!(error instanceof ProviderError)) {
      return apiError(
        502,
        "provider_unavailable",
        "AMC showtimes are temporarily unavailable. Please try again.",
      );
    }
    const statusByCode = {
      credentials_missing: 503,
      unauthorized: 502,
      rate_limited: 429,
      timeout: 504,
      unavailable: 502,
      invalid_response: 502,
    } as const;
    const codeByProviderError = {
      credentials_missing: "credentials_missing",
      unauthorized: "unauthorized",
      rate_limited: "rate_limited",
      timeout: "provider_unavailable",
      unavailable: "provider_unavailable",
      invalid_response: "invalid_provider_response",
    } as const;
    return apiError(statusByCode[error.code], codeByProviderError[error.code], error.message);
  }
}
