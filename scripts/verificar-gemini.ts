import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { claveDisponible, claveGemini, config } from '../src/config.js';

async function verificar() {
  console.log(JSON.stringify({ claveDisponible: claveDisponible() }));
  if (!claveDisponible()) return;
  const ai = new GoogleGenAI({ apiKey: claveGemini(), httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } } });
  const disponibles: Array<{ nombre: string; acciones: string[] }> = [];
  for await (const modelo of await ai.models.list({ config: { pageSize: 100 } })) {
    disponibles.push({ nombre: modelo.name ?? '', acciones: modelo.supportedActions ?? [] });
  }
  console.log(JSON.stringify({ modelos: disponibles }));
  const candidatos = [...new Set([config.GEMINI_MODEL, 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'])];
  let elegido: string | undefined;
  for (const candidato of candidatos) {
    if (!disponibles.some(m => m.nombre === `models/${candidato}` && m.acciones.includes('generateContent'))) continue;
    try {
      const r = await ai.models.generateContent({ model: candidato, contents: 'Llama a comprobar con estado listo.', config: {
        maxOutputTokens: 256,
        tools: [{ functionDeclarations: [{ name: 'comprobar', description: 'Comprueba el estado de una prueba.', parametersJsonSchema: { type: 'object', properties: { estado: { type: 'string' } }, required: ['estado'] } }] }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['comprobar'] } },
      } });
      if (r.functionCalls?.[0]?.name === 'comprobar') {
        elegido = candidato;
        console.log(JSON.stringify({ modelo: elegido, generateContent: true, functionCalling: true, tokens: r.usageMetadata?.totalTokenCount }));
        break;
      }
    } catch (e) {
      const estado = typeof e === 'object' && e !== null && 'status' in e ? Number(e.status) : null;
      console.log(JSON.stringify({ modelo: candidato, prueba: 'fallida', estado }));
    }
  }
  if (!elegido) throw new Error('No se verificó ningún modelo candidato.');
  // Conserva todos los bytes del archivo salvo la línea GEMINI_MODEL. Nunca muestra ni copia la clave.
  const env = await readFile('.env', 'utf8');
  const actualizado = /^GEMINI_MODEL\s*=/m.test(env)
    ? env.replace(/^GEMINI_MODEL\s*=.*$/m, `GEMINI_MODEL=${elegido}`)
    : env + `${env.endsWith('\n') ? '' : '\n'}GEMINI_MODEL=${elegido}\n`;
  if (actualizado !== env) await writeFile('.env', actualizado, 'utf8');
  await mkdir('out/verificacion', { recursive: true });
  await writeFile('out/verificacion/modelo.json', JSON.stringify({ modelo: elegido, modelos: disponibles, functionCalling: true, nota: 'Acceso y generación verificados. La API no certifica estado de facturación ni saldo de cuota gratuita.' }, null, 2));
}
verificar().catch(() => { console.error('No se pudo completar la comprobación Gemini. Revisar conectividad, permisos o cuota. No se muestran detalles del SDK.'); process.exitCode = 1; });
