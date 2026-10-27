# Agronica Mistletoe Marker

Offline-capable PWA (plain HTML/CSS/JS) for marking mistletoe on the LEFT or RIGHT of a row with GPS, exporting KML, and **finding** those marks again later with proximity alerts.

Live: https://jonathanagronica.github.io/agronica-mistletoe-marker/

## Modes (bottom tabs)
**Mark** – press START, then the huge LEFT / RIGHT buttons to drop a GPS mark. Menu: export/share KML, import KML, clear.

**Other Left / Other Right** (Mark tab, under the big buttons) – opens a quick bottom sheet: *Broken irrigation*, *Phytophthora treatment*, *Nutritional issue* (or Cancel). Records a mark at the position where the button was tapped, e.g. `L-5 Broken irrigation`. KML export uses a distinct icon colour/shape per category (8 styles: `markL`/`markR` blue/orange circles, and `cat-<type>-L`/`-R` dark/light shades: irrigation cyan water drop, phytophthora purple triangle, nutrition pink square; older `#cat-<type>` exports still import) and writes `Category:` in the description plus `cat` in ExtendedData; import restores it. Shown in the marks list and maps.

**Find** – load a KML (file picker, drag & drop, "open with"/share to the installed app on Android/Chromium; the app's own export or any KML with points). Press START TRACKING:
- nearest unfound mark: distance, bearing arrow (device compass if available – iOS asks permission – otherwise direction of travel), LEFT/RIGHT label (as marked; for foreign points without a side it is relative to your heading)
- alerts at the alert radius (default 30 m, slider 5–100 m), at half radius and "arrived" (≤5 m, or radius/3 for tiny radii): escalating vibration + Web Audio beeps, optional spoken alert ("Mistletoe left, 20 metres")
- FOUND / TREATED buttons stop alerts for that point; progress "X of Y found"; **Find these** category filter (default all) limits targets, alerts, list and map; category points announce e.g. "Broken irrigation left, 20 metres"; list sorted by distance; map of points and your track
- sessions persist in localStorage; **Export found** writes a KML with found/treated status (re-importable)

## v9: satellite maps, About, Help, ad strip
- **Satellite maps everywhere** (Find map, the Menu map, the About location pin): Leaflet with Esri World Imagery tiles under the track, marks (same per-type colours/shapes, L darker / R lighter), your position + GPS accuracy circle + heading, the Find alert-radius circle, and found/treated styling. Tap a mark for details (Found / Treated buttons in Find). Buttons: **Follow me**, **Fit** (auto-fit to data; panning turns it off), **Labels** (place-names overlay, remembered), **Save map area for offline**. The legend is kept. Attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community".
- The Mark screen has no map (it would shrink the big LEFT/RIGHT buttons); the live map is in the Menu.
- **Offline tiles**: the service worker caches viewed tiles in `mistletoe-tiles-viewed` (capped at 2000, oldest evicted); "Save map area for offline" downloads the current view from the current zoom up to zoom 19 (as many zoom levels as fit in 1500 tiles; zoom in closer and save again for the deepest levels) into `mistletoe-tiles-saved` (cap 4000). Both caches survive app updates. With no signal and no cached tile the map shows its dark background and a note; GPS, marks and track still work.
- **About Agronica** (small link at the top of Mark and Find, and in the Menu): services blurb, tap-to-call, tap-to-email, website, Open in Maps, satellite pin. Contact details are those published at agronicaag.com/contact; the pin is approximate (Goodwood Road, Alloway).
- **Help bot** (cartoon avatar button at the top right, and in the Menu): offline keyword-matched FAQ with quick-reply chips and a "Contact Agronica" fallback. FAQ lives in `extras.js`.
- **Ad strip**: a slim 44px strip above the tab bar (hidden on very short screens), cycles every 6 s (paused briefly while marking), never pops up. Edit **`ads.json`** to change ads (name, by, text, image, url) - no code change, fetched network-first. Ad logos are the advertisers' own, downloaded locally into `img/ads/`.
- Test hook: `localStorage['mm-tile-url']` / `['mm-label-url']` override the tile templates (the headless tests serve stub tiles from a local server).

## v11: opt-in research data sharing
- **Welcome sheet** (first run only; re-open any time from Menu -> *Research & data sharing*): friendly Agronica intro, explains the mistletoe modelling database (distribution + severity across districts), lists exactly what is shared, and has the **"Share my marks with Agronica for research"** checkbox - **OFF by default** - plus optional name / email / farm / district / default variety (A4, A16, A38, 741, 344, 246, 816, 842, 660, Other + free text) and a *Not now* button. Sharers can request access to the combined district data.
- **Severity chips**: after each mistletoe LEFT/RIGHT mark a Light / Moderate / Heavy row shows for ~4 s (non-blocking; unset by default). **Variety** per session is chosen in the Menu and stamped on new marks. Both are in the marks list and in KML export/import (`severity` / `variety` ExtendedData + description lines, also in Find exports).
- **Upload** (only when opted in): marks and a thinned track (>= 15 m apart) are queued in localStorage and POSTed as JSON to `INGEST_URL` (header `X-Ingest-Key` if `INGEST_KEY` is set) in batches (<= 200 marks / 1000 track pts), retrying with exponential backoff (15 s ... 1 h) when online, on app resume, on reconnect and with **Sync now**. Marks are deduped by id; a failing/absent server just leaves the queue in place. Only marks made *after* opting in are queued. Opting out stops uploads and clears the queue. Payload: `{deviceId, appVersion, sessionId, submittedAt, consent:true, contact?, district?, variety?, marks:[{id, lat, lon, accuracy, side, category, time, status?, severity?, variety?}], track?:[{lat,lon,time}]}`; `category` is `mistletoe | broken-irrigation | phytophthora | nutrition`. A mark whose severity is set after it was uploaded is re-sent with the same id (server should upsert on `id`).
- **Request collaborative data** (enabled once opted in and one sync has succeeded): email required, POSTs `{deviceId, name, email, farm, district, message}` to `ACCESS_URL`; queued when offline; if the endpoint answers 404 the app opens a prefilled `mailto:jonathan@agronicaag.com`.
- Config lives in `config.js` (`INGEST_URL`, `INGEST_KEY`, `ACCESS_URL`). The server must allow CORS for `POST` with `Content-Type: application/json` and `X-Ingest-Key` (preflight).
- Macca's FAQ covers sharing, collaborative data and severity/variety. Tests: `tests/share.test.js` (core with mocked fetch, KML), `tests/share.ui.test.js` (welcome, chips, upload, access request, FAQ; fetch mocked in-page).

## v12: AgronicaWorld ingest is live
- `config.js`: `INGEST_KEY` is set (sent as `X-Ingest-Key`; it is meant to sit in this static app - the server only accepts the origin `https://jonathanagronica.github.io`), plus `ACCESS_STATUS_URL`.
- Payload follows the server contract: `deviceId` is a UUID (`crypto.randomUUID`, old `mm-...` ids are migrated), `appVersion` <= 32 chars, `sessionId` <= 64 chars of `[A-Za-z0-9._:-]` (sanitised), `consent` exactly `true`, mark ids unique per submission and <= 64 chars, `time` ISO. Severity, variety and district are still sent (ignored by the server until supported).
- Chunking: <= 5000 marks, <= 20000 track points and < 1 MB per request. `429` honours `Retry-After` (no requests until then, also for Sync now). `400`/`413`: the batch is split to isolate invalid marks, which are dropped and logged (`console.warn`, shown as "rejected by server"); if everything is rejected the queue is kept (payload-wide error). `401`/`403`/`405`/5xx/network: queue kept, exponential backoff.
- Access request needs name + email; the reply status is `pending` or `approved`. **Access status** (`GET access-status?deviceId=`) is shown in the Research screen and re-checked on open, on resume and after syncs: `none | pending | approved | rejected | revoked | expired`. When approved: **Download KML / CSV** and **Load pooled data in Find/map** (parses the KML into a separate read-only, anonymised layer drawn on the Menu and Find maps; names/ids are discarded, in-memory only).

## Files
`index.html`, `style.css`, `app.js` (shell, Mark mode, shared GPS, wake lock), `find.js` (Find mode), `geo.js` (haversine/bearing/alert logic), `kml.js` (KML build/parse), `manifest.json`, `img/` (Agronica website photos as dark-overlaid backgrounds and the white `agronica-logo.svg`, from agronicaag.com; the logo is shown full-strength in the header and at ~55% opacity as a brand mark at the top of each view), `map.js` (Leaflet satellite map component), `extras.js` (About, Help bot, ad strip), `ads.json`, `vendor/leaflet/` (Leaflet 1.9.4, BSD-2, vendored - no CDN), `sw.js` (service worker, cache `mistletoe-marker-v12`), `config.js` + `share.js` (research data sharing), `icons/`. Paths are relative so the app works under a subpath.

## Updates
The service worker uses `skipWaiting` + `clients.claim`; the app shell (html/js/css/manifest) is network-first with a 3 s timeout (cache fallback offline). When a new version takes over the page reloads itself ("App updated - reloading...") - or, if GPS is running, as soon as it is stopped. Bump `CACHE` in `sw.js` on every release.

## Icon / photo credit
The app icon (`icons/`) is a circular crop of a real photograph of macadamia leaves and nuts: *Macadamia integrifolia (leaves and immature nuts)*, photo by **Forest & Kim Starr** (Starr Environmental), Maui, 2008 - via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Starr_080715-9231_Macadamia_integrifolia.jpg), licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Cropped, colour-adjusted (slightly darkened) and composited on the Agronica orange (#ffb400) rounded square, with the white Agronica "a" mark (from `img/agronica-logo.svg`) shaded over it at 55% opacity.

## Tests
```
npm i @xmldom/xmldom puppeteer-core            # somewhere on NODE_PATH (the UI test serves stub map tiles itself - no internet needed)
NODE_PATH=... node tests/logic.test.js         # geo + KML logic
python3 -m http.server 8123 &                  # then:
NODE_PATH=... node tests/ui.test.js            # headless Chrome with simulated GPS
```

## Credits
Leaflet 1.9.4 (BSD-2-Clause, `vendor/leaflet/LICENSE`). Imagery © Esri and partners (Maxar, Earthstar Geographics, GIS User Community). Product names/logos in `ads.json` belong to their owners.

## Limitations
Browsers suspend web pages when the screen is off: alerts only work while the app is open and the screen is on (Wake Lock keeps it on while tracking). iOS Safari has no vibration API (beeps/speech only) and cannot receive "share to app" files (use Load KML).

## Hosting
GitHub Pages, branch `main`, root (`/`).
