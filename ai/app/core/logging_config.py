"""Central logging configuration for the AI service.

Call configure_logging() once at startup (main.py) before any other imports
that might call logging.getLogger. All modules then call
``logging.getLogger(__name__)`` as usual.
"""
from __future__ import annotations

import logging
import os

_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
_LOG_FORMAT = "%(asctime)s [%(levelname)-8s] %(name)s | %(message)s"
_DATE_FORMAT = "%Y-%m-%dT%H:%M:%S"


def configure_logging() -> None:
    logging.basicConfig(
        level=_LOG_LEVEL,
        format=_LOG_FORMAT,
        datefmt=_DATE_FORMAT,
    )
    # Suppress noisy third-party loggers so AI service events stand out.
    for lib in ("httpx", "httpcore", "openai", "uvicorn.access"):
        logging.getLogger(lib).setLevel(logging.WARNING)
