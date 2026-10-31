# Should I Fly?

A Pebble watchapp for drone pilots in the United States. Open it before a flight and get a one-glance GO, CAUTION or NO-GO verdict, based on wind at flying altitudes, weather, and FAA airspace restrictions around you.

Works on Pebble Time 2 (emery) and Pebble Round 2 (gabbro).

Advisory only. This app is a convenience, not an authority. Data can be late, incomplete, or wrong. Always confirm in the FAA's B4UFLY app or another official source, and follow all FAA rules (Part 107 or recreational flyer rules) before you fly.

## Screens

Use UP and DOWN (or swipe on the touchscreen) to move between pages. SELECT, or a tap on the touchscreen, refreshes.

- Verdict: GO, CAUTION or NO-GO and the most important reason
- Wind: wind speed at 0, 100, 200, 300 and 400 ft, wind direction, estimated gusts
- Conditions: temperature, sky, rain, visibility, GPS storm (Kp) index, sunrise and sunset
- Airspace: FAA ceiling at your spot, and nearby zones with distance and direction
- Warnings: every reason not to fly, worst first
- Next 6 hours: wind at your max altitude each hour, color coded, with the best time to fly

The watch vibrates when the verdict is CAUTION or NO-GO (this can be turned off), and can play a sound (off by default, see Sounds). The 6-hour chart covers weather only, not airspace.

## What it checks

- Wind and gusts at 0, 100, 200, 300 and 400 ft
- Temperature, with cold-battery and heat warnings
- Rain, snow, thunderstorms and visibility (3 mile minimum for line of sight)
- Geomagnetic storms (Kp index), which can disturb GPS
- Night and twilight (anti-collision light reminder)
- Temporary Flight Restrictions (TFRs), including VIP, security, hazard and air show TFRs
- Controlled airspace (Class B, C, D and surface Class E) and the FAA UAS Facility Map ceiling for your exact location
- Prohibited and Restricted areas
- Military and national security UAS restrictions
- Stadiums (restricted during events)
- Zones within 5 miles (adjustable), with distance and compass direction

## How the verdict works

These are the default limits. All of them can be changed in Settings.

CAUTION when any of these is true:
- Wind at 400 ft is 15 mph or more
- Gusts (estimated at 400 ft) are 20 mph or more
- Temperature is 40 F or below, or 95 F or above
- Visibility is under 3 miles
- There is light rain or drizzle
- Kp index is 5 or more
- The FAA grid ceiling is under 400 ft, you are in controlled airspace, a TFR or restricted zone is within 1 mile, or you are inside a stadium zone
- It is night
- Airspace data could not be fully loaded

NO-GO when any of these is true:
- Wind at 400 ft is 24 mph or more
- Gusts are 30 mph or more
- Temperature is 14 F or below, or 104 F or above
- Visibility is under 1 mile
- There is measurable rain or a thunderstorm
- Kp index is 7 or more
- You are inside a TFR, a Prohibited or Restricted area, or a military restriction zone
- The FAA grid ceiling is 0 ft

## Settings

Open the app's settings from the Pebble phone app (tap the app, then the gear). Everything is optional.

- Units: wind in mph, knots, m/s or km/h; temperature in F or C; distance and altitude in feet and miles, or meters and kilometers
- Flight: max flight altitude (100 to 500 ft, default 400), airspace search radius (1 to 10 miles, default 5), night-flight warning on or off, stadium warning on or off
- Wind limits: caution and no-go values for wind and for gusts
- Temperature limits: cold and hot caution and no-go values
- Visibility and GPS: visibility caution and no-go values, Kp index caution and no-go values
- Alerts: vibration on or off, sound on or off, volume

Limits are entered in mph, F, miles and feet, whatever units you display. The wind screen shows five rows from 0 up to your max altitude.

## Sounds

Turn on Play sounds in Settings. Each time new data arrives the watch plays one of three sounds:

- GO: a bright rising chime (four notes going up)
- CAUTION: a soft two-tone descending sound (triangle wave)
- NO-GO: a low buzzer (three square-wave bursts)

Sounds follow the watch's own mute and Quiet Time settings. Both emery and gabbro have a speaker.

## Data sources (all free, no API keys)

- Weather and winds: Open-Meteo (open-meteo.com)
- Space weather: NOAA Space Weather Prediction Center (swpc.noaa.gov)
- UAS Facility Map, Class airspace, Special Use Airspace, military restrictions, stadiums: FAA public ArcGIS services
- TFRs: FAA TFR service (tfr.faa.gov)

Your location is sent only to these services to look up conditions. Nothing is stored or sent anywhere else.

## Install

Open this link in CloudPebble to import and build:
https://cloudpebble.repebble.com/ide/import/github/brooks2564/Pebble-Should-I-Fly

Or build locally with "pebble build" and install with "pebble install --phone <phone-ip>".

The app needs location permission on your phone (Pebble app settings).

## Limitations

- US only. Airspace data covers the United States.
- Weather models report wind at 10 m, 80 m, 120 m and 180 m only. The 0 ft value is the 10 m (33 ft) wind, and the other rows are interpolated between those heights.
- Gusts are an estimate: the 10 m gust excess is added to the wind at your max altitude.
- Wind and weather come from forecast models, not a sensor at your location.
- National parks, state parks, and local rules are not checked. Many ban drones.
- Part-time restrictions and some TFRs may change faster than the data refreshes.

## Project layout

- src/c/main.c: watch UI (6 pages, buttons, swipe and tap, vibration and sound)
- src/pkjs/index.js: phone side (location, data fetching, airspace math, units, verdict)
- src/pkjs/config.json: settings page definition (Clay)
- tools/make_assets.py: generates the store banner, icons and menu icon
- screenshots: store banner, icons and watch screenshots

Author: Brooman Inks
