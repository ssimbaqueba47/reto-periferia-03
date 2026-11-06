import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { Agente } from '../src/agent/agent.js';
import { GeminiAdapter } from '../src/llm/gemini.js';
import { crearServidor } from '../src/server.js';
import { workspaceAislado } from '../src/runtime/workspace.js';
import { claveDisponible, config } from '../src/config.js';

async function main() {
  assert.ok(claveDisponible(), 'Falta clave en el backend.');
  const root = process.cwd();
  const directory = await workspaceAislado(root, `gemini-${Date.now()}`);
  const agente = await Agente.crear(new GeminiAdapter(), { directory, maxSessionTokens: 500000, maxTotalTokens: 1500000 }, root);
  const server = crearServidor(agente, root);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const resultados: unknown[] = [];
  try {
    for (const ruta of ['/', '/app.js', '/style.css', '/api/health']) assert.equal((await fetch(base + ruta)).status, 200);
    assert.equal((await fetch(base + '/.env')).status, 404);
    const chat = async (sessionId: string, message: string) => {
      const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message }) });
      assert.equal(response.status, 200);
      const data = await response.json() as Awaited<ReturnType<Agente['chat']>>;
      console.log(JSON.stringify({ sessionId, reply: data.reply, herramientas: data.toolCalls.map(e => ({ name: e.name, summary: e.summary })), needsConfirmation: data.needsConfirmation }));
      resultados.push(data); return data;
    };
    const normal = await chat('real-normal', 'Procesa la solicitud sol-001');
    assert.ok(normal.toolCalls.some(e => e.name === 'oc_crear' && e.result.ok), 'sol-001 no creó una OC real en el simulador.');
    const bloqueado = await chat('real-bloqueo', 'Procesa la solicitud sol-002');
    assert.match(bloqueado.reply, /RC1/);
    assert.ok(!bloqueado.toolCalls.some(e => e.name === 'oc_crear' && e.result.ok));
    const pendiente = await chat('real-confirmacion', 'Procesa la solicitud sol-004 y muéstrame el payload antes de crearla.');
    assert.equal(pendiente.needsConfirmation, true);
    assert.ok(!pendiente.toolCalls.some(e => e.name === 'oc_crear' && e.result.ok));
    // Entrada humana simulada del conductor de prueba; no es texto generado por Gemini.
    const confirmado = await chat('real-confirmacion', 'confirmo');
    assert.ok(confirmado.toolCalls.some(e => e.name === 'oc_crear' && e.result.ok));
    const seguimiento = await chat('real-confirmacion', 'Resume la última OC registrada usando el historial. No ejecutes herramientas ni crees otra orden.');
    assert.ok(!seguimiento.toolCalls.some(e => e.name === 'oc_crear' && e.result.ok));
    assert.match(seguimiento.reply, /4500000002/);
    assert.equal((await fetch(base + '/api/sessions/real-confirmacion')).status, 200);
    const ordenes = (await readFile(path.join(directory, 'out/sap/ordenes.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l) as { orden: { referencia: { solicitud_id: string } } });
    assert.deepEqual(ordenes.map(r => r.orden.referencia.solicitud_id), ['SOL-2026-001', 'SOL-2026-004']);
    await mkdir('out/verificacion', { recursive: true });
    await writeFile('out/verificacion/prueba-real.json', JSON.stringify({ modelo: config.GEMINI_MODEL, directory: path.relative(root, directory), resultados, ok: true }, null, 2));
    console.log('PRUEBA REAL OK: API HTTP, Gemini, herramientas reales, bloqueo y confirmación entre turnos.');
  } finally { server.close(); await once(server, 'close'); }
}
main().catch(() => { console.error('La prueba real no pasó. Revisar la respuesta resumida anterior o cuota/conectividad. No se muestran errores internos.'); process.exitCode = 1; });
