import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// Aísla ejecuciones sin cambiar rutas ni contratos del motor original.
export async function workspaceAislado(root: string, nombre: string, limpiar = false) {
  if (!/^[a-z0-9-]+$/i.test(nombre)) throw new Error('Nombre de ejecución inválido.');
  const base = path.resolve(root, 'out', 'ejecuciones');
  const destino = path.resolve(base, nombre);
  if (path.dirname(destino) !== base) throw new Error('Ruta de ejecución fuera de out/ejecuciones.');
  if (limpiar) await rm(destino, { recursive: true, force: true });
  await mkdir(destino, { recursive: true });
  try { await stat(path.join(destino, 'fixtures')); }
  catch { await cp(path.join(root, 'fixtures'), path.join(destino, 'fixtures'), { recursive: true }); }
  return destino;
}
