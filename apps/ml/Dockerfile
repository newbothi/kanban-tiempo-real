# syntax=docker/dockerfile:1
# S-23: imagen base fijada por digest (Dependabot la actualiza).
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

# ML_ENV=production: exige ML_TOKEN (si falta, no arranca) y oculta /docs y /openapi.json
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    ML_ENV=production

WORKDIR /app
COPY requirements.txt .
# S-23: versiones exactas y verificadas por hash (requirements.txt lo genera pip-compile).
# Después se desinstala pip: la app no lo usa y trae sus propias copias de urllib3, msgpack
# y setuptools (Trivy las marca como vulnerables). También se aplican los parches del sistema.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --require-hashes --no-deps -r requirements.txt \
 && pip uninstall -y pip setuptools wheel \
 && python -c "import fastapi, uvicorn, sklearn, scipy"

COPY app ./app

# Usuario sin privilegios
RUN useradd --create-home ml
USER ml

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/health')"
# sh -c para que ${PORT} se expanda (Azure puede asignar otro puerto); exec deja a uvicorn
# como proceso principal (recibe SIGTERM). --limit-concurrency acota las peticiones
# simultáneas (las que sobran reciben 503 y Node muestra "servicio no disponible").
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --limit-concurrency 8 --timeout-keep-alive 5 --no-server-header"]
