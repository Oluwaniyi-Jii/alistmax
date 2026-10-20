import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/showtimes/route";

describe("showtimes route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a setup error instead of showtimes when the AMC key is missing in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AMC_VENDOR_API_KEY", "");

    const response = await GET(
      new Request(
        "http://localhost/api/showtimes?zip=10001&date=2026-10-17",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "credentials_missing",
      message:
        "AMC API key is missing. Add AMC_VENDOR_API_KEY to .env.local and restart the dev server.",
    });
  });
});
