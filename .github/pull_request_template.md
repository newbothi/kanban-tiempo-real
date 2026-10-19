## Qué cambia

<!-- Qué hace este PR y por qué. Si cierra un hallazgo del estudio, nómbralo (S-xx). -->

## Cómo se probó

- [ ] Tests nuevos o actualizados para lo que cambia (y un test de regresión si arregla un bug o un hallazgo)
- [ ] `npm run lint`, `npm run typecheck` y `npm run test:unit` pasan en local
- [ ] Si toca el servicio ML: `ruff check .`, `mypy` y `pytest` pasan en `apps/ml`
- [ ] Si toca la interfaz: probado a mano (y con dos usuarios si es tiempo real)

## Seguridad

- [ ] No agrega secretos, contraseñas ni cadenas de conexión (ni en código, ni en tests, ni en logs)
- [ ] Toda entrada nueva se valida con Zod (API) o Pydantic (ML), con largo máximo
- [ ] Las rutas nuevas revisan sesión y permisos (dueño / miembro) y tienen límite de peticiones si son caras
- [ ] Los errores no muestran detalles internos al cliente
- [ ] Si agrega una dependencia: es necesaria, está mantenida y `npm audit` / `pip-audit` siguen limpios
- [ ] Si cambia la base de datos: hay migración, es reversible o aditiva, y se aplica antes de desplegar

## Despliegue

<!-- ¿Hace falta algo en Azure (migración, variable nueva, reinicio)? Si no, escribe "nada". -->
