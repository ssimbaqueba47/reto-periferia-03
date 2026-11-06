import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config, ocultarSecretos } from '../config.js';
import { exclusivo } from '../domain/files.js';
import { ordenSchema, type OrdenCompra, type Contexto, type Validacion } from '../domain/schemas.js';
import { prepararConfirmacion, confirmarDesdeUsuario } from '../security/confirmaciones.js';
import { ErrorProveedor, type LlmAdapter, type Mensaje, type Llamada } from '../llm/adapter.js';
import { declaraciones, despachar, rechazo, type EventoHerramienta } from './registry.js';

export const chatSchema = z.object({ sessionId: z.string().regex(/^[\w-]{1,80}$/), message: z.string().trim().min(1).max(4000) }).strict();
type Pendiente = { caso: string; payload: OrdenCompra; id: string };
type Entrada = { role: 'user' | 'assistant'; text: string; toolCalls?: EventoHerramienta[]; needsConfirmation?: boolean; payload?: OrdenCompra };
type Sesion = { messages: Mensaje[]; history: Entrada[]; pending?: Pendiente; tokens: number; updated: number; review: boolean };
export type OpcionesAgente = { directory: string; maxIterations?: number; maxSessionTokens?: number; maxTotalTokens?: number; maxOutputTokens?: number; timeoutMs?: number };

