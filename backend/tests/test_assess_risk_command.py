from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


def run(*args: str) -> str:
    out = StringIO()
    call_command("assess_risk", *args, stdout=out)
    return out.getvalue()


def test_prints_each_condition_and_the_overall_result() -> None:
    output = run("--wind", "40", "--rain", "0.3", "--load", "42000")

    assert "Wind    40.0 mph      High" in output
    assert "Rain    0.30 in/hr    High" in output
    assert "Snow    0.00 in/hr    Low" in output
    assert "Load    42,000 lb     raises wind to Severe" in output
    assert "Result                Severe (wind, load)" in output


def test_reports_no_load_effect_for_light_loads() -> None:
    output = run("--wind", "40", "--load", "20000")

    assert "no effect" in output
    assert "Result                High (wind)" in output


def test_calm_weather_has_no_causes() -> None:
    assert "Result                Low\n" in run("--wind", "5", "--load", "20000")


def test_rejects_invalid_values() -> None:
    with pytest.raises(CommandError, match="wind_mph"):
        run("--wind", "-1", "--load", "20000")
