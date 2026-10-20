# Kanban colaborativo en tiempo real

Tablero Kanban multiusuario: varias personas trabajan en el mismo tablero y ven los cambios de los demás al instante, sin recargar. Incluye cuentas de usuario, tableros compartidos con roles y permisos validados tanto en la API como en el canal en tiempo real, y un **servicio de análisis en Python** (regresión, simulación Monte Carlo y modelos de machine learning) que pronostica entregas y detecta tarjetas estancadas.

![CI](https://github.com/newbothi/kanban-tiempo-real/actions/workflows/ci.yml/badge.svg)

**Demo en vivo:** https://kanban-newbothi.azurewebsites.net<br>
Usuario demo: `demo@kanban.cl` / `demo1234`. También puedes crear tu cuenta y abrir la demo en dos navegadores para ver la sincronización.

> Está alojada en niveles gratuitos de Azure: si nadie la usa por un rato, la primera carga puede tardar entre 30 y 60 segundos mientras despiertan el servidor y la base de datos.

![Dos usuarios trabajando en el mismo tablero](docs/dos-usuarios.png)

<table>
  <tr>
    <td><img src="docs/tablero.png" alt="Tablero con panel de miembros" /></td>
    <td><img src="docs/login.png" alt="Pantalla de inicio de sesión" /></td>
  </tr>
</table>

## Funcionalidades

- **Arrastrar y soltar** tarjetas entre columnas y dentro de una columna, con teclado accesible.
- **Tiempo real:** crear, mover y eliminar tarjetas se refleja al instante en los demás navegadores.
- **Presencia:** cuántas personas están viendo el tablero.
- **Cuentas** con correo verificado y **sesiones revocables**: cerrar sesión en una pestaña la cierra en todas.
- **Tableros compartidos:** el dueño invita por correo, la persona recibe un enlace y decide si acepta, y el dueño puede quitar miembros. Quien pierde el acceso es expulsado del canal en vivo en ese mismo momento.
- **Actualizaciones optimistas:** la interfaz responde sin esperar al servidor y se revierte si la operación falla.
- **Reconexión automática:** si se corta la conexión, el cliente se reconecta y se resincroniza.
- **Métricas con ML (Python):** tendencia del ritmo del equipo, fecha estimada de entrega con simulación Monte Carlo, predicción del tiempo de cada tarjeta y detección de tarjetas estancadas. Se recalculan solas cuando alguien mueve una tarjeta.

## Stack

| Capa | Tecnologías |
|---|---|
| Front | React 19, TypeScript, Vite, dnd-kit, TanStack Query |
| API | Node.js, Fastify 5, Socket.IO, Zod |
| Datos | SQL Server, Prisma 7 (driver adapter `mssql`) |
| Análisis (ML) | Python 3.13, FastAPI, scikit-learn, SciPy, NumPy |
| Seguridad | Sesión revocable en cookie `__Host-` httpOnly, bcrypt, límites por IP y por cuenta, CSP estricta |
| Tests | Vitest (unitarios, integración y componentes), pytest + Hypothesis, Playwright con axe (Chromium, Firefox, WebKit y móvil), k6, OWASP ZAP |
| Calidad | ESLint, Ruff, mypy, cobertura mínima, CodeQL, Bandit, gitleaks, npm audit, pip-audit, Trivy |
| CI/CD | GitHub Actions con SQL Server como servicio; despliegue continuo a Azure por digest, con OIDC |
| Infraestructura | Azure App Service, Azure SQL con identidad administrada (sin contraseña), Key Vault |

## Arquitectura

```mermaid
flowchart LR
  subgraph Navegador A
    UA[React + TanStack Query]
  end
  subgraph Navegador B
    UB[React + TanStack Query]
  end
  subgraph API [API · Fastify]
    REST[Rutas REST<br/>validación Zod + permisos]
    WS[Socket.IO<br/>rooms por tablero y por usuario]
  end
  DB[(SQL Server)]
  ML[Servicio ML · Python<br/>FastAPI + scikit-learn]

  UA -- "POST /cards/:id/move" --> REST
  REST -- "transacción<br/>(tarjeta + evento)" --> DB
  REST -- "emite card:updated<br/>(excepto a quien lo hizo)" --> WS
  WS -- WebSocket --> UB
  REST -- "GET /metrics: datos del tablero<br/>ya autorizados (HTTP interno)" --> ML
```

Es un **monorepo** con npm workspaces:

```
apps/
  web/        Front (React)
  api/        API REST + Socket.IO
  ml/         Servicio de análisis (Python + FastAPI)
packages/
  shared/     Tipos, schemas Zod, eventos del socket y lógica de orden.
              Los usan el front y la API: un solo contrato, verificado por TypeScript.
```

## Decisiones técnicas

**Los cambios entran por REST; el WebSocket solo avisa.** La validación, los permisos y las transacciones quedan en un solo lugar. Después de guardar, la API emite el evento a la room del tablero, excluyendo al socket que hizo el cambio, que se identifica con el header `x-socket-id`.

**Orden con *fractional indexing*.** Cada tarjeta tiene una `position` tipo string (`a0`, `a0V`, `a1`…). Mover una tarjeta genera una clave entre sus vecinas, así que **solo se actualiza una fila**, sin renumerar el resto. Eso hace que cada movimiento sea un único evento pequeño.

**Collation binaria en SQL Server.** Esas claves deben ordenarse byte a byte, pero la collation por defecto de SQL Server no distingue mayúsculas y desordenaría las tarjetas en silencio. La columna `position` usa `COLLATE Latin1_General_BIN2`. Prisma no permite declarar collations, así que la migración está ajustada a mano.

**El cliente envía "columna + índice", no la `position`.** El servidor calcula la clave definitiva dentro de una transacción. El front usa **la misma función** (`positionForMove`, en `packages/shared`) para la actualización optimista, de modo que lo que se ve y lo que se guarda coinciden. Un test lo verifica.

**Un solo request por arrastre.** Mientras se arrastra, el front trabaja sobre una copia local. Al soltar, envía un único `move`.

## Análisis con machine learning (Python)

![Panel de métricas](docs/metricas.png)

**Cómo encaja.** El servicio de Python no tiene base de datos ni credenciales, y no está expuesto al navegador. La API de Node verifica que el usuario sea miembro del tablero, reúne sus datos y se los envía. Python solo calcula y responde. Así:

- Los permisos viven en un solo lugar.
- Python no necesita drivers de SQL Server.
- El servicio no tiene estado, así que se pueden levantar varias copias sin coordinar nada.

En producción, además, exige un secreto compartido (`ML_TOKEN`). Si el servicio se cae, el tablero sigue funcionando y la pestaña de métricas muestra un aviso.

**Contrato tipado entre lenguajes.** Los modelos de Pydantic generan el esquema OpenAPI, y a partir de él se generan los tipos de TypeScript (`packages/shared/src/ml-api.ts`, con `npm run ml:types`). El CI regenera ambos y falla si no coinciden con los commiteados, así que no se puede cambiar la API de Python sin que TypeScript se entere.

**Los datos.** Cada cambio de columna se guarda en `CardEvent`, en la misma transacción que el movimiento. Ese historial es la materia prima del análisis.

| Análisis | Método | Qué responde |
|---|---|---|
| Ritmo del equipo | Regresión lineal (SciPy) con IC 95% y p-value | ¿Terminamos más o menos tarjetas por semana? ¿Es significativo? |
| Fecha de entrega | Simulación Monte Carlo (10.000 escenarios con semanas reales) | ¿Con qué probabilidad terminamos lo pendiente en N semanas? |
| Tiempo por tarjeta | Mediana vs. regresión lineal vs. gradient boosting, con validación cruzada (MAE) | ¿Cuánto le falta a cada tarjeta? ¿Qué la retrasa? |
| Tarjetas estancadas | Regla del rango intercuartil (Q3 + 1,5·IQR) por columna | ¿Qué lleva mucho más de lo normal en curso? |

El modelo de tiempos usa como variables el tipo de tarea, el largo del título y el **trabajo en curso al empezar** (ley de Little). Se reportan los coeficientes del modelo lineal ("cada tarjeta extra en paralelo agrega X días") porque la idea es explicar, no solo predecir.

**Datos sintéticos.** Un tablero nuevo no tiene historial suficiente, así que `npm run db:simulate -w @kanban/api` genera 6 meses simulados de un equipo, con reglas conocidas:

- El ritmo crece levemente con el tiempo.
- Cada tipo de tarea tiene su propia duración.
- La multitarea alarga las entregas.
- Algunas tarjetas se bloquean.

Los tests de Python verifican que los modelos **recuperan** relaciones conocidas. Por ejemplo, si la regla es +1 día por cada tarjeta en paralelo, el coeficiente estimado debe acercarse a 1.

![Tablero con insignias del análisis](docs/tablero-insignias.png)

## Seguridad

El proyecto pasó por una auditoría de seguridad con **26 hallazgos** (5 altos, 8 medios y 13 bajos), todos corregidos y con una prueba que impide que vuelvan. El detalle está en el [modelo de amenazas](docs/modelo-de-amenazas.md) y en la [matriz de trazabilidad](docs/plan-de-pruebas.md#matriz-de-trazabilidad). Para reportar una vulnerabilidad: [SECURITY.md](SECURITY.md).

- **Sesión:** JWT en cookie `__Host-` `httpOnly`, `Secure` y `SameSite=Lax`. Se puede **revocar**: cerrar sesión invalida el token en todas partes y corta el WebSocket en ese momento.
- **Contraseñas:** bcrypt con 12 rondas, límite de 72 **bytes** (lo que bcrypt realmente considera) y rechazo de contraseñas comunes.
- **Fuerza bruta:** 10 intentos por minuto por IP (la real, no la que declara el cliente) y, además, un freno por cuenta con esperas crecientes.
- **Sin enumeración de usuarios:** el login y las invitaciones responden lo mismo exista o no la cuenta.
- **Cuentas verificadas:** hay que confirmar el correo para ver y aceptar invitaciones. Las invitaciones quedan pendientes hasta que la persona las acepta.
- **Autorización por tablero:**

  | Acción | Dueño | Miembro | No miembro |
  |---|:-:|:-:|:-:|
  | Ver tablero y trabajar con tarjetas | ✔ | ✔ | 404 |
  | Invitar / quitar miembros | ✔ | 403 | 404 |
  | Eliminar el tablero | ✔ | 403 | 404 |

  A quien no es miembro se le responde **404 y no 403**, para no revelar que el tablero existe. También se valida que una tarjeta no pueda moverse a una columna de **otro** tablero.
- **Tiempo real:** el handshake de Socket.IO exige una sesión válida y el mismo origen, y `board:join` exige ser miembro. Al quitar a alguien, se sacan de la room **todas sus pestañas abiertas**.
- **Uso razonable:** cuotas por usuario y por tablero, límite de eventos por socket y caché de métricas, para que nadie agote la CPU del plan gratuito.
- **Cabeceras:** CSP sin `unsafe-inline` ni `eval`, HSTS, `frame-ancestors`, `nosniff`, COEP y Permissions-Policy.
- **Infraestructura:** la app entra a la base con su **identidad administrada**, sin contraseña y solo con permisos de datos. Los secretos viven en **Key Vault**; si uno no se puede leer, la app no arranca. El firewall de SQL y el servicio ML solo aceptan las IPs de salida de la app.
- **Cuenta demo:** pública pero restringida (no invita, no expulsa, no borra tableros) y se reinicia cada día.

## Tests

**346 pruebas automáticas** en seis suites, más un smoke test, un escaneo de seguridad y una prueba de carga contra las imágenes Docker reales. La estrategia completa, los criterios para fusionar y qué prueba cubre cada hallazgo están en el [plan de pruebas](docs/plan-de-pruebas.md).

| Suite | Qué cubre | Comando |
|---|---|---|
| Unitarios y de componentes | Orden, schemas, contraseñas, límites, IP del cliente y configuración de arranque; las pantallas del front con la API y el socket simulados | `npm run test:unit` |
| Integración | Auth, permisos, invitaciones, verificación, demo, socket, posiciones y métricas, contra SQL Server real | `npm run test:api` |
| Python | Cada análisis contra datos con propiedades conocidas, la API, los topes y propiedades con Hypothesis | `python -m pytest` (en `apps/ml`) |
| E2E | Dos usuarios en navegadores separados, en Chromium, Firefox, WebKit y móvil, con axe en cada pantalla | `npm run test:e2e` |
| Imágenes en marcha | Smoke test, OWASP ZAP y k6 (50 personas moviendo tarjetas a la vez) | job `stack` del CI |

Los tests de integración comprueban, por ejemplo, que un usuario sin permisos no pueda **mover, renombrar ni borrar** tarjetas ajenas, que no pueda escuchar eventos de un tablero ajeno, y que deje de recibirlos apenas lo quitan.

### Barreras del CI

Un PR no se puede fusionar si falla cualquiera de estas revisiones:

| Revisión | Herramienta | Falla si… |
|---|---|---|
| Lint | ESLint con typescript-eslint (estricto en el front) · Ruff | hay cualquier error |
| Tipos | `tsc` · mypy en modo estricto | hay cualquier error |
| Cobertura | Vitest (v8) · pytest-cov | la API, el paquete compartido o el servicio ML bajan del 80 % |
| Análisis estático | CodeQL (consultas `security-extended`) · Bandit | encuentra una vulnerabilidad |
| Dependencias | `npm audit` · `pip-audit` | hay una vulnerabilidad conocida |
| Secretos | gitleaks, sobre todos los commits del PR | aparece una clave o contraseña |
| Imágenes | Trivy | hay una vulnerabilidad HIGH o CRITICAL con arreglo disponible |
| E2E | Playwright (4 navegadores, sin reintentos) + axe | falla un flujo, hay una violación de CSP o un problema de accesibilidad serio |
| Imágenes en marcha | Smoke test · OWASP ZAP · k6 | falla el flujo completo, falta una cabecera o la carga supera los umbrales |

Además, cada imagen publicada lleva su SBOM (CycloneDX) como artefacto del CI y una procedencia (*provenance*) firmada por GitHub.

En local: `npm run lint`, `npm run typecheck`, `npm run test:coverage -w @kanban/shared`, y en `apps/ml`: `ruff check .`, `mypy`, `pytest --cov`.

## Cómo correrlo

**Requisitos:** Node.js 20.19 o superior, Python 3.12 o superior, y SQL Server con autenticación SQL y TCP habilitado en el puerto 1433.

### 1. Base de datos

En SSMS:

```sql
CREATE DATABASE kanban;
CREATE DATABASE kanban_test;   -- solo para los tests
GO
CREATE LOGIN kanban_app WITH PASSWORD = 'CambiaEsto123!', CHECK_POLICY = OFF;
GO
USE kanban;      CREATE USER kanban_app FOR LOGIN kanban_app; ALTER ROLE db_owner ADD MEMBER kanban_app;
GO
USE kanban_test; CREATE USER kanban_app FOR LOGIN kanban_app; ALTER ROLE db_owner ADD MEMBER kanban_app;
GO
-- Como Azure SQL: las lecturas no bloquean a las escrituras (evita deadlocks con mucha concurrencia).
ALTER DATABASE kanban      SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
ALTER DATABASE kanban_test SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO
```

### 2. Instalar y configurar

```bash
npm install
cd apps/api
cp .env.example .env              # en Windows: copy .env.example .env
cp .env.test.example .env.test    # en Windows: copy .env.test.example .env.test
```

En `.env`, reemplaza `JWT_SECRET` por un valor aleatorio:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```bash
npm run db:generate
npm run db:deploy
npm run db:seed        # usuario demo: demo@kanban.cl / demo1234
npm run db:simulate    # tablero con 6 meses de historia simulada (para las métricas)
```

Servicio de análisis (Python), desde la raíz:

```bash
cd apps/ml
python -m venv .venv
.venv\Scripts\activate          # en macOS/Linux: source .venv/bin/activate
pip install -r requirements.in -r requirements-dev.in
```

Los `requirements*.txt` tienen las versiones exactas con hash para Linux (los usan el CI y la imagen Docker). Para cambiar una dependencia se edita el `.in` y se regeneran con `pip-compile --generate-hashes --allow-unsafe --strip-extras` (en Linux o WSL).

### 3. Desarrollo

En tres terminales:

```bash
npm run dev:api                                   # http://localhost:3000
npm run dev:web                                   # http://localhost:5173
# en apps/ml, con el entorno virtual activado:
uvicorn app.main:app --reload --port 8000         # http://localhost:8000/docs
```

FastAPI publica documentación interactiva de la API en `/docs`.

### 4. Producción

```bash
npm run build          # compila el front
npm start              # la API sirve la API, el WebSocket y el front en un solo puerto
```

En el hosting hay que definir `NODE_ENV=production`, `DATABASE_URL` y `JWT_SECRET`, y ejecutar `npm run db:deploy -w @kanban/api` antes de arrancar.

## Despliegue (Docker + Azure)

```mermaid
flowchart LR
  P[push a main] --> CI[GitHub Actions<br/>tests, escaneos e<br/>imágenes en marcha]
  CI -- todo verde --> GHCR[GHCR<br/>imágenes con SBOM<br/>y procedencia firmada]
  GHCR -- "OIDC, por digest" --> AS[App Service<br/>web + API + WebSocket]
  GHCR -- "OIDC, por digest" --> ASML[App Service<br/>servicio ML]
  AS -- "identidad administrada" --> SQL[(Azure SQL)]
  AS -- "HTTPS + ML_TOKEN<br/>solo IPs de la app" --> ASML
  KV[(Key Vault)] -. secretos .-> AS
  KV -. secretos .-> ASML
```

- **Imágenes mínimas:** el `Dockerfile` es multi-etapa y la imagen final solo lleva lo que ejecuta: sin npm, pip, tests ni seed, con parches del sistema y un usuario sin privilegios.
- **Despliegue continuo:** cada push a `main` con todo en verde publica las imágenes y las despliega. GitHub entra a Azure con **OIDC**, sin secretos guardados, y fija cada app a un **digest** exacto (nunca `:latest`). El job espera a que `/health` responda con el commit nuevo y consulte la base.
- **Sin contraseñas en la app:** se conecta a SQL con su identidad administrada y lee `JWT_SECRET`, `ML_TOKEN` y la conexión de correo desde Key Vault.
- **Un único origen:** el contenedor sirve la web, la API y el WebSocket, así que no hace falta CORS y la cookie `Secure` funciona sobre HTTPS.
- Ante errores internos, el cliente recibe un mensaje genérico. El detalle queda solo en el log.

Cómo se opera (migraciones, rotar secretos, volver atrás): [ops/azure/README.md](ops/azure/README.md).

## Estructura

```
apps/api/
  prisma/              schema, migraciones y seed
  src/app.ts           arma la app (rutas, auth, Socket.IO, archivos estáticos)
  src/auth/            sesión, login/registro y control de acceso
  src/routes/          tableros, miembros, tarjetas y métricas
  src/ml/client.ts     cliente HTTP del servicio ML
  src/realtime.ts      Socket.IO: autenticación, rooms y presencia
  test/                tests de integración
apps/ml/
  app/schemas.py       contrato (Pydantic → OpenAPI → TypeScript)
  app/analysis/        throughput, tendencia, Monte Carlo, tiempos, estancadas
  app/service.py       orquesta los análisis y redacta las conclusiones
  tests/               pytest con datos de propiedades conocidas
apps/web/
  src/api/             cliente HTTP y hooks de TanStack Query
  src/realtime/        socket y suscripción a eventos
  src/components/      tablero, columnas, tarjetas, login, miembros
  src/components/metrics/  panel de métricas y gráficos SVG
  test/                tests de componentes (Vitest + Testing Library)
  e2e/                 tests de Playwright
packages/shared/       contrato compartido + tests unitarios
qa/                    smoke test de las imágenes, reglas de ZAP y escenario de k6
ops/azure/             scripts y guía de operación en Azure
docs/                  modelo de amenazas, plan de pruebas y capturas
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
