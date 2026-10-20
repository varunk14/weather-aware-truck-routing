# Design decisions

This document records how the specification was interpreted where it leaves room for judgement,
and the main technical choices behind Clearway. Entries describe the intended behaviour; the
README states what is implemented so far.

## Interpreting the specification

### 1. The checkpoint interval is selectable

The specification lists 10, 25 and 50 miles. The user picks one of the three when planning a trip;
the default is 25 miles.

### 2. Threshold bands include their lower bound

Adjacent bands in the risk table share edge values (0.25 in/hr of rain appears in both Moderate
and High). Each band includes its lower bound and excludes its upper bound, so a value on an edge
belongs to the higher band. The top bands keep the table's own wording: wind of 55 mph or more is
No Travel, while rain above 1.00 in/hr and snow above 3.0 in/hr are No Travel. Exactly 1.00 in/hr
of rain and exactly 3.0 in/hr of snow are therefore Severe.

### 3. A checkpoint is as risky as its worst condition

Wind, rain and snow are classified separately; the checkpoint takes the highest of the three
levels, and the load rules are then applied.

### 4. Load rules only raise risk

The load rules escalate wind risk for heavy loads (45 to 54 mph over 30,000 lb becomes No Travel;
35 to 44 mph over 40,000 lb becomes Severe). They never lower a level set by rain or snow.

### 5. Rain includes showers

Open-Meteo reports steady rain (`rain`) and convective showers (`showers`) separately. The rain
rate used for classification is their sum, so thunderstorms are not undercounted.

### 6. Wind means sustained wind

Classification uses the sustained 10 m wind speed. Gusts are shown for context only.

### 7. Each checkpoint represents a stretch of road

A checkpoint covers the road from halfway back to the previous checkpoint to halfway forward to
the next one. The length of that stretch counts toward the route's Severe and High miles.

### 8. No Travel ranks below everything else

The ranking in the specification starts with Severe miles but does not mention No Travel. Any route
with No Travel miles ranks below every route without them. The specification's order follows:
fewest Severe miles, fewest High miles, lowest average risk, shortest travel time.

### 9. Average risk is weighted by distance

Levels are scored Low 0, Moderate 1, High 2, Severe 3, No Travel 4. A route's average risk is the
mean score weighted by the miles each checkpoint covers.

### 10. Forecast hours count from departure

The 0 to 48 hour heatmap slider starts at the departure time, since that is when the weather starts
to matter for the trip.

### 11. The heatmap shows combined risk by default

The default layer is the same risk level used for ranking. Wind, rain and snow can be shown
individually to explain it.

### 12. Times are stored in UTC

All times are handled in UTC and shown in the origin's local time with the time zone labelled.

### 13. Departure within the next seven days

This keeps the whole trip and the 48 hour heatmap inside the forecast range.

### 14. Load weight between 1 and 80,000 lb

80,000 lb is the US federal maximum gross vehicle weight on interstate highways.

### 15. US customary units

Distances in miles, weight in pounds, wind in mph, precipitation in inches per hour, as in the
specification.

### 16. No persistence

There are no accounts or saved trips. Third-party responses are cached in memory only.

## Technical choices

### 17. TomTom for routing and geocoding

TomTom's truck travel mode takes the vehicle weight into account, returns up to five alternative
routes, and the same account covers geocoding and address suggestions.

### 18. Always three routes

TomTom may return fewer alternatives than requested when no sensible ones exist. In that case
additional routes are requested through a via point offset from the main route.

### 19. Open-Meteo for weather

Free, no API key, hourly forecasts in mph and inches, and many locations in one request.

### 20. Third-party calls go through the API

The browser only talks to Clearway's API, so the TomTom key never reaches the client.

### 21. MapLibre GL with OpenFreeMap

WebGL rendering keeps panning, zooming and the heatmap smooth; OpenFreeMap provides vector tiles
without a key.

### 22. Heatmap frames load together

All 0 to 48 hour frames arrive in one response, so moving the slider never waits on the network.

### 23. Hosting

The web app is served as a static site and the API as a separate web service. An uptime monitor
calls the health endpoint so the API stays responsive.

### 24. Django 5.2 LTS without a database

Long-term support release; all dependencies support it. The API is stateless, so no database is
configured.

## Interface

### 25. Product name

The app is called Clearway: finding the clear road.

### 26. Visual design

Light, warm surfaces with navy text and a teal accent, set in DM Sans. Green, yellow, orange, red
and purple are reserved for risk levels and never used as interface colours.

### 27. One risk scale everywhere

Checkpoint markers, route bars, labels and the heatmap use the same five colours. Risk is never
shown by colour alone: every level is also named.

### 28. The heatmap shows true levels

Each location on the heatmap shows its actual risk level, rather than a density blend that would
overstate risk where samples cluster.
