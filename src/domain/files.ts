import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { proveedorSchema, centroSchema, type Contexto, type Validacion } from './schemas.js';

export const casoSchema=z.string().regex(/^sol-\d{3}$/, 'Caso inválido').describe('Carpeta del caso en fixtures/reto-03/solicitudes');
export function casoPath(ctx:Contexto,caso:string){return path.join(ctx.directory,'fixtures','reto-03','solicitudes',casoSchema.parse(caso));}
export async function json(file:string):Promise<unknown>{return JSON.parse(await readFile(file,'utf8'));}
export async function opcional(file:string){try{return await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export async function guardar(ctx:Contexto,relative:string,contenido:string){const file=path.join(ctx.directory,'out',relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,contenido,'utf8');return path.join('out',relative).replaceAll('\\','/');}
export async function agregar(ctx:Contexto,relative:string,contenido:string){const file=path.join(ctx.directory,'out',relative);await mkdir(path.dirname(file),{recursive:true});await appendFile(file,contenido,'utf8');}
export const hash=(texto:string)=>createHash('sha256').update(texto,'utf8').digest('hex');
export function estable(value:unknown):string{if(Array.isArray(value))return '['+value.map(estable).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+estable(v)).join(',')+'}';return JSON.stringify(value)??'null';}
export async function maestros(ctx:Contexto){const base=path.join(ctx.directory,'fixtures','reto-03','maestros');return {
 proveedores:z.array(proveedorSchema).parse(await json(path.join(base,'proveedores.json'))),
 centros:z.array(centroSchema).parse(await json(path.join(base,'centros-costo.json'))),
 iva:z.array(z.object({codigo:z.string()})).parse(await json(path.join(base,'indicadores-iva.json'))),
 pagos:z.array(z.object({codigo:z.string()})).parse(await json(path.join(base,'condiciones-pago.json'))),
};}
const col=(v:unknown)=>'"'+String(v).replaceAll('"','""')+'"';
export async function control(ctx:Contexto,id:string,resultado:string,v:Validacion,numero=''){
 if(await opcional(path.join(ctx.directory,'out/control.csv'))===null)await agregar(ctx,'control.csv','solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n');
 await agregar(ctx,'control.csv',[id,resultado,numero,v.retroactiva,JSON.stringify(v.bloqueos),JSON.stringify(v.confirmaciones),new Date().toISOString()].map(col).join(',')+'\n');
}
const colas=new Map<string,Promise<unknown>>();
export async function exclusivo<T>(key:string,fn:()=>Promise<T>):Promise<T>{const anterior=colas.get(key)??Promise.resolve();const actual=anterior.catch(()=>{}).then(fn);colas.set(key,actual);try{return await actual;}finally{if(colas.get(key)===actual)colas.delete(key);}}
