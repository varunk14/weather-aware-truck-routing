from django.urls import path

from routing.views import HealthView

app_name = "routing"

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
]
