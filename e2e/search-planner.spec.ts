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
    ticketUrl: "https://www.amctheatres.com/movies/first-feature",
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
    ticketUrl: "https://www.amctheatres.com/movies/second-feature",
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
  await page.getByRole("button", { name: /AMC Midtown/ }).first().click();
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
  const firstTicketLink = page.getByRole("link", { name: /Buy tickets · First Feature/ });
  await expect(firstTicketLink).toHaveAttribute(
    "href",
    "https://www.amctheatres.com/movies/first-feature",
  );
  await expect(firstTicketLink).toHaveAttribute("target", "_blank");
  await page.locator('article[role="button"]').filter({ hasText: "Second Feature" }).click();
  await expect(
    page.getByRole("link", { name: /Buy tickets · Second Feature/ }),
  ).toHaveAttribute(
    "href",
    "https://www.amctheatres.com/movies/second-feature",
  );
  const ticketButtonHeights = await page
    .getByRole("link", { name: /Buy tickets/ })
    .evaluateAll((links) =>
      links.map((link) => link.getBoundingClientRect().height),
    );
  expect(ticketButtonHeights).toEqual([44, 44]);
  await page.getByRole("button", { name: "Remove Second Feature" }).click();
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

  await page.getByRole("button", { name: /AMC Uptown/ }).first().click();
  await expect(page.locator("#tonight").getByText("First Feature", { exact: true })).toBeVisible();
  await expect(page.locator("#tonight")).toContainText("First Feature");
  await expect(
    page.getByRole("button", { name: "Unlock First Feature" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /AMC Downtown/ }).first().click();
  await expect(page.locator("main [role='alert']")).toContainText("temporarily unavailable");
  await expect(page.locator("#tonight").getByText("First Feature", { exact: true })).toBeVisible();
  await expect(page.locator("#tonight")).toContainText("First Feature");
  await expect(
    page.getByRole("button", { name: "Unlock First Feature" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("restores preferred cinemas above the ZIP search and loads one without searching again", async ({
  page,
}) => {
  await page.route("**/api/showtimes?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") === "theatres") {
      await route.fulfill({
        json: {
          zip: url.searchParams.get("zip"),
          date: url.searchParams.get("date"),
          theatres: [{
            id: "42",
            name: "AMC Midtown",
            address: "123 Broadway",
            city: "New York",
            state: "NY",
          }],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        zip: url.searchParams.get("zip"),
        date: url.searchParams.get("date"),
        results,
      },
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("ZIP code").fill("10001");
  await page.getByRole("button", { name: "Find a theatre" }).click();
  await page.getByRole("button", {
    name: "Save AMC Midtown as preferred cinema",
  }).click();
  await expect(page.getByRole("button", {
    name: "Remove AMC Midtown from preferred cinema",
  })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Find a theatre" }).click();
  const cinemaList = page.getByRole("region", { name: "Cinemas" });
  await expect(cinemaList).toBeVisible();
  await expect(page.getByRole("region", { name: "Preferred cinemas" })).toHaveCount(0);
  await expect(cinemaList.getByText("AMC Midtown", { exact: true })).toHaveCount(1);

  await page.getByPlaceholder("ZIP code").fill("90210");
  await page.reload();
  const preferredSection = page.getByRole("region", { name: "Preferred cinemas" });
  await expect(preferredSection).toBeVisible();
  await expect(page.getByPlaceholder("ZIP code")).toHaveValue("10001");
  const preferredBounds = await preferredSection.boundingBox();
  const searchBounds = await page.locator("form").boundingBox();
  expect(preferredBounds).not.toBeNull();
  expect(searchBounds).not.toBeNull();
  expect(preferredBounds!.y + preferredBounds!.height).toBeLessThan(searchBounds!.y);

  await preferredSection.getByRole("button", { name: /AMC Midtown/ }).first().click();
  await expect(page.getByText("First Feature")).toBeVisible();
});

test("loads a preferred cinema for a selected date without requiring a ZIP", async ({
  page,
}) => {
  const expectedDate = await page.evaluate(() => {
    const nextMonth = new Date();
    nextMonth.setDate(1);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(15);
    return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(nextMonth.getDate()).padStart(2, "0")}`;
  });
  await page.addInitScript(() => {
    localStorage.setItem("alistmax-preferred-cinemas-v1", JSON.stringify([{
      id: "42",
      name: "AMC Midtown",
      address: "123 Broadway",
      city: "New York",
      state: "NY",
    }]));
  });
  await page.route("**/api/showtimes?*", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: {
        zip: url.searchParams.get("zip") ?? "",
        date: url.searchParams.get("date"),
        results: [],
      },
    });
  });

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Preferred cinemas" })).toBeVisible();
  await page.getByRole("button", { name: "Choose date" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "15", exact: true }).click();
  const request = page.waitForRequest((candidate) =>
    candidate.url().includes("theatreId=42"),
  );
  await page.getByRole("region", { name: "Preferred cinemas" })
    .getByRole("button", { name: /AMC Midtown/ })
    .first()
    .click();

  const selectedTheatreRequest = new URL((await request).url());
  expect(selectedTheatreRequest.searchParams.get("date")).toBe(expectedDate);
  expect(selectedTheatreRequest.searchParams.has("zip")).toBe(false);
  await expect(page.getByText("No screenings remain at this theatre for the selected date.")).toBeVisible();
});

test("automatically dismisses planning feedback", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/showtimes?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("mode") === "theatres") {
      await route.fulfill({
        json: {
          zip: url.searchParams.get("zip"),
          date: url.searchParams.get("date"),
          theatres: [{
            id: "42",
            name: "AMC Midtown",
            address: "123 Broadway",
            city: "New York",
            state: "NY",
          }],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        zip: url.searchParams.get("zip"),
        date: url.searchParams.get("date"),
        results,
      },
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("ZIP code").fill("10001");
  await page.getByRole("button", { name: "Find a theatre" }).click();
  await page.getByRole("button", { name: /AMC Midtown/ }).first().click();
  await page.getByRole("button", { name: "Schedule options" }).click();
  await page.getByLabel("Busy from").fill("00:00");
  await page.getByLabel("Until").fill("23:59");
  await page.getByRole("button", { name: "Add a random movie" }).click();
  const alert = page.locator("main [role='alert']");
  await expect(alert).toContainText("No eligible movies are available outside your blocked time.");

  await page.clock.fastForward(6_000);
  await expect(alert).toHaveCount(0);
});
