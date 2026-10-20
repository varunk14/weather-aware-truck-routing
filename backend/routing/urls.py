from django.urls import path

from routing.views import HealthView, PlaceSuggestView, RoutesView

app_name = "routing"

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("places/suggest", PlaceSuggestView.as_view(), name="place-suggest"),
    path("routes", RoutesView.as_view(), name="routes"),
]
