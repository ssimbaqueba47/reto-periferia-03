import path from 'node:path';
import { z } from 'zod';
import { casoSchema, estable, agregar, control, exclusivo } from '../domain/files.js';
import { paqueteSchema, derivadosSchema, ordenSchema, type Contexto } from '../domain/schemas.js';
import { leer, evaluar, construir, evidencia } from '../domain/engine.js';
import { prepararConfirmacion, autorizacion } from '../security/confirmaciones.js';
import { MockSapAdapter } from '../sap/mock.js';

function herramienta<S extends z.ZodRawShape,T>(nombre:string,description:string,args:S,fn:(a:z.infer<z.ZodObject<S>>,ctx:Contexto)=>Promise<T>){return {description,args,async execute(input:unknown,ctx:Contexto):Promise<string>{
 let resultado:string;
 try{const parsed=z.object(args).strict().parse(input);const data=await fn(parsed,ctx);resultado=JSON.stringify({ok:true,data});}
 catch(e){resultado=JSON.stringify({ok:false,error:e instanceof Error?e.message:'Error desconocido; solicitar revisión del paquete.'});}
 try{await exclusivo(path.resolve(ctx.directory,'out/log.jsonl'),()=>agregar(ctx,'log.jsonl',JSON.stringify({herramienta:nombre,argumentos:input,resultado:JSON.parse(resultado),sessionId:ctx.sessionId,ts:new Date().toISOString()})+'\n'));}
 catch{ return JSON.stringify({ok:false,error:'No se pudo registrar auditoría de la herramienta; revisar permisos de out/.'});}
 return resultado;
 }};}
async function canonico(ctx:Contexto,caso:string,paquete:unknown){const original=await leer(ctx,caso);if(estable(original)!==estable(paquete))throw new Error('Paquete alterado: debe corresponder a los fixtures originales.');return original;}
export const leer_paquete=herramienta('oc_leer_paquete','Lee los documentos normalizados de un caso e informa adjuntos faltantes.',{caso:casoSchema},async({caso},ctx)=>leer(ctx,caso));
export const validar=herramienta('oc_validar','Aplica RC1–RC10 y devuelve bloqueos, confirmaciones y derivados.',{caso:casoSchema,paquete:paqueteSchema.describe('Paquete devuelto por oc_leer_paquete')},async({caso,paquete},ctx)=>{
 const p=await canonico(ctx,caso,paquete);const {validacion}=await evaluar(ctx,p);
 await exclusivo(path.resolve(ctx.directory,'out/control.csv'),()=>control(ctx,p.solicitud.solicitud_id,!validacion.apta?'bloqueado':validacion.confirmaciones.length?'pendiente':'apta',validacion));return validacion;
});
export const construir_payload=herramienta('oc_construir_payload','Construye la OC canónica y su trazabilidad sin modificar importes.',{caso:casoSchema,paquete:paqueteSchema.describe('Paquete original del caso'),derivados:derivadosSchema.describe('Valores derivados por oc_validar')},async({caso,paquete,derivados},ctx)=>{
 const p=await canonico(ctx,caso,paquete);const {validacion}=await evaluar(ctx,p);if(estable(derivados)!==estable(validacion.derivados))throw new Error('Derivados alterados.');
 const data=await construir(ctx,caso,p);if(validacion.confirmaciones.length)prepararConfirmacion(ctx,caso,data.payload);return data;
});
export const generar_evidencia=herramienta('oc_generar_evidencia','Genera el correo de aprobación en TXT y su hash SHA-256.',{caso:casoSchema},async({caso},ctx)=>evidencia(ctx,caso));
export const crear=herramienta('oc_crear','Revalida la OC y la registra solo si no hay bloqueos y existe autorización humana cuando corresponde.',{caso:casoSchema,payload:ordenSchema.describe('OC canónica construida previamente'),confirmado:z.boolean().optional().describe('Indica confirmación; no sustituye autorización humana del backend')},async({caso,payload,confirmado},ctx)=>exclusivo(path.resolve(ctx.directory,'out/creacion'),async()=>{
 const p=await leer(ctx,caso);const {validacion:v}=await evaluar(ctx,p);
 const registrar=(estado:string,numero='')=>exclusivo(path.resolve(ctx.directory,'out/control.csv'),()=>control(ctx,p.solicitud.solicitud_id,estado,v,numero));
 if(!v.apta){await registrar('bloqueado');throw new Error('OC bloqueada: '+JSON.stringify(v.bloqueos));}
 const canonical=await construir(ctx,caso,p);
 if(estable(canonical.payload)!==estable(payload)){await registrar('rechazado');throw new Error('Payload alterado o desactualizado. Volver a construir y confirmar.');}
 const sap=new MockSapAdapter(ctx);const existente=await sap.buscarOrdenPorReferencia(p.solicitud.solicitud_id);
 const actor=autorizacion(ctx,caso,payload);
 if(v.confirmaciones.length&&(!confirmado||!actor)){
  prepararConfirmacion(ctx,caso,payload);await registrar('pendiente');throw new Error('Se requiere confirmación humana explícita válida para esta sesión, caso y payload.');
 }
 const orden=structuredClone(payload);for(const ex of orden.excepciones)ex.confirmado_por=actor;
 const resultado=await sap.crearOrden(orden);await registrar(existente?'idempotente':'creada',resultado.numero_oc);return {...resultado,idempotente:!!existente};
}));
