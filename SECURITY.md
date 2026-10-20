# Política de seguridad

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de GitHub: pestaña **Security** del repositorio → **Report a vulnerability**. Solo el mantenedor ve el reporte, y la corrección se publica después como aviso de seguridad.

Ayuda mucho incluir:

- qué se puede hacer y con qué permisos (sin cuenta, con cuenta, siendo miembro de un tablero);
- los pasos para reproducirlo o una prueba de concepto mínima;
- la versión: el campo `version` de `/health` en la demo indica el commit que está corriendo.

Es un proyecto personal, así que los plazos son de buena fe: respuesta en unos **5 días hábiles** y, si se confirma, una corrección o un plan en unos **30 días**. Quien reporte aparece en el aviso, si quiere.

## Alcance

**Dentro:** este repositorio y la demo en `kanban-newbothi.azurewebsites.net`.

**Fuera:**

- denegación de servicio por volumen (el plan gratuito de Azure tiene una cuota diaria de CPU; está documentado como riesgo aceptado);
- ingeniería social y ataques físicos;
- la plataforma de Azure o GitHub en sí;
- hallazgos de escáneres automáticos sin un impacto demostrado.

Al probar contra la demo, usa cuentas propias, no accedas a datos de otras personas y no envíes más de unas pocas peticiones por segundo.

## Versiones soportadas

Solo la rama `main`, que es la que está desplegada. No hay versiones anteriores mantenidas.

## Cómo está protegido

- [Modelo de amenazas](docs/modelo-de-amenazas.md): límites de confianza, amenazas por categoría STRIDE y riesgos aceptados.
- [Plan de pruebas](docs/plan-de-pruebas.md): qué prueba verifica cada control, con la matriz de los 26 hallazgos de la auditoría.
- Cada PR pasa por CodeQL, Bandit, gitleaks, `npm audit`, `pip-audit`, Trivy y un escaneo ZAP antes de poder fusionarse.
