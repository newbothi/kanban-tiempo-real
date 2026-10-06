# Kanban colaborativo en tiempo real

Tablero Kanban multiusuario: varias personas trabajan en el mismo tablero y ven los cambios de los demás al instante, sin recargar. Incluye cuentas de usuario, tableros compartidos con roles y permisos validados tanto en la API como en el canal en tiempo real.

![CI](https://github.com/newbothi/kanban-tiempo-real/actions/workflows/ci.yml/badge.svg)

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
- **Cuentas y sesiones** con JWT en cookie `httpOnly`.
- **Tableros compartidos:** el dueño invita por correo y quita miembros. Quien pierde el acceso es expulsado del canal en vivo en ese mismo momento.
- **Actualizaciones optimistas:** la interfaz responde sin esperar al servidor y se revierte si la operación falla.
- **Reconexión automática:** si se corta la conexión, el cliente se reconecta y se resincroniza.

## Stack

| Capa | Tecnologías |
|---|---|
| Front | React 19, TypeScript, Vite, dnd-kit, TanStack Query |
| API | Node.js, Fastify 5, Socket.IO, Zod |
| Datos | SQL Server, Prisma 7 (driver adapter `mssql`) |
| Seguridad | JWT en cookie httpOnly, bcrypt, rate limiting |
| Tests | Vitest (unitarios e integración), Playwright (E2E con dos navegadores) |
| CI | GitHub Actions con SQL Server como servicio |

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

  UA -- "POST /cards/:id/move" --> REST
  REST -- transacción --> DB
  REST -- "emite card:updated<br/>(excepto a quien lo hizo)" --> WS
  WS -- WebSocket --> UB
```

Es un **monorepo** con npm workspaces:

```
apps/
  web/        Front (React)
  api/        API REST + Socket.IO
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

## Seguridad

- **Sesión:** JWT en cookie `httpOnly` (inaccesible desde JavaScript, protege contra XSS), `SameSite=Lax` (protege contra CSRF) y `Secure` en producción.
- **Contraseñas:** bcrypt con 12 rondas, limitadas a 72 bytes (lo que bcrypt realmente considera).
- **Fuerza bruta:** rate limit de 10 intentos por minuto por IP en login y registro.
- **Sin enumeración de usuarios:** si el correo no existe, el login responde con el mismo mensaje y en el mismo tiempo que con una contraseña incorrecta.
- **Autorización por tablero:**

  | Acción | Dueño | Miembro | No miembro |
  |---|:-:|:-:|:-:|
  | Ver tablero y trabajar con tarjetas | ✔ | ✔ | 404 |
  | Invitar / quitar miembros | ✔ | 403 | 404 |
  | Eliminar el tablero | ✔ | 403 | 404 |

  A quien no es miembro se le responde **404 y no 403**, para no revelar que el tablero existe. También se valida que una tarjeta no pueda moverse a una columna de **otro** tablero.
- **Tiempo real:** el handshake de Socket.IO exige una sesión válida, y `board:join` exige ser miembro. Al quitar a alguien, se sacan de la room **todas sus pestañas abiertas**.
- **Dependencias:** `npm audit` reporta 4 avisos moderados en la cadena `mssql → tedious → sprintf-js`, sin versión corregida. `tedious` solo llama a `sprintf` con formatos fijos, así que no es explotable desde las entradas de la app. El resto se corrigió con `overrides`.

## Tests

| Suite | Qué cubre | Comando |
|---|---|---|
| Unitarios (27) | Orden, movimientos, schemas | `npm run test:unit` |
| Integración (36) | Auth, permisos y eventos del socket contra SQL Server real | `npm run test:api` |
| E2E (2) | Dos usuarios en navegadores separados: invitar, arrastrar, sincronizar, expulsar | `npm run test:e2e` |

Los tests de integración comprueban, por ejemplo, que un usuario sin permisos no pueda **mover, renombrar ni borrar** tarjetas ajenas, que no pueda escuchar eventos de un tablero ajeno, y que deje de recibirlos apenas lo quitan.

## Cómo correrlo

**Requisitos:** Node.js 20.19 o superior, y SQL Server con autenticación SQL y TCP habilitado en el puerto 1433.

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
```

### 3. Desarrollo

En dos terminales, desde la raíz:

```bash
npm run dev:api        # http://localhost:3000
npm run dev:web        # http://localhost:5173
```

### 4. Producción

```bash
npm run build          # compila el front
npm start              # la API sirve la API, el WebSocket y el front en un solo puerto
```

En el hosting hay que definir `NODE_ENV=production`, `DATABASE_URL` y `JWT_SECRET`, y ejecutar `npm run db:deploy -w @kanban/api` antes de arrancar.

## Estructura

```
apps/api/
  prisma/              schema, migraciones y seed
  src/app.ts           arma la app (rutas, auth, Socket.IO, archivos estáticos)
  src/auth/            sesión, login/registro y control de acceso
  src/routes/          tableros, miembros y tarjetas
  src/realtime.ts      Socket.IO: autenticación, rooms y presencia
  test/                tests de integración
apps/web/
  src/api/             cliente HTTP y hooks de TanStack Query
  src/realtime/        socket y suscripción a eventos
  src/components/      tablero, columnas, tarjetas, login, miembros
  e2e/                 tests de Playwright
packages/shared/       contrato compartido + tests unitarios
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