export class Agente {
  private readonly sessions = new Map<string, Sesion>();
  private totalTokens = 0;
  private constructor(private readonly llm: LlmAdapter, private readonly options: OpcionesAgente, private readonly system: string) {}
  static async crear(llm: LlmAdapter, options: OpcionesAgente, sourceDirectory = options.directory) {
    const [prompt, knowledge] = await Promise.all([
      readFile(path.join(sourceDirectory, 'agent/prompt.md'), 'utf8'),
      readFile(path.join(sourceDirectory, 'src/knowledge/ordenes-compra.md'), 'utf8'),
    ]);
    return new Agente(llm, options, `${prompt}\n\nConocimiento del proceso:\n${knowledge}`);
  }
  private session(id: string) {
    for (const [key, value] of this.sessions) if (Date.now() - value.updated > 2 * 60 * 60_000) this.sessions.delete(key);
    let s = this.sessions.get(id);
    if (!s) {
      if (this.sessions.size >= 100) throw new Error('Se alcanzó el límite de sesiones. Intenta más tarde.');
      s = { messages: [], history: [], tokens: 0, updated: Date.now(), review: false };
      this.sessions.set(id, s);
    }
    s.updated = Date.now();
    return s;
  }
  historial(id: string) {
    const s = this.sessions.get(id);
    return s ? { sessionId: id, history: structuredClone(s.history), needsConfirmation: Boolean(s.pending), tokens: s.tokens } : null;
  }
  async chat(input: unknown) {
    const parsed = chatSchema.parse(input);
    return exclusivo(`sesion:${this.options.directory}:${parsed.sessionId}`, async () => {
      const s = this.session(parsed.sessionId);
      if (s.history.length >= 100) return { reply: 'La sesión alcanzó su límite de mensajes. Inicia una sesión nueva.', toolCalls: [], needsConfirmation: Boolean(s.pending), payload: undefined };
      const ctx: Contexto = { directory: this.options.directory, sessionId: ocultarSecretos(parsed.sessionId) };
      const message = ocultarSecretos(parsed.message);
      s.messages.push({ role: 'user', text: message });
      s.history.push({ role: 'user', text: message });
      const events: EventoHerramienta[] = [];
      const finish = (reply: string, payload?: OrdenCompra, guardarMensaje = true) => {
        const safe = ocultarSecretos(reply);
        if (guardarMensaje) s.messages.push({ role: 'assistant', text: safe });
        s.history.push({ role: 'assistant', text: safe, toolCalls: events, needsConfirmation: Boolean(s.pending), payload });
        return { reply: safe, toolCalls: events, needsConfirmation: Boolean(s.pending), payload };
      };
      try {
        if (s.pending) {
          const pending = s.pending;
          if (/^(rechazo|cancelar|cancelo|no)$/i.test(message)) {
            s.pending = undefined;
            return finish('Operación cancelada. No se creó una orden por esta confirmación.');
          }
          if (/^(confirmo|sí, confirmo|si, confirmo)$/i.test(message)) {
            s.pending = undefined;
            s.review = false;
            confirmarDesdeUsuario(ctx, pending.caso, pending.id, pending.payload, message);
            const call: Llamada = { id: randomUUID(), name: 'oc_crear', args: { caso: pending.caso, payload: pending.payload, confirmado: true } };
            const ev = await despachar(call, ctx);
            events.push(ev);
            s.messages.push({ role: 'tool', origin: 'backend', results: [{ id: call.id, name: call.name, response: ev.result }] });
            return finish(this.resultadoCreacion(ev), pending.payload);
          }
          // Solo el turno inmediatamente posterior puede autorizar. Consultas adicionales requieren mostrar de nuevo.
          s.pending = undefined;
          return finish('No recibí una confirmación explícita. No se creó la orden. Vuelve a procesar el caso para revisar y confirmar su payload.');
        }
        s.review = /no\s+(?:la\s+)?cre|hasta\s+que.*confirm|antes.*confirm/i.test(message);
        for (let i = 0; i < Math.min(this.options.maxIterations ?? config.AGENT_MAX_ITERATIONS, 25); i++) {
          const response = await this.consultar(s);
          s.messages.push(response);
          if (!response.calls?.length) {
            if (events.length) return finish('El proceso no terminó. ' + events.map(e => `${e.name}: ${e.summary}`).join('\n'), undefined, false);
            if (/sol-\d{3}/i.test(message)) return finish('El modelo no ejecutó herramientas para este caso. No se creó ninguna orden en este turno. Intenta nuevamente.', undefined, false);
            return finish(response.text || 'Indica el caso que deseas procesar, por ejemplo sol-001.', undefined, false);
          }
          const results = [];
          let terminal: { reply: string; payload?: OrdenCompra } | undefined;
          for (const call of response.calls) {
            let ev: EventoHerramienta;
            if (terminal || s.pending) ev = await rechazo(ctx, call, 'El turno terminó; se requiere intervención humana antes de continuar.');
            else if (call.name === 'oc_crear' && s.review) ev = await rechazo(ctx, call, 'El usuario solicitó revisar y confirmar antes de crear. Construye primero el payload.');
            else ev = await despachar(call, ctx);
            events.push(ev);
            results.push({ id: call.id, name: call.name, response: ev.result });
            if (!ev.result.ok || terminal) continue;
            const d = ev.result.data as Record<string, unknown>;
            if (call.name === 'oc_validar') {
              const v = d as unknown as Validacion;
              if (!v.apta) terminal = { reply: 'Solicitud bloqueada. No se creó la OC.\n' + v.bloqueos.map(b => `${b.codigo}: ${b.detalle} ${b.accion}`).join('\n') };
            }
            if (call.name === 'oc_construir_payload') {
              const payload = ordenSchema.parse(d.payload);
              if (payload.excepciones.length || s.review) {
                const caso = String(call.args.caso);
                s.pending = { caso, payload, id: prepararConfirmacion(ctx, caso, payload) };
                terminal = { reply: this.pregunta(payload), payload };
              }
            }
            if (call.name === 'oc_crear') terminal = { reply: this.resultadoCreacion(ev) };
          }
          s.messages.push({ role: 'tool', results });
          if (terminal) return finish(terminal.reply, terminal.payload);
        }
        return finish('Se alcanzó el límite de iteraciones. Revisa las herramientas ejecutadas: el proceso no terminó en este turno.');
      } catch (e) {
        // Jamás se devuelve el error original del SDK ni excepciones internas.
        return finish(e instanceof ErrorProveedor ? e.message : 'No se pudo completar el turno. No se autorizaron operaciones adicionales. Revisa los resultados y vuelve a procesar el caso.');
      }
    });
  }
  private async consultar(s: Sesion) {
    const output = this.options.maxOutputTokens ?? config.GEMINI_MAX_OUTPUT_TOKENS;
    // Reserva conservadora: bytes de entrada + salida máxima. Incluye firmas opacas del proveedor.
    const reserva = Buffer.byteLength(JSON.stringify(s.messages) + this.system + JSON.stringify(declaraciones), 'utf8') + output;
    const sessionMax = this.options.maxSessionTokens ?? config.AGENT_MAX_SESSION_TOKENS;
    const totalMax = this.options.maxTotalTokens ?? config.AGENT_MAX_TOTAL_TOKENS;
    if (s.tokens + reserva > sessionMax || this.totalTokens + reserva > totalMax) throw new ErrorProveedor('limite');
    s.tokens += reserva;
    this.totalTokens += reserva;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        this.llm.enviar(s.messages, declaraciones, this.system, output),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ErrorProveedor('timeout')), this.options.timeoutMs ?? config.GEMINI_TIMEOUT_MS + 1000); }),
      ]);
      const gastado = r.tokens > 0 ? r.tokens : reserva;
      s.tokens += gastado - reserva;
      this.totalTokens += gastado - reserva;
      return r.message;
    } finally { if (timer) clearTimeout(timer); }
  }
  private pregunta(p: OrdenCompra) {
    const motivos = p.excepciones.map(e => `${e.codigo}: ${e.detalle}`).join('\n');
    const posiciones = p.posiciones.map(pos => `${pos.descripcion}: ${pos.cantidad} ${pos.unidad} × ${pos.precio_unitario} ${p.moneda}`).join('\n');
    return `OC preparada para ${p.proveedor.nombre}.\n${posiciones}\nPago: ${p.condiciones_pago}; IVA: ${p.posiciones.map(pos => pos.indicador_iva).join(', ')}.\n${motivos}\n¿Confirmas crear esta OC con el payload mostrado? Responde «confirmo» o «rechazo» en tu siguiente mensaje.`;
  }
  private resultadoCreacion(e: EventoHerramienta) {
    if (!e.result.ok) return `No se confirmó la creación. ${String(e.result.error)}`;
    const d = e.result.data as Record<string, unknown>;
    return `OC ${d.numero_oc}${d.idempotente ? ' ya existente; no se duplicó' : ' creada en SAP simulado'}. Fecha: ${d.fecha}.\nEvidencia: out/${String(e.args.caso)}/aprobacion.txt.`;
  }
}
