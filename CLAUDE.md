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
- `src/pkjs/index.js` does everything smart: Clay settings, geolocation, fetches (Open-Meteo, NOAA Kp, FAA ArcGIS, FAA TFR WFS), point-in-polygon and distance math, unit conversion, and the verdict. It sends 5 small AppMessages in sequence (send queue, one at a time); the verdict message (m1, with SOUND/VOLUME/VIBE) goes last because it triggers vibration and sound on the watch.
- Settings: `src/pkjs/config.json` (Clay, `@rebble/clay`). Keys are `SET_*`; every one must also be in package.json messageKeys. JS reads them from localStorage `clay-settings` (`loadSettings()`); a `webviewclosed` listener re-runs the fetch. Limits are stored in mph/F/mi/ft regardless of display units.
- The watch is dumb: it displays pre-formatted strings and severities from the phone. Sound uses `speaker_play_notes` (GO chime, CAUTION descending triangle, NO-GO square buzzer), skipped when `speaker_is_muted()`.
- `src/c/main.c` only displays. One canvas layer, 6 pages, UP/DOWN or swipe to change page, SELECT or a touchscreen tap sends REQUEST to refresh. Background is pure black.
- First launch shows a disclaimer window (persist key 1, `PERSIST_DISCLAIMER`). SELECT or tap accepts, BACK exits. Alerts are silenced while it is up. To see it again in the emulator, delete the platform's `qemu_spi_flash.bin`. Screenshots `0-disclaimer.png` are in each platform folder.
- List text format sent to the watch: `<sev digit><title>\t<detail>` per line (0 info, 1 caution, 2 no-go).
- Wind rows use linear interpolation between the model heights 10/80/120/180 m (`windAt`).

## Message keys
See package.json (display keys plus `SET_*` settings keys). After changing keys run `pebble clean` before `pebble build`.

## Testing without a phone
Node shim (not committed): fake `XMLHttpRequest` (via fetch), `navigator.geolocation` (use `Object.defineProperty(globalThis,'navigator',...)` on Node 24), `localStorage` returning a fake `clay-settings` JSON, `Pebble`, and run `src/pkjs/index.js` inside `new Function('require', src)` with a stub require. Good spots: Addison TX (32.97 -96.84, Class D, ceiling 0), Washington DC (38.8895 -77.0353, many zones).

## Gotchas
- Emulator "While your Pebble was off wakeup events" dialog blocks the app: delete `~/.pebble-sdk/4.33.1/<platform>/qemu_spi_flash.bin` and reinstall.
- ArcGIS queries use a 5 mile buffer and `maxAllowableOffset` to keep geometry small. MODE C veil is excluded.
- Never commit a build with fake data.

## Assets
`python3 tools/make_assets.py` regenerates `screenshots/banner.png` (720x320), icons 144/80/25, and `resources/images/menu_icon.png` (25x25).

## Screenshots
`screenshots/emery/` and `screenshots/gabbro/` hold one PNG per page (1-verdict to 6-next-6-hours), taken in the emulator at 12:15 PM with a GO verdict (location 33.2 -97.5). Because real conditions change, they were made from a scratch copy of the project whose pkjs treats the forecast's 12:00 hour as "now". Never commit that patched copy or its pbw. Reset the emulator flash and use `pebble emu-set-location` before capturing.
