import path from 'node:path';
import { z } from 'zod';
import { aprobacionOriginalSchema, correoSchema, solicitudSchema, paqueteSchema, ordenSchema, type Paquete, type Contexto, type Validacion } from './schemas.js';
import { casoPath, opcional, json, maestros, guardar, hash } from './files.js';

function extraer(texto:string,re:RegExp,nombre:string){const value=texto.match(re)?.[1]?.trim();if(!value)throw new Error(`No se pudo leer ${nombre}; solicitar documento completo.`);return value;}
function importe(texto:string){return Number(extraer(texto,/^TOTAL[^\n]*?:\s*(?:COP|USD)\s+([\d.,]+)/mi,'total').replaceAll('.','').replace(',','.'));}
export const nit=(v:string)=>v.split('-')[0]!.replace(/\D/g,'');
const nombre=(v:string)=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export async function leer(ctx:Contexto,caso:string):Promise<Paquete>{
 const base=casoPath(ctx,caso);const solicitud=solicitudSchema.parse(await json(path.join(base,'solicitud.json')));
 const correoOriginal=correoSchema.extend({adjuntos:z.array(z.string())}).parse(await json(path.join(base,'correo.json')));const correo=correoSchema.parse(correoOriginal);
 const cot=await opcional(path.join(base,'cotizacion.txt'));const apr=await opcional(path.join(base,'aprobacion.json'));const fac=await opcional(path.join(base,'factura.txt'));
 let validez:string|null=null;
 if(cot){const fecha=cot.match(/^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];const dias=cot.match(/Validez de la oferta:\s*(\d+) días/)?.[1];if(fecha&&dias){const d=new Date(fecha);d.setUTCDate(d.getUTCDate()+Number(dias));validez=d.toISOString().slice(0,10);}}
 const aprobacion=apr?aprobacionOriginalSchema.parse(JSON.parse(apr)):null;
 return paqueteSchema.parse({correo,solicitud,
 cotizacion:cot?{proveedor:extraer(cot,/^Proveedor:\s*(.+)$/m,'proveedor'),nit:nit(extraer(cot,/^NIT:\s*(.+)$/m,'NIT')),total:importe(cot),moneda:extraer(cot,/^TOTAL[^\n]*?:\s*(COP|USD)/mi,'moneda'),validez_hasta:validez,texto:cot}:null,
 aprobacion:aprobacion?{de:aprobacion.de,fecha:aprobacion.fecha,aprobado:/\baprobado\b/i.test(aprobacion.cuerpo),texto:aprobacion.cuerpo}:null,
 factura:fac?{numero:extraer(fac,/No\.\s*(\S+)/,'número de factura'),fecha:extraer(fac,/Fecha de emisión:\s*(\d{4}-\d{2}-\d{2})/,'fecha factura'),total:importe(fac)}:null,
 faltantes:[...(!cot?['cotizacion.txt']:[]),...(!apr?['aprobacion.json']:[]),...(!fac&&correoOriginal.adjuntos.includes('factura.pdf')?['factura.txt']:[])],
 });
}
export async function evaluar(ctx:Contexto,p:Paquete){
 const m=await maestros(ctx);const s=p.solicitud;const proveedor=m.proveedores.find(v=>s.proveedor_nit?nit(v.nit)===nit(s.proveedor_nit):nombre(v.nombre)===nombre(s.proveedor_nombre));
 const centro=m.centros.find(c=>c.centro_costo===s.centro_costo);const aprobador=centro?.aprobadores.find(a=>a.email.toLowerCase()===p.aprobacion?.de.toLowerCase());
 const v:Validacion={apta:true,bloqueos:[],confirmaciones:[],derivados:{},retroactiva:false};
 const bloquear=(codigo:string,detalle:string,accion:string)=>v.bloqueos.push({codigo,detalle,accion});
 const confirmar=(codigo:string,detalle:string)=>v.confirmaciones.push({codigo,detalle,accion:'Confirmar explícitamente antes de crear la OC.'});
 if(p.faltantes.includes('factura.txt'))bloquear('DATOS','El correo declara factura adjunta pero falta factura.txt.','Solicitar factura para verificar retroactividad.');
 if(!proveedor||!proveedor.activo)bloquear('RC1','Proveedor inexistente o inactivo.','Gestionar alta o activación del proveedor.');
 if(!p.aprobacion?.aprobado||!aprobador)bloquear('RC2','Aprobación ausente, sin Aprobado o remitente no autorizado para el centro.','Solicitar aprobación con autoridad para este centro y monto.');
 if(aprobador&&s.valor_total>aprobador.tope)bloquear('RC3',`Monto ${s.valor_total} supera tope ${aprobador.tope}.`,'Escalar a un aprobador con tope suficiente para este centro.');
 if(!centro?.subareas.includes(s.subarea))bloquear('RC4','Subárea no pertenece al centro de costo.','Corregir centro o subárea con el solicitante.');
 if(!p.cotizacion)confirmar('RC5','No hay cotización.');
 else if(Math.abs(p.cotizacion.total-s.valor_total)>s.valor_total*0.02)confirmar('RC5',`Solicitud: ${s.valor_total}; cotización: ${p.cotizacion.total}; diferencia: ${Math.abs(p.cotizacion.total-s.valor_total)/s.valor_total*100}%.`);
 if(!s.indicador_iva&&proveedor){v.derivados.indicador_iva=proveedor.indicador_iva_default;confirmar('RC6',`IVA derivado del proveedor: ${proveedor.indicador_iva_default}.`);}
 if(!s.condiciones_pago&&proveedor)v.derivados.condiciones_pago=proveedor.condiciones_pago_default;
 if(p.factura&&p.factura.fecha.slice(0,10)<s.fecha_solicitud.slice(0,10)){v.retroactiva=true;confirmar('RC8',`Factura ${p.factura.fecha} anterior a solicitud ${s.fecha_solicitud}.`);}
 if(p.aprobacion&&p.aprobacion.fecha.slice(0,10)<s.fecha_solicitud.slice(0,10))confirmar('RC9','Aprobación anterior a fecha de solicitud.');
 if(Math.abs(s.cantidad*s.valor_unitario-s.valor_total)>1)bloquear('RC10','Cantidad por valor unitario no coincide con total (tolerancia 1).','Solicitar corrección de los importes.');
 const iva=s.indicador_iva??v.derivados.indicador_iva;const pago=s.condiciones_pago??v.derivados.condiciones_pago;
 if(proveedor&&(!m.iva.some(i=>i.codigo===iva)||!m.pagos.some(i=>i.codigo===pago)))bloquear('DATOS','Código de IVA o pago no existe en maestros.','Corregir códigos o maestro.');
 v.apta=v.bloqueos.length===0;return {validacion:v,proveedor};
}
export async function evidencia(ctx:Contexto,caso:string){
 const a=aprobacionOriginalSchema.parse(await json(path.join(casoPath(ctx,caso),'aprobacion.json')));
 const contenido=`De: ${a.de}\nPara: ${a.para}\nFecha: ${a.fecha}\nAsunto: ${a.asunto}\n\n${a.cuerpo}\n`;
 const sha256=hash(contenido);return {ruta:await guardar(ctx,`${caso}/aprobacion.txt`,contenido+`SHA-256: ${sha256}\n`),sha256};
}
export async function construir(ctx:Contexto,caso:string,p:Paquete){
 const {validacion:v,proveedor}=await evaluar(ctx,p);if(!v.apta||!proveedor||!p.aprobacion)throw new Error('No se puede construir: '+JSON.stringify(v.bloqueos));
 const ev=await evidencia(ctx,caso);const s=p.solicitud;
 const unidad=/\bhoras?\b/i.test(p.cotizacion?.texto??s.descripcion)?'H':'UN';
 const payload=ordenSchema.parse({referencia:{solicitud_id:s.solicitud_id,correo_id:p.correo.id,cotizacion_ref:p.cotizacion?.texto.match(/^COTIZACIÓN\s+(.+)$/m)?.[1]?.trim()??null},sociedad:'1000',organizacion_compras:'1000',proveedor:{codigo_sap:proveedor.codigo_sap,nit:proveedor.nit,nombre:proveedor.nombre},moneda:s.moneda,condiciones_pago:s.condiciones_pago??v.derivados.condiciones_pago,aprobador:{email:p.aprobacion.de,fecha_aprobacion:p.aprobacion.fecha,evidencia_sha256:ev.sha256},posiciones:[{numero:10,descripcion:s.descripcion.slice(0,40),cantidad:s.cantidad,unidad,precio_unitario:s.valor_unitario,centro_costo:s.centro_costo,subarea:s.subarea,indicador_iva:s.indicador_iva??v.derivados.indicador_iva}],excepciones:v.confirmaciones.map(c=>({codigo:c.codigo,detalle:c.detalle,confirmado_por:null}))});
 const fuentes:Record<string,string>={
 'referencia.solicitud_id':'solicitud.solicitud_id','referencia.correo_id':'correo.id','referencia.cotizacion_ref':'cotizacion.texto: encabezado',sociedad:'derivado: constante PRD 7.4',organizacion_compras:'derivado: constante PRD 7.4',moneda:'solicitud.moneda',condiciones_pago:s.condiciones_pago?'solicitud.condiciones_pago':'maestro.proveedores.condiciones_pago_default',
 'aprobador.email':'aprobacion.de','aprobador.fecha_aprobacion':'aprobacion.fecha','aprobador.evidencia_sha256':'derivado: SHA-256 de aprobación',
 };
 for(const k of ['codigo_sap','nit','nombre'])fuentes[`proveedor.${k}`]=`maestro.proveedores.${k}`;
 for(const k of ['cantidad','centro_costo','subarea'])fuentes[`posiciones[0].${k}`]=`solicitud.${k}`;
 Object.assign(fuentes,{'posiciones[0].numero':'derivado: primera posición 10','posiciones[0].descripcion':'solicitud.descripcion: primeros 40 caracteres','posiciones[0].unidad':'derivado: hora explícita en cotización o descripción => H; resto UN','posiciones[0].precio_unitario':'solicitud.valor_unitario','posiciones[0].indicador_iva':s.indicador_iva?'solicitud.indicador_iva':'maestro.proveedores.indicador_iva_default'});
 payload.excepciones.forEach((_,i)=>{for(const k of ['codigo','detalle','confirmado_por'])fuentes[`excepciones[${i}].${k}`]='derivado: validación RC y confirmación de sesión';});
 const ruta_trazabilidad=await guardar(ctx,`${caso}/trazabilidad.json`,JSON.stringify({payload,fuentes,descripcion_original:s.descripcion},null,2));
 return {payload,ruta_trazabilidad};
}
