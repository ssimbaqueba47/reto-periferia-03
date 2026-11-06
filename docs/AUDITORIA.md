# Auditoría final del PRD — 2026-11-06

Fuente: PRD.md v2.0, leído completo. **Cumplido** significa que hay código/documento y una comprobación identificable; no certifica producción empresarial. **Parcial** identifica un límite concreto. **Pendiente** no se ha ejecutado/entregado. No se asigna puntaje: la ficha remite a una rúbrica en sección 10 que no está presente en el documento.

## Evidencias y cómo reproducirlas

- `npm run typecheck`, `npm run build`, `npm test`: 30 pruebas (19 motor, 11 agente/API), ejecutadas en Node 26.13.0. Transcripción local: `out/auditoria/pruebas.txt`.
- `npm run test:production`: instalación nueva con `npm ci --omit=dev` en workspace aislado; informe `out/auditoria/produccion.json`. Verifica compilado, arranque Node sin tsx, HOST/PORT, recursos, casos e impacto de reinicio. No usa Gemini en esta prueba.
- `npm run test:real`: Gemini real y HTTP para sol-001/002/004, confirmación en otro turno y conversación posterior. Informe `out/verificacion/prueba-real.json`; sin respuestas simuladas del proveedor. La confirmación humana es una entrada explícita del conductor de prueba.
- `npm run test:web`: evidencia de fase 2 conservada en `out/verificacion/navegador.json` y capturas PNG. Chrome real, escritorio/móvil e historial al recargar. No se repitió por cambios finales exclusivos de arranque/documentación.
- `npm run demo`: motor sin clave, aislado en `out/ejecuciones/demo/out/`. La limpieza solo afecta a ese workspace. No ejecutar `demo:entrega` mientras se preservan datos reales de la aplicación.
- `npm run verify:secrets`: comparación literal de la clave en memoria contra fuentes y artefactos, excluyendo `.env`, `.git` y dependencias. No muestra el secreto. No sustituye auditoría de un historial Git que todavía no existe.
- Los hashes de los 29 fixtures coinciden con los de la fase 2. Se verifica también el hash de `out/sap/ordenes.jsonl` antes y después de estas pruebas; las pruebas no deben cambiarlo.

Las evidencias bajo out/ son locales y no se incluyen en el ZIP por PRD 9.5. Los tests y scripts necesarios para reproducirlas sí se entregan.

## Matriz de requisitos obligatorios

