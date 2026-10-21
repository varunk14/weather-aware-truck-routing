"""Gunicorn settings for the hosted API (``gunicorn -c gunicorn.conf.py``).

One worker process with threads: plans and forecasts are cached in memory, so every request
must see the same cache, and a free instance has 512 MB. Requests mostly wait on TomTom and
Open-Meteo, so threads serve several at once. A long trip takes up to about 20 seconds to
plan, well inside the timeout.
"""

import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
workers = 1
worker_class = "gthread"
threads = 8
timeout = 90
graceful_timeout = 30
# Access logs go to the platform's log stream; Django's own logging covers errors.
accesslog = "-"
