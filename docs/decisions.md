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

### 17. Small differences do not decide the ranking

Miles are compared to the nearest 0.1 mile and average risk to three decimals, so floating-point
noise never makes one route rank above another that is equal in practice.

### 18. Warn when every route crosses No Travel conditions

If even the best route has No Travel miles, the recommendation says so and suggests a later
departure instead of presenting that route as safe.

## Technical choices

### 19. TomTom for routing and geocoding

TomTom's truck travel mode takes the vehicle weight into account, returns up to five alternative
routes, and the same account covers geocoding and address suggestions.

### 20. Always three routes

TomTom may return fewer alternatives than requested when no sensible ones exist. Extra routes are
then requested through a point offset to either side of the main route's midpoint, and kept only
if less than 90% of their length runs within 2 km of a route already found. These routes are
marked as detours, and the response notes when fewer than three distinct routes exist.

### 21. Open-Meteo for weather

Free, no API key, hourly forecasts in mph and inches, and many locations in one request.

### 22. Third-party calls go through the API

The browser only talks to Clearway's API, so the TomTom key never reaches the client.

### 23. MapLibre GL with OpenFreeMap

WebGL rendering keeps panning, zooming and the heatmap smooth; OpenFreeMap provides vector tiles
without a key.

### 24. Heatmap frames load together

All 0 to 48 hour frames arrive in one response, so moving the slider never waits on the network.

### 25. Hosting

The web app is served as a static site and the API as a separate web service. An uptime monitor
calls the health endpoint so the API stays responsive.

### 26. Django 5.2 LTS without a database

Long-term support release; all dependencies support it. The API is stateless, so no database is
configured.

### 27. Arrival times follow TomTom's travel times

TomTom reports road distance and travel time (including historic traffic for the departure time)
at points along each route. Checkpoint arrival times are interpolated between those points rather
than assuming a constant speed, so slow urban stretches are reflected.

### 28. Places anywhere, trips up to 3,500 miles

The specification names no region, so places can be anywhere TomTom has truck routing: the
United States, Canada, Europe, Australia, India and most other regions. Distances, speeds and
weights stay in the specification's US units everywhere. A trip may be at most 3,500 miles (US
coast to coast is about 2,800): longer trips would need thousands of forecast locations and
could run past the 16 day forecast. The limit is checked first on the straight-line distance,
so a trip across an ocean is refused without a routing request, and then on the shortest route.

### 29. The map receives a simplified route line

Routes arrive with 10,000 or more points. The browser gets a version simplified to within 30 m of
the road (a few hundred points); checkpoints are placed on the full-detail route.

### 30. Caching and rate limits protect the routing quota

Identical trips are cached for 15 minutes and place lookups for a day. Each client is limited to
60 suggestion and 10 route requests per minute.

### 31. A departure a few minutes in the past is accepted

The routing API itself accepts any past departure, so the API enforces the window: from 15
minutes ago, so a form filled in at "now" is not rejected, up to 7 days ahead.

### 32. Weather for the hour the truck arrives

Open-Meteo reports rain, showers, snowfall and gusts over the hour ending at each time, so a
checkpoint reached at 12:37 uses the 13:00 values (12:00 to 13:00). Wind speed is an instant
value and comes from the nearest hour. If a value is missing, the nearest hour at most two hours
away that has it is used (rain and showers always from the same hour); beyond that the plan fails
with a clear message rather than guessing.

### 33. One weather lookup for all three routes

The checkpoints of every route are looked up together. Checkpoints within 0.01 degrees (about
1 km) share one forecast, which merges the shared origin and destination. A coarser grid was
measured and saves almost nothing (Chicago to Denver at 10 miles: 351 locations at 0.01 degrees,
349 at 0.05), because the routes' checkpoints rarely fall close together. Up to 200 locations go
into one request, the most a request URL carries safely. Larger trips are split into batches
ordered by arrival time, so each request only asks for the hours its checkpoints need, and the
batches are fetched in parallel with a 10 second timeout each.

### 34. The weather quota

Open-Meteo's free tier allows 600 calls a minute, 5,000 an hour and 10,000 a day; Clearway counts
each location as one call. Chicago to Denver needs 71 locations at 50 mile spacing, 141 at 25
miles and 351 at 10 miles, so the daily limit covers about 70 trips at the default spacing. Plans
are cached for 15 minutes, and if Open-Meteo starts rate limiting, the API says the weather
service is busy instead of failing silently.

### 35. Machine-readable risk levels

The API reports levels as `low`, `moderate`, `high`, `severe` and `no_travel`, with the numeric
score alongside, so the interface can choose labels and colours without parsing text.

## Interface

### 36. Product name

The app is called Clearway: finding the clear road.

### 37. Visual design

Light, warm surfaces with navy text and a teal accent, set in DM Sans. Green, yellow, orange, red
and purple are reserved for risk levels and never used as interface colours.

### 38. One risk scale everywhere

Checkpoint markers, route bars, labels and the heatmap use the same five colours. Risk is never
shown by colour alone: every level is also named.

### 39. The heatmap shows true levels

Each location on the heatmap shows its actual risk level, rather than a density blend that would
overstate risk where samples cluster.

### 40. Built for phones as well as desktops

Every screen works on phones from 360 px wide as well as on tablets and desktops: no horizontal
scrolling, touch targets of at least 44 px, inputs large enough to avoid zoom on focus, and respect
for the notch and home-indicator areas. The end-to-end tests run on a desktop and a mobile device
profile.

### 41. A bottom sheet on phones

On phones the map fills the screen and the trip sits in a sheet over it, as in map apps. The sheet
has three positions: a peek with the trip summary and the recommendation, half height with the
route cards, and full height with everything, including the trip form. Its handle is a button
(tap to cycle, arrow keys to step) and it can also be dragged. Picking a route or a checkpoint
lowers the sheet so the map shows it. Wider screens keep the side panel.

### 42. Everything on the map is also in the panel

Each route card gives distance, time, arrival and the miles at each risk level in numbers, and the
selected route lists its checkpoints above Low risk. Picking one opens the same details as tapping
it on the map, so the result can be read without the map, with a keyboard or a screen reader.

### 43. Times are shown where they happen

Departure and checkpoint arrival times are shown in the origin's local time and arrival at the
destination in the destination's, each with its UTC offset, rather than in the viewer's time zone.
The departure is entered in the viewer's own time, which the form says.

### 44. Waiting is explained

A plan takes about five to ten seconds, mostly for routing. The panel says what is happening, counts
the seconds, says so if a service is slow, and can be cancelled. A cancelled request leaves the
previous plan on screen.
