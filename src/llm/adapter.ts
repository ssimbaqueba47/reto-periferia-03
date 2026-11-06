export type Llamada = { id?: string; name: string; args: Record<string, unknown> };
export type Resultado = { id?: string; name: string; response: Record<string, unknown> };
export type Mensaje = {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  calls?: Llamada[];
  results?: Resultado[];
  origin?: 'backend';
  // Contenido opaco del proveedor: conserva firmas, partes e identificadores sin contaminar el dominio.
  native?: unknown;
};
export type Declaracion = { name: string; description: string; parametersJsonSchema: unknown };
export type RespuestaModelo = { message: Mensaje; tokens: number };
export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  enviar(mensajes: Mensaje[], herramientas: Declaracion[], system: string, maxOutputTokens: number): Promise<RespuestaModelo>;
}
export class ErrorProveedor extends Error {
  constructor(public readonly codigo: 'cuota' | 'limite' | 'timeout' | 'configuracion' | 'proveedor') {
    super({ cuota: 'Gemini no tiene cuota disponible en este momento. Intenta más tarde o revisa los límites del proyecto.', limite: 'Se alcanzó el presupuesto de tokens configurado para el agente. Revisa los límites del backend antes de continuar.', timeout: 'Gemini tardó demasiado. Puedes volver a intentar; la sesión se conserva.', configuracion: 'Gemini no está configurado o no tiene acceso al modelo. Revisa la configuración del backend.', proveedor: 'No se pudo obtener una respuesta de Gemini. La sesión se conserva.' }[codigo]);
  }
}
