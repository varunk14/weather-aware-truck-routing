from argparse import ArgumentParser
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from routing.risk import Conditions, assess_checkpoint, wind_level_for_load


class Command(BaseCommand):
    help = "Classify the weather at one checkpoint with Clearway's risk rules."

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--wind", type=float, required=True, help="Sustained wind, mph")
        parser.add_argument("--rain", type=float, default=0.0, help="Rain, inches per hour")
        parser.add_argument("--snow", type=float, default=0.0, help="Snow, inches per hour")
        parser.add_argument("--load", type=float, required=True, help="Load weight, pounds")

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            conditions = Conditions(options["wind"], options["rain"], options["snow"])
            risk = assess_checkpoint(conditions, options["load"])
        except ValueError as error:
            raise CommandError(str(error)) from error

        if risk.raised_by_load:
            raised = wind_level_for_load(conditions.wind_mph, options["load"])
            load_effect = f"raises wind to {raised.label}"
        else:
            load_effect = "no effect"
        result = risk.level.label
        if risk.causes:
            result += f" ({', '.join(risk.causes)})"

        rows = [
            ("Wind", f"{conditions.wind_mph:.1f} mph", risk.wind.label),
            ("Rain", f"{conditions.rain_in_per_hr:.2f} in/hr", risk.rain.label),
            ("Snow", f"{conditions.snow_in_per_hr:.2f} in/hr", risk.snow.label),
            ("Load", f"{options['load']:,.0f} lb", load_effect),
            ("Result", "", result),
        ]
        for name, value, level in rows:
            self.stdout.write(f"{name:<8}{value:<14}{level}")
