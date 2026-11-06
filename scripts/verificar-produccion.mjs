import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

const root = process.cwd();
const pausa = ms => new Promise(r => setTimeout(r, ms));
async function run() {
  const dir = path.join(root, 'out/ejecuciones', `produccion-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  // Solo los archivos necesarios para distribuir. Nunca copia .env ni datos del chat.
  for (const file of ['package.json', 'package-lock.json', 'out/build', 'fixtures', 'web', 'agent', 'src/knowledge']) {
    await cp(path.join(root, file), path.join(dir, file), { recursive: true });
  }
  const installer = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000'], { cwd: dir, stdio: 'ignore', windowsHide: true })
    : spawn('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=15000'], { cwd: dir, stdio: 'ignore' });
  const [code] = await once(installer, 'exit');
  assert.equal(code, 0, 'Falló npm ci --omit=dev en workspace aislado.');
  for (const file of ['node_modules/tsx', 'node_modules/typescript', '.env']) {
    let existe = true; try { await access(path.join(dir, file)); } catch { existe = false; }
    assert.equal(existe, false, `No debe existir ${file} en la instalación de producción.`);
  }
  const oc = await import(pathToFileURL(path.join(dir, 'out/build/tools/oc.js')).href);
  const security = await import(pathToFileURL(path.join(dir, 'out/build/security/confirmaciones.js')).href);
  const ctx = { directory: dir, sessionId: 'produccion' };
  const parse = raw => JSON.parse(raw);
  const ok = raw => { const r = parse(raw); assert.equal(r.ok, true, r.error); return r.data; };
  const preparar = async caso => {
    const paquete = ok(await oc.leer_paquete.execute({ caso }, ctx));
    const validacion = ok(await oc.validar.execute({ caso, paquete }, ctx));
    const construido = validacion.apta ? ok(await oc.construir_payload.execute({ caso, paquete, derivados: validacion.derivados }, ctx)) : null;
    return { validacion, construido };
  };
  const normal = await preparar('sol-001');
  const created = ok(await oc.crear.execute({ caso: 'sol-001', payload: normal.construido.payload }, ctx));
  const repeated = ok(await oc.crear.execute({ caso: 'sol-001', payload: normal.construido.payload }, ctx));
  assert.equal(created.numero_oc, '4500000001'); assert.equal(repeated.numero_oc, created.numero_oc); assert.equal(repeated.idempotente, true);
  const bloqueado = await preparar('sol-002'); assert.equal(bloqueado.validacion.apta, false);
  assert.equal(parse(await oc.crear.execute({ caso: 'sol-002', payload: normal.construido.payload, confirmado: true }, ctx)).ok, false);
  const pendiente = await preparar('sol-004');
  assert.ok(pendiente.validacion.confirmaciones.some(c => c.codigo === 'RC5'));
  assert.equal(parse(await oc.crear.execute({ caso: 'sol-004', payload: pendiente.construido.payload, confirmado: true }, ctx)).ok, false);
  const id = security.prepararConfirmacion(ctx, 'sol-004', pendiente.construido.payload);
  security.confirmarDesdeUsuario(ctx, 'sol-004', id, pendiente.construido.payload, 'confirmo');
  assert.equal(ok(await oc.crear.execute({ caso: 'sol-004', payload: pendiente.construido.payload, confirmado: true }, ctx)).numero_oc, '4500000002');
  const sapfile = path.join(dir, 'out/sap/ordenes.jsonl');
  const hash = async () => createHash('sha256').update(await readFile(sapfile)).digest('hex');
  const antes = await hash();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close');
  const env = { ...process.env, NODE_ENV: 'production', HOST: '0.0.0.0', PORT: String(port), GEMINI_API_KEY: '' };
  const start = () => spawn(process.execPath, ['out/build/server.js'], { cwd: dir, env, stdio: 'ignore', windowsHide: true });
  let child = start();
  const base = `http://127.0.0.1:${port}`;
  const ready = async () => {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await pausa(100); }
    throw new Error('El servidor compilado no respondió.');
  };
  const stop = async () => { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; };
  try {
    await ready();
    for (const route of ['/', '/style.css', '/app.js']) assert.equal((await fetch(base + route)).status, 200);
    assert.equal((await fetch(base + '/.env')).status, 404);
    const health = await fetch(base + '/api/health').then(r => r.json()); assert.equal(health.configured, false);
    await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reinicio', message: 'Hola' }) });
    assert.equal((await fetch(base + '/api/sessions/reinicio')).status, 200);
    await stop(); child = start(); await ready();
    assert.equal((await fetch(base + '/api/sessions/reinicio')).status, 404);
    assert.equal(await hash(), antes);
    const despues = ok(await oc.crear.execute({ caso: 'sol-001', payload: normal.construido.payload }, ctx)); assert.equal(despues.idempotente, true);
    await mkdir(path.join(root, 'out/auditoria'), { recursive: true });
    await writeFile(path.join(root, 'out/auditoria/produccion.json'), JSON.stringify({ ok: true, node: process.version, workspace: path.relative(root, dir), instalacion: 'npm ci --omit=dev', inicio: 'node out/build/server.js', host: env.HOST, port, casos: ['sol-001 creación e idempotencia', 'sol-002 bloqueo', 'sol-004 autorización explícita'], reinicio: 'Sesiones perdidas; archivos conservados en disco local. Render efímero puede perder ambos.', geminiRealEnEstaPrueba: false }, null, 2));
    console.log('PRODUCCIÓN OK: sin tsx/TypeScript, PORT del entorno, 0.0.0.0, estáticos, motor compilado e idempotencia; sesiones no sobreviven al reinicio.');
  } finally { if (child.exitCode === null) await stop(); }
}
run().catch(e => { console.error(e instanceof Error ? e.message : 'Falló la verificación de producción.'); process.exitCode = 1; });
