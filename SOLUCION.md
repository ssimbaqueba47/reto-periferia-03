# Solución — Agente conversacional de Órdenes de Compra SAP

## 1. Problema
La analista administrativa necesita preparar órdenes de compra sin digitación repetitiva ni omitir controles de proveedor, autoridad, montos y evidencia.

## 2. Arquitectura
```text
HTML/CSS/JavaScript → API HTTP Node → Agente → Adaptador LLM → Google Gemini
                                       ↓
                              Registro Zod de herramientas
                                       ↓
                              Motor determinista existente
                              ├─ fixtures/ (solo lectura)
                              └─ out/ (SAP simulado y auditoría)
```

- web/: interfaz sin framework, historial, indicador de procesamiento, herramientas expandibles, tabla de payload y confirmación.
- src/server.ts: rutas HTTP, estáticos mediante lista permitida y errores seguros.
- src/agent/agent.ts: sesiones, ciclo, límites, pausa y continuación entre turnos.
- src/agent/registry.ts: cinco herramientas, adaptación de Zod a JSON Schema y despacho validado.
- src/llm/: interfaz independiente y SDK oficial @google/genai.
- agent/prompt.md: comportamiento; src/knowledge/ordenes-compra.md: conocimiento cargado como contexto.
- src/domain/, src/tools/oc.ts y src/sap/: motor de fase 1 reutilizado, sin reescribir reglas.
- src/security/confirmaciones.ts: mecanismo de autorización existente, exclusivo del backend.

No se implementan SAP real, recepción de correos, PDF, Excel ni bonus.

## 3. Ciclo y confirmación humana
El modelo recibe historial y declaraciones, solicita funciones y recibe sus resultados tipados. El adaptador conserva el Content completo de Gemini, incluidas partes, identificadores y thoughtSignature. Las respuestas de función conservan name e id; no se aplanan ni regeneran las firmas. El dominio no importa el SDK.

Las ejecuciones iniciadas directamente por el backend tras confirmar se identifican por separado: su resultado se incorpora como contexto verificado, sin inventar una FunctionCall de Gemini ni una firma del modelo. Esto permite continuar la conversación después de crear una OC sin romper el protocolo.

Cada turno permite como máximo 25 iteraciones, configurable hacia abajo. Hay timeout, salida máxima por llamada, límite de mensajes y sesiones, presupuesto por sesión y presupuesto global del proceso. Se reserva conservadoramente el tamaño en bytes del contexto más la salida máxima antes de llamar; se concilia con usageMetadata al finalizar. Un error conserva la reserva para no permitir gasto ilimitado mediante reintentos. Los presupuestos se reinician al reiniciar el proceso: no sustituyen cuotas del proveedor.

Al construir un payload con excepciones, el backend termina el turno, muestra motivos y payload, y prepara autorización vinculada a sesión, caso y hash. Solo acepta confirmo, sí, confirmo o si, confirmo en el mensaje humano inmediatamente siguiente. Rechazo cancela; otro mensaje invalida la espera y exige volver a presentar el caso. La autorización vence a los 15 minutos. También se respeta una petición expresa de revisar antes de crear aunque no haya excepciones.

La confirmación no es una herramienta del modelo. Al recibir el mensaje humano válido, el backend llama confirmarDesdeUsuario y despacha oc_crear con el mismo payload. La herramienta relee maestros y documentos y revalida todo. confirmado:true enviado por Gemini no autoriza ni supera bloqueos.

Los cierres de bloqueo, confirmación y creación se redactan desde resultados reales de herramientas, sin pedir al modelo que invente un resumen financiero. La generación del modelo sigue decidiendo las llamadas intermedias. Los mensajes y herramientas quedan visibles; out/log.jsonl registra las ejecuciones y los rechazos del registro.

## 4. Modelo y costo
Modelo efectivamente utilizado: **gemini-3.5-flash-lite**, con @google/genai 2.32.0. Se verificó en models.list que anuncia generateContent y se ejecutó una llamada real de function calling a comprobar: 71 tokens. Se mantuvo este identificador en GEMINI_MODEL sin cambiar GEMINI_API_KEY.

