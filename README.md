# Alistmax

[Open Alistmax](https://alistmax.vercel.app/)

Find AMC showtimes near a ZIP code, choose a theatre, and build a movie-night
schedule from available screenings.

## What it does

- Shows movie posters, runtimes, and AMC showtimes.
- Keeps a screening visible until 25 minutes after its listed start. Screenings
  that have already started cannot be added to a plan.
- Builds a schedule for up to four movies and can optimize for shorter gaps,
  an earlier start, or a later finish.
- Lets you lock movies, block off a time, and switch theatres without losing
  your selections.

The schedule estimates each movie's end using its runtime plus 30 minutes for
trailers. It does not estimate travel time or show ticket availability.
Selections are cleared when you reload the page.

## Run locally

Use Node.js 22 and npm:

```powershell
npm install
Copy-Item .env.example .env.local
```

Add your AMC-issued key as `AMC_VENDOR_API_KEY` in `.env.local`, then run:

```powershell
npm run dev
```

Open <http://localhost:3000>. Keep the key server-side and never commit
`.env.local`.

## Deploy

The app is deployed at [alistmax.vercel.app](https://alistmax.vercel.app/).
For another deployment, import the repository into Vercel and set
`AMC_VENDOR_API_KEY` as a server-side environment variable.

The app uses AMC for showtimes and OpenStreetMap Nominatim to resolve ZIP codes.
It is intended for personal use and has no sign-in or app-level rate limiting;
use Vercel Deployment Protection if access should be restricted.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```
