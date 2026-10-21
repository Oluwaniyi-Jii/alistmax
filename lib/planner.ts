import type {
  ItineraryEntry,
  PlannerSettings,
  Showtime,
  TransitionStatus,
} from "@/lib/types";

export const TIGHT_TRANSITION_THRESHOLD_MINUTES = 10;
export const MAX_MOVIES_IN_SCHEDULE = 8;

function validInstant(value: string | null | undefined): number | null {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) {
    return null;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function estimateFeatureStart(
  showtime: Showtime,
  trailerBufferMinutes: number,
): number | null {
  const listed = validInstant(showtime.listedStartUtc);
  if (listed === null) return null;

  const actual = validInstant(showtime.actualFeatureStartUtc);
  return actual ?? listed + trailerBufferMinutes * 60_000;
}

export function calculateItinerary(
  showtimes: Showtime[],
  settings: PlannerSettings,
): ItineraryEntry[] {
  return showtimes.map((showtime, index) => {
    const featureStart = estimateFeatureStart(
      showtime,
      settings.trailerBufferMinutes,
    );
    const runtime = showtime.runtimeMinutes;
    const featureEnd =
      featureStart !== null && runtime !== null && runtime > 0
        ? featureStart + runtime * 60_000
        : null;
    const next = showtimes[index + 1];

    let transition: ItineraryEntry["transition"] = null;
    if (next) {
      const nextFeatureStart = estimateFeatureStart(
        next,
        settings.trailerBufferMinutes,
      );
      if (
        featureEnd === null ||
        nextFeatureStart === null ||
        runtime === null ||
        runtime <= 0
      ) {
        transition = {
          status: "unverified",
          availableGapMinutes: null,
          requiredGapMinutes: null,
          creditsMissedMinutes: 0,
          reason:
            "A runtime or valid listed start time is missing, so this gap cannot be verified.",
        };
      } else {
        const availableGapMinutes = Math.floor(
          (nextFeatureStart - featureEnd) / 60_000,
        );
        const requiredGapMinutes =
          settings.transitionBufferMinutes +
          (showtime.theatreId !== next.theatreId
            ? settings.travelTimeMinutes
            : 0);
        const creditsMissedMinutes = Math.max(
          0,
          requiredGapMinutes - availableGapMinutes,
        );
        const spareMinutes =
          availableGapMinutes + creditsMissedMinutes - requiredGapMinutes;
        let status: TransitionStatus;
        let reason: string;

        if (creditsMissedMinutes > settings.creditsAllowanceMinutes) {
          status = "infeasible";
          reason = `Needs ${creditsMissedMinutes} min of end credits; allowance is ${settings.creditsAllowanceMinutes} min.`;
        } else if (creditsMissedMinutes > 0) {
          status = "tight";
          reason = `Works if you leave up to ${creditsMissedMinutes} min of end credits.`;
        } else if (spareMinutes <= TIGHT_TRANSITION_THRESHOLD_MINUTES) {
          status = "tight";
          reason = `${spareMinutes} min spare; tight means 10 min or less beyond the required gap.`;
        } else {
          status = "feasible";
          reason = `${spareMinutes} min beyond the required transition time.`;
        }

        transition = {
          status,
          availableGapMinutes,
          requiredGapMinutes,
          creditsMissedMinutes,
          reason,
        };
      }
    }

    return {
      showtime,
      featureStartUtc:
        featureStart === null ? null : new Date(featureStart).toISOString(),
      featureEndUtc:
        featureEnd === null ? null : new Date(featureEnd).toISOString(),
      transition,
    };
  });
}

export type BestSchedule = {
  showtimes: Showtime[];
  selectedCount: number;
  idleMinutes: number;
};

type ScheduleCandidate = {
  mask: number;
  showtimes: Showtime[];
  idleMinutes: number;
  creditsMissedMinutes: number;
};

export function movieKey(showtime: Showtime): string {
  return showtime.movieId ?? showtime.movieTitle.toLocaleLowerCase();
}

export function findBestSchedule(
  showtimes: Showtime[],
  selectedMovieKeys: ReadonlySet<string>,
  settings: PlannerSettings,
): BestSchedule | null {
  if (
    selectedMovieKeys.size === 0 ||
    selectedMovieKeys.size > MAX_MOVIES_IN_SCHEDULE
  ) {
    return null;
  }
  const movieKeys = [...selectedMovieKeys];
  const movieBits = new Map(movieKeys.map((key, index) => [key, 1 << index]));
  const options = showtimes
    .filter((showtime) => movieBits.has(movieKey(showtime)))
    .map((showtime) => ({
      showtime,
      start: validInstant(showtime.listedStartUtc),
    }))
    .filter(
      (option): option is { showtime: Showtime; start: number } =>
        option.start !== null,
    )
    .sort((a, b) => a.start - b.start);
  const candidatesByEnd: Map<number, ScheduleCandidate>[] = [];

  for (let currentIndex = 0; currentIndex < options.length; currentIndex += 1) {
    const current = options[currentIndex];
    const currentBit = movieBits.get(movieKey(current.showtime));
    if (currentBit === undefined) continue;
    const endings = new Map<number, ScheduleCandidate>([
      [
        currentBit,
        {
          mask: currentBit,
          showtimes: [current.showtime],
          idleMinutes: 0,
          creditsMissedMinutes: 0,
        },
      ],
    ]);

    for (let previousIndex = 0; previousIndex < currentIndex; previousIndex += 1) {
      const previous = options[previousIndex];
      const transition = calculateItinerary(
        [previous.showtime, current.showtime],
        settings,
      )[0].transition;
      if (
        !transition ||
        transition.availableGapMinutes === null ||
        transition.requiredGapMinutes === null ||
        transition.creditsMissedMinutes > settings.creditsAllowanceMinutes
      ) {
        continue;
      }

      const idle = Math.max(
        0,
        transition.availableGapMinutes +
          transition.creditsMissedMinutes -
          transition.requiredGapMinutes,
      );
      for (const candidate of candidatesByEnd[previousIndex].values()) {
        if ((candidate.mask & currentBit) !== 0) continue;
        const mask = candidate.mask | currentBit;
        const path = {
          mask,
          showtimes: [...candidate.showtimes, current.showtime],
          idleMinutes: candidate.idleMinutes + idle,
          creditsMissedMinutes:
            candidate.creditsMissedMinutes + transition.creditsMissedMinutes,
        };
        const existing = endings.get(mask);
        if (
          !existing ||
          path.idleMinutes < existing.idleMinutes ||
          (path.idleMinutes === existing.idleMinutes &&
            path.creditsMissedMinutes < existing.creditsMissedMinutes) ||
          (path.idleMinutes === existing.idleMinutes &&
            path.creditsMissedMinutes === existing.creditsMissedMinutes &&
            (validInstant(path.showtimes[0].listedStartUtc) ?? Infinity) <
              (validInstant(existing.showtimes[0].listedStartUtc) ?? Infinity))
        ) {
          endings.set(mask, path);
        }
      }
    }
    candidatesByEnd.push(endings);
  }

  let best: ScheduleCandidate | null = null;
  for (const endings of candidatesByEnd) {
    for (const candidate of endings.values()) {
      const count = bitCount(candidate.mask);
      const bestCount = best ? bitCount(best.mask) : 0;
      if (
        !best ||
        count > bestCount ||
        (count === bestCount && candidate.idleMinutes < best.idleMinutes) ||
        (count === bestCount &&
          candidate.idleMinutes === best.idleMinutes &&
          candidate.creditsMissedMinutes < best.creditsMissedMinutes) ||
        (count === bestCount &&
          candidate.idleMinutes === best.idleMinutes &&
          candidate.creditsMissedMinutes === best.creditsMissedMinutes &&
          (validInstant(candidate.showtimes[0].listedStartUtc) ?? Infinity) <
            (validInstant(best.showtimes[0].listedStartUtc) ?? Infinity))
      ) {
        best = candidate;
      }
    }
  }

  return best
    ? {
        showtimes: best.showtimes,
        selectedCount: movieKeys.length,
        idleMinutes: best.idleMinutes,
      }
    : null;
}

function bitCount(value: number): number {
  let count = 0;
  for (let bits = value; bits; bits &= bits - 1) count += 1;
  return count;
}
