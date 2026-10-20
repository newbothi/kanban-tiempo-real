#!/usr/bin/env bash
# Aplica las migraciones pendientes a la base de Azure, desde Cloud Shell.
# La app ya no tiene la contraseña del administrador (S-04): la cadena de migraciones vive
# en el Key Vault (secreto database-url-admin) y solo la puede leer quien administra.
# Abre el firewall para la IP de Cloud Shell y lo vuelve a cerrar al terminar, aunque falle.
#   bash ops/azure/migrar.sh
set -euo pipefail
RG=${RG:-kanban-rg}; SQL=${SQL:-kanban-newbothi-us}; KV=${KV:-kv-kanban-newbothi}
cd "$(dirname "$0")/../.."

[ -d node_modules ] || npm ci --silent
IP=$(curl -s https://api.ipify.org)
cerrar() { az sql server firewall-rule delete -g "$RG" -s "$SQL" -n CloudShellTemp -o none 2>/dev/null && echo "firewall: regla temporal borrada"; }
trap cerrar EXIT
az sql server firewall-rule create -g "$RG" -s "$SQL" -n CloudShellTemp --start-ip-address "$IP" --end-ip-address "$IP" -o none
echo "firewall: abierto solo para $IP"
sleep 30 # la regla tarda en aplicarse

DATABASE_URL="$(az keyvault secret show --vault-name "$KV" -n database-url-admin --query value -o tsv)" \
  npm run db:deploy -w @kanban/api
