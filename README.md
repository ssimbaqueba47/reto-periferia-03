# Órdenes de Compra SAP — Periferia IT Group

Agente conversacional con Google Gemini, herramientas deterministas TypeScript/Zod y SAP simulado. Frontend HTML/CSS/JavaScript y backend HTTP en un proceso. Node.js 20+; no hay conexión real con SAP ni correo.

## Arranque local
Desde la raíz, instala las dependencias y configura .env con los nombres de .env.example. Nunca copies una clave a archivos versionados.

```powershell
npm.cmd ci
npm.cmd run dev
```

Abre **http://localhost:3000** (o el puerto de PORT). En otras shells puedes usar npm. La clave solo se carga en el backend; la interfaz no la recibe.

Para producción, compila primero; start ya no necesita tsx:

```powershell
npm.cmd run build
$env:NODE_ENV='production'
$env:HOST='0.0.0.0'
$env:PORT='10000'
npm.cmd start
```

`npm start` ejecuta `node out/build/server.js`. No limpia órdenes ni artefactos. Para hosting conserva web/, agent/, src/knowledge/ y fixtures/ en la raíz; el servidor los lee desde el checkout.

| Variable | Uso / predeterminado |
| --- | --- |
| GEMINI_API_KEY | Obligatoria para Gemini; solo backend |
| GEMINI_MODEL | gemini-3.5-flash-lite, verificado realmente |
| PORT | 3000 |
| HOST | Desarrollo: 127.0.0.1; NODE_ENV=production: 0.0.0.0 |
| AGENT_MAX_ITERATIONS | 25, máximo admitido por el ciclo |
| AGENT_MAX_SESSION_TOKENS | 200000 |
| AGENT_MAX_TOTAL_TOKENS | 1000000, global del proceso |
| GEMINI_TIMEOUT_MS | 45000 |
| GEMINI_MAX_OUTPUT_TOKENS | 4096 por llamada |

Prueba en el chat: Procesa la solicitud sol-001. Para excepciones: Procesa la solicitud sol-004. Revisa el payload y responde confirmo o rechazo en el mensaje siguiente. Un mensaje distinto cancela la espera y exige volver a presentar el caso.

El modelo está documentado con nivel gratuito y funcionó con esta clave. La API no certifica la facturación del proyecto ni su saldo gratuito: compruébalos en Google AI Studio. No hay cambio automático a un modelo de pago.

## Comandos de verificación
```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run demo
npm.cmd run verify:gemini
npm.cmd run test:real
npm.cmd run verify:secrets
npm.cmd run build
npm.cmd run test:production
```

- test: 30 pruebas sin llamadas al proveedor. Incluye las 19 originales del motor.
- build: emite JavaScript de src/ a out/build/, sin borrar out/sap/.
- test:production: instala solo dependencias runtime en una copia aislada sin .env, prueba Node compilado sin tsx/TypeScript, PORT/HOST, sol-001/002/004 y reinicio. No consume Gemini.
- demo: seis casos sin clave; limpia únicamente su workspace en out/ejecuciones/demo/, con resultados en su subcarpeta out/. No borra órdenes del chat.
- verify:gemini: consulta catálogo y prueba mínima de función. Puede actualizar únicamente GEMINI_MODEL en .env. No imprime claves ni errores del SDK.
- test:real: usa Gemini y API HTTP reales; procesa sol-001, bloquea sol-002 y confirma sol-004 en otro turno. Salida aislada en out/ejecuciones/gemini-<timestamp>/out/.
- verify:secrets: contrasta el secreto solo en memoria contra código y artefactos, excluyendo .env y dependencias. Devuelve contadores, nunca el valor.
- test:web: comprobación opcional con Chrome/Edge local en Windows y Node 22+; usa Gemini real, valida móvil/escritorio, confirma sol-004 y prueba recarga. No instala navegador. Capturas en out/verificacion/.
- demo:entrega: versión del PRD con artefactos directamente en out/. **Limpia out/ completo**; usar solo con servidor detenido. Un marcador de servidor activo bloquea este modo.

En las pruebas reales, el conductor envía o hace click explícitamente en confirmo como simulación de la analista; nunca es el modelo quien autoriza.

