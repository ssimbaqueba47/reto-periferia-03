# Despliegue Node.js / Render — guía sin ejecutar publicación

Estado: compilación y arranque de producción comprobados localmente; ningún repositorio ni servicio se ha publicado. La prueba usa Node 26.13.0 en Windows. No se ha probado un despliegue Linux ni una máquina completamente limpia.

## Compatibilidad y comandos

El backend no requiere navegador, Bun, shell ni tsx durante su ejecución de producción. Las dependencias runtime son Zod, dotenv y el SDK oficial Gemini. El build emite JavaScript ESM a `out/build/`; los archivos `web/`, `agent/`, `src/knowledge/` y `fixtures/` se leen desde la raíz del checkout y deben permanecer en la entrega.

```bash
npm ci --include=dev
npm run typecheck
npm test
npm run build
# Solo en una imagen/copia de producción, después de compilar:
npm prune --omit=dev
NODE_ENV=production HOST=0.0.0.0 PORT=10000 npm start
```

En PowerShell las últimas variables se establecen así:

```powershell
$env:NODE_ENV='production'
$env:HOST='0.0.0.0'
$env:PORT='10000'
npm.cmd start
```

No ejecutes `prune` sobre el entorno de desarrollo si vas a seguir usando las pruebas o demo TypeScript. `npm start` ejecuta exactamente `node out/build/server.js`. No borra datos. `npm run build` escribe únicamente los módulos compilados en `out/build/`; no limpia `out/sap/`.

