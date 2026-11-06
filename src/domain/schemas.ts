import { z } from 'zod';

export const fecha = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const solicitudSchema = z.object({
  solicitud_id: z.string().min(1), solicitante: z.string(), proveedor_nombre: z.string().min(1), proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1), centro_costo: z.string(), subarea: z.string(), cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(), valor_total: z.number().positive(), moneda: z.enum(['COP','USD']),
  indicador_iva: z.string().optional(), condiciones_pago: z.string().optional(), fecha_solicitud: fecha,
});
export const correoSchema = z.object({id:z.string(),de:z.string(),asunto:z.string(),fecha});
export const aprobacionOriginalSchema = z.object({de:z.string(),para:z.string(),fecha,asunto:z.string(),cuerpo:z.string()});
export const paqueteSchema = z.object({
  correo: correoSchema, solicitud: solicitudSchema,
  cotizacion: z.object({proveedor:z.string(),nit:z.string().nullable(),total:z.number().nonnegative(),moneda:z.enum(['COP','USD']),validez_hasta:fecha.nullable(),texto:z.string()}).nullable(),
  aprobacion:z.object({de:z.string(),fecha,aprobado:z.boolean(),texto:z.string()}).nullable(),
  factura:z.object({numero:z.string(),fecha,total:z.number().nonnegative()}).nullable(),
  faltantes:z.array(z.string()).default([]),
});
export const proveedorSchema=z.object({codigo_sap:z.string(),nit:z.string(),nombre:z.string(),condiciones_pago_default:z.string(),indicador_iva_default:z.string(),activo:z.boolean()});
export const centroSchema=z.object({centro_costo:z.string(),subareas:z.array(z.string()),aprobadores:z.array(z.object({email:z.string(),tope:z.number()}))});
export const derivadosSchema=z.object({indicador_iva:z.string().optional(),condiciones_pago:z.string().optional()});
export const ordenSchema=z.object({
 referencia:z.object({solicitud_id:z.string(),correo_id:z.string(),cotizacion_ref:z.string().nullable()}),
 sociedad:z.literal('1000'),organizacion_compras:z.literal('1000'),proveedor:z.object({codigo_sap:z.string(),nit:z.string(),nombre:z.string()}),
 moneda:z.enum(['COP','USD']),condiciones_pago:z.string(),aprobador:z.object({email:z.string(),fecha_aprobacion:fecha,evidencia_sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
 posiciones:z.array(z.object({numero:z.number().int().positive().multipleOf(10),descripcion:z.string().min(1).max(40),cantidad:z.number().positive(),unidad:z.enum(['UN','H','MES']),precio_unitario:z.number().nonnegative(),centro_costo:z.string(),subarea:z.string(),indicador_iva:z.string()})).min(1),
 excepciones:z.array(z.object({codigo:z.string(),detalle:z.string(),confirmado_por:z.string().nullable()})),
});
export type Paquete=z.infer<typeof paqueteSchema>;
export type OrdenCompra=z.infer<typeof ordenSchema>;
export type Derivados=z.infer<typeof derivadosSchema>;
export type Proveedor=z.infer<typeof proveedorSchema>;
export type Hallazgo={codigo:string;detalle:string;accion:string};
export type Validacion={apta:boolean;bloqueos:Hallazgo[];confirmaciones:Hallazgo[];derivados:Derivados;retroactiva:boolean};
export type Contexto={directory:string;sessionId:string};
