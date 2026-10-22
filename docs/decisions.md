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

### 13. Departure within the next ten days

Open-Meteo forecasts 16 days ahead. Ten days leaves room for the longest trip allowed (3,500
miles, about three days of driving) and the 48 hour heatmap, so every checkpoint has a forecast.
Hourly forecasts more than about a week ahead are much less certain, so the form says so when
the departure is that far out.

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

### 20. Three routes, in a few seconds

TomTom's own alternative routes take six to eleven seconds to compute for trips of a few hundred
miles or more, and fail on very long trips, while a single fastest route takes one to two
seconds. The fastest route and TomTom's alternatives are therefore requested together, and as
soon as the fastest route arrives, two more are requested through points offset to either side
of its middle (detours). TomTom's own alternatives are used if they arrive within four seconds;
after that, whichever complete set of three is ready first is used. A detour is kept only if
less than 90% of its length runs within 2 km of a route already found, and is marked as a detour
in the response. Nothing waits longer than 20 seconds; the response notes when fewer than three
distinct routes were found. Measured: Dallas to Houston 2.7 s, Chicago to Denver 4.3 s, Paris to
Madrid 6.7 s, Lisbon to Moscow 18 s (it used to fail).

### 21. Open-Meteo for weather

Free, no API key, hourly forecasts in mph and inches, and many locations in one request.

### 22. Third-party calls go through the API

The browser only talks to Clearway's API, so the TomTom key never reaches the client.

### 23. MapLibre GL with OpenFreeMap

WebGL rendering keeps panning, zooming and the heatmap smooth; OpenFreeMap provides vector tiles
without a key.

### 24. Heatmap frames load together

All 0 to 48 hour frames arrive with the plan, so moving the slider never waits on the network.
The corridor's weather is one Open-Meteo request, made at the same time as the checkpoints'
request, so it adds little to the planning time. If only that request fails, the plan is still
returned without a heatmap and the timeline says so.

### 25. Hosting

The web app is served as a static site and the API as a separate web service, both on Render's
free plan (`render.yaml`). The web app calls the API directly, which allows only the web app's
origin; a rewrite through the static site was not used, so a long plan never depends on a
proxy's time limit. A free API instance sleeps after 15 minutes idle, so an external uptime
monitor calls the health endpoint every 5 minutes, which stays inside the free 750 instance
hours a month. A scheduled GitHub Actions job does the same as a backup only: GitHub starts
scheduled jobs on a best-effort basis, and in practice they ran hours apart. The API runs as one Gunicorn process with threads, so every request
shares the in-memory cache.

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

Identical trips are cached for an hour and place lookups for a day. Each client is limited to
60 suggestion and 10 route requests per minute.

### 31. A departure a few minutes in the past is accepted

The routing API itself accepts any past departure, so the API enforces the window: from 15
minutes ago, so a form filled in at "now" is not rejected, up to 10 days ahead.

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

Open-Meteo's free tier allows 600 calls a minute, 5,000 an hour and 10,000 a day, and each
forecast location counts as one call. Chicago to Denver needs 71 checkpoint locations at 50 mile
spacing, 141 at 25 miles and 351 at 10 miles, and the heatmap adds at most 120 cells (see 49),
so the daily limit covers about 38 new trips at the default spacing, the hourly limit about 19
and the minute limit two.
Plans and the corridor's forecast are cached for an hour, as long as an hourly forecast stays
current, so repeating a trip costs nothing and a re-plan with another load or spacing fetches
only the checkpoints. When Open-Meteo refuses a request, the API says which limit was reached:
busy for a minute, or the daily limit until midnight UTC. The free plan counts calls per server
address, which a hosting platform may share with other apps; a paid Open-Meteo plan removes the
limit if the demo ever needs it.

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
overstate risk where samples cluster. The corridor is a grid of square cells that tile without
overlapping, each coloured by the level the checkpoint rules give for its own weather and the
trip's load; a heatmap that adds up nearby points was tried and rejected, as was a layer of
overlapping soft circles, where the overlaps came out darker than the cells themselves.

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

