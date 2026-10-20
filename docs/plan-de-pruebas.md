# Plan de pruebas (QA y QC)

Cada cambio pasa por **346 pruebas automáticas** en seis suites, más un smoke test, un escaneo de seguridad (ZAP) y una prueba de carga (k6) contra las imágenes Docker reales. Si una sola falla, el PR no se puede fusionar y nada se publica.

- **QA (el proceso):** las barreras del CI que impiden que un defecto llegue a `main`.
- **QC (el producto):** las pruebas que verifican que la aplicación hace lo que debe, incluidos los 26 hallazgos de la auditoría de seguridad.

Este documento es la referencia de qué se prueba, dónde y cómo se rastrea cada hallazgo hasta su prueba. El análisis de amenazas está en [modelo-de-amenazas.md](modelo-de-amenazas.md).

## Niveles de prueba

| Nivel | Herramienta | Qué verifica | Pruebas | Dónde corre |
|---|---|---|--:|---|
| Unitarias de la API | Vitest | Límites, freno de login, IP del cliente, validación de la respuesta del ML, configuración de arranque, conexión a SQL | 61 | job `check` |
| Integración de la API | Vitest + SQL Server real | Auth, permisos, invitaciones, verificación de correo, cuenta demo, tiempo real, posiciones, métricas, concurrencia | 104 | job `integration` |
| Paquete compartido | Vitest | Orden fraccional, schemas, política de contraseñas | 27 | job `check` |
| Componentes del front | Vitest + Testing Library | Login y registro, tablero, movimiento optimista y su reversión, miembros, avisos de cuenta, métricas, con API y socket simulados | 80 | job `check` |
| Servicio ML | pytest + Hypothesis | Cada análisis con datos de propiedades conocidas, la API y sus topes, propiedades que valen para cualquier entrada | 50 | job `ml` |
| E2E | Playwright + axe | Dos usuarios colaborando, salir del tablero, cerrar sesión en otra pestaña, accesibilidad, móvil sin scroll horizontal | 6 × 4 navegadores = 24 | job `integration` |
| Smoke de las imágenes | `qa/smoke.sh` | Las dos imágenes en modo producción: salud, cabeceras, cookie, flujo completo, usuario sin privilegios, sin gestores de paquetes | 1 script | job `stack` |
| Seguridad dinámica | OWASP ZAP baseline | Cabeceras, cookies, CORS y fugas de información; 12 reglas suben de aviso a falla | 1 escaneo | job `stack` |
| Carga | k6 | 50 personas moviendo tarjetas y 10 leyendo métricas a la vez | 1 escenario | job `stack` |
| Estabilidad | Workflow `estabilidad.yml` | La API y los E2E de los 4 navegadores, 20 corridas en paralelo sin reintentos | 20 corridas | cada lunes y a pedido |

Los conteos son los de octubre de 2026; el CI muestra los actuales en el resumen de cada corrida.

## Criterios de entrada y salida

Un PR **entra** a revisión cuando el CI arranca solo, sin pasos manuales. **Sale** (se puede fusionar) solo si:

1. Los 11 checks obligatorios de la protección de `main` están en verde, con la rama al día con `main`.
2. La cobertura no baja de **80 %** en la API, el paquete compartido y el servicio ML, ni de **75 %** en el front. Se mide en sentencias, ramas, funciones y líneas.
3. `npm audit`, `pip-audit`, gitleaks, CodeQL, Bandit y Trivy no encuentran nada. Trivy solo falla con vulnerabilidades HIGH o CRITICAL que ya tengan arreglo.
4. Las imágenes pasan el smoke test, ZAP y los umbrales de k6:
   - p95 bajo **1,5 s** al mover tarjetas y bajo **3 s** en métricas;
   - menos de **1 %** de errores;
   - más de **99 %** de checks correctos;
   - volumen mínimo de requests, para que un script que falla en silencio no pase.

