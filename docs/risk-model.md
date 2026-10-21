# Risk model

How Clearway turns a forecast into a risk level, a route into risk numbers, and three routes into
a recommendation. The code lives in [`backend/routing/risk`](../backend/routing/risk) and has no
framework or network dependencies.

## 1. Levels

| Level     | Score |
| --------- | ----- |
| Low       | 0     |
| Moderate  | 1     |
| High      | 2     |
| Severe    | 3     |
| No Travel | 4     |

The score is used for the average risk of a route.

## 2. Weather at a checkpoint

Each condition is classified on its own. A band includes its lower bound and excludes its upper
bound, so a value on a shared edge belongs to the higher band. The No Travel band keeps the
wording of the specification.

| Condition    | Low    | Moderate       | High           | Severe       | No Travel |
| ------------ | ------ | -------------- | -------------- | ------------ | --------- |
| Wind (mph)   | < 25   | 25 to < 35     | 35 to < 45     | 45 to < 55   | ≥ 55      |
| Rain (in/hr) | < 0.10 | 0.10 to < 0.25 | 0.25 to < 0.50 | 0.50 to 1.00 | > 1.00    |
| Snow (in/hr) | < 0.5  | 0.5 to < 1.0   | 1.0 to < 2.0   | 2.0 to 3.0   | > 3.0     |

Wind is the sustained 10 m wind speed. Rain is steady rain plus showers. All values are for the
hour the truck is expected to reach the checkpoint.

## 3. Load rules

Heavy loads make strong wind more dangerous. The rules only ever raise a level.

| Wind         | Load        | Wind level becomes |
| ------------ | ----------- | ------------------ |
| ≥ 55 mph     | any         | No Travel          |
| 45 to 54 mph | > 30,000 lb | No Travel          |
| 35 to 44 mph | > 40,000 lb | Severe             |

Exactly 30,000 lb or 40,000 lb does not trigger a rule ("more than" in the specification).

## 4. Checkpoint level

The checkpoint level is the highest of the wind, rain and snow levels, raised by the load rules
where they apply. The result also records which factors set it, for example `("rain",)` or
`("wind", "load")`, so the interface can explain the level.

| Wind   | Rain       | Snow | Load      | Level                     |
| ------ | ---------- | ---- | --------- | ------------------------- |
| 10 mph | 0.30 in/hr | 0    | 20,000 lb | High (rain)               |
| 40 mph | 0          | 0    | 20,000 lb | High (wind)               |
| 40 mph | 0          | 0    | 42,000 lb | Severe (wind and load)    |
| 50 mph | 0          | 0    | 35,000 lb | No Travel (wind and load) |
| 40 mph | 1.50 in/hr | 0    | 42,000 lb | No Travel (rain)          |

## 5. From checkpoints to a route

Checkpoints are placed every 10, 25 or 50 miles. Each one represents the road from halfway back
to the previous checkpoint to halfway forward to the next one; the first starts at the origin and
the last ends at the destination.

Example, a 60 mile route sampled every 25 miles:

| Checkpoint (mile) | 0    | 25  | 50   | 60  |
| ----------------- | ---- | --- | ---- | --- |
| Miles represented | 12.5 | 25  | 17.5 | 5   |

Adding these lengths per level gives the route's miles in each level. Average risk is the mean
score weighted by those miles: 90 Low miles and 10 No Travel miles give
(90 × 0 + 10 × 4) / 100 = 0.40.

## 6. Ranking

Routes are compared on these criteria, in order; the first difference decides.

1. Fewest miles in No Travel conditions
2. Fewest miles in Severe weather
3. Fewest miles in High-risk weather
4. Lowest average risk
5. Shortest travel time

Criteria 2 to 5 are the specification's. No Travel comes first because it is worse than Severe
but is not mentioned in the specification's list. Miles are compared to the nearest 0.1 mile and
average risk to three decimals, so floating-point noise never decides between otherwise equal
routes. Full ties keep the order in which the routing provider returned the routes.

## 7. The recommendation

The best-ranked route is recommended with one sentence that compares it with the fastest route.

| Situation                                   | Sentence                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Best route is also the fastest              | Fastest route, and no other route has less weather risk.                                              |
| Avoids a hazard the fastest route has       | Avoids 75 mi of Severe weather on the fastest route (Route A), for 1 h 07 min more driving.           |
| Has less of a hazard than the fastest route | Has 25 mi less Severe weather than the fastest route (Route A), for 20 min more driving.              |
| Only the average differs                    | Lower average weather risk than the fastest route (Route A): 0.10 vs 0.50, for 5 min more driving.    |
| Every route crosses No Travel conditions    | Every route crosses No Travel conditions. Route B has the fewest (12 mi); consider a later departure. |

In the last case the recommendation is marked as not safe, so the interface can warn the driver
instead of presenting the route as a safe choice.

## 8. Where the weather comes from

Forecasts come from [Open-Meteo](https://open-meteo.com): sustained wind speed at 10 m, wind
gusts, rain, showers and snowfall, hourly, in mph and inches. Each checkpoint uses the forecast
for the time the truck is expected there:

| Value             | Forecast hour used                    | Arrival 12:37 uses |
| ----------------- | ------------------------------------- | ------------------ |
| Rain, snow, gusts | The hour that contains the arrival    | 13:00 (12 to 13)   |
| Wind              | The whole hour nearest to the arrival | 13:00              |

Open-Meteo reports rain and snow as the total, and gusts as the maximum, over the hour ending at
each time, which is why 12:37 uses the 13:00 value. Rain is `rain` plus `showers`, both from the
same hour. A missing value is replaced by the nearest value at most two hours away; if there is
none, the trip cannot be assessed and the API says so instead of guessing. Gusts are shown for
context only; the level uses the sustained wind speed.

## 9. The heatmap

Heatmap cells use the same rules as checkpoints: each cell's level for an hour is
`assess_checkpoint` applied to that cell's wind, rain (with showers) and snow for the hour, with
the trip's load. A cell's level is never combined with its neighbours', so the map shows the
true level at each place. The heatmap is for looking ahead; the recommendation comes from the
checkpoints alone, which use the hour the truck actually reaches them.

## Trying it

```bash
cd backend
uv run python manage.py assess_risk --wind 40 --rain 0.3 --load 42000
```

```
Wind    40.0 mph      High
Rain    0.30 in/hr    High
Snow    0.00 in/hr    Low
Load    42,000 lb     raises wind to Severe
Result                Severe (wind, load)
```

## Tests

`backend/tests/risk` covers every band edge in the table, every load rule, each ranking criterion
on its own, and each recommendation sentence. Property-based tests (Hypothesis) check that more
wind, rain, snow or load never lowers a level, that checkpoint coverage always adds up to the
route length, and that the recommended route is never worse than another.
`backend/tests/routing/test_weather.py` covers the hour matching, including arrivals in other
time zones, and every fallback case. `backend/tests/routing/test_heatmap.py` covers the corridor
grid, the frame hours and the heatmap levels with light and heavy loads.