A plan takes about three to five seconds, mostly for routing, and up to 20 for very long trips. The panel says what is happening, counts
the seconds, says so if a service is slow, and can be cancelled. A cancelled request leaves the
previous plan on screen.

### 45. A calendar for the departure

The browser's own date picker cannot be styled and, on desktops, has no confirm button. The form
uses its own picker, laid out like the browser's: a month calendar, with arrows to the next
month, in which only the allowed days (now to ten days ahead) can be chosen, and a time typed or
stepped like the browser's time input. The hour, minutes and AM or PM each take typed digits and
the up and down arrows, with buttons above and below for a mouse or a finger. Any minute can be
chosen. A time that has passed is marked and Done waits until it is fixed. The departure changes
only on Done; Cancel, Escape or a click outside leave it as it was.

### 46. The heatmap corridor

The heatmap covers a corridor about three cells wide around all three routes. Cells start 20 km
apart and grow in steps of 10 % until there are at most 120 (see 49): a 250 mile trip keeps
20 km cells and a corridor about 60 km wide, a cross-country trip gets cells of about 135 km and
a corridor about 400 km wide, which shows the weather systems the routes pass through rather
than conditions at the roadside. Frames are whole UTC hours from the hour of departure, 50 of
them, which covers any moment in the first 48 hours.

### 47. What the slider shows between hours

Dragging the slider moves it in tenths of an hour; the arrow keys move it half an hour, Page Up
and Page Down six hours, Home and End to the ends. Wind, rain and snow are blended between the two hourly
frames around the slider's time. Risk is a level, not a quantity, so it is not blended: it comes
from the frame whose hour contains the slider's time, the same rule the checkpoints use for rain
and snow. Moving the slider only changes the map's colour expression; the frames are uploaded to
the map once per plan.

### 48. The truck on the timeline

The timeline shows where the truck on the selected route is at the slider's time, from the
checkpoints' arrival times, so it moves at the pace TomTom expects, slower in traffic. The
slider always runs 48 hours, the forecast window the specification asks for, so a shorter trip
arrives part way along it: a mark on the track and the text ("arrives at +24.5 h") say when.
Playing runs the 48 hours in 12 seconds. On a phone the timeline floats above the lowered sheet
and hides while the sheet is raised or a checkpoint's details are open, when it would cover most
of the map; hiding it pauses playing and hides the heatmap, which is never shown without its
legend.

### 49. At most 120 heatmap cells

Open-Meteo's free plan allows 600 calls a minute, one per forecast location. A plan's checkpoints
need up to about 200 locations, and with 200 heatmap cells a long trip used about 400 calls, so
a second new trip planned within the same minute came back without its heatmap (its routes and
recommendation were unaffected). With at most 120 cells a plan uses about 250 to 320 calls and
two new trips fit in a minute. The cost is coarser cells on long trips only (about 135 km instead
of 95 km from Los Angeles to Houston); trips of a few hundred miles keep their 20 km cells, and
the checkpoints, which decide the recommendation, are not affected. Repeating a trip within the
hour costs nothing, since plans and corridor forecasts are cached. A paid Open-Meteo plan would
remove the limit.

The same limit caps the checkpoints: the three routes together may use at most 450 forecast
points, so with the heatmap a plan stays under 600. At 25 or 50 mile spacing every trip up to
3,500 miles fits; at 10 miles the limit is reached at roughly 1,500 miles. Such a plan is refused
after routing and before any weather is fetched, with a message on the checkpoint field that
names the spacing that fits ("Choose 25 mi or more"), rather than failing later as "busy".

### 50. Typed places use the first suggestion

A place typed without picking a suggestion is resolved to the place the suggestions list would
have offered first; TomTom's address lookup is used only when there is no suggestion. The address
lookup alone does not know places by name: "California Academy of Sciences" became a street of
that name in Wisconsin. The resolved name is shown in the trip summary, so a surprise is visible.

### 51. Close average risks are shown to three decimals

Routes rank by average risk to three decimals. When the recommendation's reason compares two
averages that are equal to two decimals (0.09 against 0.09), it shows the third (0.090 against
0.094), so the sentence never reads as if the numbers were the same.
