# Should I Fly? - Claude Code Instructions

## Overview
Pebble **watchapp** (not a watchface) for US drone pilots: GO / CAUTION / NO-GO verdict from wind at altitude, weather and FAA airspace. Platforms: **emery and gabbro only**.
Short name and long name: "Should I Fly?" (package.json top-level `name` and `pebble.displayName`).
UUID: `38588757-378f-434c-9819-e7134663a193`
GitHub: `brooks2564/Pebble-Should-I-Fly`

## Build & Install
```bash
pebble build
cp build/Pebble-Should-I-Fly.pbw Pebble-Should-I-Fly.pbw
pebble install --phone 192.168.0.228   # IPs drift, see memory
```

## Architecture
- `src/pkjs/index.js` does everything smart: geolocation, fetches (Open-Meteo, NOAA Kp, FAA ArcGIS, FAA TFR WFS), point-in-polygon and distance math, and the verdict. It sends 5 small AppMessages in sequence (send queue, one at a time).
- `src/c/main.c` only displays. One canvas layer, 6 pages, UP/DOWN or swipe to change page, SELECT or a touchscreen tap sends REQUEST to refresh. Background is pure black.
- List text format sent to the watch: `<sev digit><title>\t<detail>` per line (0 info, 1 caution, 2 no-go).
- Verdict limits live in `LIM` at the top of the pkjs file.

## Message keys
REQUEST, STATUS, VERDICT, REASON, W0, W100, W200, W300, W400, GUST, WDIR, TEMP, PRECIP, COND, VIS, CLOUD, KP, SUNRISE, SUNSET, NOWMIN, CEIL, HSTART, HW, HV, ZONES, ALERTS (see package.json).

## Testing without a phone
`node /tmp/harness.js <lat> <lon>` style shim: fake `XMLHttpRequest` (via fetch), `navigator.geolocation`, `Pebble` and eval `src/pkjs/index.js`. Good spots: Addison TX (32.97 -96.84, Class D, ceiling 0), Washington DC (38.8895 -77.0353, many zones).

## Gotchas
- Emulator "While your Pebble was off wakeup events" dialog blocks the app: delete `~/.pebble-sdk/4.33.1/<platform>/qemu_spi_flash.bin` and reinstall.
- ArcGIS queries use a 5 mile buffer and `maxAllowableOffset` to keep geometry small. MODE C veil is excluded.
- Never commit a build with fake data.

## Assets
`python3 tools/make_assets.py` regenerates `screenshots/banner.png` (720x320), icons 144/80/25, and `resources/images/menu_icon.png` (25x25).
