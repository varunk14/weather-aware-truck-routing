"""Geometry on the WGS84 sphere: distances, interpolation, simplification and proximity.

Distances use the haversine formula, which is accurate to well under 0.5% at route scale.
Planar work (simplification, proximity) uses a local equirectangular projection, which is
adequate for routes within North America.
"""

import math
from collections import defaultdict
from collections.abc import Iterator, Sequence
from itertools import pairwise
from typing import NamedTuple

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1609.344


class LatLon(NamedTuple):
    lat: float
    lon: float


def haversine_m(a: LatLon, b: LatLon) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def cumulative_m(points: Sequence[LatLon]) -> list[float]:
    """Distance from the first point to every point along the line."""
    distances = [0.0]
    for a, b in pairwise(points):
        distances.append(distances[-1] + haversine_m(a, b))
    return distances


def interpolate(a: LatLon, b: LatLon, fraction: float) -> LatLon:
    """Point a given fraction of the way from ``a`` to ``b`` (linear; fine for short segments)."""
    return LatLon(a.lat + (b.lat - a.lat) * fraction, a.lon + (b.lon - a.lon) * fraction)


def bearing_deg(a: LatLon, b: LatLon) -> float:
    """Initial bearing from ``a`` to ``b``, clockwise from north, in [0, 360)."""
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlon = math.radians(b.lon - a.lon)
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.degrees(math.atan2(y, x)) % 360


def destination(origin: LatLon, bearing: float, distance_m: float) -> LatLon:
    """Point reached by travelling ``distance_m`` from ``origin`` on an initial ``bearing``."""
    angular = distance_m / EARTH_RADIUS_M
    theta = math.radians(bearing)
    lat1, lon1 = math.radians(origin.lat), math.radians(origin.lon)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(theta)
    )
    lon2 = lon1 + math.atan2(
        math.sin(theta) * math.sin(angular) * math.cos(lat1),
        math.cos(angular) - math.sin(lat1) * math.sin(lat2),
    )
    return LatLon(math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180)


def densify(points: Sequence[LatLon], max_step_m: float) -> list[LatLon]:
    """Insert points so no two consecutive points are more than ``max_step_m`` apart."""
    if not points:
        return []
    dense = [points[0]]
    for a, b in pairwise(points):
        steps = max(1, math.ceil(haversine_m(a, b) / max_step_m))
        dense.extend(interpolate(a, b, i / steps) for i in range(1, steps + 1))
    return dense


def simplify(points: Sequence[LatLon], tolerance_m: float) -> list[LatLon]:
    """Ramer-Douglas-Peucker simplification that keeps the first and last points.

    Every removed point lies within ``tolerance_m`` of the simplified line.
    """
    if len(points) < 3:
        return list(points)
    project = _projector(points)
    xy = [project(p) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        farthest, index = 0.0, -1
        for i in range(start + 1, end):
            distance = _segment_distance(xy[i], xy[start], xy[end])
            if distance > farthest:
                farthest, index = distance, i
        if farthest > tolerance_m:
            keep[index] = True
            stack.extend(((start, index), (index, end)))
    return [point for point, kept in zip(points, keep, strict=True) if kept]


def fraction_near(samples: Sequence[LatLon], line: Sequence[LatLon], radius_m: float) -> float:
    """Share of ``samples`` that lie within ``radius_m`` of the polyline ``line``."""
    if not samples or not line:
        return 0.0
    project = _projector([*samples, *line])
    grid: defaultdict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for x, y in map(project, densify(line, radius_m / 2)):
        grid[(math.floor(x / radius_m), math.floor(y / radius_m))].append((x, y))

    near = 0
    for x, y in map(project, samples):
        cx, cy = math.floor(x / radius_m), math.floor(y / radius_m)
        if any(
            math.hypot(x - qx, y - qy) <= radius_m
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            for qx, qy in grid.get((cx + dx, cy + dy), ())
        ):
            near += 1
    return near / len(samples)


def sample_along(points: Sequence[LatLon], step_m: float) -> Iterator[LatLon]:
    """Points spaced ``step_m`` apart along the line, starting at its first point."""
    distances = cumulative_m(points)
    target, i = 0.0, 0
    while target <= distances[-1]:
        while i < len(points) - 2 and distances[i + 1] < target:
            i += 1
        span = distances[i + 1] - distances[i] if len(points) > 1 else 0.0
        fraction = (target - distances[i]) / span if span > 0 else 0.0
        yield interpolate(points[i], points[min(i + 1, len(points) - 1)], fraction)
        target += step_m


def _projector(points: Sequence[LatLon]) -> "_Projection":
    mean_lat = math.radians(sum(p.lat for p in points) / len(points))
    return _Projection(math.cos(mean_lat))


class _Projection:
    """Equirectangular projection to metres around a reference latitude."""

    __slots__ = ("_kx", "_ky")

    def __init__(self, cos_lat: float) -> None:
        self._ky = math.radians(1) * EARTH_RADIUS_M
        self._kx = self._ky * cos_lat

    def __call__(self, point: LatLon) -> tuple[float, float]:
        return point.lon * self._kx, point.lat * self._ky


def _segment_distance(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_sq))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