**Las barreras se probaron a sí mismas.** Antes de confiar en ellas se abrieron PRs hechos para fallar, y cada uno quedó bloqueado por la barrera esperada: un secreto falso (#13, gitleaks), una dependencia vulnerable (#14, `npm audit`), código sin tests (#15, cobertura) y un error de lint (#16, ESLint).

**Sin reintentos.** Playwright corre con `retries: 0`: una prueba que falla a veces es un defecto, no ruido. El workflow de estabilidad existe para encontrarlas antes de que molesten.

**Del CI a producción.** Solo un push a `main` con todo en verde publica las imágenes en GHCR. Azure recibe la imagen **por digest** (no `:latest`), y el despliegue espera hasta que `/health` responda con el commit nuevo. `/health` además consulta la base, así que un despliegue que no conecta a SQL no se da por bueno.

## Matriz de trazabilidad

Cada hallazgo de la auditoría, el control que lo corrige y la prueba o barrera que impide que vuelva. Las pruebas están rotuladas con su ID (`S-xx`) para encontrarlas con una búsqueda.

| ID | Sev. | Hallazgo | Control | Verificación |
|---|---|---|---|---|
| S-01 | Alta | `board:join` sin callback tumbaba el servidor | Los eventos del socket validan sus argumentos y el callback es opcional; los errores se capturan | `realtime.test.ts` › S-01 (eventos malformados; el proceso sigue vivo) |
| S-02 | Alta | Saltar el límite de login falseando `X-Forwarded-For` | `trustProxy` de un salto: la IP es la que agrega Azure. Freno por cuenta: 5 intentos libres y esperas crecientes hasta 15 min | `unit/client-ip.test.ts`, `unit/throttle.test.ts`, `auth.test.ts` › S-02; k6 usa una IP por persona virtual |
| S-03 | Alta | La contraseña del admin de SQL quedó expuesta | Rotada; hoy vive solo en Key Vault (`database-url-admin`) y la app ya no la usa | Operación (fase 0). gitleaks impide que una clave llegue al repo |
| S-04 | Alta | La app usaba el login administrador | Identidad administrada de la app con `db_datareader` y `db_datawriter`, sin contraseña | `unit/db-connection.test.ts` › S-04; el despliegue exige `/health` (consulta SQL) |
| S-05 | Alta | Agotar la CPU del plan con `/metrics` | Caché por tablero, 5 cálculos por usuario y minuto, topes de tarjetas y simulaciones, cuerpos de hasta 10 MB y análisis O(N log N) | `unit/metrics-service.test.ts`, `metrics-limits.test.ts`, `test_security.py` › s05 (incluye memoria acotada y 5.000 tarjetas en menos de 2 s); k6 › métricas |
| S-06 | Media | El ML aceptaba todo si faltaba `ML_TOKEN` | Falla cerrado: sin token de 32 caracteres, ni la API ni el ML arrancan en producción | `unit/startup-config.test.ts` › S-06, `test_security.py` › s06; smoke: ML sin token → 401 |
| S-07 | Media | ML público con `/docs` y `/openapi.json` | Sin documentación en producción; restricción de acceso a las IPs de salida de la app | `test_security.py` › s07; smoke: `/docs` → 404 |
| S-08 | Media | Invitar revelaba correos registrados y sumaba gente sin consentimiento | Invitaciones pendientes que la persona acepta; misma respuesta exista o no la cuenta | `permissions.test.ts` › invitaciones (S-08), `invite-email.test.ts` |
| S-09 | Media | Registrar un correo ajeno y recibir sus invitaciones | Verificación por correo; sin verificar no se ven ni aceptan invitaciones | `verification-demo.test.ts` › S-09 |
| S-10 | Media | JWT irrevocable; el socket seguía vivo | `sessionVersion` en el token y en la base; el socket se corta al cerrar sesión o al vencer | `auth.test.ts` › S-10, `realtime.test.ts` › S-10, E2E «cerrar sesión en una pestaña la cierra en la otra» |
| S-11 | Media | Faltaban cabeceras de seguridad | Helmet: CSP estricta, HSTS, `frame-ancestors`, `nosniff`, COEP y Permissions-Policy; HTTPS Only y TLS 1.2 | `unit/http-security.test.ts` › S-11; E2E sin violaciones de CSP en 4 navegadores; smoke y ZAP |
| S-12 | Media | El workflow no limitaba el `GITHUB_TOKEN` | `permissions: contents: read` global; escritura solo en los jobs que publican o despliegan | CodeQL (actions) revisa los workflows |
| S-13 | Media | El `JWT_SECRET` de ejemplo pasaba la validación | En producción se rechazan los valores de ejemplo y cualquier referencia de Key Vault sin resolver | `unit/origins-and-secret.test.ts` › S-13, `unit/startup-config.test.ts` › S-13, `test_security.py` › s13 |
| S-14 | Baja | `x-socket-id` permitía ocultar cambios a otros | Solo se excluye un socket del mismo usuario | `realtime.test.ts` › S-14 |
| S-15 | Baja | Socket.IO sin revisar `Origin`; CORS caía a localhost | Mismo origen en producción; el handshake rechaza otros sitios aunque traigan cookie | `unit/origins-and-secret.test.ts` › S-15, `unit/http-security.test.ts` › S-15, `realtime.test.ts` › S-15 |
| S-16 | Baja | Sin cuotas ni límites; respuestas sin paginar | Topes por usuario y tablero, ventanas deslizantes, ids validados como UUID | `limits.test.ts` › S-16, `unit/limits.test.ts`, `unit/http-security.test.ts` › S-16 |
| S-17 | Baja | El límite contaba caracteres, no bytes; contraseñas comunes | 72 bytes UTF-8 y lista de contraseñas comunes, igual en el front y la API | `passwords.test.ts` › S-17 (compartido), `auth.test.ts` › S-17 |
| S-18 | Baja | Seed sin protección; la demo podía invitar y borrar | El seed se niega a correr contra Azure; demo restringida que se reinicia cada día | `verification-demo.test.ts` › S-18 |
| S-19 | Baja | La respuesta del ML llegaba sin validar | Schema estricto y tope de tamaño; lo desconocido se descarta | `unit/ml-response.test.ts`, `unit/ml-client.test.ts`, `metrics.test.ts` › S-19 |
| S-20 | Baja | Posiciones de más de 255 caracteres y duplicadas, con 500 | Bloqueo por columna (`UPDLOCK, HOLDLOCK`), reequilibrio de claves largas y reintento ante conflicto | `positions.test.ts` › S-20, `realtime-qc.test.ts` › concurrencia (20 movimientos simultáneos); k6 › mover |
| S-21 | Baja | Carrera entre `board:join` y la expulsión | Se vuelve a comprobar la membresía después del `join` | `realtime.test.ts` › perder el acceso. La carrera exacta no es reproducible de forma determinista: se cubre con revisión de código |
| S-22 | Baja | El ML respondía 500 ante tokens no ASCII o fechas mezcladas | Comparación en bytes; fechas con zona horaria obligatoria y rango acotado | `test_security.py` › s22 |
| S-23 | Baja | Cadena de suministro débil | Actions por SHA, imágenes base por digest, pip con hashes, Dependabot, CodeQL, Trivy, SBOM, procedencia firmada y despliegue por digest | Barreras `dependencies` y `docker`; job `deploy` |
| S-24 | Baja | Secretos posibles en el contexto de build; tests y seed en la imagen | `.dockerignore` con patrones de secretos; la imagen final solo lleva lo que ejecuta | Smoke › imágenes endurecidas (sin tests, seed, npm ni pip); Trivy |
| S-25 | Baja | Secretos en App Settings; firewall amplio | Referencias de Key Vault, reglas solo para las IPs de salida de la app, migraciones con una regla temporal | Arranque falla cerrado (S-13); operación verificada con `az` |
| S-26 | Baja | `sprintf-js` con un DoS moderado | Desapareció al actualizar `tedious` | `npm audit` en cada PR |

## Pruebas no funcionales

- **Accesibilidad.** axe revisa cada pantalla (login, tablero, miembros, métricas) con las reglas WCAG 2.1 A y AA, en los 4 proyectos de Playwright. Falla con cualquier problema serio o crítico, y el detalle completo queda adjunto al reporte.
- **Compatibilidad.** Chromium, Firefox y WebKit de escritorio, más un perfil móvil táctil.
- **Rendimiento.** Escenarios y umbrales en `qa/k6/carga.js`. Cada persona virtual usa su propia cuenta e IP, como en la realidad.
- **Seguridad dinámica.** ZAP baseline contra la imagen en modo producción. Las reglas que deben fallar están en `qa/zap/reglas.tsv`, con su motivo.
- **Propiedades.** Hypothesis genera tableros al azar y comprueba invariantes: los percentiles están ordenados, más ritmo nunca atrasa la fecha y más trabajo nunca la adelanta.

## Cómo correrlas en local

```bash
npm run lint && npm run typecheck
npm run test:unit -w @kanban/api            # unitarias de la API (sin base de datos)
npm run test:coverage -w @kanban/api        # unitarias + integración (necesita kanban_test)
npm run test:coverage -w @kanban/shared
npm run test:coverage -w @kanban/web
npm run test:e2e                            # Playwright (necesita la API, la web y el ML)

cd apps/ml && ruff check . && mypy && python -m pytest --cov
```

El smoke test, ZAP y k6 necesitan las dos imágenes levantadas en modo producción. El job `stack` de `.github/workflows/ci.yml` muestra cómo levantarlas y los comandos exactos.
