import { expect, test } from "@playwright/test";

const now = Date.now();
const results = [
  {
    id: "42:101",
    movieId: "101",
    movieTitle: "First Feature",
    posterUrl: null,
    runtimeMinutes: 90,
    listedStartUtc: new Date(now + 60 * 60_000).toISOString(),
    providerLocalStart: null,
    actualFeatureStartUtc: null,
    theatreId: "42",
    theatreName: "AMC Midtown",
    theatreTimeZone: "America/New_York",
    theatreUtcOffset: "-04:00",
    address: null,
    city: "New York",
    state: "NY",
    format: [],
    ticketUrl: null,
  },
  {
    id: "42:102",
    movieId: "102",
    movieTitle: "Second Feature",
    posterUrl: null,
    runtimeMinutes: 95,
    listedStartUtc: new Date(now + 3 * 60 * 60_000).toISOString(),
    providerLocalStart: null,
    actualFeatureStartUtc: null,
    theatreId: "42",
    theatreName: "AMC Midtown",
    theatreTimeZone: "America/New_York",
    theatreUtcOffset: "-04:00",
    address: null,
    city: "New York",
    state: "NY",
    format: [],
    ticketUrl: null,
  },
  {
    id: "42:103",
    movieId: "103",
    movieTitle: "Already Started",
    posterUrl: null,
    runtimeMinutes: 80,
    listedStartUtc: new Date(now - 30 * 60_000).toISOString(),
    providerLocalStart: null,
    actualFeatureStartUtc: null,
    theatreId: "42",
    theatreName: "AMC Midtown",
    theatreTimeZone: "America/New_York",
    theatreUtcOffset: "-04:00",
    address: null,
    city: "New York",
    state: "NY",
    format: [],
    ticketUrl: null,
  },
  {
    id: "42:104",
    movieId: "104",
    movieTitle: "Recently Started",
    posterUrl: null,
    runtimeMinutes: 85,
    listedStartUtc: new Date(now - 20 * 60_000).toISOString(),
    providerLocalStart: null,
    actualFeatureStartUtc: null,
    theatreId: "42",
    theatreName: "AMC Midtown",
    theatreTimeZone: "America/New_York",
    theatreUtcOffset: "-04:00",
    address: null,
    city: "New York",
    state: "NY",
    format: [],
    ticketUrl: null,
  },
];

const alternateTheatreResults = results.map((show, index) => ({
  ...show,
  id: `43:${show.movieId}`,
  theatreId: "43",
  theatreName: "AMC Uptown",
  listedStartUtc: new Date(now + (index === 0 ? 2 : 4) * 60 * 60_000).toISOString(),
}));

test("mobile layout stays within the viewport and keeps the plan accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/showtimes?*", async (route) => {
    const url = new URL(route.request().url());
    const zip = url.searchParams.get("zip");
    const date = url.searchParams.get("date");
    if (url.searchParams.get("mode") === "theatres") {
      await route.fulfill({
        json: {
          zip,
          date,
          theatres: [
            {
              id: "42",
              name: "AMC Midtown",
              address: "123 Broadway",
              city: "New York",
              state: "NY",
            },
            {
              id: "43",
              name: "AMC Uptown",
              address: "456 Broadway",
              city: "New York",
              state: "NY",
            },
            {
              id: "44",
              name: "AMC Downtown",
              address: "789 Broadway",
              city: "New York",
              state: "NY",
            },
          ],
        },
      });
      return;
    }
    if (url.searchParams.get("theatreId") === "44") {
      await route.fulfill({
        status: 502,
        json: {
          error: "provider_unavailable",
          message: "AMC showtimes are temporarily unavailable. Please try again.",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        zip,
        date,
        results: url.searchParams.get("theatreId") === "43"
          ? alternateTheatreResults
          : results,
      },
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("ZIP code").fill("10001");
  await page.getByRole("button", { name: "Find a theatre" }).click();
  await page.getByRole("button", { name: /AMC Midtown/ }).click();
  await expect(page.getByText("First Feature")).toBeVisible();
  await expect(page.getByText(/Showtimes disappear 25 minutes/)).toBeVisible();
  await expect(page.getByText("Already Started")).toHaveCount(0);
  await expect(page.getByText("Recently Started")).toBeVisible();
  await expect(page.locator('button[aria-label*="already started"]')).toBeDisabled();

  const documentWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(documentWidths.scroll).toBeLessThanOrEqual(documentWidths.client);

  await page.locator('article[role="button"]').filter({ hasText: "First Feature" }).click();
  await page.getByRole("button", { name: "Lock First Feature" }).click();
  const planShortcut = page.getByRole("link", {
    name: /View tonight's plan: 1 movie/,
  });
  await expect(planShortcut).toBeVisible();
  const shortcutBounds = await planShortcut.boundingBox();
  expect(shortcutBounds).not.toBeNull();
  expect(shortcutBounds!.y + shortcutBounds!.height).toBeLessThanOrEqual(844);

  await planShortcut.click();
  await expect(page).toHaveURL(/#tonight$/);
  await expect(page.locator("#tonight")).toBeVisible();

  await page.getByRole("button", { name: /AMC Uptown/ }).click();
  await expect(page.locator("#tonight").getByText("First Feature")).toBeVisible();
  await expect(page.locator("#tonight")).toContainText("First Feature");
  await expect(
    page.getByRole("button", { name: "Unlock First Feature" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /AMC Downtown/ }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("temporarily unavailable");
  await expect(page.locator("#tonight").getByText("First Feature")).toBeVisible();
  await expect(page.locator("#tonight")).toContainText("First Feature");
  await expect(
    page.getByRole("button", { name: "Unlock First Feature" }),
  ).toHaveAttribute("aria-pressed", "true");
});