| Requisito PRD | Implementación / documento | Prueba o evidencia | Estado |
| --- | --- | --- | --- |
| §0, §6: agente completo con frontend, backend y modelo | src/server.ts, src/agent/agent.ts, src/llm/gemini.ts, web/ | test:real; navegador de fase 2; test:production | cumplido |
| §0: TypeScript y Node 20+ | package.json, tsconfig.json, tsconfig.build.json | typecheck y ejecución en Node 26.13.0 | cumplido |
| §0: verificar versiones mínimas/máquina limpia | package.json engines | No se probó Node 20 ni instalación en máquina completamente limpia | parcial |
| O1: sol-001 automática | src/tools/oc.ts, src/sap/mock.ts | test:real, demo, test:production; «Ciclo de herramientas crea sol-001…» | cumplido |
| O2: sol-002 y sol-003 bloqueadas y con recomendación | src/domain/engine.ts, src/agent/agent.ts | «Los seis casos oficiales…», «Bloqueados no crean…», test:real sol-002 | cumplido |
| O3: sol-004 y sol-006 piden confirmación | src/domain/engine.ts, src/agent/agent.ts | «Confirmación siguiente turno…», «sol-005/006…», test:real sol-004 | cumplido |
| O4: sol-005 retroactiva y confirmada | src/domain/engine.ts, src/domain/files.ts | «RC8/RC9…», «sol-005/006…» comprueba CSV con retroactiva=true | cumplido |
| HU-1, §7.2: paquete normalizado | src/domain/engine.ts leer, src/domain/schemas.ts | «Los seis casos oficiales…», JSON real de leer_paquete | cumplido |
| HU-1: adjuntos ausentes null y nombre | src/domain/engine.ts | «JSON malformado…documentos faltantes»: cotización/aprobación null; solicitud ausente devuelve error, no null (tensión HU-6/§7.2) | parcial |
| HU-2: apta, bloqueos, confirmaciones, derivados y retroactiva | src/domain/engine.ts evaluar | Seis casos y pruebas RC1–RC10 | cumplido |
| HU-3: payload validado con Zod y vista previa | src/domain/schemas.ts, src/domain/engine.ts, web/app.js | «Evidencia verificable…», test:web payload y tabla | cumplido |
| HU-3: trazabilidad de cada valor final | src/domain/engine.ts construir | Fuentes por campo y descripción original comprobadas; snapshot previo conserva confirmado_por=null, mientras SAP guarda sesión confirmante | parcial |
| HU-4 P0: TXT con encabezados/cuerpo/SHA-256 | src/domain/engine.ts evidencia | «Evidencia verificable…» recalcula hash y contrasta con payload | cumplido |
| HU-5: creación sin bloqueos y solo autorizada | src/tools/oc.ts crear, src/security/confirmaciones.ts | «Creación: confirmación humana…», «Bloqueados no crean…», test:production | cumplido |
| HU-5: secuencia desde 4500000001 y JSONL | src/sap/mock.ts | «SAP: secuencia e idempotencia concurrente…», demo y test:production | cumplido |
| HU-5: idempotencia por solicitud_id | src/sap/mock.ts | «Creación por herramientas concurrente…», repetición sol-001 en demo/producción | cumplido |
| HU-5: CSV de cada intento exitoso/bloqueado/pendiente | src/domain/files.ts, src/tools/oc.ts | CSV en tests; errores que no pasan Zod/lectura se registran en log, no siempre en control.csv | parcial |
| HU-6: JSON malformado y monto inválido no propagan excepción | src/tools/oc.ts, src/domain/schemas.ts | «JSON malformado…», «Contratos: cinco exports…» | cumplido |
| HU-6: explicación legible y sugerencia para todo error | src/tools/oc.ts, src/agent/agent.ts | Algunos errores de parseo conservan detalle Zod/archivo; no hay prueba de recomendación específica para todos | parcial |
| §6.1: chat, historial y pensando | web/index.html, web/app.js, web/style.css | Chrome fase 2; rutas estáticas en producción | cumplido |
| §6.1: mostrar nombre, argumentos, resumen y confirmación | web/app.js | test:web y chat-confirmacion.png; detalles expandibles | cumplido |
| §6.1: API con sesiones | src/server.ts, src/agent/agent.ts | «HTTP sirve frontend y sesiones…», prueba de reinicio | cumplido |
| §6.1: interfaz LLM separada y cambio sin tocar ciclo | src/llm/adapter.ts, src/llm/gemini.ts | Agente probado con interfaz de prueba y con Gemini real | cumplido |
| §6.1/6.5: prompt Markdown separado y conocimiento separado | agent/prompt.md, src/knowledge/ordenes-compra.md | Agente.crear los carga; tests de inicialización | cumplido |
| §6.2: exactamente cinco herramientas, nombre archivo_export | src/tools/oc.ts, src/agent/registry.ts | «Contratos: cinco exports…», «Inicialización, registro…» | cumplido |
| §6.2: description, args Zod descritos y execute string JSON sin lanzar | src/tools/oc.ts | Tests de contrato y argumentos inválidos; revisión de cada args | cumplido |
| §6.2: validar argumentos antes de ejecutar y devolver error al modelo | src/agent/registry.ts, src/agent/agent.ts | Test registro; corrección de argumentos observada en test:real | cumplido |
| CA1: máximo de iteraciones configurable y limitado | src/agent/agent.ts | «Errores de proveedor, timeout y límite…»; clamp de 25 en código | cumplido |
| CA1: resumen preciso de lo obtenido y faltante al agotar límite | src/agent/agent.ts | Se muestran eventos y aviso general, no una lista completa de pasos faltantes | parcial |
| CA2: no afirmar valores sin herramientas | agent/prompt.md, src/agent/agent.ts | Payload/creación canónicos y cierres críticos deterministas; texto general del modelo no tiene verificador universal | parcial |
| CA3: pregunta y confirmación humana siguiente turno | src/agent/agent.ts, src/security/confirmaciones.ts | Tests de sesión, rechazo, vencimiento y revisión; test:real y test:web | cumplido |
| CA4: todas las llamadas visibles y en log.jsonl | src/tools/oc.ts, src/agent/registry.ts, web/app.js | Tests CSV/log y captura de herramientas; errores de disco impiden garantizar registro atómico | cumplido |
| CA5: errores de proveedor claros y sesión conservada | src/llm/adapter.ts, src/llm/gemini.ts, src/agent/agent.ts | Tests cuota, timeout y detalle interno oculto | cumplido |
| §6.4: POST chat, GET sesión, GET health sin claves | src/server.ts | Tests HTTP, test:real, test:production | cumplido |
| §6.6: demo seis casos sin modelo, repetición sol-001 y confirmación sol-004 | demo.ts | Demo aislada ejecutada; no importa SDK ni config del modelo | cumplido |
| §7.1: fixtures originales sin modificar | src/domain/engine.ts, tests y workspace | Contraste SHA-256 de los 29 originales | cumplido |
| RC1: proveedor existe y activo; NIT/nombre | src/domain/engine.ts | «RC1: inactivo, nombre normalizado…» | cumplido |
| RC2: aprobación y autoridad en centro | src/domain/engine.ts | «RC2/RC3/RC4…», sol-003 y bloqueos | cumplido |
| RC3: total <= tope del mismo centro | src/domain/engine.ts | Igualdad 50M y exceso en «RC2/RC3/RC4…» | cumplido |
| RC4: subárea pertenece al centro | src/domain/engine.ts | Subárea y centro desconocidos en «RC2/RC3/RC4…» | cumplido |
| RC5: umbral inclusivo 2%, ausencia confirma | src/domain/engine.ts | «RC5: 2% inclusivo…» y caso sol-004 | cumplido |
| RC6: IVA derivado y confirmado | src/domain/engine.ts | «RC6/RC7…» y sol-006 | cumplido |
| RC7: pago derivado, solo informa | src/domain/engine.ts | «RC6/RC7…» y sol-006 | cumplido |
| RC8: factura anterior, marca y control | src/domain/engine.ts, src/domain/files.ts | «RC8/RC9…» y comprobación CSV sol-005 | cumplido |
| RC9: aprobación anterior confirma | src/domain/engine.ts | Fecha anterior y misma fecha en «RC8/RC9…» | cumplido |
| RC10: multiplicación ±1 | src/domain/engine.ts | «RC10: tolerancia inclusiva…» | cumplido |
| §7.4: esquema OrdenCompra y descripción <=40 | src/domain/schemas.ts, src/domain/engine.ts | «Evidencia verificable…», typecheck, payload compilado | cumplido |
| §7.4: SapAdapter con tres operaciones | src/sap/adapter.ts, src/sap/mock.ts | «SAP: secuencia…» y código compilado | cumplido |
| §7.5: diseño SAP real, errores, mapeo, credenciales y Plan B | SOLUCION.md §6 | Revisión documental contra las cinco exigencias de §7.5; no prueba SAP real | cumplido |
| §8: un comando arranca frontend/backend | package.json, src/server.ts | npm run dev en fase 2 y Node compilado en test:production | cumplido |
| §8: arranque <2 min en máquina limpia | README.md, docs/DESPLIEGUE.md | Instalación aislada sí; máquina limpia/red fría no medida | pendiente |
| §8: demo determinista y limpieza al inicio | demo.ts, src/runtime/workspace.ts | Dos ejecuciones comparadas sin timestamps; limpieza aislada por seguridad, modo entrega conserva out/ del PRD | cumplido |
| §8: secreto solo backend y sin shell en herramientas | src/config.ts, .gitignore, src/tools/oc.ts | Escaneo literal, .env HTTP=404; herramientas no importan child_process | cumplido |
| §8: presupuesto no ilimitado en acceso público | src/agent/agent.ts, docs/DESPLIEGUE.md | Límites por proceso probados; reinicios restauran presupuesto y no hay cuotas persistentes/configuración de cuenta verificada | parcial |
| §8: errores tipados y un caso no impide otro | src/tools/oc.ts, src/llm/adapter.ts | Tests de contratos/timeout; demo continúa tras bloqueados | cumplido |
| §8: TypeScript sin any | src/, tests/, demo.ts | Typecheck y búsqueda de any en código propio | cumplido |
| §8: funciones cortas/legibilidad | src/domain/engine.ts, src/agent/agent.ts | Separación de responsabilidades; varias funciones densas/largas no se refactorizaron en la entrega | parcial |
| §8: dependencias justificadas, Zod obligatorio | package.json, SOLUCION.md §8 | Lockfile, revisión e instalación de solo producción | cumplido |
| §9.1: SOLUCION con 12 apartados | SOLUCION.md | Revisión de encabezados; SAP y trade-offs completos | cumplido |
| §9.1: costo real estimado por caso | SOLUCION.md §4 | USD 0 solo condicionado a elegibilidad/cuota gratuita; no se midió factura ni desglose entrada/salida por caso | parcial |
| §9.1: riesgos, supuestos, cobertura y uso IA | SOLUCION.md §§9–12 | Documento y esta matriz; algunos riesgos son explícitamente no resueltos | cumplido |
| §9.2: README de arranque, entorno y demo | README.md | Comandos reproducidos y .env.example sin secreto | cumplido |
| §9.2/9.3: URL pública activa durante defensa | README.md | No se autorizó ni ejecutó publicación | pendiente |
| §9.5: repositorio con historial o ZIP sin node_modules/out/.env | out/entrega/reto-03-entrega.zip | ZIP de fuente con lista permitida e inspección de entradas; no hay Git/historial | cumplido |

