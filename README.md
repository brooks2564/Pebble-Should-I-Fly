# Should I Fly?

![Should I Fly?](screenshots/banner.png)

A Pebble watchapp for drone pilots in the **United States**. Open it before a flight and get a one-glance **GO / CAUTION / NO-GO** verdict, based on wind at flying altitudes, weather, and FAA airspace restrictions around you.

Works on **Pebble Time 2 (emery)** and **Pebble Round 2 (gabbro)**.

> **Advisory only.** This app is a convenience, not an authority. Data can be late, incomplete, or wrong. Always confirm in the FAA's B4UFLY app or another official source, and follow all FAA rules (Part 107 / recreational flyer rules), before you fly.

## Screens

Use **UP / DOWN** (or swipe on the touchscreen) to move between pages. **SELECT** or a **tap** on the touchscreen refreshes.

| Page | What it shows |
|------|---------------|
| Verdict | GO / CAUTION / NO-GO and the most important reason |
| Wind | Wind speed at 0, 100, 200, 300 and 400 ft, wind direction, estimated gusts |
| Conditions | Temperature, sky, rain, visibility, GPS storm (Kp) index, sunrise and sunset |
| Airspace | FAA ceiling at your spot, and nearby zones with distance and direction |
| Warnings | Every reason not to fly, worst first |
| Next 6 hours | Wind at 400 ft each hour, color coded, with the best time to fly |

The watch vibrates when the verdict is CAUTION or NO-GO (can be turned off), and can play a sound (off by default, see Settings). The 6-hour chart covers weather only, not airspace.

## What it checks

- **Wind and gusts** at 0, 100, 200, 300 and 400 ft
- **Temperature**, with cold-battery and heat warnings
- **Rain, snow, thunderstorms** and **visibility** (3 mile minimum for line of sight)
- **Geomagnetic storms** (Kp index), which can disturb GPS
- **Night and twilight** (anti-collision light reminder)
- **Temporary Flight Restrictions (TFRs)**, including VIP, security, hazard and air show TFRs
- **Controlled airspace** (Class B, C, D and surface Class E) and the **FAA UAS Facility Map** ceiling for your exact location
- **Prohibited and Restricted areas**
- **Military and national security UAS restrictions**
- **Stadiums** (restricted during events)
- Zones within **5 miles**, with distance and compass direction

## How the verdict works

| | CAUTION | NO-GO |
|---|---|---|
| Wind at 400 ft | 15 mph or more | 24 mph or more |
| Gusts (estimated at 400 ft) | 20 mph or more | 30 mph or more |
| Temperature | 40 F or below, 95 F or above | 14 F or below, 104 F or above |
| Visibility | under 3 mi | under 1 mi |
| Rain | light rain or drizzle | measurable rain, thunderstorm |
| Kp index | 5 or more | 7 or more |
| Airspace | FAA grid ceiling under 400 ft, controlled airspace, nearby TFR, stadium | inside a TFR, Prohibited, Restricted or military zone, FAA grid ceiling of 0 ft |
| Other | night flight, airspace data unavailable | |

All limits are adjustable in Settings (below). The numbers above are the defaults.

## Settings

Open the app's settings from the Pebble phone app (tap the app, then the gear). Everything is optional.

| Group | Options |
|-------|---------|
| Units | Wind: mph, knots, m/s, km/h. Temperature: F or C. Distance and altitude: feet and miles, or meters and kilometers |
| Flight | Max flight altitude (100 to 500 ft, default 400), airspace search radius (1 to 10 mi, default 5), night-flight warning on or off, stadium warning on or off |
| Wind limits | Caution and no-go for wind and for gusts |
| Temperature limits | Cold and hot caution and no-go |
| Visibility and GPS | Visibility caution and no-go, Kp index caution and no-go |
| Alerts | Vibration on or off, sound on or off, volume |

Limits are entered in mph, F, miles and feet, whatever units you display. The wind screen shows five rows from 0 up to your max altitude.

## Sounds

Turn on **Play sounds** in Settings. Each time new data arrives the watch plays:

- **GO**: a bright rising chime (four notes going up)
- **CAUTION**: a soft two-tone descending "uh-oh" (triangle wave)
- **NO-GO**: a low buzzer (three square-wave bursts)

Sounds follow the watch's own mute and Quiet Time settings. They need a watch with a speaker, which both emery and gabbro have.

## Data sources (all free, no API keys)

- Weather and winds: [Open-Meteo](https://open-meteo.com)
- Space weather: [NOAA SWPC](https://www.swpc.noaa.gov)
- UAS Facility Map, Class airspace, Special Use Airspace, military restrictions, stadiums: FAA public ArcGIS services
- TFRs: FAA TFR service (tfr.faa.gov)

Your location is sent only to these services to look up conditions. Nothing is stored or sent anywhere else.

## Install

Open this link in CloudPebble to import and build:

https://cloudpebble.repebble.com/ide/import/github/brooks2564/Pebble-Should-I-Fly

Or build locally:

```bash
pebble build
pebble install --phone <phone-ip>
```

The app needs location permission on your phone (Pebble app settings).

## Limitations

- **US only.** Airspace data covers the United States.
- Weather models report wind at 10 m, 80 m and 120 m only. The 0 ft value is the 10 m (33 ft) wind, and 100, 200 and 300 ft are interpolated between those heights.
- Gusts are an estimate: the 10 m gust excess is added to the 400 ft wind.
- Wind and weather come from forecast models, not a sensor at your location.
- National parks, state parks, and local rules are **not** checked. Many ban drones.
- Part-time restrictions and some TFRs may change faster than the data refreshes.

## Project layout

```
src/c/main.c        Watch UI (6 pages, buttons and swipe)
src/pkjs/index.js   Phone side: location, data fetching, airspace math, verdict
tools/make_assets.py  Generates banner, icons and menu icon
screenshots/        Store banner, icons and watch screenshots
```

Author: Brooman Inks
