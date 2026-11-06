# Proceso de órdenes de compra

La analista solicita procesar un paquete identificado por carpeta sol-001 a sol-006. El paquete incluye correo, solicitud JSON, cotización TXT, aprobación JSON y factura opcional. SAP es un simulador local; no hay envío de correos ni compras reales.

Las reglas se ejecutan en oc_validar; este texto describe el proceso, no sustituye su implementación:

- RC1: proveedor existente y activo; NIT o nombre normalizado cuando falta NIT.
- RC2: aprobación existente con Aprobado y remitente autorizado para el centro.
- RC3: monto dentro del tope del aprobador para ese centro.
- RC4: subárea pertenece al centro.
- RC5: ausencia de cotización o diferencia superior al 2% requiere confirmación con ambos valores.
- RC6: IVA ausente se deriva del proveedor y requiere confirmación.
- RC7: pago ausente se deriva del proveedor; solo se informa.
- RC8: factura anterior a solicitud marca retroactiva y requiere confirmación.
- RC9: aprobación anterior a solicitud requiere confirmación.
- RC10: cantidad por precio debe igualar total con tolerancia de una unidad.

Apta significa sin bloqueos; puede seguir pendiente. Los bloqueos nunca se autorizan por chat. La solicitud mantiene sus importes; una discrepancia no permite reemplazarlos por los de cotización. Las derivaciones se informan al usuario. La evidencia P0 es TXT con SHA-256. Se conserva trazabilidad e idempotencia por solicitud_id; los identificadores de carpeta y solicitud son diferentes.
