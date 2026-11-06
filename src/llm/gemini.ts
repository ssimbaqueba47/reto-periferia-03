import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { claveDisponible, claveGemini, config } from '../config.js';
import { ErrorProveedor, type LlmAdapter, type Mensaje, type Declaracion } from './adapter.js';

export function contenidoGemini(m: Mensaje): Content {
  if (m.native) return m.native as Content;
  // Una ejecución iniciada por el backend no tiene FunctionCall firmado por Gemini.
  // Se incorpora como contexto explícito, nunca como una llamada de modelo falsificada.
  if (m.origin === 'backend') return { role: 'user', parts: [{ text: 'Resultado verificado de herramientas ejecutadas por el backend tras autorización humana: ' + JSON.stringify(m.results) }] };
  const parts: Part[] = [];
  if (m.text) parts.push({ text: m.text });
  for (const call of m.calls ?? []) parts.push({ functionCall: call });
  for (const result of m.results ?? []) parts.push({ functionResponse: result });
  return { role: m.role === 'assistant' ? 'model' : 'user', parts };
}

export class GeminiAdapter implements LlmAdapter {
  readonly provider = 'google-gemini';
  readonly model: string;
  private readonly client?: GoogleGenAI;
  constructor(model = config.GEMINI_MODEL, private readonly timeout = config.GEMINI_TIMEOUT_MS) {
    this.model = model;
    if (claveDisponible()) this.client = new GoogleGenAI({ apiKey: claveGemini(), httpOptions: { timeout, retryOptions: { attempts: 1 } } });
  }
  async enviar(mensajes: Mensaje[], herramientas: Declaracion[], system: string, maxOutputTokens: number) {
    if (!this.client) throw new ErrorProveedor('configuracion');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const r = await this.client.models.generateContent({
        model: this.model,
        contents: mensajes.map(contenidoGemini),
        config: { systemInstruction: system, maxOutputTokens, temperature: 0,
          abortSignal: controller.signal, tools: [{ functionDeclarations: herramientas }] },
      });
      const content = r.candidates?.[0]?.content;
      if (!content?.parts?.length) throw new ErrorProveedor('proveedor');
      const calls = content.parts.flatMap(p => p.functionCall?.name ? [{ name: p.functionCall.name, args: p.functionCall.args ?? {}, id: p.functionCall.id }] : []);
      const text = content.parts.filter(p => !p.thought).map(p => p.text ?? '').join('');
      return { message: { role: 'assistant' as const, text, calls, native: content }, tokens: r.usageMetadata?.totalTokenCount ?? 0 };
    } catch (e) {
      if (e instanceof ErrorProveedor) throw e;
      const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 0;
      if (controller.signal.aborted) throw new ErrorProveedor('timeout');
      if (status === 429) throw new ErrorProveedor('cuota');
      if ([400, 401, 403, 404].includes(status)) throw new ErrorProveedor('configuracion');
      throw new ErrorProveedor('proveedor');
    } finally { clearTimeout(timer); }
  }
}
