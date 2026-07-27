# UK Canal Route Map

A single-page, self-hosted interactive map: day tabs, a route line per day,
numbered/photo markers, and a stop panel with times, notes, and ratings —
same interaction pattern as the reference screenshot, built with free tools
(Leaflet + OpenStreetMap/CARTO tiles) so there's no API key or billing
account to manage.

## Structure

```
index.html             the page shell
style.css              all styling (dark map + floating panel)
src/app.ts             TypeScript source — edit this
app.js                 compiled output — what index.html actually loads
data/stops.json        all trip content (days, stops, times, photos, notes)
data/route.json        canal polylines per day (generated; commit this)
scripts/build-route.mjs  fetches OSM canal geometry → data/route.json
tsconfig.json          compiler config
package.json           build scripts
```

**To change the content** (dates, stops, notes, photos), edit
`data/stops.json` — no rebuild needed for text/photos. If you move stop
coordinates, also regenerate the canal lines:
```
npm run build:route
```

**To change the behavior/UI**, edit `src/app.ts`, then run:
```
npm install
npm run build
```
This regenerates `app.js`. Commit both `src/app.ts` and the regenerated
`app.js` — GitHub Pages serves static files only, so the compiled output
has to be in the repo, not built on the fly.

## Run locally

Any static file server works, e.g.:
```
npm run serve
```
or just open `index.html` directly in a browser (fetch of stops.json may
be blocked by some browsers' local file restrictions — a local server
avoids that).

## Deploy on GitHub Pages

1. Create a new repo and push this folder to it:
   ```
   git init
   git add .
   git commit -m "Initial trip map"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo-name>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source** →
   "Deploy from a branch" → branch `main`, folder `/ (root)` → Save.
3. GitHub gives you a URL like
   `https://<you>.github.io/<repo-name>/` — that's the link to send
   yourself (or hand to your OpenClaw agent) to open on your phone.

No GitHub Actions, no build step required on GitHub's side — `app.js` is
already committed, so Pages just serves the files as-is.

## Notes

- Map tiles are CARTO's free dark basemap (no key required) instead of
  Google Maps, to avoid needing an API key/billing account for something
  this static. If you'd rather use Google Maps JS API for a closer visual
  match, that's a straightforward swap in `src/app.ts` but does require
  your own API key.
- Canal route lines are real OpenStreetMap waterway geometry (Trent &
  Mersey + Staffs & Worcs), baked into `data/route.json` at build time.
- The site asks for your location on load and snaps a "you are here" dot
  onto the canal corridor. HTTPS is required (GitHub Pages provides that).
- Photo URLs in `stops.json` are Google Places photo links, which can
  expire after a while. If a photo goes blank, swap in a fresh URL or a
  self-hosted image.
- Rating counts marked `null` in `stops.json` are unknown/unverified —
  don't treat every number in there as a live, current rating; refresh
  from Google Maps directly if that matters to you.
