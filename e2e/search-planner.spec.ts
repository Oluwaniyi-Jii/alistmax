import { expect, test } from "@playwright/test";

const results = [
  {
    id: "42:101",
    movieId: "101",
    movieTitle: "First Feature",
    posterUrl: null,
    runtimeMinutes: 90,
    listedStartUtc: "2026-10-23T15:00:00.000Z",
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
    listedStartUtc: "2026-10-23T17:15:00.000Z",
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
  listedStartUtc: index === 0
    ? "2026-10-23T16:00:00.000Z"
    : "2026-10-23T18:15:00.000Z",
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
  await expect(page.getByRole("button", { name: /First Feature 12:00 PM/ })).toBeVisible();
  await expect(page.locator("#tonight")).toContainText("12:00 PM");
  await expect(
    page.getByRole("button", { name: "Unlock First Feature" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /AMC Downtown/ }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("temporarily unavailable");
  await expect(page.getByRole("button", { name: /First Feature 12:00 PM/ })).toBeVisible();
  await expect(page.locator("#tonight")).toContainText("12:00 PM");
  await expect(
    page.getByRole("button", { name: "Unlock First Feature" }),
  ).toHaveAttribute("aria-pressed", "true");
});
