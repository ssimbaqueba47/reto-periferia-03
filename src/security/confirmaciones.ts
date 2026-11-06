import { randomUUID } from 'node:crypto';
import { estable, hash } from '../domain/files.js';
import type { Contexto, OrdenCompra } from '../domain/schemas.js';

// Backend-only: no se registra como herramienta ni se acepta desde argumentos del modelo.
type Pendiente={id:string;digest:string;autorizada:boolean;creada:number;confirmadoPor:string|null};
const pendientes=new Map<string,Pendiente>();
const clave=(ctx:Contexto,caso:string)=>estable([ctx.directory,ctx.sessionId,caso]);
export function prepararConfirmacion(ctx:Contexto,caso:string,payload:OrdenCompra){
 const k=clave(ctx,caso);const digest=hash(estable(payload));const anterior=pendientes.get(k);
 if(anterior?.digest===digest&&Date.now()-anterior.creada<15*60_000)return anterior.id;
 const id=randomUUID();pendientes.set(k,{id,digest,autorizada:false,creada:Date.now(),confirmadoPor:null});return id;
}
export function confirmarDesdeUsuario(ctx:Contexto,caso:string,id:string,payload:OrdenCompra,mensaje:string){
 const p=pendientes.get(clave(ctx,caso));
 if(!p||p.id!==id||p.digest!==hash(estable(payload))||Date.now()-p.creada>=15*60_000)throw new Error('Confirmación inexistente, vencida o no corresponde a sesión, caso y payload.');
 if(!/^(confirmo|sí, confirmo|si, confirmo)$/i.test(mensaje.trim()))throw new Error('Se requiere confirmación humana explícita.');
 p.autorizada=true;p.confirmadoPor=`sesion:${ctx.sessionId}`;
}
export function autorizacion(ctx:Contexto,caso:string,payload:OrdenCompra){const p=pendientes.get(clave(ctx,caso));return p?.autorizada&&p.digest===hash(estable(payload))&&Date.now()-p.creada<15*60_000?p.confirmadoPor:null;}
