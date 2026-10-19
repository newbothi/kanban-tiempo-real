#!/usr/bin/env bash
# Smoke test de las DOS imágenes Docker ya levantadas (fase 4).
# Se corre en el CI antes de publicarlas: si algo de esto falla, no se publica nada.
#   API_URL  (por defecto http://127.0.0.1:3000)   ML_URL  (por defecto http://127.0.0.1:8000)
#   ML_TOKEN (el mismo con el que arrancó el contenedor ML)
set -euo pipefail
API=${API_URL:-http://127.0.0.1:3000}
ML=${ML_URL:-http://127.0.0.1:8000}
fails=0
ok()   { echo "✔ $1"; }
fail() { echo "::error title=Smoke test::$1"; fails=$((fails + 1)); }
expect_status() { # descripción, código esperado, curl args…
  local desc=$1 want=$2; shift 2
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' "$@")
  [ "$got" = "$want" ] && ok "$desc ($got)" || fail "$desc: esperaba $want y llegó $got"
}

echo "== Salud"
expect_status "API /health (conecta a SQL Server)" 200 "$API/health"
expect_status "ML /health" 200 "$ML/health"

echo "== Configuración de producción"
expect_status "ML sin token → 401" 401 -X POST -H 'content-type: application/json' -d '{}' "$ML/analyze"
expect_status "ML /docs oculto" 404 "$ML/docs"
expect_status "API /api/auth/me sin sesión → 401" 401 "$API/api/auth/me"
headers=$(curl -sI "$API/")
for h in content-security-policy strict-transport-security x-content-type-options x-frame-options referrer-policy; do
  grep -qi "^$h:" <<<"$headers" && ok "cabecera $h" || fail "falta la cabecera $h"
done
grep -qi '^x-powered-by:' <<<"$headers" && fail "la API revela x-powered-by" || ok "sin x-powered-by"
expect_status "el front se sirve desde la misma imagen" 200 "$API/"

echo "== Flujo completo: registro → tablero → tarjeta → métricas (pasa por el ML)"
email="smoke-$(date +%s)@ci.cl"
jar=$(mktemp)
expect_status "registro" 201 -c "$jar" -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"name\":\"Smoke\",\"password\":\"una frase de prueba larga\"}" "$API/api/auth/register"
grep -q '__Host-kanban_session' "$jar" && ok "cookie de sesión con prefijo __Host-" || fail "la cookie no usa el prefijo __Host-"
board=$(curl -s -b "$jar" -H 'content-type: application/json' -d '{"name":"Smoke"}' "$API/api/boards")
board_id=$(jq -r .id <<<"$board")
[ "$board_id" != null ] && ok "tablero creado" || fail "no se creó el tablero: $board"
col=$(curl -s -b "$jar" "$API/api/boards/$board_id" | jq -r '.columns[0].id')
expect_status "tarjeta creada" 201 -b "$jar" -H 'content-type: application/json' \
  -d "{\"columnId\":\"$col\",\"title\":\"Hola desde el smoke test\"}" "$API/api/cards"
expect_status "métricas: la API llega al ML con el token" 200 -b "$jar" "$API/api/boards/$board_id/metrics"

echo "== Imágenes endurecidas"
for c in kanban-api kanban-ml; do
  uid=$(docker exec "$c" id -u)
  [ "$uid" != 0 ] && ok "$c corre sin root (uid $uid)" || fail "$c corre como root"
done
docker exec kanban-api sh -c 'command -v npm npx corepack' >/dev/null 2>&1 && fail "la imagen de la API trae npm" || ok "API sin npm/npx/corepack"
docker exec kanban-ml sh -c 'command -v pip' >/dev/null 2>&1 && fail "la imagen del ML trae pip" || ok "ML sin pip"
docker exec kanban-api sh -c 'test -e /app/apps/api/test || test -e /app/apps/api/prisma/seed.ts' && fail "la imagen trae tests o seed" || ok "API sin tests ni seed"

echo
[ "$fails" = 0 ] && echo "Smoke test OK" || { echo "Smoke test: $fails fallas"; exit 1; }
