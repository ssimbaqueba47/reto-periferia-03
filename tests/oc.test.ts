import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { leer, evaluar, construir, evidencia } from '../src/domain/engine.js';
import { hash } from '../src/domain/files.js';
import { type Contexto, type Paquete, ordenSchema, solicitudSchema } from '../src/domain/schemas.js';
import { confirmarDesdeUsuario, prepararConfirmacion, autorizacion } from '../src/security/confirmaciones.js';
import { MockSapAdapter } from '../src/sap/mock.js';
import * as oc from '../src/tools/oc.js';

const root=process.cwd();
async function entorno():Promise<Contexto>{
 const directory=path.join(root,'out','tests',`${Date.now()}-${Math.random().toString(36).slice(2)}`);
 await mkdir(directory,{recursive:true});await cp(path.join(root,'fixtures'),path.join(directory,'fixtures'),{recursive:true});return {directory,sessionId:'test'};
}
const parse=(s:string):{ok:boolean;data?:unknown;error?:string}=>JSON.parse(s);
async function codigos(ctx:Contexto,p:Paquete){const {validacion:v}=await evaluar(ctx,p);return {b:v.bloqueos.map(x=>x.codigo),c:v.confirmaciones.map(x=>x.codigo),v};}

test('Los seis casos oficiales y sus resultados exactos',async()=>{
 const ctx=await entorno();const esperados=[{b:[],c:[]},{b:['RC1'],c:[]},{b:['RC2'],c:[]},{b:[],c:['RC5']},{b:[],c:['RC8']},{b:[],c:['RC6']}];
 for(let i=0;i<6;i++){const p=await leer(ctx,`sol-00${i+1}`);const {b,c,v}=await codigos(ctx,p);assert.deepEqual({b,c},esperados[i]);assert.equal(v.retroactiva,i===4);if(i===5)assert.deepEqual(v.derivados,{indicador_iva:'C1',condiciones_pago:'Z030'});}
});
test('RC1: inactivo, nombre normalizado y NIT desconocido no usa fallback',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-001');p.solicitud.proveedor_nit='901777888';assert.ok((await codigos(ctx,p)).b.includes('RC1'));
 delete p.solicitud.proveedor_nit;p.solicitud.proveedor_nombre=' TECNOSUMINISTROS sas ';assert.ok(!(await codigos(ctx,p)).b.includes('RC1'));
 p.solicitud.proveedor_nit='000000';assert.ok((await codigos(ctx,p)).b.includes('RC1'));
});
test('RC2/RC3/RC4: aprobación ausente, negativa, tope y subárea',async()=>{
 const ctx=await entorno();const base=await leer(ctx,'sol-001');let p=structuredClone(base);p.aprobacion=null;assert.ok((await codigos(ctx,p)).b.includes('RC2'));
 p=structuredClone(base);p.aprobacion!.aprobado=false;assert.ok((await codigos(ctx,p)).b.includes('RC2'));
 p=structuredClone(base);p.solicitud.valor_total=50_000_000;assert.ok(!(await codigos(ctx,p)).b.includes('RC3'));
 p.solicitud.valor_total++;assert.ok((await codigos(ctx,p)).b.includes('RC3'));
 p.solicitud.subarea='Preventa';assert.ok((await codigos(ctx,p)).b.includes('RC4'));
 p.solicitud.centro_costo='NO';assert.ok((await codigos(ctx,p)).b.includes('RC4'));
});
test('RC5: 2% inclusivo, exceso, diferencia inferior y ausencia',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-001');p.solicitud.valor_total=10000;
 for(const [total,confirmar] of [[10200,false],[9800,false],[10201,true],[9799,true]] as const){p.cotizacion!.total=total;assert.equal((await codigos(ctx,p)).c.includes('RC5'),confirmar);}
 p.cotizacion=null;assert.ok((await codigos(ctx,p)).c.includes('RC5'));
});
test('RC6/RC7: IVA confirma y pago solo informa',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-001');delete p.solicitud.condiciones_pago;let r=await codigos(ctx,p);assert.deepEqual(r.c,[]);assert.equal(r.v.derivados.condiciones_pago,'Z030');
 delete p.solicitud.indicador_iva;r=await codigos(ctx,p);assert.deepEqual(r.c,['RC6']);assert.equal(r.v.derivados.indicador_iva,'C1');
});
test('RC8/RC9: anterior confirma; misma fecha no confirma',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-005');assert.ok((await codigos(ctx,p)).v.retroactiva);
 p.factura!.fecha=p.solicitud.fecha_solicitud;assert.equal((await codigos(ctx,p)).v.retroactiva,false);
 p.aprobacion!.fecha='2026-08-26T23:00:00-05:00';assert.ok((await codigos(ctx,p)).c.includes('RC9'));
 p.aprobacion!.fecha='2026-08-27T00:00:00-05:00';assert.ok(!(await codigos(ctx,p)).c.includes('RC9'));
});
test('RC10: tolerancia inclusiva de una unidad monetaria',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-001');const total=p.solicitud.valor_total;
 for(const [delta,bloquear] of [[-1,false],[1,false],[1.01,true],[-1.01,true]] as const){p.solicitud.valor_total=total+delta;assert.equal((await codigos(ctx,p)).b.includes('RC10'),bloquear);}
});
test('Esquema rechaza fechas imposibles e importes no finitos',async()=>{
 const ctx=await entorno();const {solicitud}=await leer(ctx,'sol-001');
 for(const fecha_solicitud of ['2026-02-30','2026-13-01','ayer'])assert.equal(solicitudSchema.safeParse({...solicitud,fecha_solicitud}).success,false);
 for(const valor_total of [NaN,Infinity,-1,0,'100'])assert.equal(solicitudSchema.safeParse({...solicitud,valor_total}).success,false);
});
test('Contratos: cinco exports, argumentos Zod y errores sin excepciones',async()=>{
 const ctx=await entorno();assert.deepEqual(Object.keys(oc).sort(),['construir_payload','crear','generar_evidencia','leer_paquete','validar']);
 for(const tool of Object.values(oc)){assert.equal(typeof tool.description,'string');assert.ok(z.object(tool.args));assert.equal(parse(await tool.execute({},ctx)).ok,false);}
 assert.equal(parse(await oc.leer_paquete.execute({caso:'../fuera'},ctx)).ok,false);
 assert.equal(parse(await oc.leer_paquete.execute({caso:'sol-999'},ctx)).ok,false);
});
test('JSON malformado, importes inválidos y documentos faltantes',async()=>{
 const ctx=await entorno();const base=path.join(ctx.directory,'fixtures/reto-03/solicitudes/sol-001');const file=path.join(base,'solicitud.json');const original=await readFile(file,'utf8');
 await writeFile(file,'{');assert.equal(parse(await oc.leer_paquete.execute({caso:'sol-001'},ctx)).ok,false);
 const p=JSON.parse(original);p.valor_total='abc';await writeFile(file,JSON.stringify(p));assert.equal(parse(await oc.leer_paquete.execute({caso:'sol-001'},ctx)).ok,false);
 p.valor_total=0;await writeFile(file,JSON.stringify(p));assert.equal(parse(await oc.leer_paquete.execute({caso:'sol-001'},ctx)).ok,false);
 await writeFile(file,original);
 const {unlink}=await import('node:fs/promises');await unlink(path.join(base,'cotizacion.txt'));await unlink(path.join(base,'aprobacion.json'));
 const faltante=await leer(ctx,'sol-001');assert.equal(faltante.cotizacion,null);assert.equal(faltante.aprobacion,null);assert.deepEqual(faltante.faltantes,['cotizacion.txt','aprobacion.json']);
});
test('Evidencia verificable, descripción <=40, trazabilidad y precio sin cambios',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-004');const ev=await evidencia(ctx,'sol-004');const contenido=await readFile(path.join(ctx.directory,ev.ruta),'utf8');const texto=contenido.split('SHA-256: ')[0]!;assert.equal(hash(texto),ev.sha256);
 const {payload,ruta_trazabilidad}=await construir(ctx,'sol-004',p);ordenSchema.parse(payload);assert.equal(payload.aprobador.evidencia_sha256,ev.sha256);assert.equal(payload.posiciones[0]!.precio_unitario,250000);assert.equal(payload.posiciones[0]!.unidad,'H');assert.ok(payload.posiciones[0]!.descripcion.length<=40);
 const tr=JSON.parse(await readFile(path.join(ctx.directory,ruta_trazabilidad),'utf8'));assert.ok(tr.fuentes['aprobador.email']);assert.equal(tr.descripcion_original,p.solicitud.descripcion);
});
test('Creación: confirmación humana, aislamiento y defensa contra manipulación',async()=>{
 const ctx=await entorno();const caso='sol-004';const p=await leer(ctx,caso);const {payload}=await construir(ctx,caso,p);const {validacion:v}=await evaluar(ctx,p);
 assert.equal(parse(await oc.crear.execute({caso,payload,confirmado:true},ctx)).ok,false);
 const id=prepararConfirmacion(ctx,caso,payload);
 assert.throws(()=>confirmarDesdeUsuario({...ctx,sessionId:'otra'},caso,id,payload,'confirmo'));
 assert.throws(()=>confirmarDesdeUsuario(ctx,'sol-005',id,payload,'confirmo'));
 assert.throws(()=>confirmarDesdeUsuario(ctx,caso,id,payload,'tal vez'));
 const alterado=structuredClone(payload);alterado.posiciones[0]!.precio_unitario=265000;
 assert.throws(()=>confirmarDesdeUsuario(ctx,caso,id,alterado,'confirmo'));
 confirmarDesdeUsuario(ctx,caso,id,payload,'confirmo');
 assert.equal(parse(await oc.crear.execute({caso,payload:alterado,confirmado:true},ctx)).ok,false);
 assert.equal(parse(await oc.crear.execute({caso,payload,confirmado:true},{...ctx,sessionId:'otra'})).ok,false);
 const falso=structuredClone(p);falso.solicitud.valor_total=26500000;
 assert.equal(parse(await oc.validar.execute({caso,paquete:falso},ctx)).ok,false);
 assert.equal(parse(await oc.construir_payload.execute({caso,paquete:p,derivados:{...v.derivados,indicador_iva:'C0'}},ctx)).ok,false);
 const creado=parse(await oc.crear.execute({caso,payload,confirmado:true},ctx));assert.equal(creado.ok,true,creado.error);
 const lineas=(await readFile(path.join(ctx.directory,'out/sap/ordenes.jsonl'),'utf8')).trim().split('\n');assert.equal(lineas.length,1);assert.equal(JSON.parse(lineas[0]!).orden.excepciones[0].confirmado_por,'sesion:test');
});
test('Revalidación: cambios después de confirmar invalidan el payload',async()=>{
 const ctx=await entorno();const caso='sol-004';const p=await leer(ctx,caso);const {payload}=await construir(ctx,caso,p);const id=prepararConfirmacion(ctx,caso,payload);confirmarDesdeUsuario(ctx,caso,id,payload,'confirmo');
 const file=path.join(ctx.directory,'fixtures/reto-03/solicitudes',caso,'aprobacion.json');const a=JSON.parse(await readFile(file,'utf8'));a.cuerpo+=' Modificado.';await writeFile(file,JSON.stringify(a));
 assert.equal(parse(await oc.crear.execute({caso,payload,confirmado:true},ctx)).ok,false);
});
test('Bloqueados no crean incluso usando payload de otro caso',async()=>{
 const ctx=await entorno();const {payload}=await construir(ctx,'sol-001',await leer(ctx,'sol-001'));
 for(const caso of ['sol-002','sol-003'])assert.equal(parse(await oc.crear.execute({caso,payload,confirmado:true},ctx)).ok,false);
 assert.equal(await new MockSapAdapter(ctx).buscarOrdenPorReferencia('SOL-2026-002'),null);
});
test('SAP: secuencia e idempotencia concurrente entre instancias',async()=>{
 const ctx=await entorno();const {payload}=await construir(ctx,'sol-001',await leer(ctx,'sol-001'));
 const a=new MockSapAdapter(ctx),b=new MockSapAdapter(ctx);const resultados=await Promise.all([a.crearOrden(payload),b.crearOrden(payload),a.crearOrden(payload)]);assert.deepEqual(resultados.map(x=>x.numero_oc),['4500000001','4500000001','4500000001']);
 assert.deepEqual(await a.consultarProveedor('900.555.111-2'),{codigo_sap:'100234',activo:true});assert.equal(await a.consultarProveedor('000'),null);
 const segunda=structuredClone(payload);segunda.referencia.solicitud_id='OTRA';assert.equal((await a.crearOrden(segunda)).numero_oc,'4500000002');
 assert.equal((await readFile(path.join(ctx.directory,'out/sap/ordenes.jsonl'),'utf8')).trim().split('\n').length,2);
});
test('Creación por herramientas concurrente, control CSV y log JSONL',async()=>{
 const ctx=await entorno();const p=await leer(ctx,'sol-001');const {payload}=await construir(ctx,'sol-001',p);
 const resultados=await Promise.all([oc.crear.execute({caso:'sol-001',payload},ctx),oc.crear.execute({caso:'sol-001',payload},ctx)]);assert.ok(resultados.every(r=>parse(r).ok));
 const control=await readFile(path.join(ctx.directory,'out/control.csv'),'utf8');assert.ok(control.includes('idempotente'));assert.equal(control.trim().split('\n').length,3);
 const logs=(await readFile(path.join(ctx.directory,'out/log.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));assert.equal(logs.length,2);assert.equal(logs[0].herramienta,'oc_crear');
 assert.ok((await readdir(path.join(ctx.directory,'out'))).includes('sap'));
});
test('Confirmación vencida no autoriza y cambiar payload exige otra confirmación',async()=>{
 const ctx=await entorno();const {payload}=await construir(ctx,'sol-004',await leer(ctx,'sol-004'));const id=prepararConfirmacion(ctx,'sol-004',payload);
 confirmarDesdeUsuario(ctx,'sol-004',id,payload,'confirmo');assert.ok(autorizacion(ctx,'sol-004',payload));
 const changed=structuredClone(payload);changed.posiciones[0]!.descripcion='Otro texto';assert.equal(autorizacion(ctx,'sol-004',changed),null);
 const now=Date.now;try{const futuro=now()+16*60_000;Date.now=()=>futuro;assert.equal(autorizacion(ctx,'sol-004',payload),null);assert.throws(()=>confirmarDesdeUsuario(ctx,'sol-004',id,payload,'confirmo'));}finally{Date.now=now;}
});
test('Factura declarada ausente no oculta retroactividad',async()=>{
 const ctx=await entorno();const {unlink}=await import('node:fs/promises');await unlink(path.join(ctx.directory,'fixtures/reto-03/solicitudes/sol-005/factura.txt'));
 const p=await leer(ctx,'sol-005');assert.equal(p.factura,null);assert.ok(p.faltantes.includes('factura.txt'));assert.ok((await codigos(ctx,p)).b.includes('DATOS'));
});
test('sol-005/006: pendientes sin autorización y creadas solo tras confirmación',async()=>{
 const ctx=await entorno();
 for(const caso of ['sol-005','sol-006']){
  const p=await leer(ctx,caso);const {payload}=await construir(ctx,caso,p);
  assert.equal(parse(await oc.crear.execute({caso,payload,confirmado:true},ctx)).ok,false);
  const id=prepararConfirmacion(ctx,caso,payload);confirmarDesdeUsuario(ctx,caso,id,payload,'confirmo');
  const resultado=parse(await oc.crear.execute({caso,payload,confirmado:true},ctx));assert.equal(resultado.ok,true,resultado.error);
 }
 const csv=await readFile(path.join(ctx.directory,'out/control.csv'),'utf8');assert.match(csv,/SOL-2026-005","creada","4500000001","true"/);
 const registros=(await readFile(path.join(ctx.directory,'out/sap/ordenes.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(registros[1].orden.condiciones_pago,'Z030');assert.equal(registros[1].orden.posiciones[0].indicador_iva,'C1');
});