## P1 y bonus fuera del alcance autorizado

| Requisito | Archivo/evidencia | Estado |
| --- | --- | --- |
| PDF de aprobación | No implementado; TXT P0 sí | pendiente |
| Excel real | No implementado; JSON oficial sí | pendiente |
| Módulo reutilizable bonus | No implementado | pendiente |

## Interpretaciones y límites que defender

1. HU-1 pide null para adjuntos ausentes, pero §7.2 exige solicitud y correo no nulos, y HU-6 pide error por paquete incompleto. Se documentó la interpretación; no se inventó un contrato nuevo en la fase final.
2. No hay regla de expiración de cotización ni prohibición de compras retroactivas. Se aplican exactamente los controles del reto.
3. El precio ya incluye IVA; unidad y truncado están documentados como supuestos. SAP real requiere homologación y datos adicionales antes de escribir.
4. La trazabilidad guardada es una vista previa; confirmado_por de la orden final está en JSONL. No se vende como auditoría empresarial transaccional.
5. La idempotencia existe mientras se conserva el registro local. Disco efímero o pérdida del archivo elimina esa garantía histórica.
6. Google admite el modelo y las pruebas reales pasaron; no se comprobó la factura ni el saldo de nivel gratuito del proyecto.
7. Sin Git no se puede auditar un historial inexistente. Se entrega ZIP limpio y pasos manuales para crear/subir el repositorio después de autorización.
8. No se desplegó Render, no se verificó su proxy/HTTPS en vivo y no se conectó SAP. No confundir preparación y diseño con publicación o integración probada.
