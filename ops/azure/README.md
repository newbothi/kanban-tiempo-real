# Operación en Azure

Cómo está montada la producción y cómo se opera, desde **Azure Cloud Shell (Bash)**. Ningún comando de esta guía muestra un secreto: los que necesitan uno lo leen de Key Vault o de un archivo temporal con permisos `600`.

| Recurso | Nombre |
|---|---|
| Grupo de recursos | `kanban-rg` (West US; la política de la suscripción exige `-l westus`) |
| Plan | `kanban-plan` (F1, Linux) |
| App principal | `kanban-newbothi`: web, API y WebSocket |
| Servicio ML | `kanban-newbothi-ml` |
| Azure SQL | servidor `kanban-newbothi-us`, base `kanban` |
| Key Vault | `kv-kanban-newbothi` (permisos por RBAC) |
| Identidad de despliegue | `kanban-deploy` (identidad administrada asignada por el usuario) |

## Quién accede a qué

| Identidad | Acceso | Para qué |
|---|---|---|
| App principal (asignada por el sistema) | `db_datareader` + `db_datawriter` en `kanban`; lee `jwt-secret`, `ml-token` y `acs-connection-string` | Atender a los usuarios |
| Servicio ML (asignada por el sistema) | Lee `ml-token` | Validar el token de la app |
| `kanban-deploy` | Website Contributor en las dos apps | Que GitHub Actions cambie la imagen |
| Administrador de Entra del servidor (tu cuenta) | Todo en SQL; Key Vault Secrets Officer | Crear usuarios, migrar, rotar secretos |
| Login SQL `kanbanadmin` | Dueño del servidor; su cadena vive solo en el secreto `database-url-admin` | Las migraciones de Prisma |

## Despliegue

Automático: cada push a `main` con el CI en verde publica las imágenes en GHCR y el job **Despliegue en Azure (por digest)** las aplica, primero al ML y después a la app. El job termina cuando `https://kanban-newbothi.azurewebsites.net/health` responde con el commit nuevo.

GitHub entra con OIDC, sin secretos. La credencial federada de `kanban-deploy` acepta solo este *subject*, que usa los ids del dueño y del repositorio en vez de sus nombres:

```
repo:newbothi@95059732/kanban-tiempo-real@1408024138:environment:produccion
```

Si el despliegue falla con `AADSTS700213`, el subject que presentó GitHub aparece en el error; hay que registrar ese valor exacto.

**Volver a una versión anterior:** re-ejecutar el job de despliegue de esa corrida, o fijar el digest a mano:

```bash
az webapp config container set -g kanban-rg -n kanban-newbothi \
  --container-image-name ghcr.io/newbothi/kanban-tiempo-real@sha256:<digest> -o none
```

## Migraciones

```bash
git clone https://github.com/newbothi/kanban-tiempo-real && cd kanban-tiempo-real
bash ops/azure/migrar.sh
```

El script abre el firewall de SQL solo para la IP de Cloud Shell, aplica las migraciones con la cadena del administrador que lee de Key Vault, y borra la regla al terminar, aunque falle.

## Secretos en Key Vault

Las apps los reciben como referencias en sus ajustes:

```
@Microsoft.KeyVault(VaultName=kv-kanban-newbothi;SecretName=jwt-secret)
```

Si App Service no logra resolver una referencia, la API y el ML **no arrancan**, y el log dice qué variable falló. Para ver el estado de cada referencia:

```bash
SUB=$(az account show --query id -o tsv)
az rest --method get --url "https://management.azure.com/subscriptions/$SUB/resourceGroups/kanban-rg/providers/Microsoft.Web/sites/kanban-newbothi/config/configreferences/appsettings?api-version=2022-03-01" \
  --query "value[].{ajuste:name, estado:properties.status, detalle:properties.details}" -o table
```

**Rotar un secreto:** crear una versión nueva en Key Vault y cambiar cualquier ajuste de la app. Las referencias apuntan a la última versión, pero App Service guarda los valores hasta 24 horas; un cambio de configuración lo obliga a leerlos al instante (reiniciar no basta). `ml-token` lo usan las dos apps: hay que hacerlo en las dos.

```bash
f=$(mktemp); chmod 600 "$f"
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" > "$f"
az keyvault secret set --vault-name kv-kanban-newbothi -n jwt-secret --file "$f" --encoding utf-8 -o none; rm -f "$f"
az webapp config appsettings set -g kanban-rg -n kanban-newbothi --settings "SECRETOS_ROTADOS=$(date -u +%FT%TZ)" -o none
```

Rotar `jwt-secret` cierra todas las sesiones abiertas.

## Base de datos sin contraseña

La app se conecta con su identidad administrada:

```
DATABASE_URL=sqlserver://kanban-newbothi-us.database.windows.net:1433;database=kanban;encrypt=true;authentication=ActiveDirectoryDefault
```

El usuario de la identidad en la base lo crea `db-identidad.mjs` (ver su encabezado). Hay que volver a ejecutarlo si se recrea la app, porque cambia el id de su identidad.

**Plan de vuelta atrás**, si la app no logra conectar: volver a la cadena del administrador, sin mostrarla.

```bash
f=$(mktemp); g=$(mktemp); chmod 600 "$f" "$g"
az keyvault secret show --vault-name kv-kanban-newbothi -n database-url-admin --query value -o tsv > "$f"
jq -Rn --rawfile v "$f" '[{name:"DATABASE_URL", value:($v|rtrimstr("\n")), slotSetting:false}]' > "$g"
az webapp config appsettings set -g kanban-rg -n kanban-newbothi --settings @"$g" -o none
rm -f "$f" "$g"
```

## Red

- **SQL:** una regla de firewall por cada IP de salida posible de la app (`app-salida-N`). No hay regla «Permitir servicios de Azure».
- **Servicio ML:** restricciones de acceso que solo admiten esas mismas IPs (`app-N`); el resto recibe 403.

Si Azure cambia las IPs de salida de la app (por ejemplo, al cambiar de plan), hay que regenerar las dos listas. Las IPs actuales:

```bash
az webapp show -g kanban-rg -n kanban-newbothi --query possibleOutboundIpAddresses -o tsv | tr ',' '\n'
```

En el plan F1 esas IPs se comparten con otros clientes de Azure: las reglas reducen la exposición, y la autenticación (token de Entra en SQL, `ML_TOKEN` en el ML) sigue siendo la barrera principal. Está en los riesgos aceptados del [modelo de amenazas](../../docs/modelo-de-amenazas.md).
