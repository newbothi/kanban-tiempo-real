"""Perfiles de Hypothesis.

- dev (por defecto): ejemplos al azar en cada corrida, para encontrar casos nuevos.
- ci: semilla fija (`derandomize`) y más ejemplos: el CI no puede fallar "a veces".
Se elige con HYPOTHESIS_PROFILE=ci.
"""
import os

from hypothesis import HealthCheck, settings

settings.register_profile("dev", max_examples=60, deadline=None)
settings.register_profile(
    "ci", max_examples=150, deadline=None, derandomize=True, suppress_health_check=[HealthCheck.too_slow]
)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))
