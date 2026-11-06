import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, claveDisponible, ocultarSecretos } from './config.js';
import { Agente, chatSchema } from './agent/agent.js';
import { GeminiAdapter } from './llm/gemini.js';

async function cuerpo(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk as Uint8Array);
    size += b.length;
    if (size > 20000) throw new Error('Cuerpo demasiado grande.');
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(ocultarSecretos(JSON.stringify(value)));
}
export function crearServidor(agent: Agente, root: string, model = config.GEMINI_MODEL) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, provider: 'google-gemini', model, configured: claveDisponible() });
      const session = url.pathname.match(/^\/api\/sessions\/([\w-]{1,80})$/);
      if (req.method === 'GET' && session) {
        const historial = agent.historial(session[1]!);
        return json(res, historial ? 200 : 404, historial ?? { error: 'Sesión no encontrada.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Origen no permitido.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Usa application/json.' });
        let input: unknown;
        try { input = await cuerpo(req); } catch { return json(res, 400, { error: 'JSON inválido o mensaje demasiado grande.' }); }
        const parsed = chatSchema.safeParse(input);
        if (!parsed.success) return json(res, 400, { error: 'Se requieren sessionId válido y message de 1 a 4000 caracteres.' });
        return json(res, 200, await agent.chat(parsed.data));
      }
      const staticFiles: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
      };
      const asset = staticFiles[url.pathname];
      if (req.method === 'GET' && asset) {
        const contenido = await readFile(path.join(root, 'web', asset[0]));
        res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(contenido);
      }
      json(res, 404, { error: 'Recurso no encontrado.' });
    } catch { json(res, 503, { error: 'No se pudo completar la operación. Intenta de nuevo.' }); }
  });
}
async function main() {
  const root = process.cwd();
  const agent = await Agente.crear(new GeminiAdapter(), { directory: root });
  const server = crearServidor(agent, root);
  const marker = path.join(root, 'out/.servidor-activo');
  await mkdir(path.dirname(marker), { recursive: true });
  server.on('error', () => { console.error('No se pudo iniciar el servidor. Revisa el puerto configurado.'); process.exitCode = 1; });
  server.listen(config.PORT, config.HOST, () => {
    void writeFile(marker, String(process.pid));
    console.log(`Órdenes de compra: ${config.HOST}:${config.PORT} | ${config.GEMINI_MODEL} | clave disponible: ${claveDisponible()}`);
  });
  const cerrar = () => server.close(() => { void unlink(marker).catch(() => {}).finally(() => process.exit()); });
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('No se pudo iniciar la aplicación. Revisa la configuración del backend.'); process.exitCode = 1; });
}