`PORT` procede del entorno, con 3000 como fallback local. `HOST` es `127.0.0.1` en desarrollo y `0.0.0.0` cuando `NODE_ENV=production`; puede fijarse explícitamente. Render exige escuchar en `0.0.0.0` y recomienda su variable `PORT`. [Web Services](https://render.com/docs/web-services).

## Configuración exacta en Render

Crear manualmente un **Web Service**, no un Static Site:

| Ajuste | Valor |
| --- | --- |
| Runtime | Node |
| Root Directory | Vacío, si package.json está en la raíz del repositorio |
| Build Command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instancias | Una; no escalar sobre los archivos actuales |
| Auto deploy | Desactivado inicialmente para controlar la defensa |
| NODE_VERSION | `26.13.0`, versión usada en la comprobación local; confirmar disponibilidad al crear el servicio |
| NODE_ENV | `production` |
| HOST | `0.0.0.0` |
| PORT | Usar el asignado por Render; no copiar el puerto local |

La selección explícita de Node evita que el rango abierto `>=20` termine usando otra versión. Si Render no ofrece la versión comprobada, elegir y probar otra compatible antes de dar por válido el despliegue. [Selección de Node](https://render.com/docs/node-version).

Secretos y límites, configurados en Environment del servicio, nunca en Git:

| Variable | Valor / acción |
| --- | --- |
| GEMINI_API_KEY | Introducir manualmente una clave dedicada a esta demo |
| GEMINI_MODEL | `gemini-3.5-flash-lite` |
| AGENT_MAX_ITERATIONS | `25` |
| AGENT_MAX_SESSION_TOKENS | `200000` |
| AGENT_MAX_TOTAL_TOKENS | `1000000` por proceso; reducir si se necesita |
| GEMINI_TIMEOUT_MS | `45000` |
| GEMINI_MAX_OUTPUT_TOKENS | `4096` |

El health check confirma proceso y configuración, **no** cuota, validez de credenciales ni generación Gemini. Después de desplegar hay que probar una conversación. No subir `.env` ni copiar su contenido a logs o tickets.

## Render gratuito: alcance y pérdida de datos

Los servicios gratuitos tienen filesystem efímero, no admiten disco persistente y se suspenden tras inactividad. Render indica que los cambios locales se pierden en reinicios o redeploys. [Free services](https://render.com/docs/free), [FAQ](https://render.com/docs/faq).

Consecuencias para esta aplicación:

- Sesiones, autorizaciones y presupuestos en memoria se pierden en cualquier reinicio, incluso con un disco duradero.
- Si se reemplaza el filesystem, se pierden órdenes, evidencia, trazabilidad, CSV y logs de `out/`. La secuencia puede volver a 4500000001 y desaparece la memoria de idempotencia.
- Los fixtures y el código reaparecen desde el checkout. No deben generarse en el Start Command ni depender de `out/` anterior.
- Una solicitud antigua no se puede reconocer como ya creada si se perdió su JSONL. No presentar esto como garantía de idempotencia entre despliegues.
- Una sola instancia es necesaria; no hay bloqueo distribuido ni transacción entre SAP simulado y auditoría.

El plan gratuito es aceptable como **demostración temporal con datos ficticios** y aceptación explícita de estas pérdidas. No es almacenamiento empresarial. Se conserva la arquitectura por archivos del PRD; no se añadió base de datos ni se supone que un disco pago esté configurado. Si se requiere historial duradero, habrá que acordar persistencia y nueva verificación antes de usarlo para compras reales.

No usar cron externo para mantenerlo despierto ni prometer latencia de arranque en frío no medida. Abrirlo con anticipación a la defensa y comprobar Gemini, cuota y casos. Mantener una alternativa local si falla el hosting.

## Seguridad al exponerlo

No hay autenticación, roles ni protección por IP. El PRD permite link público, pero conocer un sessionId permite consultar su historial. CORS/origen y CSP no equivalen a autenticación ni detienen llamadas directas. No cargar datos personales o comerciales reales.

Los límites de sesiones, mensajes, iteraciones, timeout y tokens contienen el consumo de un proceso. Se reinician al suspender/reiniciar Render: **no son un límite de gasto duradero**. Antes de abrir el link, configurar manualmente cuotas/restricciones en el proyecto Gemini, usar una clave dedicada y verificar facturación en AI Studio. La aplicación no ha verificado ese control externo ni el saldo gratuito.

Para acceso restringido, usar un control de acceso de infraestructura aprobado y comprobar que protege frontend y `/api/*`; no se ha instalado ni configurado uno. Si se necesita autenticación en la aplicación, queda como cambio separado. No se incorporó un formulario de claves ni se reutilizó la API key como contraseña.

## Pasos manuales para publicar, tras autorización

1. Revisar `docs/AUDITORIA.md`, los parciales y la pérdida de datos aceptada. Ejecutar `npm run typecheck`, `npm test`, `npm run build` y `npm run verify:secrets` localmente.
2. Crear un repositorio privado en el proveedor elegido, o usar el ZIP de entrega. Esta carpeta no tiene historial Git. Si se usa Git, inicializarlo localmente y añadir explícitamente código, fixtures, documentación, lockfile y `.env.example`; comprobar con `git status` y `git ls-files` que no figuran `.env`, `node_modules/` ni `out/` antes del primer commit. `.gitignore` no elimina secretos ya versionados.
3. Crear el commit y subirlo únicamente cuando el usuario autorice publicar. No se ha realizado este paso.
4. En Render, conectar el repositorio autorizado y completar la tabla anterior. Introducir la clave solo en Environment. No usar una Static Site para este backend.
5. Crear el servicio y esperar build/deploy. Comprobar la URL HTTPS asignada por Render y revisar que los logs no contienen secretos. No se ha inventado ni reservado una URL.
6. Verificar `/api/health`, frontend, sol-001 dos veces (misma OC), sol-002 (bloqueada), sol-004 (pregunta → confirmo → OC), refresco de historial y errores. Un 200 en health no basta.
7. Añadir la URL real al README y entregarla al evaluador. Documentar instante de reinicio si se pierden los datos y repetir la demostración desde cero.
8. Al terminar la defensa, cerrar/restringir el servicio y revocar la clave dedicada si ya no se necesita.

## Evidencia local reproducible

`npm run test:production` instala `npm ci --omit=dev` en `out/ejecuciones/produccion-<timestamp>`, sin copiar `.env`, y verifica que no hay tsx ni TypeScript. Ejecuta el motor compilado para sol-001/002/004 y arranca Node con `NODE_ENV=production`, `HOST=0.0.0.0` y un `PORT` asignado. Comprueba estáticos, health, reinicio, pérdida de sesión y conservación de archivos en el disco local. No reproduce ni prueba la infraestructura de Render. Informe: `out/auditoria/produccion.json`.
