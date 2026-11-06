import path from 'node:path';
import { z } from 'zod';
import { ordenSchema, type Contexto, type OrdenCompra } from '../domain/schemas.js';
import { agregar, exclusivo, maestros, opcional } from '../domain/files.js';
import { nit } from '../domain/engine.js';
import type { SapAdapter } from './adapter.js';
const registroSchema=z.object({numero_oc:z.string(),fecha:z.string(),orden:ordenSchema});
export class MockSapAdapter implements SapAdapter {
 constructor(private readonly ctx:Contexto){}
 private async registros(){const contenido=await opcional(path.join(this.ctx.directory,'out/sap/ordenes.jsonl'));return (contenido??'').split('\n').filter(Boolean).map(l=>registroSchema.parse(JSON.parse(l)));}
 async consultarProveedor(n:string){const p=(await maestros(this.ctx)).proveedores.find(p=>nit(p.nit)===nit(n));return p?{codigo_sap:p.codigo_sap,activo:p.activo}:null;}
 async buscarOrdenPorReferencia(id:string){const p=(await this.registros()).find(r=>r.orden.referencia.solicitud_id===id);return p?{numero_oc:p.numero_oc}:null;}
 async crearOrden(orden:OrdenCompra){return exclusivo(path.resolve(this.ctx.directory,'out/sap/ordenes.jsonl'),async()=>{
  const validada=ordenSchema.parse(orden);const registros=await this.registros();const existente=registros.find(r=>r.orden.referencia.solicitud_id===validada.referencia.solicitud_id);
  if(existente)return {numero_oc:existente.numero_oc,fecha:existente.fecha};
  const numero_oc=String(registros.reduce((max,r)=>Math.max(max,Number(r.numero_oc)),4500000000)+1);const fecha=new Date().toISOString();
  await agregar(this.ctx,'sap/ordenes.jsonl',JSON.stringify({numero_oc,fecha,orden:validada})+'\n');return {numero_oc,fecha};
 });}
}
