"""Hourly weather over the trip corridor, for the heatmap and its 0 to 48 hour slider.

The corridor is a grid of square cells around every route: each route is walked in short steps
and the cell under each step, with its eight neighbours, is kept, so the corridor is about three
cells wide. Cells start 20 km apart and grow until there are at most ``MAX_CELLS`` of them; the
free Open-Meteo plan counts every location as a call, so a long trip gets coarser cells rather
than more of them, and the corridor's forecast is cached so a re-plan of the same trip with
another load or checkpoint spacing does not fetch it again.

Every cell has ``FRAME_COUNT`` whole UTC hours of wind, rain and snow from the hour of departure,
enough for any point in the first 48 hours, all fetched up front so the slider never waits for
the network. Each frame also carries the risk level the checkpoint rules give for that weather
and the trip's load: the true level at that place and hour, never a sum of nearby levels.
"""

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from django.core.cache import cache

from routing.clients.open_meteo import MAX_POINTS_PER_REQUEST, HourlyForecast, OpenMeteoClient
from routing.geo import LatLon, sample_along
from routing.risk import Conditions, RiskLevel, assess_checkpoint
from routing.services.weather import FALLBACK_HOURS, HOUR, floor_hour, total_near

FRAME_COUNT = 50
# Every heatmap is a single Open-Meteo request, which takes at most this many locations.
MAX_CELLS = MAX_POINTS_PER_REQUEST
# The same corridor and hours (another load or checkpoint spacing on the same trip) reuse the
# forecast for this long, like plans. Forecasts are hourly, so an hour loses nothing.
FORECAST_CACHE_S = 60 * 60
MIN_SPACING_M = 20_000
SPACING_GROWTH = 1.25
METERS_PER_DEGREE = 111_320


@dataclass(frozen=True, slots=True)
class Corridor:
    spacing_m: float
    cells: tuple[LatLon, ...]
    # The size of a cell in degrees, so the cells can be drawn as squares that tile exactly.
    lat_step: float = 0.0
    lon_step: float = 0.0


@dataclass(frozen=True, slots=True)
class HeatmapCell:
    """One cell's weather and risk for each frame; None where the forecast has no value."""

    position: LatLon
    wind_mph: tuple[float | None, ...]
    rain_in_per_hr: tuple[float | None, ...]
    snow_in_per_hr: tuple[float | None, ...]
    risk: tuple[RiskLevel | None, ...]


@dataclass(frozen=True, slots=True)
class Heatmap:
    """Frame ``i`` is the weather at ``start + i`` hours."""

    start: datetime
    spacing_m: float
    lat_step: float
    lon_step: float
    cells: tuple[HeatmapCell, ...]


def corridor_cells(lines: Sequence[Sequence[LatLon]], max_cells: int = MAX_CELLS) -> Corridor:
    """Cell centres around ``lines``, as fine as ``max_cells`` allows."""
    points = [point for line in lines for point in line]
    if not points:
        return Corridor(MIN_SPACING_M, ())
    # A flat grid scaled for the middle latitude of the trip, so cells are close to square.
    middle = (min(p.lat for p in points) + max(p.lat for p in points)) / 2
    scale = math.cos(math.radians(middle))
    spacing = float(MIN_SPACING_M)
    while True:
        cells = _cells(lines, spacing, scale)
        if len(cells) <= max_cells:
            lat_step = spacing / METERS_PER_DEGREE
            return Corridor(spacing, cells, lat_step=lat_step, lon_step=lat_step / scale)
        spacing *= SPACING_GROWTH


def corridor_heatmap(
    client: OpenMeteoClient,
    lines: Sequence[Sequence[LatLon]],
    departure: datetime,
    load_lb: float,
) -> Heatmap:
    corridor = corridor_cells(lines)
    start = floor_hour(departure)
    hours = [start + i * HOUR for i in range(FRAME_COUNT)]
    first, last = hours[0] - FALLBACK_HOURS * HOUR, hours[-1] + FALLBACK_HOURS * HOUR

    key = _cache_key(corridor.cells, start)
    forecasts: list[HourlyForecast] | None = cache.get(key)
    if forecasts is None:
        forecasts = client.hourly(corridor.cells, first, last)
        cache.set(key, forecasts, FORECAST_CACHE_S)

    cells = tuple(
        _cell(position, forecast, hours, load_lb)
        for position, forecast in zip(corridor.cells, forecasts, strict=True)
    )
    return Heatmap(
        start=start,
        spacing_m=corridor.spacing_m,
        lat_step=corridor.lat_step,
        lon_step=corridor.lon_step,
        cells=cells,
    )


def _cache_key(cells: Sequence[LatLon], start: datetime) -> str:
    text = start.isoformat() + ";" + ";".join(f"{c.lat:.4f},{c.lon:.4f}" for c in cells)
    return "heatmap:" + hashlib.sha256(text.encode()).hexdigest()


def _cells(lines: Sequence[Sequence[LatLon]], spacing: float, scale: float) -> tuple[LatLon, ...]:
    def index(point: LatLon) -> tuple[int, int]:
        return (
            round(point.lon * scale * METERS_PER_DEGREE / spacing),
            round(point.lat * METERS_PER_DEGREE / spacing),
        )

    taken: set[tuple[int, int]] = set()
    for line in lines:
        if not line:
            continue
        for point in [*sample_along(line, spacing / 2), line[-1]]:
            col, row = index(point)
            taken.update((col + dc, row + dr) for dc in (-1, 0, 1) for dr in (-1, 0, 1))
    centres = (
        LatLon(row * spacing / METERS_PER_DEGREE, col * spacing / (METERS_PER_DEGREE * scale))
        for col, row in sorted(taken)
    )
    # Neighbours of a route near the poles or the 180th meridian can fall off the globe.
    return tuple(c for c in centres if -90 <= c.lat <= 90 and -180 <= c.lon <= 180)


def _cell(
    position: LatLon, forecast: HourlyForecast, hours: Sequence[datetime], load_lb: float
) -> HeatmapCell:
    wind = tuple(total_near(forecast, hour, forecast.wind_mph) for hour in hours)
    rain = tuple(
        total_near(forecast, hour, forecast.rain_in, forecast.showers_in) for hour in hours
    )
    snow = tuple(total_near(forecast, hour, forecast.snow_in) for hour in hours)
    risk = tuple(_risk(w, r, s, load_lb) for w, r, s in zip(wind, rain, snow, strict=True))
    return HeatmapCell(position, wind, rain, snow, risk)


def _risk(
    wind: float | None, rain: float | None, snow: float | None, load_lb: float
) -> RiskLevel | None:
    if wind is None or rain is None or snow is None:
        return None
    conditions = Conditions(wind_mph=wind, rain_in_per_hr=rain, snow_in_per_hr=snow)
    return assess_checkpoint(conditions, load_lb).level
