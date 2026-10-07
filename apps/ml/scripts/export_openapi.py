"""Escribe el esquema OpenAPI del servicio sin necesidad de levantarlo.

Uso (desde apps/ml):  python -m scripts.export_openapi openapi.json
"""
import json
import sys
from pathlib import Path

from app.main import app

out = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
out.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"OpenAPI escrito en {out}")
