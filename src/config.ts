import { config as cargar } from 'dotenv';
import { z } from 'zod';

// dotenv solo carga el secreto al proceso. Nunca se imprime su resultado.
cargar({ quiet: true });
const positivo = (defecto: number) => z.coerce.number().int().positive().default(defecto);
export const config = z.object({
  GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-3.5-flash-lite'),
  PORT: positivo(3000),
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).default(process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  AGENT_MAX_ITERATIONS: positivo(25),
  AGENT_MAX_SESSION_TOKENS: positivo(200000),
  AGENT_MAX_TOTAL_TOKENS: positivo(1000000),
  GEMINI_TIMEOUT_MS: positivo(45000),
  GEMINI_MAX_OUTPUT_TOKENS: positivo(4096),
}).parse(process.env);

export function claveDisponible() { return Boolean(process.env.GEMINI_API_KEY?.trim()); }
export function claveGemini() {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) throw new Error('Falta GEMINI_API_KEY en el backend.');
  return clave;
}
export function ocultarSecretos(texto: string) {
  const clave = process.env.GEMINI_API_KEY?.trim();
  return (clave ? texto.split(clave).join('[secreto omitido]') : texto)
    .replace(/AIza[\w-]{20,}/g, '[secreto omitido]');
}
