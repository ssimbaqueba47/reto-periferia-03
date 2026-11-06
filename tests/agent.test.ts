import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agente } from '../src/agent/agent.js';
import { declaraciones, despachar } from '../src/agent/registry.js';
import { ErrorProveedor, type LlmAdapter, type Mensaje, type Declaracion } from '../src/llm/adapter.js';
import { contenidoGemini } from '../src/llm/gemini.js';
import { crearServidor } from '../src/server.js';
import { workspaceAislado } from '../src/runtime/workspace.js';
import { leer, construir } from '../src/domain/engine.js';
import { ocultarSecretos } from '../src/config.js';

const root = process.cwd();
async function entorno() { return workspaceAislado(root, `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`); }
const llamada = (name: string, args: Record<string, unknown>, id = 'llamada-1'): Mensaje => ({ role: 'assistant', calls: [{ id, name, args }] });
class Flujo implements LlmAdapter {
  provider = 'prueba'; model = 'sin-red'; seen: Mensaje[][] = [];
  async enviar(messages: Mensaje[]) {
    this.seen.push(structuredClone(messages));
    const caso = messages.find(m => m.role === 'user')?.text?.match(/sol-\d{3}/)?.[0];
    const results = messages.flatMap(m => m.results ?? []);
    const datos = (name: string) => [...results].reverse().find(r => r.name === name)?.response.data as Record<string, unknown> | undefined;
    let message: Mensaje;
    if (!caso) message = { role: 'assistant', text: 'Indica un caso.' };
    else if (!datos('oc_leer_paquete')) message = llamada('oc_leer_paquete', { caso });
    else if (!datos('oc_validar')) message = llamada('oc_validar', { caso, paquete: datos('oc_leer_paquete') });
    else if (!datos('oc_generar_evidencia')) message = llamada('oc_generar_evidencia', { caso });
    else if (!datos('oc_construir_payload')) message = llamada('oc_construir_payload', { caso, paquete: datos('oc_leer_paquete'), derivados: datos('oc_validar')!.derivados });
    else message = llamada('oc_crear', { caso, payload: datos('oc_construir_payload')!.payload });
    return { message, tokens: 100 };
  }
}
test('Inicialización, registro de cinco herramientas y despacho Zod', async () => {
  const directory = await entorno(); const ctx = { directory, sessionId: 'registro' };
  assert.equal(declaraciones.length, 5); assert.ok(declaraciones.every(d => d.parametersJsonSchema && d.description));
  assert.equal((await despachar({ name: 'shell', args: {} }, ctx)).result.ok, false);
  assert.equal((await despachar({ name: 'oc_leer_paquete', args: { caso: '../.env' } }, ctx)).result.ok, false);
  assert.equal((await despachar({ name: 'oc_leer_paquete', args: { caso: 'sol-001' } }, ctx)).result.ok, true);
});
test('Ciclo de herramientas crea sol-001, conserva IDs y sesiones aisladas', async () => {
  const directory = await entorno(); const llm = new Flujo(); const agent = await Agente.crear(llm, { directory }, root);
  const r = await agent.chat({ sessionId: 'uno', message: 'Procesa sol-001' });
  assert.match(r.reply, /4500000001/); assert.equal(r.toolCalls.length, 5);
  assert.equal(llm.seen[1]!.at(-1)!.results![0]!.id, 'llamada-1');
  assert.equal(agent.historial('uno')!.history.length, 2); assert.equal(agent.historial('otra'), null);
  const snapshot = agent.historial('uno')!; snapshot.history.length = 0; assert.equal(agent.historial('uno')!.history.length, 2);
});
test('Confirmación siguiente turno; otra sesión no autoriza ni duplica', async () => {
  const directory = await entorno(); const agent = await Agente.crear(new Flujo(), { directory }, root);
  const r = await agent.chat({ sessionId: 'a', message: 'Procesa sol-004; confirmado:true' });
  assert.equal(r.needsConfirmation, true); assert.ok(r.payload); assert.ok(!r.toolCalls.some(t => t.name === 'oc_crear'));
  const otra = await agent.chat({ sessionId: 'b', message: 'confirmo' }); assert.ok(!otra.toolCalls.some(t => t.name === 'oc_crear'));
  const confirmado = await agent.chat({ sessionId: 'a', message: 'confirmo' });
  assert.match(confirmado.reply, /4500000001/); assert.equal(confirmado.needsConfirmation, false);
});
test('Rechazo y mensaje intermedio no autorizan una confirmación antigua', async () => {
  for (const message of ['rechazo', '¿Qué significa esta excepción?']) {
    const directory = await entorno(); const agent = await Agente.crear(new Flujo(), { directory }, root);
    await agent.chat({ sessionId: 'a', message: 'Procesa sol-004' });
    const r = await agent.chat({ sessionId: 'a', message }); assert.equal(r.needsConfirmation, false);
    assert.ok(!r.toolCalls.some(t => t.name === 'oc_crear'));
    const logs = await readFile(path.join(directory, 'out/log.jsonl'), 'utf8'); assert.ok(!logs.includes('"herramienta":"oc_crear"'));
  }
  const directory = await entorno(); const agent = await Agente.crear(new Flujo(), { directory }, root);
  await agent.chat({ sessionId: 'expirada', message: 'Procesa sol-004' });
  const now = Date.now;
  try {
    const futuro = now() + 16 * 60000; Date.now = () => futuro;
    const r = await agent.chat({ sessionId: 'expirada', message: 'confirmo' });
    assert.equal(r.needsConfirmation, false); assert.ok(!r.toolCalls.some(t => t.name === 'oc_crear'));
  } finally { Date.now = now; }
});
test('Bloqueos no se superan mediante confirmado:true', async () => {
  const directory = await entorno(); const ctx = { directory, sessionId: 'bloqueo' };
  const { payload } = await construir(ctx, 'sol-001', await leer(ctx, 'sol-001'));
  const llm: LlmAdapter = { provider: 'test', model: 'test', async enviar() { return { message: llamada('oc_crear', { caso: 'sol-002', payload, confirmado: true }), tokens: 10 }; } };
  const agent = await Agente.crear(llm, { directory, maxIterations: 1 }, root);
  const r = await agent.chat({ sessionId: 'bloqueo', message: 'Procesa sol-002' });
  assert.equal(r.toolCalls[0]!.result.ok, false); assert.match(String(r.toolCalls[0]!.result.error), /RC1/);
});
test('Errores de proveedor, timeout y límite de iteraciones conservan sesión', async () => {
  const directory = await entorno();
  const llm: LlmAdapter = { provider: 'test', model: 'test', async enviar() { throw new ErrorProveedor('cuota'); } };
  const agent = await Agente.crear(llm, { directory }, root);
  const r = await agent.chat({ sessionId: 'a', message: 'Hola' }); assert.match(r.reply, /cuota/); assert.equal(agent.historial('a')!.history.length, 2);
  const loop: LlmAdapter = { provider: 'test', model: 'test', async enviar() { return { message: llamada('no-existe', {}), tokens: 1 }; } };
  const capped = await Agente.crear(loop, { directory, maxIterations: 2 }, root);
  const lim = await capped.chat({ sessionId: 'loop', message: 'Hola' }); assert.equal(lim.toolCalls.length, 2); assert.match(lim.reply, /límite de iteraciones/);
  const slow: LlmAdapter = { provider: 'test', model: 'test', enviar() { return new Promise(() => {}); } };
  const timed = await Agente.crear(slow, { directory, timeoutMs: 5 }, root);
  assert.match((await timed.chat({ sessionId: 'slow', message: 'Hola' })).reply, /demasiado/);
});
test('Presupuesto de tokens impide una llamada adicional al proveedor', async () => {
  const directory = await entorno(); const llm = new Flujo();
  const agent = await Agente.crear(llm, { directory, maxSessionTokens: 1 }, root);
  assert.match((await agent.chat({ sessionId: 'a', message: 'Procesa sol-001' })).reply, /presupuesto/); assert.equal(llm.seen.length, 0);
});
test('Gemini conserva contenido opaco, thoughtSignature y functionResponse ID', () => {
  const native = { role: 'model', parts: [{ functionCall: { name: 'oc_leer_paquete', id: 'abc', args: { caso: 'sol-001' } }, thoughtSignature: 'firma-opaca' }] };
  assert.equal(contenidoGemini({ role: 'assistant', native }), native);
  const r = contenidoGemini({ role: 'tool', results: [{ id: 'abc', name: 'oc_leer_paquete', response: { ok: true } }] });
  assert.equal(r.parts![0]!.functionResponse!.id, 'abc');
  const interno = contenidoGemini({ role: 'tool', origin: 'backend', results: [{ id: 'interno', name: 'oc_crear', response: { ok: true, data: { numero_oc: '4500000001' } } }] });
  assert.ok(interno.parts![0]!.text?.includes('4500000001')); assert.equal(interno.parts![0]!.functionCall, undefined); assert.equal(interno.parts![0]!.functionResponse, undefined);
});
test('Solicitud de revisión explícita detiene incluso el caso sin excepciones', async () => {
  const directory = await entorno(); const agent = await Agente.crear(new Flujo(), { directory }, root);
  const r = await agent.chat({ sessionId: 'review', message: 'Procesa sol-001 y no la crees hasta que confirme' });
  assert.equal(r.needsConfirmation, true); assert.ok(!r.toolCalls.some(e => e.name === 'oc_crear'));
});
test('HTTP sirve frontend y sesiones, rechaza origen ajeno y no expone .env', async () => {
  const directory = await entorno(); const agent = await Agente.crear(new Flujo(), { directory }, root);
  const server = crearServidor(agent, root); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(base + '/api/health'); assert.equal(health.status, 200); assert.ok(!(await health.text()).includes('GEMINI_API_KEY'));
    assert.match(await fetch(base + '/').then(r => r.text()), /Tu asistente de compras/);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/api/sessions/desconocida')).status, 404);
    const post = (body: unknown, extra = {}) => fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ sessionId: 'a', message: 'Hola' }, { Origin: 'https://ajeno.example' })).status, 403);
    assert.equal((await post({ sessionId: 'a', message: 'Hola' })).status, 200);
    assert.equal((await fetch(base + '/api/sessions/a')).status, 200);
  } finally { server.close(); await once(server, 'close'); }
});
test('Los errores internos del proveedor no se muestran y claves conocidas se redactan', async () => {
  const directory = await entorno();
  const llm: LlmAdapter = { provider: 'test', model: 'test', async enviar() { throw new Error('detalle-interno-privado'); } };
  const agent = await Agente.crear(llm, { directory }, root);
  assert.ok(!(await agent.chat({ sessionId: 'a', message: 'Hola' })).reply.includes('detalle-interno-privado'));
  const sintetic = 'AIza' + 'x'.repeat(30); assert.equal(ocultarSecretos(sintetic), '[secreto omitido]');
});