## API
| Método | Ruta | Contrato |
| --- | --- | --- |
| POST | /api/chat | {sessionId,message} → {reply,toolCalls,needsConfirmation,payload?} |
| GET | /api/sessions/:id | Historial visible y estado de confirmación |
| GET | /api/health | {ok,provider,model,configured}, sin secretos |

sessionId admite letras, números, guion y guion bajo (máximo 80). message admite 1–4000 caracteres. Sesiones en memoria: recargar el navegador conserva la sesión mientras el servidor siga activo; reiniciarlo pierde historial y confirmaciones.

Las operaciones empresariales y sus valores salen de las cinco herramientas del motor. La confirmación se controla en el backend, ligada a sesión, caso y hash. confirmado:true enviado por Gemini no autoriza una compra.

## Archivos
En ejecución normal:
- out/<caso>/aprobacion.txt y trazabilidad.json.
- out/control.csv: eventos, no contador de órdenes únicas.
- out/log.jsonl: llamadas y rechazos de herramientas.
- out/sap/ordenes.jsonl: órdenes secuenciales e idempotentes.
- out/verificacion/: informes y capturas de las verificaciones.
- out/ejecuciones/: workspaces aislados de demo y pruebas reales.

No iniciar varios procesos sobre los mismos archivos SAP. Fixtures oficiales de solo lectura. .env, out/ y node_modules/ están excluidos de la entrega.

## Verificado y pendiente
Typecheck correcto, 30 pruebas aprobadas y pruebas reales de HTTP/Gemini y Chrome aprobadas en Node 26.13.0. Los detalles y supuestos están en [SOLUCION.md](SOLUCION.md).

**No hay URL pública de despliegue todavía**. El diseño documental SAP real está completo en SOLUCION.md; no existe conexión real. PDF, Excel y bonus no se implementaron por alcance.

La [matriz final](docs/AUDITORIA.md) distingue cumplidos, parciales y pendientes, sin afirmar cumplimiento total. Los límites incluyen trazabilidad previa al confirmado_por final, mensajes de error no uniformes, respuestas generales del modelo sin verificación automática de procedencia, ausencia de autenticación y presupuestos que se reinician con el proceso. No se probó arranque en máquina totalmente limpia/Node 20.

## Render: instrucciones de publicación manual

Guía completa y efectos de reinicios: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md). Ningún repositorio ni recurso externo fue publicado.

Tras autorizar la publicación, crea/sube un repositorio con los archivos de la entrega excluyendo .env, out/ y node_modules/. En Render configura un **Web Service Node**, raíz del repositorio, una instancia:

- Build: `npm ci --include=dev && npm run build && npm prune --omit=dev`.
- Start: `npm start`.
- Health: `/api/health`.
- Entorno: `NODE_ENV=production`, `HOST=0.0.0.0`, `NODE_VERSION=26.13.0` (confirmar disponibilidad), `GEMINI_MODEL=gemini-3.5-flash-lite`, clave dedicada solo en Environment y límites de .env.example. Usa el `PORT` asignado por Render.
- Después verifica la URL HTTPS real, casos y cuota Gemini; añade esa URL al README. No basta health=200.

Render gratuito usa filesystem efímero: al perderlo se pierden órdenes, evidencia, control y memoria de idempotencia; las sesiones/presupuestos también se pierden al reiniciar. Es una demo temporal, no registro empresarial. No se cambió el almacenamiento ni se agregó base de datos. [Limitaciones oficiales](https://render.com/docs/free).

No hay autenticación ni límite de gasto duradero entre reinicios. Antes de exponer el link configura cuotas del proyecto Gemini y una clave dedicada; si se necesita acceso restringido, acuerda y verifica protección de infraestructura. El saldo gratuito y ese control externo no están certificados por la app.

## Paquete de entrega

ZIP de fuente: `out/entrega/reto-03-entrega.zip`, sin .env, out/ interno, node_modules/ ni .git. Se excluyen los resultados locales conforme al PRD; las pruebas se reproducen con los scripts incluidos. Renómbralo `reto-03-<apellido>.zip` antes de entregarlo. Esta carpeta aún no tiene historial Git; no se fabricaron commits ni se subió el código.

En el sandbox de esta sesión tsx fallaba con uv_os_get_passwd/ENOMEM; las verificaciones se completaron con permisos de ejecución adecuados, sin modificar políticas de PowerShell.