Fuentes oficiales consultadas:
- [Modelo y capacidades](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
- [Precios y nivel gratuito](https://ai.google.dev/gemini-api/docs/pricing).
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling).
- [SDK oficial y contratos](https://github.com/googleapis/js-genai).

La documentación ofrece nivel gratuito para este modelo. Las solicitudes reales tuvieron cuota operativa, pero una API key y models.list **no certifican el estado de facturación ni el saldo gratuito del proyecto**. No se afirma que la prueba confirme una factura de cero. En un proyecto elegible dentro del nivel gratuito, el costo de inferencia por caso es USD 0; fuera de él depende de tokens y tarifa vigente. No hay fallback silencioso a modelos de pago ni reintentos automáticos del SDK.

Se eligió Flash-Lite por compatibilidad real, latencia y alcance del flujo. El modelo puede proponer argumentos incorrectos: las pruebas reales observaron omisión de null y derivados no canónicos; fueron rechazados y el modelo corrigió tras recibir errores, sin crear órdenes con datos alterados.

## 5. Matriz de controles
| Control | Implementación existente |
| --- | --- |
| RC1 | Proveedor por NIT, o nombre si falta NIT; debe estar activo |
| RC2 | Aprobación con Aprobado y remitente autorizado para el centro |
| RC3 | Total dentro del tope del mismo aprobador para ese centro |
| RC4 | Subárea pertenece al centro |
| RC5 | Ausencia de cotización o diferencia superior al 2% confirma |
| RC6 | IVA ausente se deriva y confirma |
| RC7 | Pago ausente se deriva y solo informa |
| RC8 | Factura anterior a solicitud marca retroactiva y confirma |
| RC9 | Aprobación anterior a solicitud confirma |
| RC10 | Cantidad por precio coincide con total con tolerancia inclusiva de 1 |

apta significa sin bloqueos, no autorización incondicional. RC3 no toma topes de otros centros cuando RC2 falla. La dificultad principal es vincular consentimiento y payload sin confiar en texto generado por el modelo.

## 6. Diseño del adaptador SAP real — solo documentación

### Arquitectura y alternativas
Propuesta: herramientas → controles deterministas y autorización → SapAdapter → fachada empresarial (opcionalmente SAP Integration Suite) → SAP. Los secretos y la traducción técnica viven en el adaptador/fachada, nunca en el modelo.

Preferiría **OData sobre HTTPS**, condicionado a disponibilidad y soporte en la versión de SAP. El PRD menciona API_PURCHASEORDER_PROCESS_SRV V2; SAP también publica Purchase Order OData V4 (API_PURCHASEORDER_2). La elección requiere revisar release, metadatos y capacidades del destino: no asumir que una API está habilitada ni copiar campos entre versiones. V2 aparece deprecada en documentación de determinados productos/releases. [SAP Purchase Order V2](https://help.sap.com/docs/PRODUCT_ID/91af7f8d3acd47da90d33aaacfcd0d59/acd2da57df6cc525e10000000a4450e5.html).

Referencia de la alternativa V4: [SAP Purchase Order OData V4](https://help.sap.com/docs/SAP_S4HANA_CLOUD/0e602d466b99490187fcbb30d1dc897c/c89eec80ec2043d980cb7b8c89e0a00a.html). No se verificó cuál versión dispone Periferia.

| Opción | Criterio de elección | Condición |
| --- | --- | --- |
| OData | S/4 con API soportada, habilitada y accesible | Confirmar operaciones, esquema y autenticación |
| RFC / BAPI_PO_CREATE1 | ECC/on-premise con integración RFC aprobada | Red privada, conector y control de transacción |
| IDoc / ALE | Plataforma asíncrona existente | Tipo/mensaje y configuración acordados; recepción no es creación |
| Integration Suite | Mediación, conectividad y monitoreo gestionados | Destinos, licencias y operación; Cloud Connector si corresponde |
| Archivo | Sin conexión viable | Plantilla homologada y carga humana |

BAPI_PO_CREATE1 y el IDoc asociado tienen restricciones de interfaz a revisar con SAP. [Guía oficial BAPI](https://help.sap.com/docs/SUPPORT_CONTENT/spmm/3362167600.html?locale=en-US).

Hoy oc.ts instancia MockSapAdapter directamente. Una integración futura necesita fábrica/inyección de SapAdapter y repositorios de maestros empresariales; no basta con renombrar el mock. Se mantendrían RC1–RC10 y sus pruebas. Nada de esto se conectó ni implementó en esta fase.

### Credenciales y acceso
Identidad técnica de mínimo privilegio, separada por ambiente. OAuth2, certificados u otro mecanismo soportado por el communication arrangement/destino, según producto; no dar por hecho un mecanismo universal. Para RFC, destino administrado y canal cifrado aprobado, sin abrir RFC a Internet.

Credenciales en vault/gestor empresarial o destinos de integración, con rotación y revocación. Nunca en Git, prompt, argumentos de herramientas, navegador o logs. Para on-premise, conectividad privada aprobada; no suponer que Render tiene acceso a la red SAP. Redactar tokens/cabeceras y registrar solo códigos seguros y correlaciones.

### Mapeo de datos
Es un mapeo propuesto, **no certificado contra un SAP real**. Los nombres candidatos deben contrastarse con los metadatos de la API elegida.

| Payload del PRD | Destino conceptual / candidato OData | Tratamiento |
| --- | --- | --- |
| sociedad | CompanyCode | Validar sociedad; 1000 solo está fijado en el reto |
| organizacion_compras | PurchasingOrganization | Validar organización y permisos |
| proveedor.codigo_sap | Supplier | Código SAP; NIT/nombre se contrastan con maestro, no lo reemplazan |
| moneda | DocumentCurrency | Validar moneda y precisión |
| condiciones_pago | PaymentTerms | Código homologado |
| solicitud_id | Referencia externa consultable o extensión acordada | Dedupe y reconciliación; no asumir unicidad de texto libre |
| correo_id y cotizacion_ref | Referencias documentales/extensiones | Conservar vínculo con origen |
| posiciones.numero | PurchaseOrderItem | Formato de posición según API |
| descripcion | PurchaseOrderItemText | Límite del destino y original conservado |
| cantidad/unidad | OrderQuantity / PurchaseOrderQuantityUnit | Tabla SAP de unidades; no enviar UN/H/MES sin homologar |
| precio_unitario | Precio neto o condiciones del ítem | El fixture contiene IVA: no enviarlo como neto ni sumar IVA dos veces |
| centro_costo | CostCenter en imputación del ítem | Categoría, controlling y vigencia |
| subarea | Extensión/dimensión empresarial acordada | No existe equivalencia universal que podamos inventar |
| indicador_iva | TaxCode homologado | C1 del fixture no implica C1 en el destino |
| aprobador/excepciones | Auditoría y extensiones | No equivalen al release/workflow SAP ni lo evitan |
| evidencia_sha256 | Hash y vínculo documental | API documental compatible; no asumir adjuntos dentro del POST de pedido |

En RFC se separarían cabecera, posiciones e imputaciones de BAPI_PO_CREATE1, con las estructuras de indicadores que requiera su contrato. No se inventan campos Z.

Faltan datos potencialmente obligatorios: tipo de pedido, grupo de compras, centro/planta, entrega, categoría de imputación, cuenta contable y material/servicio. Se obtienen de maestros/configuración aprobados y quedan trazados; si faltan, se bloquea, no los inventa el modelo.

Finanzas debe aprobar tratamiento de precios netos, impuestos, decimales y redondeos. Conservar importe original, transformación y total efectivo. Un cambio relevante exige revisar el nuevo payload y renovar confirmación; no alterar silenciosamente el monto aprobado.

### Validación y confirmación
1. Consultar maestros vigentes y ejecutar RC1–RC10.
2. Validar requisitos del destino, unidades, moneda, impuestos, imputación y permisos.
3. Buscar OC por referencia; construir y mostrar payload efectivo y evidencia.
4. Para operaciones reales sensibles, proponer confirmación explícita por identidad autenticada, sesión, caso y hash del payload de destino. Es política empresarial propuesta, no una RC adicional aplicada al mock.
5. Usar simulación del destino solo si existe; no equivale a OC creada.
6. Escribir con autorización vigente y devolver únicamente el número confirmado por SAP.

La sesión actual no demuestra identidad personal; producción necesita identidad corporativa, roles y segregación. El correo es evidencia, no una firma digital ni autorización para omitir controles SAP.

### Errores, reintentos e idempotencia
Errores de negocio, permisos o maestros no se reintentan automáticamente: devolver código seguro y acción. Transporte, 429 o 5xx admiten reintentos limitados con backoff/jitter, consultando referencia si el intento pudo escribir.

Un timeout después de enviar el pedido deja resultado desconocido: reconciliar antes de reenviar, sin anunciar éxito ni hacer otro POST ciego. Si se creó el pedido pero falló adjunto o auditoría, guardar número y estado incompleto y reparar la etapa fallida, sin duplicar el pedido. En RFC revisar retornos y controlar COMMIT/ROLLBACK según contrato antes de informar resultado definitivo.

En IDoc, separar recibido, procesado y documento de negocio. crearOrden no devuelve un numero_oc hasta confirmar creación. Si es asíncrono, hace falta coordinador y seguimiento adicional: la interfaz síncrona actual no representa por sí sola todo ese ciclo.

La consulta previa del mock no impide carreras entre servidores. La fachada necesita registro duradero con exclusión/clave única o garantía equivalente de SAP: solicitud_id, hash, estado, correlación, intentos y número. Misma referencia/hash devuelve existente; mismo ID y hash diferente exige revisión. Es diseño futuro: no se agregó una base de datos al reto.

### Auditoría y Plan B
Conservar fuentes, versión de reglas/maestros, payload original y de destino, hashes, identidad y consentimiento, intentos, número SAP y vínculos de evidencia. Auditoría empresarial con retención y permisos; no archivos efímeros de hosting gratuito. La evidencia se carga y relaciona con el servicio documental permitido, por separado si es necesario.

Sin integración viable, el agente sigue validando y preparando payload, evidencia y trazabilidad. Como siguiente implementación podría exportarse una plantilla de carga homologada o ficha para digitación revisada por la analista. La carga sería humana y se reconciliaría su número después. No se implementó el exportador ni se atribuye una OC real a esta alternativa.

## 7. Lectura del proceso
A dirección le diría que una OC retroactiva evidencia que el control ocurrió después de comprometer la compra. El agente puede detectarlo y registrarlo, pero no convierte una aprobación tardía en autorización previa ni demuestra por sí solo que la compra fue indebida. El PRD permite continuar con confirmación: cambiar esa política corresponde a la organización, no al modelo.

Propondría medir solicitudes únicas retroactivas entre órdenes creadas, usando solicitud_id para deduplicar reintentos. Complementaría ese indicador con causas y distribución por centro, proveedor y periodo, sin inferir porcentajes de los seis fixtures. La marca procede de comparar factura y solicitud; no detecta compromisos previos sin factura y no debe presentarse como una medición exhaustiva de compras fuera de proceso.

El cambio operativo sería exigir solicitud, cotización y aprobación antes del compromiso de compra. Para urgencias se necesita una excepción identificable, con responsable, motivo y revisión posterior; no esconderlas ajustando fechas o montos. El agente prepara evidencia y devuelve inconsistencias para resolución humana, sin solicitar aprobaciones nuevas al líder ni reemplazar sus facultades.

La analista conserva la decisión sobre las excepciones permitidas y la revisión del payload. Compras y contabilidad deberían revisar periódicamente los casos retroactivos y acordar mejoras sobre sus causas. Antes de prometer ahorro o calidad de control, mediría tiempos y errores en una muestra real autorizada, comparando con el proceso manual.

Finalmente, estos indicadores requieren un registro duradero y reconciliado con SAP. Los archivos efímeros de una demo en Render no sirven como fuente corporativa de auditoría. El valor del reto es demostrar automatización controlada y trazable, con límites visibles; no afirmar que ya se resolvió la política empresarial de compras.

## 8. Decisiones y dependencias
1. Motor determinista compartido frente a reglas en el prompt: las decisiones auditables siguen en TypeScript y se prueban sin modelo.
2. SDK oficial detrás de interfaz propia frente a SDK en el servidor: conserva protocolo Gemini y permite cambiar de proveedor sin tocar el ciclo.
3. HTTP sin streaming frente a WebSocket: menos dependencias y un comando para front/backend; herramientas se muestran al finalizar el turno.
4. Confirmación backend con hash frente a booleano: solo un mensaje humano en la sesión correcta puede autorizar.
5. Sesiones en memoria y archivos frente a base de datos: alcance mínimo; exige un proceso y pierde sesiones al reiniciar.
6. TXT frente a PDF y HTML plano frente a framework: prioriza P0 y evita dependencias adicionales.
7. Demo aislada por defecto frente a limpiar out/ en uso: protege órdenes del chat; demo:entrega conserva explícitamente las rutas originales.

Dependencias: Zod obligatorio, @google/genai oficial y dotenv para cargar entorno de forma silenciosa compatible con Node 20+. TypeScript, @types/node y tsx para desarrollo. Pruebas con node:test; no se añadió framework ni librería de UI. La comprobación opcional del navegador usa Chrome/Edge instalado y requiere WebSocket global (Node 22+), sin cambiar el requisito de la aplicación.

## 9. Supuestos y transformaciones
- Se conservan importes de solicitud, que ya incluyen IVA en estos fixtures. No se agrega IVA ni se cambia el precio de sol-004.
- Los NIT pierden separadores y el dígito de verificación separado por guion. Un NIT informado inexistente no recurre al nombre.
- Nombres: minúsculas, sin diacríticos, espacios ni puntuación. Correos de aprobadores sin distinguir mayúsculas.
- Aprobado se detecta como palabra completa, sin distinguir mayúsculas. No hay interpretación semántica de frases ambiguas; es una limitación del criterio literal del PRD.
- Fechas de controles: fecha de calendario declarada, sin usar hora actual. Los fixtures usan offset -05:00.
- Para evitar división por cero y datos inválidos: cantidad y total positivos; precio no negativo; importes numéricos finitos. Códigos IVA y pago existentes en maestros; códigos desconocidos producen bloqueo DATOS, separado de RC1–RC10.
- Cotización y aprobación ausentes: null y nombre en faltantes. Factura ausente es normal salvo que el correo la declare: entonces se bloquea como DATOS para no ocultar retroactividad. Correo o solicitud ausentes/malformados dan error porque el tipo obligatorio del PRD no admite null en esos campos.
- El paquete agrega faltantes para cumplir HU-1. El original de aprobación conserva destinatario y asunto para la evidencia.
- Referencia de cotización extraída de encabezado. Validez: fecha más días calendario sin contar emisión. No se agrega control de vencimiento.
- Importes TXT según formato oficial: punto para miles, coma decimal. Se lee TOTAL y NIT de proveedor, nunca del cliente.
- Una posición 10. Unidad H si cotización (o descripción sin cotización) menciona hora/horas; los demás conceptos discretos usan UN. Vigencia de licencia no se convierte en unidad MES. Revisar este supuesto al ampliar formatos.
- Descripción: primeros 40 caracteres UTF-16; original completo en trazabilidad.
- Sociedad y organización: constantes 1000 de PRD 7.4.
- SHA-256 de bytes UTF-8 de encabezados y cuerpo con LF y salto final, excluyendo línea del propio hash. Evidencia se genera antes de construir, también internamente si hace falta.
- Trazabilidad agrega correo y aprobación a las fuentes de HU-3, pues alimentan campos obligatorios.
- Excepciones incluyen confirmaciones; payload mostrado con confirmado_por null, orden almacenada con sesión autorizada.
- control.csv registra validación (apta/bloqueado/pendiente) e intentos de creación (creada/idempotente/bloqueado/pendiente/rechazado). Es un registro de eventos, no un contador de órdenes.
- La demo predeterminada limpia solo su workspace bajo out/ejecuciones/demo; --entrega limpia out/ completo únicamente con servidor detenido. Las pruebas alteran copias aisladas, nunca fixtures oficiales.
- Demo autoriza solo sol-004; sol-005/006 quedan pendientes. Termina con dos órdenes.


## 10. Cobertura y verificaciones
La matriz final por requisito está en [docs/AUDITORIA.md](docs/AUDITORIA.md); sus parciales y pendientes prevalecen sobre el resumen por historia. La guía concreta de hosting está en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

| Historia | Estado | Alcance |
| --- | --- | --- |
| HU-1 | Parcial | JSON/TXT oficiales; null de cotización/aprobación, error si falta solicitud |
| HU-2 | Hecho | RC1–RC10 con motor existente |
| HU-3 | Parcial | Payload Zod, tabla y trazabilidad previa; no snapshot final actualizado de confirmado_por |
| HU-4 | Hecho P0 | TXT y SHA-256; PDF P1 pendiente |
| HU-5 | Parcial | Creación e idempotencia probadas; intentos que fallan antes de validar no siempre llegan al CSV |
| HU-6 | Parcial | Errores no propagan y sesión conservada; claridad/recomendaciones no uniformes |

Verificación ejecutada en Node v26.13.0: typecheck, 30 pruebas (19 originales + 11 del agente/API) sin fallos, demo y prueba real HTTP/Gemini para sol-001, sol-002 y sol-004 con continuación tras confirmación humana simulada.

La prueba de navegador en Chrome verificó 1440×1000 y 390×844, ausencia de desbordamiento móvil, herramientas, payload, click de confirmación de sol-004, creación real mediante Gemini y recuperación de historial tras recargar. Capturas e informes están en out/verificacion/. Estos tests usan entornos aislados; no son las órdenes del chat principal.

La API devuelve /api/health sin secreto; /api/sessions/:id devuelve historial visible sin el Content interno del proveedor. /api/chat valida cuerpo, tipo y origen. Los archivos servidos se limitan a index.html, app.js y style.css: .env, fixtures y out no se exponen como estáticos.

Los 29 fixtures conservaron los hashes de la fase 1. En este entorno Windows fue necesario ejecutar tsx y acceder a red fuera del sandbox por restricciones de uv_os_get_passwd; no se cambió la configuración de seguridad del sistema.

## 11. Uso de IA
Codex participó en análisis, implementación, documentación y pruebas. Se utilizó la habilidad Sites para el flujo web local. Gemini es el modelo de ejecución del agente. No se delegaron tareas a subagentes.

Se descartó confiar en confirmado:true como aprobación humana, reescribir montos para cuadrar documentos, agregar caducidad de cotización como control y ocultar fallos del modelo con respuestas prefabricadas. Los tests unitarios usan adaptadores de prueba explícitos; test:real y test:web llaman realmente a Gemini.

## 12. Riesgos, límites y pendientes
- Sesiones y presupuestos viven en memoria; reinicio pierde historial y autorizaciones. No hay autenticación ni multiusuario, conforme al alcance del PRD. Los identificadores de sesión deben tratarse como capacidad de acceso, no como identidad verificada.
- Exclusión mutua de un proceso; no iniciar varios servidores sobre el mismo out/. No hay transacción entre orden, CSV y log: fallos de disco requieren reconciliación.
- La redacción final de operaciones críticas proviene de herramientas; respuestas generales del modelo todavía pueden ser inexactas. Los argumentos incorrectos se rechazan, consumiendo cuota.
- El servidor escucha en loopback en desarrollo; en producción usa HOST=0.0.0.0 y PORT del entorno. No se publicó ni se expuso la clave. Un despliegue público necesita límites persistentes por usuario/IP y cuotas del proveedor; los límites actuales protegen un proceso local.
- Pendiente del PRD: link público y validación del arranque en máquina limpia/Node 20. El diseño SAP está documentado; no se conectó ni probó un destino real. PDF y Excel son P1; módulo reutilizable es bonus.
- Credenciales solo en entorno backend; errores SDK nunca se serializan. No se registran cabeceras, requests HTTP del proveedor ni configuración completa. .env no se lee como contenido para el modelo ni se copia a workspaces de prueba.


## Preparación final de entrega
Cambios funcionales limitados a HOST configurable y arranque con JavaScript compilado. npm run build emite en out/build; npm start ejecuta Node sin tsx. No se cambiaron reglas, almacenamiento ni herramientas. test:production comprobó instalación aislada sin devDependencies, PORT, 0.0.0.0, estáticos, casos compilados y reinicio. Render no se desplegó; su funcionamiento remoto sigue pendiente de verificar. No hay historial Git en esta carpeta; la entrega puede hacerse por ZIP sin secretos y publicarse manualmente tras autorización.
