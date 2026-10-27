# Agronica Mistletoe Marker

Offline-capable PWA (plain HTML/CSS/JS) for marking mistletoe on the LEFT or RIGHT of a row with GPS, exporting KML, and **finding** those marks again later with proximity alerts.

Live: https://jonathanagronica.github.io/agronica-mistletoe-marker/

## Modes (bottom tabs)
**Mark** – press START, then the huge LEFT / RIGHT buttons to drop a GPS mark. Menu: export/share KML, import KML, clear.

**Other Left / Other Right** (Mark tab, under the big buttons) – opens a quick bottom sheet: *Broken irrigation*, *Phytophthora treatment*, *Nutritional issue* (or Cancel). Records a mark at the position where the button was tapped, e.g. `L-5 Broken irrigation`. KML export uses a distinct icon colour/shape per category (`cat-irrigation` cyan water, `cat-phytophthora` purple triangle, `cat-nutrition` pink square) and writes `Category:` in the description plus `cat` in ExtendedData; import restores it. Shown in the marks list and maps.

**Find** – load a KML (file picker, drag & drop, "open with"/share to the installed app on Android/Chromium; the app's own export or any KML with points). Press START TRACKING:
- nearest unfound mark: distance, bearing arrow (device compass if available – iOS asks permission – otherwise direction of travel), LEFT/RIGHT label (as marked; for foreign points without a side it is relative to your heading)
- alerts at the alert radius (default 30 m, slider 5–100 m), at half radius and "arrived" (≤5 m, or radius/3 for tiny radii): escalating vibration + Web Audio beeps, optional spoken alert ("Mistletoe left, 20 metres")
- FOUND / TREATED buttons stop alerts for that point; progress "X of Y found"; **Find these** category filter (default all) limits targets, alerts, list and map; category points announce e.g. "Broken irrigation left, 20 metres"; list sorted by distance; map of points and your track
- sessions persist in localStorage; **Export found** writes a KML with found/treated status (re-importable)

## Files
`index.html`, `style.css`, `app.js` (shell, Mark mode, shared GPS, wake lock), `find.js` (Find mode), `geo.js` (haversine/bearing/alert logic), `kml.js` (KML build/parse), `manifest.json`, `img/` (Agronica website photos as dark-overlaid backgrounds, from agronicaag.com), `sw.js` (service worker, cache `mistletoe-marker-v4`), `icons/`. Paths are relative so the app works under a subpath.

## Tests
```
npm i @xmldom/xmldom puppeteer-core            # somewhere on NODE_PATH
NODE_PATH=... node tests/logic.test.js         # geo + KML logic
python3 -m http.server 8123 &                  # then:
NODE_PATH=... node tests/ui.test.js            # headless Chrome with simulated GPS
```

## Limitations
Browsers suspend web pages when the screen is off: alerts only work while the app is open and the screen is on (Wake Lock keeps it on while tracking). iOS Safari has no vibration API (beeps/speech only) and cannot receive "share to app" files (use Load KML).

## Hosting
GitHub Pages, branch `main`, root (`/`).
