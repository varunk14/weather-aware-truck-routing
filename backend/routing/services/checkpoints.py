"""Checkpoints along a route, with the truck's estimated arrival time at each one."""

import bisect
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise

from routing.clients.tomtom import TruckRoute
from routing.geo import METERS_PER_MILE, LatLon, cumulative_m, interpolate

# A regular checkpoint this close to the destination is dropped; the destination covers it.
MIN_FINAL_GAP_M = 1.0 * METERS_PER_MILE


@dataclass(frozen=True, slots=True)
class Checkpoint:
    distance_m: float
    position: LatLon
    eta: datetime


class RouteTrack:
    """Road distance and travel time at every point of a route's polyline.

    TomTom reports progress for a subset of points. Points in between are filled in
    proportionally to straight-line distance, as TomTom's documentation recommends, so ETAs
    follow TomTom's own travel times (including historic traffic) rather than a fixed speed.
    """

    def __init__(self, route: TruckRoute) -> None:
        points, progress = route.points, route.progress
        if (
            len(points) < 2
            or not progress
            or progress[0].point_index != 0
            or progress[-1].point_index != len(points) - 1
        ):
            raise ValueError("Route progress must cover the whole polyline.")

        straight = cumulative_m(points)
        distance = [0.0] * len(points)
        elapsed = [0.0] * len(points)
        for a, b in pairwise(progress):
            span = straight[b.point_index] - straight[a.point_index]
            steps = b.point_index - a.point_index
            for i in range(a.point_index, b.point_index + 1):
                if span > 0:
                    fraction = (straight[i] - straight[a.point_index]) / span
                else:
                    fraction = (i - a.point_index) / steps if steps else 0.0
                distance[i] = a.distance_m + (b.distance_m - a.distance_m) * fraction
                elapsed[i] = a.travel_time_s + (b.travel_time_s - a.travel_time_s) * fraction

        self._points = points
        self._distance = distance
        self._elapsed = elapsed
        self.length_m = distance[-1]
        self.departure = route.departure

    def locate(self, distance_m: float) -> tuple[LatLon, float]:
        """Position and elapsed travel time, in seconds, ``distance_m`` from the origin."""
        target = min(max(distance_m, 0.0), self.length_m)
        i = bisect.bisect_right(self._distance, target) - 1
        i = min(max(i, 0), len(self._points) - 2)
        span = self._distance[i + 1] - self._distance[i]
        fraction = (target - self._distance[i]) / span if span > 0 else 0.0
        position = interpolate(self._points[i], self._points[i + 1], fraction)
        elapsed = self._elapsed[i] + (self._elapsed[i + 1] - self._elapsed[i]) * fraction
        return position, elapsed


def checkpoint_distances_m(length_m: float, interval_mi: float) -> list[float]:
    """The origin, every ``interval_mi`` miles along the route, and the destination."""
    step = interval_mi * METERS_PER_MILE
    distances = [0.0]
    distance = step
    while distance < length_m - MIN_FINAL_GAP_M:
        distances.append(distance)
        distance += step
    if length_m > 0:
        distances.append(length_m)
    return distances


def place_checkpoints(route: TruckRoute, interval_mi: float) -> list[Checkpoint]:
    track = RouteTrack(route)
    checkpoints = []
    for distance in checkpoint_distances_m(track.length_m, interval_mi):
        position, elapsed_s = track.locate(distance)
        eta = track.departure + timedelta(seconds=elapsed_s)
        checkpoints.append(Checkpoint(distance_m=distance, position=position, eta=eta))
    return checkpoints
