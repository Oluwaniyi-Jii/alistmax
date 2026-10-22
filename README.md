# Alistmax

Alistmax is a personal-use AMC showtime browser and movie-night scheduler. It
does not have accounts, a database, analytics, or ticket booking.

## Features

- Search by a five-digit US ZIP code and a date. Choose a theatre before its
  movies and showtimes are loaded.
- Browse available AMC showtimes with movie posters when AMC supplies usable
  artwork or a movie ID that can be used to request its poster, plus runtime
  and showtime information.
- Click a showing to add it to or remove it from the evening plan. Choose up to
  four movies; the scheduler selects showings that fit and can change their
  order.
- Optimize for the tightest gaps, an earlier start, or a later finish.
- Lock movies in the current plan before randomizing the other movie choices.
- Block a period of time so the scheduler avoids screenings that conflict with
  it.
- See the selected movie runtimes, approximate time between screenings, and
  movies left out of the current plan. A selected movie can be removed directly
  from the plan.
- The plan and search selections are held in page state; reloading the page
  clears them.

The schedule is an estimate, not a guarantee. AMC showtimes are used as listed;
the planner estimates each screening as its listed start plus the movie runtime
and a fixed 30-minute allowance for trailers and other pre-feature material.
Missing runtimes use a 110-minute estimate. The planner will not schedule
overlapping screenings and does not model leaving before credits, travel
between theatres, or real-time ticket availability. Busy-time filtering also
uses the runtime estimate plus 30 minutes. Showtimes use AMC's theatre time
zone when one is available; otherwise, the browser's local time zone is used.

## Data sources and caching

The app calls AMC's API from the server. The AMC vendor key is sent in the
`X-AMC-Vendor-Key` request header and is never sent to browser code. AMC
showtime and theatre-detail requests use `no-store`; the app does not cache live
AMC listings.

AMC's location-based showtime endpoint takes latitude and longitude rather than
a ZIP code. Alistmax resolves ZIP codes using the
[OpenStreetMap Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/).
That lookup is cached by Next.js for 30 days. Requests are serialized and
throttled to at most one per second within a running server process. The app
identifies itself in the request and attributes OpenStreetMap contributors in
the interface. It does not provide autocomplete or bulk geocoding. Review the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
before deploying or changing geocoding behavior.

Theatre results are based on AMC's showtimes returned for the ZIP's resolved
coordinates. The app does not provide a search-radius control or calculate
theatre distances or travel times.

## Requirements

- Node.js 22.13 or newer
- npm
- An AMC developer vendor key with access to the required AMC API endpoints

## Local development

In PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `AMC_VENDOR_API_KEY` in `.env.local` to the key issued by AMC, then start
the development server:

```powershell
npm run dev
```

Open <http://localhost:3000>. Without the key, searches show a setup error
instead of sample or fabricated showtimes. Do not commit `.env.local`.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The Playwright browser tests use mocked showtime API responses. Install
Chromium before running them if it is not already available:

```powershell
npx playwright install chromium
npm run test:e2e
```

## Deploy to Vercel

1. Push the repository to GitHub and import it into Vercel.
2. Keep the detected Next.js build settings.
3. Add `AMC_VENDOR_API_KEY` as a server-side environment variable in Vercel.
   Do not use a `NEXT_PUBLIC_` variable for this secret.
4. Deploy and test a search using an AMC-issued key.

This is a personal-use app without access control. If it should not be
available to everyone, enable Vercel Deployment Protection so visitors cannot
use your AMC API quota. Live AMC authentication, access scope, response
compatibility, and rate-limit behavior must be verified with an authorized key;
the automated tests mock AMC and do not confirm live API access.

## AMC API references

- [AMC authentication](https://developers.amctheatres.com/GettingStarted/Authentication)
- [AMC Showtime API v2](https://developers.amctheatres.com/ApiReference/showtime-api-v2)
- [AMC Location API v2](https://developers.amctheatres.com/ApiReference/location-api-v2)

The server validates ZIP codes, dates, and theatre IDs, applies an eight-second
timeout to external requests, and returns explicit errors for missing
credentials, rejected keys, rate limits, provider outages, and malformed
responses. Showtime pagination requests up to 50 pages, with up to 100 results
per page, and rejects repeated page links.
