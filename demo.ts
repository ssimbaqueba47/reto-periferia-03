import assert from 'node:assert/strict';
import { rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import * as oc from './src/tools/oc.js';
import { paqueteSchema, ordenSchema, type Contexto } from './src/domain/schemas.js';
import { prepararConfirmacion, confirmarDesdeUsuario } from './src/security/confirmaciones.js';
import { evaluar } from './src/domain/engine.js';
import { workspaceAislado } from './src/runtime/workspace.js';

const entrega=process.argv.includes('--entrega');
if(entrega){
 let activo=false;try{await access(path.join(process.cwd(),'out/.servidor-activo'));activo=true;}catch{}
 assert.equal(activo,false,'Detén el servidor antes de ejecutar la demo de entrega sobre out/.');
}
const directory=entrega?process.cwd():await workspaceAislado(process.cwd(),'demo',true);
const ctx:Contexto={directory,sessionId:'demo'};
const destino=path.resolve(ctx.directory,'out');
assert.equal(path.dirname(destino),path.resolve(ctx.directory));
assert.equal(path.basename(destino),'out');
await rm(destino,{recursive:true,force:true});
function respuesta(raw:string):{ok:boolean;data?:unknown;error?:string}{return JSON.parse(raw);}
function data(raw:string):unknown{const r=respuesta(raw);assert.equal(r.ok,true,r.error);return r.data;}
for(let i=1;i<=6;i++){
 const caso=`sol-${String(i).padStart(3,'0')}`;
 const paquete=paqueteSchema.parse(data(await oc.leer_paquete.execute({caso},ctx)));
 const resultado=data(await oc.validar.execute({caso,paquete},ctx));
 const {validacion}=await evaluar(ctx,paquete);
 assert.deepEqual(resultado,validacion);
 const {apta,bloqueos,confirmaciones,derivados,retroactiva}=validacion;
 console.log(`\n${caso}: ${JSON.stringify({apta,bloqueos,confirmaciones,derivados,retroactiva})}`);
 if(!apta){
  assert.equal(respuesta(await oc.construir_payload.execute({caso,paquete,derivados},ctx)).ok,false);
  console.log('SIN OC: bloqueada.');continue;
 }
 data(await oc.generar_evidencia.execute({caso},ctx));
 const construido=data(await oc.construir_payload.execute({caso,paquete,derivados},ctx)) as {payload:unknown};
 const payload=ordenSchema.parse(construido.payload);
 const intento=respuesta(await oc.crear.execute({caso,payload},ctx));
 if(confirmaciones.length){
  assert.equal(intento.ok,false);console.log('SIN OC: pendiente de confirmación.');
  if(i===4){
   assert.equal(respuesta(await oc.crear.execute({caso,payload,confirmado:true},ctx)).ok,false);
   console.log('confirmado:true sin autorización humana: rechazado.');
   const id=prepararConfirmacion(ctx,caso,payload);
   confirmarDesdeUsuario(ctx,caso,id,payload,'confirmo');
   console.log('Confirmación explícita del conductor de demo (simula mensaje humano): confirmo');
   console.log('OC:',data(await oc.crear.execute({caso,payload,confirmado:true},ctx)));
  }
 }else{
  assert.equal(intento.ok,true,intento.error);console.log('OC:',intento.data);
  const repetida=data(await oc.crear.execute({caso,payload},ctx)) as {numero_oc:string;idempotente:boolean};
  assert.equal(repetida.idempotente,true);assert.equal(repetida.numero_oc,'4500000001');console.log('Reintento:',repetida);
 }
}
const lineas=(await readFile(path.join(destino,'sap/ordenes.jsonl'),'utf8')).trim().split('\n');
assert.equal(lineas.length,2);
assert.deepEqual(lineas.map(l=>JSON.parse(l).orden.referencia.solicitud_id),['SOL-2026-001','SOL-2026-004']);
console.log('\nDEMO OK: 2 órdenes, sin duplicados; sol-002/003 bloqueadas; sol-005/006 pendientes.');
