const $ = (id) => document.getElementById(id);
let sessionId = localStorage.getItem('oc-session') || crypto.randomUUID();
localStorage.setItem('oc-session', sessionId);
let busy = false;
const labels = ['Flujo normal', 'Proveedor', 'Autorización', 'Diferencia de valores', 'Retroactividad', 'IVA y pago'];
labels.forEach((label, i) => {
  const caso = `sol-00${i + 1}`;
  const b = document.createElement('button'); b.className = 'case'; b.dataset.case = caso;
  b.textContent = `▤  ${caso} `;
  const s = document.createElement('span'); s.textContent = label; b.append(s); $('cases').append(b);
});
function element(tag, text, className) {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e;
}
function payloadView(payload) {
  const box = element('div', undefined, 'payload'); box.append(element('h3', `Vista previa · ${payload.referencia.solicitud_id}`));
  const table = element('table'); const header = element('tr');
  ['Descripción', 'Cantidad', 'Precio unitario', 'Centro', 'IVA'].forEach(t => header.append(element('th', t))); table.append(header);
  payload.posiciones.forEach(p => {
    const row = element('tr');
    [p.descripcion, `${p.cantidad} ${p.unidad}`, `${new Intl.NumberFormat('es-CO').format(p.precio_unitario)} ${payload.moneda}`, `${p.centro_costo} / ${p.subarea}`, p.indicador_iva].forEach(v => row.append(element('td', v))); table.append(row);
  });
  box.append(table); const full = element('details'); full.append(element('summary', 'Ver payload completo'), element('pre', JSON.stringify(payload, null, 2))); box.append(full); return box;
}
function render(entry) {
  $('welcome').hidden = true;
  const row = element('article', undefined, `bubble ${entry.role}`);
  if (entry.role === 'assistant') row.append(element('div', '◈', 'avatar'));
  const content = element('div', undefined, 'message-content');
  if (entry.role === 'assistant') content.append(element('div', 'Asistente de compras', 'message-label'));
  const tools = element('div', undefined, 'tools');
  for (const call of entry.toolCalls || []) {
    const detail = element('details', undefined, `tool ${call.result.ok ? '' : 'error-tool'}`);
    detail.append(element('summary', `${call.result.ok ? '✓' : '!'} ${call.name} · ${call.summary}`));
    detail.append(element('pre', JSON.stringify({ argumentos: call.args, resultado: call.result }, null, 2))); tools.append(detail);
  }
  content.append(tools, element('div', entry.text, 'message-text'));
  if (entry.payload) content.append(payloadView(entry.payload));
  row.append(content); $('messages').append(row); row.scrollIntoView({ block: 'end' });
}
function setBusy(value) {
  busy = value; $('processing').hidden = !value;
  document.querySelectorAll('button').forEach(b => { b.disabled = value; }); $('message').disabled = value;
}
async function send(message) {
  if (busy || !message.trim()) return;
  render({ role: 'user', text: message }); $('message').value = ''; $('error').hidden = true; $('confirmation').hidden = true; setBusy(true);
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'No se pudo enviar el mensaje.');
    render({ role: 'assistant', text: data.reply, toolCalls: data.toolCalls, payload: data.payload });
    $('confirmation').hidden = !data.needsConfirmation;
  } catch (e) {
    $('error').textContent = e instanceof Error ? e.message : 'Se perdió la conexión. El historial se conserva.'; $('error').hidden = false;
  } finally { setBusy(false); $('message').focus(); }
}
$('composer').addEventListener('submit', e => { e.preventDefault(); void send($('message').value); });
$('message').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
document.addEventListener('click', e => { const b = e.target.closest('[data-case]'); if (b) void send(`Procesa la solicitud ${b.dataset.case}`); });
$('confirm').addEventListener('click', () => void send('confirmo'));
$('reject').addEventListener('click', () => void send('rechazo'));
$('new-session').addEventListener('click', () => {
  if (busy) return; sessionId = crypto.randomUUID(); localStorage.setItem('oc-session', sessionId); $('messages').replaceChildren(); $('welcome').hidden = false; $('confirmation').hidden = true; $('error').hidden = true; $('message').value = '';
});
async function init() {
  try {
    const health = await fetch('/api/health').then(r => r.json());
    $('connection').textContent = health.configured ? '● Gemini configurado' : 'Clave no configurada';
    if (health.configured) $('connection').classList.add('ready');
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (res.ok) { const data = await res.json(); data.history.forEach(render); $('confirmation').hidden = !data.needsConfirmation; }
  } catch { $('connection').textContent = 'Sin conexión'; }
}
void init();
