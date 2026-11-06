import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { claveDisponible, claveGemini } from '../src/config.js';

async function main() {
  if (!claveDisponible()) { console.log('Clave no configurada: no se puede contrastar filtración literal.'); return; }
  const secreto = Buffer.from(claveGemini(), 'utf8');
  let revisados = 0; let filtraciones = 0;
  async function recorrer(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.env'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await recorrer(file);
      else if (entry.isFile()) { revisados++; if ((await readFile(file)).includes(secreto)) filtraciones++; }
    }
  }
  await recorrer(process.cwd());
  console.log(JSON.stringify({ archivosRevisados: revisados, filtraciones, claveMostrada: false }));
  if (filtraciones) process.exitCode = 1;
}
main().catch(() => { console.error('No se pudo completar la comprobación de secretos.'); process.exitCode = 1; });
