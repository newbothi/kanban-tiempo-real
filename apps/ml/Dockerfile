# syntax=docker/dockerfile:1
FROM python:3.13-slim

# ML_ENV=production: exige ML_TOKEN (si falta, no arranca) y oculta /docs y /openapi.json
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    ML_ENV=production

WORKDIR /app
COPY requirements.txt .
# S-23: versiones exactas y verificadas por hash (requirements.txt lo genera pip-compile).
RUN pip install --require-hashes --no-deps -r requirements.txt

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
