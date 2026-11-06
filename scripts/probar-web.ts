import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Agente } from '../src/agent/agent.js';
import { GeminiAdapter } from '../src/llm/gemini.js';
import { crearServidor } from '../src/server.js';
import { workspaceAislado } from '../src/runtime/workspace.js';

// Comprobación opcional con Chrome/Edge local; no instala un navegador ni depende de Playwright.
class DevTools {
  private id = 0;
  private callbacks = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', ev => {
      const m = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown>; error?: unknown };
      if (!m.id) return;
      const cb = this.callbacks.get(m.id); this.callbacks.delete(m.id);
      if (m.error) cb?.reject(new Error('Falló una operación del navegador.'));
      else cb?.resolve(m.result ?? {});
    });
  }
  static async conectar(url: string) {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => { ws.addEventListener('open', () => resolve(), { once: true }); ws.addEventListener('error', () => reject(new Error('No se pudo conectar al navegador.')), { once: true }); });
    return new DevTools(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.callbacks.delete(id); reject(new Error('Timeout del navegador.')); }, 15000);
      this.callbacks.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() { this.socket.close(); }
}
const pausa = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  assert.ok(typeof WebSocket !== 'undefined', 'Esta comprobación opcional requiere Node con WebSocket global (22+).');
  let executable: string | undefined;
  for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
    try { await access(p); executable = p; break; } catch { /* Probar siguiente navegador. */ }
  }
  assert.ok(executable, 'No se encontró Chrome o Edge local.');
  const root = process.cwd(); const directory = await workspaceAislado(root, `browser-${Date.now()}`);
  const agent = await Agente.crear(new GeminiAdapter(), { directory, maxSessionTokens: 500000 }, root);
  const server = crearServidor(agent, root); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
  const profile = path.join(directory, 'perfil-navegador');
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let dev: DevTools | undefined;
  try {
    let endpoint = '';
    for (let i = 0; i < 100; i++) {
      try { const [port, resource] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); endpoint = `ws://127.0.0.1:${port}${resource}`; break; } catch { await pausa(100); }
    }
    assert.ok(endpoint, 'El navegador no inició DevTools.'); dev = await DevTools.conectar(endpoint);
    const target = await dev.send('Target.createTarget', { url: 'about:blank' });
    const attached = await dev.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const session = String(attached.sessionId);
    const send = (method: string, params: Record<string, unknown> = {}) => dev!.send(method, params, session);
    const evaluar = async (expression: string) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('Error JavaScript en el frontend.');
      return (result.result as { value?: unknown })?.value;
    };
    const esperar = async (expression: string, timeout = 90000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) { if (await evaluar(expression)) return; await pausa(250); }
      throw new Error('El frontend no alcanzó el estado esperado.');
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await esperar('document.readyState === "complete" && document.querySelectorAll(".case").length === 6', 15000);
    await mkdir('out/verificacion', { recursive: true });
    const screenshot = async (file: string) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(`out/verificacion/${file}`, Buffer.from(String(r.data), 'base64')); };
    await screenshot('chat-escritorio.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluar('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Desbordamiento horizontal móvil.');
    await screenshot('chat-movil.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluar('document.querySelector(".quick-actions [data-case=sol-004]").click()');
    await esperar('document.querySelector("#confirmation").hidden === false');
    assert.equal(await evaluar('document.querySelectorAll(".tool").length >= 4'), true);
    assert.equal(await evaluar('document.querySelector(".payload table") !== null'), true);
    await screenshot('chat-confirmacion.png');
    // Click del conductor de pruebas, equivalente a mensaje humano independiente; no generado por el modelo.
    await evaluar('document.querySelector("#confirm").click()');
    await esperar('document.querySelector("#messages").textContent.includes("creada en SAP simulado")');
    assert.equal(await evaluar('document.querySelector("#confirmation").hidden'), true);
    await screenshot('chat-creada.png');
    await send('Page.reload');
    await esperar('document.querySelector("#messages")?.textContent.includes("creada en SAP simulado")');
    await writeFile('out/verificacion/navegador.json', JSON.stringify({ ok: true, modelo: new GeminiAdapter().model, resoluciones: ['1440x1000', '390x844'], confirmado: true, historialRecuperado: true, directory: path.relative(root, directory) }, null, 2));
    console.log('NAVEGADOR OK: escritorio, móvil sin desbordamiento, herramientas, payload, confirmación real entre turnos, OC creada e historial tras recarga.');
  } finally {
    dev?.close(); browser.kill(); server.close(); await once(server, 'close');
  }
}
main().catch(() => { console.error('La verificación del navegador no pasó. No se muestran errores internos.'); process.exitCode = 1; });
