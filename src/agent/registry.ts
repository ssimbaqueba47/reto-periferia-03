import { z } from 'zod';
import * as oc from '../tools/oc.js';
import { agregar, exclusivo } from '../domain/files.js';
import { ocultarSecretos } from '../config.js';
import type { Contexto } from '../domain/schemas.js';
import type { Declaracion, Llamada } from '../llm/adapter.js';

const registro = new Map(Object.entries(oc).map(([nombre, herramienta]) => [`oc_${nombre}`, herramienta]));
export const declaraciones: Declaracion[] = [...registro].map(([name, tool]) => {
  const schema = z.toJSONSchema(z.object(tool.args), { target: 'draft-7' });
  delete schema.$schema;
  return { name, description: tool.description, parametersJsonSchema: schema };
});

export type EventoHerramienta = { id?: string; name: string; args: Record<string, unknown>; result: Record<string, unknown>; summary: string };
export function resumen(resultado: Record<string, unknown>) {
  if (!resultado.ok) return 'No ejecutada: ' + String(resultado.error);
  const d = resultado.data as Record<string, unknown> | undefined;
  if (d?.numero_oc) return `OC ${d.numero_oc}${d.idempotente ? ' (ya existente)' : ' creada'}`;
  if (typeof d?.apta === 'boolean') return `Apta: ${d.apta}; bloqueos: ${(d.bloqueos as unknown[]).length}; confirmaciones: ${(d.confirmaciones as unknown[]).length}`;
  if (d?.payload) return 'Payload preparado con trazabilidad';
  if (d?.sha256) return 'Evidencia generada con SHA-256';
  return 'Documentos consultados';
}
export async function rechazo(ctx: Contexto, call: Llamada, error: string): Promise<EventoHerramienta> {
  const result = { ok: false, error };
  await exclusivo(`${ctx.directory}/out/log.jsonl`, () => agregar(ctx, 'log.jsonl', ocultarSecretos(JSON.stringify({ herramienta: call.name, argumentos: call.args, resultado: result, sessionId: ctx.sessionId, ts: new Date().toISOString() })) + '\n'));
  return { ...call, result, summary: resumen(result) };
}
export async function despachar(call: Llamada, ctx: Contexto): Promise<EventoHerramienta> {
  const tool = registro.get(call.name);
  if (!tool) return rechazo(ctx, call, 'Herramienta no permitida.');
  const args = JSON.parse(ocultarSecretos(JSON.stringify(call.args))) as Record<string, unknown>;
  const validado = z.object(tool.args).strict().safeParse(args);
  if (!validado.success) return rechazo(ctx, { ...call, args }, 'Argumentos inválidos: ' + validado.error.issues.map(i => `${i.path.join('.') || 'entrada'}: ${i.code === 'invalid_type' ? 'campo ausente o tipo incorrecto' : 'valor no permitido por el esquema'}`).join('; '));
  const raw = await tool.execute(validado.data, ctx);
  const result = JSON.parse(ocultarSecretos(raw)) as Record<string, unknown>;
  return { ...call, args, result, summary: resumen(result) };
}
