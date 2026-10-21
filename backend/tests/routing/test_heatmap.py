from datetime import UTC, datetime, timedelta, timezone

import pytest

from routing.clients.open_meteo import MAX_POINTS_PER_REQUEST
from routing.geo import LatLon, haversine_m
from routing.risk import RiskLevel
from routing.services.heatmap import (
    FRAME_COUNT,
    MAX_CELLS,
    MIN_SPACING_M,
    corridor_cells,
    corridor_heatmap,
)
from tests.routing.conftest import CALM, FakeOpenMeteo, WeatherFunction, WeatherValues

CHICAGO = LatLon(41.8781, -87.6298)
MILWAUKEE = LatLon(43.0389, -87.9065)
DENVER = LatLon(39.7392, -104.9903)
LOS_ANGELES = LatLon(34.0522, -118.2437)
NEW_YORK = LatLon(40.7128, -74.0060)
# 13:20 UTC, so the frames start at 13:00.
DEPART = datetime(2026, 10, 21, 13, 20, tzinfo=UTC)
FIRST_FRAME = datetime(2026, 10, 21, 13, tzinfo=UTC)


def line(a: LatLon, b: LatLon, steps: int = 50) -> list[LatLon]:
    return [
        LatLon(a.lat + (b.lat - a.lat) * i / steps, a.lon + (b.lon - a.lon) * i / steps)
        for i in range(steps + 1)
    ]


def nearest_cell_m(point: LatLon, cells: tuple[LatLon, ...]) -> float:
    return min(haversine_m(point, cell) for cell in cells)


def weather_in_frames(values: dict[int, WeatherValues]) -> WeatherFunction:
    """CALM, except in the given frames (hours after the first frame)."""

    def weather(point: LatLon, hour: datetime) -> WeatherValues:
        return values.get(round((hour - FIRST_FRAME) / timedelta(hours=1)), CALM)

    return weather


def points_in(open_meteo: FakeOpenMeteo) -> list[int]:
    return [len(request.url.params["latitude"].split(",")) for request in open_meteo.requests]


class TestCorridorCells:
    def test_a_short_trip_gets_the_finest_cells_along_and_beside_the_route(self) -> None:
        route = line(CHICAGO, MILWAUKEE)

        corridor = corridor_cells([route])

        assert corridor.spacing_m == MIN_SPACING_M
        # About 130 km long and three cells wide.
        assert 20 <= len(corridor.cells) <= 40
        for point in route:
            assert nearest_cell_m(point, corridor.cells) < corridor.spacing_m

    def test_cells_are_close_to_square_away_from_the_equator(self) -> None:
        corridor = corridor_cells([line(CHICAGO, MILWAUKEE)])
        first = corridor.cells[0]
        nearest = min(haversine_m(first, cell) for cell in corridor.cells[1:])

        assert nearest == pytest.approx(MIN_SPACING_M, rel=0.05)

    def test_a_long_trip_gets_coarser_cells_instead_of_more(self) -> None:
        corridor = corridor_cells([line(LOS_ANGELES, NEW_YORK, steps=400)])

        assert len(corridor.cells) <= MAX_CELLS
        assert corridor.spacing_m > MIN_SPACING_M

    def test_routes_that_share_roads_share_cells(self) -> None:
        one = corridor_cells([line(CHICAGO, MILWAUKEE)])
        both = corridor_cells([line(CHICAGO, MILWAUKEE), line(CHICAGO, MILWAUKEE)])

        assert both == one

    def test_every_route_is_covered(self) -> None:
        north, west = line(CHICAGO, MILWAUKEE), line(CHICAGO, DENVER)

        corridor = corridor_cells([north, west])

        for point in [*north, *west]:
            assert nearest_cell_m(point, corridor.cells) < corridor.spacing_m

    def test_neighbouring_cells_are_one_cell_size_apart(self) -> None:
        corridor = corridor_cells([line(CHICAGO, MILWAUKEE)])
        lats = sorted({round(cell.lat, 6) for cell in corridor.cells})
        lons = sorted({round(cell.lon, 6) for cell in corridor.cells})

        assert lats[1] - lats[0] == pytest.approx(corridor.lat_step, rel=1e-4)
        assert lons[1] - lons[0] == pytest.approx(corridor.lon_step, rel=1e-4)
        assert corridor.lon_step > corridor.lat_step  # Degrees of longitude are shorter here.

    def test_cells_beside_the_180th_meridian_stay_on_the_globe(self) -> None:
        fiji = line(LatLon(-17.8, 178.0), LatLon(-16.5, 179.9))

        corridor = corridor_cells([fiji])

        assert corridor.cells
        assert all(-180 <= cell.lon <= 180 for cell in corridor.cells)

    def test_no_routes_no_cells(self) -> None:
        assert corridor_cells([]).cells == ()


