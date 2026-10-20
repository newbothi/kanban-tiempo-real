# Cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El proyecto se despliega de forma continua desde `main`, sin números de versión: cada entrada corresponde a una etapa del endurecimiento posterior a la auditoría de seguridad y calidad. Los IDs `S-xx` son los hallazgos de esa auditoría; la [matriz de trazabilidad](docs/plan-de-pruebas.md#matriz-de-trazabilidad) dice qué prueba cubre cada uno.

## Fase 5 · Infraestructura y documentos — 2026-10-19

### Seguridad
- La app se conecta a Azure SQL con su **identidad administrada**, sin contraseña, y con permisos de solo lectura y escritura de datos (S-04).
- Los secretos pasan a **Key Vault**; cada app lee solo los suyos (S-25).
- La API y el servicio ML **no arrancan** si una referencia de Key Vault queda sin resolver: App Service pasaría el texto de la referencia, que es público y pasaba los controles de longitud (S-13).
- El firewall de SQL deja de permitir «todos los servicios de Azure»: solo las IPs de salida de la app, y una regla temporal durante cada migración (S-25).
- El servicio ML solo acepta conexiones desde las IPs de salida de la app (S-07).

### Agregado
- **Despliegue continuo por digest:** al pasar el CI en `main`, GitHub entra a Azure con OIDC, sin secretos guardados, y espera hasta que `/health` responda con el commit nuevo.
- `/health` informa la versión (commit) que está corriendo.
- Scripts de operación en `ops/azure/`: usuario de la base para la identidad y migraciones con regla temporal de firewall.
- `SECURITY.md`, [modelo de amenazas](docs/modelo-de-amenazas.md) y [plan de pruebas](docs/plan-de-pruebas.md).

## Fase 4 · Suite de QC — 2026-10-19

### Agregado
- E2E en Chromium, Firefox, WebKit y móvil, con axe en cada pantalla y sin reintentos.
- Tests de componentes del front (80) y tests de propiedades del ML con Hypothesis.
- Tests de tiempo real: entradas mal formadas, reconexión, presencia y 20 movimientos simultáneos.
- Las imágenes Docker se prueban en marcha antes de publicarse: smoke test, ZAP baseline y k6 (50 personas moviendo tarjetas).
- Workflow de estabilidad: 20 corridas en paralelo cada semana.

### Corregido
- Contraste AA, controles anidados y roles de los gráficos.
- Violaciones de CSP en WebKit: Zod sin `eval` en el navegador, favicon propio y arrastre sin animación de caída.
- Registro simultáneo con el mismo correo: reintento ante deadlock y 409 en vez de 500; conflictos que persisten responden 503 con `Retry-After`.

## Fase 3 · Barreras de QA — 2026-10-19

### Agregado
- CI con lint, tipos, cobertura mínima (80 % en API, paquete compartido y ML), CodeQL, Bandit, gitleaks, `npm audit`, `pip-audit` y Trivy; todos obligatorios para fusionar (S-12, S-23).
- Imágenes base y actions fijadas por digest o SHA, dependencias de Python con hash, Dependabot, SBOM y procedencia firmada (S-23).
- Se comprobó que cada barrera bloquea de verdad, con PRs de prueba que debían fallar: un secreto falso, una dependencia vulnerable, código sin tests y un error de lint.

### Seguridad
- Imágenes con parches del sistema, sin npm ni pip en tiempo de ejecución, sin tests ni seed, y `.dockerignore` con patrones de secretos (S-24).

## Invitaciones por correo — 2026-10-19

### Agregado
- Las invitaciones llegan por correo con un enlace (Azure Communication Services).

## Fase 2 · Sesión y API — 2026-10-18

### Seguridad
- Sesiones revocables con `sessionVersion`; el WebSocket se corta al cerrar sesión o al vencer el token (S-10).
- CSP, HSTS, `frame-ancestors`, `nosniff` y cookie con prefijo `__Host-` (S-11).
- Se rechazan los `JWT_SECRET` de ejemplo (S-13); Socket.IO revisa `Origin` y CORS no cae a localhost (S-15).
- Contraseñas: límite en bytes y lista de contraseñas comunes (S-17).
- `x-socket-id` solo excluye sockets del mismo usuario (S-14).
- Cuotas y límites por usuario, ids validados (S-16); la respuesta del ML se valida antes de llegar al navegador (S-19).
- Invitaciones pendientes que se aceptan, sin revelar qué correos existen (S-08); verificación de correo (S-09); demo sin permisos destructivos que se reinicia cada día y seed protegido (S-18).

### Corregido
- Posiciones largas o duplicadas por carreras: bloqueo por columna, reequilibrio y reintento (S-20).
- Carrera entre `board:join` y la expulsión de un miembro (S-21).

## Fase 1 · Lo que podía tumbar el sitio — 2026-10-18

### Seguridad
- Un evento `board:join` sin callback ya no tumba el servidor (S-01).
- El límite de intentos de login usa la IP real y además frena por cuenta (S-02).
- `/metrics` con caché y límites; el ML con topes de entrada y análisis O(N log N) (S-05).
- El ML exige token en producción y oculta `/docs` (S-06, S-07); tokens no ASCII y fechas sin zona horaria ya no dan 500 (S-22).

## Fase 0 · Azure — 2026-10-18

### Seguridad
- Contraseña del administrador de SQL rotada (S-03); HTTPS Only, TLS 1.2 y FTPS desactivado; regla de firewall de la IP de casa eliminada.

## Versión inicial — 2026-10-06

- Tablero Kanban en tiempo real con cuentas, tableros compartidos y servicio de análisis con ML en Python.
