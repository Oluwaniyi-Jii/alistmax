import { describe, expect, it } from "vitest";
import {
  calculateItinerary,
  findBestSchedule,
  TIGHT_TRANSITION_THRESHOLD_MINUTES,
} from "@/lib/planner";
import type { PlannerSettings, Showtime } from "@/lib/types";

const settings: PlannerSettings = {
  trailerBufferMinutes: 20,
  transitionBufferMinutes: 15,
  travelTimeMinutes: 25,
  creditsAllowanceMinutes: 0,
};

function showtime(
  id: string,
  start: string | null,
  runtime: number | null,
  theatreId = "100",
  timezone: string | null = "America/New_York",
): Showtime {
  return {
    id,
    movieId: id,
    movieTitle: `Movie ${id}`,
    posterUrl: null,
    runtimeMinutes: runtime,
    listedStartUtc: start,
    providerLocalStart: null,
    theatreId,
    theatreName: `AMC ${theatreId}`,
    theatreTimeZone: timezone,
    theatreUtcOffset: "-04:00",
    address: null,
    city: "New York",
    state: "NY",
    format: [],
    ticketUrl: null,
  };
}

describe("calculateItinerary", () => {
  it("marks a viable double feature feasible and estimates the finish", () => {
    const entries = calculateItinerary(
      [
        showtime("a", "2026-10-17T20:00:00.000Z", 100),
        showtime("b", "2026-10-17T23:00:00.000Z", 90),
      ],
      settings,
    );
    expect(entries[0].transition?.status).toBe("feasible");
    expect(entries[0].transition?.availableGapMinutes).toBe(80);
    expect(entries[0].transition?.requiredGapMinutes).toBe(15);
    expect(entries[1].featureEndUtc).toBe("2026-10-18T00:50:00.000Z");
  });

  describe("findBestSchedule", () => {
    it("chooses showings that fit all selected movies and orders them by showtime", () => {
      const bEarly = { ...showtime("b-early", "2026-10-17T20:30:00.000Z", 90), movieId: "b" };
      const bLate = { ...showtime("b-late", "2026-10-17T21:15:00.000Z", 90), movieId: "b" };
      const schedule = findBestSchedule(
        [
          showtime("a", "2026-10-17T19:00:00.000Z", 120),
          bEarly,
          bLate,
          showtime("c", "2026-10-17T23:00:00.000Z", 100),
        ],
        new Set(["a", "b", "c"]),
        { trailerBufferMinutes: 0, transitionBufferMinutes: 15, travelTimeMinutes: 0, creditsAllowanceMinutes: 0 },
      );

      expect(schedule?.showtimes.map((item) => item.id)).toEqual([
        "a",
        "b-late",
        "c",
      ]);
      expect(schedule?.showtimes).toHaveLength(3);
      expect(schedule?.selectedCount).toBe(3);
    });

    it("fits the largest possible subset when all picked movies cannot fit", () => {
      const schedule = findBestSchedule(
        [
          showtime("a", "2026-10-17T19:00:00.000Z", 120),
          showtime("b", "2026-10-17T20:00:00.000Z", 150),
          showtime("c", "2026-10-17T22:30:00.000Z", 90),
        ],
        new Set(["a", "b", "c"]),
        { trailerBufferMinutes: 0, transitionBufferMinutes: 15, travelTimeMinutes: 0, creditsAllowanceMinutes: 0 },
      );

      expect(schedule?.showtimes).toHaveLength(2);
      expect(schedule?.showtimes.map((item) => item.id)).not.toContain("b");
    });

    it("prefers less idle time over an earlier start when both plans fit", () => {
      const schedule = findBestSchedule(
        [
          { ...showtime("a-early", "2026-10-17T15:00:00.000Z", 90), movieId: "a" },
          { ...showtime("a-late", "2026-10-17T16:00:00.000Z", 90), movieId: "a" },
          showtime("b", "2026-10-17T18:00:00.000Z", 90),
        ],
        new Set(["a", "b"]),
        { trailerBufferMinutes: 0, transitionBufferMinutes: 15, travelTimeMinutes: 0, creditsAllowanceMinutes: 0 },
      );

      expect(schedule?.showtimes.map((item) => item.id)).toEqual(["a-late", "b"]);
      expect(schedule?.idleMinutes).toBe(15);
    });

    it("can start with a later-picked movie and excludes movies that were not picked", () => {
      const schedule = findBestSchedule(
        [
          showtime("a", "2026-10-17T19:45:00.000Z", 90),
          showtime("b", "2026-10-17T18:00:00.000Z", 90),
          showtime("rejected", "2026-10-17T17:00:00.000Z", 60),
        ],
        new Set(["a", "b"]),
        {
          trailerBufferMinutes: 0,
          transitionBufferMinutes: 15,
          travelTimeMinutes: 0,
          creditsAllowanceMinutes: 0,
        },
      );

      expect(schedule?.showtimes.map((item) => item.id)).toEqual(["b", "a"]);
      expect(schedule?.showtimes.map((item) => item.id)).not.toContain("rejected");
    });

    it("uses the configured credits allowance to make a close transition workable", () => {
      const entries = calculateItinerary(
        [
          showtime("a", "2026-10-17T18:00:00.000Z", 120),
          showtime("b", "2026-10-17T20:10:00.000Z", 90),
        ],
        { ...settings, creditsAllowanceMinutes: 10 },
      );

      expect(entries[0].transition?.availableGapMinutes).toBe(10);
      expect(entries[0].transition?.creditsMissedMinutes).toBe(5);
      expect(entries[0].transition?.status).toBe("tight");
      expect(entries[0].transition?.reason).toContain("leave up to 5 min");
    });

    it("uses early departure to fit more of the explicitly picked movies", () => {
      const showtimes = [
        showtime("a", "2026-10-17T18:00:00.000Z", 120),
        showtime("b", "2026-10-17T20:10:00.000Z", 90),
      ];
      const picked = new Set(["a", "b"]);

      expect(
        findBestSchedule(showtimes, picked, {
          ...settings,
          creditsAllowanceMinutes: 0,
        })?.showtimes,
      ).toHaveLength(1);

      expect(
        findBestSchedule(showtimes, picked, {
          ...settings,
          creditsAllowanceMinutes: 10,
        })?.showtimes.map((item) => item.id),
      ).toEqual(["a", "b"]);
    });

    it("returns no suggestion before any movies are picked", () => {
      expect(findBestSchedule([], new Set(), settings)).toBeNull();
    });
  });

  it("marks a transition infeasible when the credits allowance is not enough", () => {
    const [first] = calculateItinerary(
      [
        showtime("a", "2026-10-17T18:00:00.000Z", 120),
        showtime("b", "2026-10-17T20:10:00.000Z", 90),
      ],
      { ...settings, creditsAllowanceMinutes: 0 },
    );
    expect(first.transition?.status).toBe("infeasible");
    expect(first.transition?.availableGapMinutes).toBe(10);
  });

  it("marks an otherwise feasible transition tight within the documented threshold", () => {
    const [first] = calculateItinerary(
      [
        showtime("a", "2026-10-17T18:00:00.000Z", 100),
        showtime("b", "2026-10-17T19:55:00.000Z", 90),
      ],
      settings,
    );
    expect(TIGHT_TRANSITION_THRESHOLD_MINUTES).toBe(10);
    expect(first.transition?.status).toBe("tight");
    expect(first.transition?.reason).toContain("10 min or less");
  });

  it("calculates feature end after midnight using absolute timestamps", () => {
    const [entry] = calculateItinerary(
      [showtime("a", "2026-10-18T03:30:00.000Z", 150)],
      settings,
    );
    expect(entry.featureEndUtc).toBe("2026-10-18T06:20:00.000Z");
  });

  it("keeps cross-theater timestamps absolute across time zones and includes travel", () => {
    const entries = calculateItinerary(
      [
        showtime("a", "2026-10-17T20:00:00.000Z", 100, "100", "America/New_York"),
        showtime("b", "2026-10-18T00:00:00.000Z", 90, "200", "America/Los_Angeles"),
      ],
      settings,
    );
    expect(entries[0].transition?.requiredGapMinutes).toBe(40);
    expect(entries[0].transition?.status).toBe("feasible");
  });

  it("marks missing runtime and invalid showtime as unverified", () => {
    const missingRuntime = calculateItinerary(
      [
        showtime("a", "2026-10-17T18:00:00.000Z", null),
        showtime("b", "2026-10-17T21:00:00.000Z", 90),
      ],
      settings,
    )[0];
    const invalidStart = calculateItinerary(
      [showtime("a", "not-a-time", 90), showtime("b", "2026-10-17T21:00:00.000Z", 90)],
      settings,
    )[0];
    expect(missingRuntime.transition?.status).toBe("unverified");
    expect(missingRuntime.featureEndUtc).toBeNull();
    expect(invalidStart.transition?.status).toBe("unverified");
  });

  it("allows zero-minute buffers and does not add trailers twice for actual feature starts", () => {
    const [entry] = calculateItinerary(
      [
        {
          ...showtime("a", "2026-10-17T18:00:00.000Z", 90),
          actualFeatureStartUtc: "2026-10-17T18:05:00.000Z",
        },
        showtime("b", "2026-10-17T19:35:00.000Z", 90),
      ],
      {
        trailerBufferMinutes: 0,
        transitionBufferMinutes: 0,
        travelTimeMinutes: 0,
        creditsAllowanceMinutes: 0,
      },
    );
    expect(entry.featureStartUtc).toBe("2026-10-17T18:05:00.000Z");
    expect(entry.featureEndUtc).toBe("2026-10-17T19:35:00.000Z");
    expect(entry.transition?.status).toBe("tight");
  });

  it("recalculates multiple movie transitions when buffers change", () => {
    const itinerary = [
      showtime("a", "2026-10-17T15:00:00.000Z", 90),
      showtime("b", "2026-10-17T17:00:00.000Z", 90),
      showtime("c", "2026-10-17T19:00:00.000Z", 90),
    ];
    const withBuffer = calculateItinerary(itinerary, settings);
    const withoutBuffer = calculateItinerary(itinerary, {
      ...settings,
      trailerBufferMinutes: 0,
      transitionBufferMinutes: 20,
    });
    expect(withBuffer).toHaveLength(3);
    expect(withBuffer[0].transition?.status).toBe("feasible");
    expect(withoutBuffer[0].transition?.status).toBe("tight");
    expect(withoutBuffer[1].transition?.status).toBe("tight");
  });

});
