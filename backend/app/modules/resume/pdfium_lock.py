"""One lock for every use of pdfium in a process.

pdfium is not thread-safe: two threads inside it at once can corrupt its
state or crash the process, and pypdfium2 does not serialise calls for us.
The API runs the resume parser (onboarding) and the preview renderer in
FastAPI's thread pool, so both take this lock. Celery workers are separate
processes and each has its own.
"""

from __future__ import annotations

import threading
from typing import Final

PDFIUM_LOCK: Final = threading.Lock()