class TestCorridorHeatmap:
    def test_frames_cover_48_hours_from_the_hour_of_departure(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        heatmap = corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], DEPART, 38_000)

        assert heatmap.start == FIRST_FRAME
        assert heatmap.start + timedelta(hours=FRAME_COUNT - 1) >= DEPART + timedelta(hours=48)
        assert all(len(cell.risk) == FRAME_COUNT for cell in heatmap.cells)
        assert all(level == RiskLevel.LOW for cell in heatmap.cells for level in cell.risk)

    def test_one_request_for_a_short_trip(self, open_meteo: FakeOpenMeteo) -> None:
        corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], DEPART, 38_000)

        assert len(open_meteo.requests) == 1
        params = open_meteo.requests[0].url.params
        # Padded by the two hour fallback window on both sides.
        assert params["start_hour"] == "2026-10-21T11:00"
        assert params["end_hour"] == "2026-10-23T16:00"

    def test_a_long_trip_still_fits_in_one_request(self, open_meteo: FakeOpenMeteo) -> None:
        heatmap = corridor_heatmap(
            open_meteo.client(), [line(LOS_ANGELES, NEW_YORK, steps=400)], DEPART, 38_000
        )

        assert points_in(open_meteo) == [len(heatmap.cells)]
        assert len(heatmap.cells) <= MAX_POINTS_PER_REQUEST

    def test_risk_follows_the_checkpoint_rules_and_the_load(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        open_meteo.weather = weather_in_frames(
            {
                3: {**CALM, "wind_speed_10m": 40.0},  # High; Severe over 40,000 lb.
                5: {**CALM, "rain": 0.2, "showers": 0.2},  # 0.4 in/hr in all: High.
                7: {**CALM, "snowfall": 3.5},  # No Travel.
            }
        )

        light = corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], DEPART, 20_000)
        heavy = corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], DEPART, 45_000)

        cell = light.cells[0]
        assert cell.wind_mph[3] == 40.0
        assert cell.rain_in_per_hr[5] == pytest.approx(0.4)
        assert cell.snow_in_per_hr[7] == 3.5
        assert [cell.risk[i] for i in (3, 5, 7)] == [
            RiskLevel.HIGH,
            RiskLevel.HIGH,
            RiskLevel.NO_TRAVEL,
        ]
        assert heavy.cells[0].risk[3] == RiskLevel.SEVERE

    def test_the_same_corridor_and_hours_reuse_the_forecast(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        route = [line(CHICAGO, MILWAUKEE)]
        corridor_heatmap(open_meteo.client(), route, DEPART, 20_000)
        heavy = corridor_heatmap(open_meteo.client(), route, DEPART, 45_000)
        later = corridor_heatmap(open_meteo.client(), route, DEPART + timedelta(hours=2), 45_000)

        # Another load reuses the forecast; another departure hour needs its own.
        assert len(open_meteo.requests) == 2
        assert len(heavy.cells[0].risk) == len(later.cells[0].risk) == FRAME_COUNT

    def test_a_missing_value_falls_back_to_a_nearby_hour_or_stays_missing(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        missing = {**CALM, "wind_speed_10m": None}
        # Frame 10 alone is missing, and so are frames 20 to 30.
        gaps: dict[int, WeatherValues] = {10: missing, **dict.fromkeys(range(20, 31), missing)}
        open_meteo.weather = weather_in_frames(gaps)

        heatmap = corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], DEPART, 38_000)
        cell = heatmap.cells[0]

        assert cell.wind_mph[10] == CALM["wind_speed_10m"]
        assert cell.risk[10] == RiskLevel.LOW
        assert cell.wind_mph[25] is None
        assert cell.risk[25] is None

    def test_the_first_and_last_frames_fall_back_to_the_padded_hours(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        missing = {**CALM, "wind_speed_10m": None}
        open_meteo.weather = weather_in_frames(
            {0: missing, FRAME_COUNT - 1: missing, -1: {**CALM, "wind_speed_10m": 30.0}}
        )

        heatmap = corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], DEPART, 38_000)
        cell = heatmap.cells[0]

        # The hour before the first frame is fetched for the fallback, and tried first.
        assert cell.wind_mph[0] == 30.0
        assert cell.wind_mph[FRAME_COUNT - 1] == CALM["wind_speed_10m"]

    def test_frames_start_at_the_utc_hour_whatever_the_departure_offset(
        self, open_meteo: FakeOpenMeteo
    ) -> None:
        india = timezone(timedelta(hours=5, minutes=30))
        # 18:50 in India is 13:20 UTC.
        departure = datetime(2026, 10, 21, 18, 50, tzinfo=india)

        heatmap = corridor_heatmap(open_meteo.client(), [line(CHICAGO, MILWAUKEE)], departure, 1)

        assert heatmap.start == FIRST_FRAME
