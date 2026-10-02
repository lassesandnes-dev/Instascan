"""Massefelt background worker.

Heavy, long-running processing (photogrammetry, LAS/E57 import, meshing,
terrain generation) runs here — isolated from the web process and never in
an HTTP request. Jobs are rows in the ``ProcessingJob`` table.
"""

__version__ = "0.1.0"
