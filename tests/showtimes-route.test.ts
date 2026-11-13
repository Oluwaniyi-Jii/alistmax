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

  it("allows a preferred-theatre search without a ZIP code", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AMC_VENDOR_API_KEY", "");

    const response = await GET(
      new Request(
        "http://localhost/api/showtimes?theatreId=42&date=2026-10-17",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "credentials_missing",
    });
  });

  it("still requires a ZIP code when searching for nearby theatres", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/showtimes?mode=theatres&date=2026-10-17",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_zip",
    });
  });
});
