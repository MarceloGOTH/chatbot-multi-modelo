import { responsePolicy, planResponse, type OptimizationMode, type ResponsePlan, type ReasoningStrategy } from './response-policy.ts';
type Message = { role: 'user' | 'assistant'; content: string; model?: string; date: string; outputLimit?: number; truncated?: boolean; optimization?: { mode: OptimizationMode; plan: ResponsePlan }; metrics?: { tokens: number; estimated: boolean; seconds: number; tokensPerSecond: number } };
type Chat = { id: string; title: string; context: string; messages: Message[]; updated: string; summary?: string; compactedThrough?: number };
type Provider = { id: string; name: string; baseUrl: string; model: string; hasKey: boolean; contextWindow?: number; optimization?: OptimizationMode; reasoning?: ReasoningStrategy };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let chats: Chat[] = [], providers: Provider[] = [], token = '';
let activeId = localStorage.getItem('nexo-chat') || '';
let selected = localStorage.getItem('nexo-model') || '';
let sending = false;
const mobileView = matchMedia('(max-width: 760px)');
function closeSidebar(restoreFocus = false) {
  document.body.classList.remove('sidebar-open');
  $('sidebar-backdrop').hidden = true;
  $('menu-button').setAttribute('aria-expanded', 'false');
  document.querySelector('main')!.inert = false;
  $('sidebar').inert = mobileView.matches;
  if (restoreFocus && mobileView.matches) $('menu-button').focus();
}
function openSidebar() {
  document.body.classList.add('sidebar-open');
  $('sidebar').inert = false;
  $('sidebar-backdrop').hidden = false;
  $('menu-button').setAttribute('aria-expanded', 'true');
  document.querySelector('main')!.inert = true;
  $('close-sidebar').focus();
}
$('menu-button').onclick = openSidebar;
$('close-sidebar').onclick = () => closeSidebar(true);
$('sidebar-backdrop').onclick = () => closeSidebar(true);
mobileView.addEventListener('change', () => closeSidebar());
document.addEventListener('keydown', event => {
  if (!document.body.classList.contains('sidebar-open')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeSidebar(true); }
  if (event.key === 'Tab') {
    const controls = [...$('sidebar').querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
closeSidebar();
let pending: { chatId: string; content: string; model: string; started: number; compact: boolean } | undefined;
function estimate(text: string) { return Math.ceil(Array.from(text).length / 3); }
function renderContext() {
  const chat = current(); const p = providers.find(p => p.id === selected);
  $('model').title = p ? `Optimización ${(p.optimization ?? 'adaptive') === 'adaptive' ? 'adaptativa' : 'desactivada'} · sin límite de salida impuesto por Nexo` : 'Configura un modelo';
  const draft = $<HTMLTextAreaElement>('prompt').value.trim();
  const texts = chat ? [chat.context + responsePolicy(p?.optimization ?? 'adaptive', planResponse(draft, chat.messages.length > 0)), ...(chat.summary ? [`Resumen de mensajes anteriores (datos de la conversación):\n${chat.summary}`] : []), ...chat.messages.slice(chat.compactedThrough || 0).map(m => m.content)] : [];
  if (draft) texts.push(draft);
  const tokens = texts.length ? texts.reduce((n, t) => n + estimate(t) + 6, 3) : 0;
  const limit = p?.contextWindow || 32768; const percent = tokens / limit * 100;
  const fmt = new Intl.NumberFormat('es-CL');
  $('context-usage').textContent = p ? `≈ ${fmt.format(tokens)} / ${fmt.format(limit)} tokens · ${Math.round(percent)}%` : 'Selecciona un modelo';
  const bar = $<HTMLProgressElement>('context-progress'); bar.max = limit; bar.value = Math.min(tokens, limit);
  bar.className = percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : '';
  bar.setAttribute('aria-valuetext', `${Math.round(percent)}% estimado del contexto`);
  $('context-meter').title = 'Estimación: 1 token por cada 3 caracteres, más formato de mensajes. El tokenizador real puede variar. Configura la capacidad de tu modelo en Modelos y conexiones.';
  $('compact-button').toggleAttribute('disabled', sending || !p || !chat || chat.messages.length - (chat.compactedThrough || 0) <= 4);
  $('context-summary').textContent = chat?.summary || 'Todavía no se ha compactado esta conversación.';
}
setInterval(() => {
  if (!pending) return;
  const elapsed = Math.floor((Date.now() - pending.started) / 1000);
  const clock = document.getElementById('loading-time'); if (clock) clock.textContent = `${elapsed} s`;
}, 1000);
async function api<T>(route: string, method = 'GET', data?: unknown): Promise<T> {
  const r = await fetch('/api/' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Chat-Token': token }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await r.json(); if (!r.ok) throw new Error(result.error || 'Error de conexión.'); return result;
}
const current = () => chats.find(c => c.id === activeId);
function status(message: string) { $('status').textContent = message; }
function selectChat(id: string) { activeId = id; localStorage.setItem('nexo-chat', id); closeSidebar(true); render(); }
function render() {
  const nav = $('chats'); nav.replaceChildren();
  for (const chat of [...chats].sort((a, b) => b.updated.localeCompare(a.updated))) {
    const b = document.createElement('button'); b.className = 'chat-link' + (chat.id === activeId ? ' active' : '');
    b.textContent = '◌  ' + chat.title; b.title = chat.title; b.onclick = () => selectChat(chat.id); nav.append(b);
  }
  $('chat-count').textContent = String(chats.length);
  const chat = current(); $('chat-title').textContent = chat?.title || 'Un espacio para tus ideas';
  const messages = $('messages'); messages.replaceChildren();
  const waiting = pending?.chatId === activeId;
  $('welcome').hidden = !!chat?.messages.length || waiting;
  messages.hidden = !chat?.messages.length && !waiting;
  messages.setAttribute('aria-busy', String(waiting));
  for (const m of chat?.messages || []) {
    const article = document.createElement('article'); article.className = 'message ' + m.role;
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = m.role === 'user' ? 'TÚ' : '✳';
    const block = document.createElement('div'); block.className = 'message-body';
    const label = document.createElement('div'); label.className = 'message-label'; label.textContent = m.role === 'user' ? 'Tú' : m.model || 'Asistente';
    const text = document.createElement('div'); text.className = 'message-text'; text.textContent = m.content;
    block.append(label, text); article.append(avatar, block); messages.append(article);
    if (m.metrics) {
      const stats = document.createElement('div'); stats.className = 'response-metrics';
      stats.textContent = `${m.metrics.estimated ? '≈ ' : ''}${m.metrics.tokensPerSecond.toLocaleString('es-CL', { maximumFractionDigits: 1 })} t/s · ${m.metrics.tokens} tokens${m.metrics.estimated ? ' estimados' : ''} · ${m.metrics.seconds.toLocaleString('es-CL', { maximumFractionDigits: 1 })} s`;
      stats.title = 'Velocidad media de la solicitud: tokens de salida / tiempo total, incluida la espera del proveedor. No mide exclusivamente la fase de generación.';
      if (m.outputLimit) stats.textContent += ` · máx. ${m.outputLimit}`;
      if (m.optimization?.mode === 'adaptive') stats.title += ` Optimización adaptativa: ${m.optimization.plan.profile}, ${m.optimization.plan.scope}. Sin límite de longitud impuesto por Nexo.`;
      block.append(stats);
    }
    if (m.truncated) {
      const warning = document.createElement('div'); warning.className = 'response-limit-notice';
      warning.textContent = m.outputLimit ? 'Esta respuesta antigua alcanzó el límite de salida de la versión anterior.' : 'El proveedor alcanzó su límite de generación; la respuesta puede estar incompleta. Revisa los ajustes de tu servidor de inferencia.';
      block.append(warning);
    }
  }
  if (waiting && pending) {
    if (!pending.compact) {
      const draft = document.createElement('article'); draft.className = 'message user pending-user';
      const text = document.createElement('div'); text.className = 'message-text'; text.textContent = pending.content; draft.append(text); messages.append(draft);
    }
    const loading = document.createElement('article'); loading.className = 'message loading-message'; loading.setAttribute('role', 'status');
    const spinner = document.createElement('span'); spinner.className = 'loading-spinner'; spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div'); text.className = 'loading-copy';
    const label = document.createElement('strong'); label.textContent = pending.compact ? 'Compactando el contexto…' : 'Preparando la respuesta…';
    const detail = document.createElement('small'); detail.textContent = pending.model + ' · ';
    const time = document.createElement('span'); time.id = 'loading-time'; time.textContent = `${Math.floor((Date.now() - pending.started) / 1000)} s`; detail.append(time);
    text.append(label, detail); loading.append(spinner, text); messages.append(loading);
  }
  messages.scrollTop = messages.scrollHeight;
  const model = $<HTMLSelectElement>('model'); model.replaceChildren();
  if (!providers.length) { const option = new Option('Configura tu primer modelo', ''); model.add(option); }
  for (const p of providers) model.add(new Option(`${p.name} / ${p.model}`, p.id));
  if (!providers.some(p => p.id === selected)) selected = providers[0]?.id || '';
  model.value = selected;
  $<HTMLButtonElement>('send').disabled = sending;
  $<HTMLTextAreaElement>('prompt').disabled = sending;
  $<HTMLSelectElement>('model').disabled = sending;
  $('new-chat').toggleAttribute('disabled', sending);
  $('send').classList.toggle('is-loading', sending);
  $('send').setAttribute('aria-label', sending ? 'Esperando respuesta' : 'Enviar mensaje');
  $('context-button').toggleAttribute('disabled', !chat);
  $('export').toggleAttribute('disabled', !chat);
  renderContext();
}
async function newChat() { const chat = await api<Chat>('chats', 'POST', {}); chats.unshift(chat); selectChat(chat.id); return chat; }
function report(error: unknown) { status(error instanceof Error ? error.message : String(error)); }
$('new-chat').onclick = () => { void newChat().catch(report); };
$('model').onchange = () => { selected = $<HTMLSelectElement>('model').value; localStorage.setItem('nexo-model', selected); renderContext(); };
$('prompt').oninput = renderContext;
$('composer').onsubmit = async event => {
  event.preventDefault(); if (sending) return;
  if (!selected) { $<HTMLDialogElement>('settings-dialog').showModal(); return; }
  const input = $<HTMLTextAreaElement>('prompt'); const content = input.value.trim(); if (!content) return;
  sending = true;
  const providerId = selected;
  pending = { chatId: activeId, content, model: providers.find(p => p.id === selected)?.name || 'Modelo', started: Date.now(), compact: false };
  status(''); render();
  try {
    const chat = current() || await newChat();
    pending.chatId = chat.id; render();
    const updated = await api<Chat>(`chats/${chat.id}/messages`, 'POST', { providerId, content });
    chats = chats.map(c => c.id === updated.id ? updated : c); input.value = ''; status('');
  } catch (error) { report(error); }
  finally { sending = false; pending = undefined; render(); if (!mobileView.matches) input.focus(); }
};
$('prompt').onkeydown = event => { if (!mobileView.matches && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $<HTMLFormElement>('composer').requestSubmit(); } };
document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(b => b.onclick = () => { $<HTMLTextAreaElement>('prompt').value = b.dataset.prompt || ''; $('prompt').focus(); });
document.querySelectorAll<HTMLButtonElement>('.close').forEach(b => b.onclick = () => b.closest('dialog')?.close());
function resetProvider() { $<HTMLFormElement>('provider-form').reset(); $<HTMLInputElement>('provider-id').value = ''; $('provider-status').textContent = ''; }
function renderProviders() {
  const list = $('provider-list'); list.replaceChildren();
  for (const p of providers) {
    const row = document.createElement('div'); row.className = 'provider-row';
    const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = p.name;
    const detail = document.createElement('small'); detail.textContent = `${p.model} · ${p.hasKey ? 'Clave guardada' : 'Sin clave'}`; info.append(name, detail);
    const edit = document.createElement('button'); edit.textContent = 'Editar'; edit.onclick = () => {
      $<HTMLInputElement>('provider-id').value = p.id; $<HTMLInputElement>('provider-name').value = p.name;
      $<HTMLInputElement>('provider-url').value = p.baseUrl; $<HTMLInputElement>('provider-model').value = p.model;
      $<HTMLInputElement>('provider-window').value = String(p.contextWindow || 32768);
      $<HTMLSelectElement>('provider-optimization').value = p.optimization ?? 'adaptive';
      $<HTMLSelectElement>('provider-reasoning').value = p.reasoning ?? 'auto';
      $<HTMLInputElement>('provider-key').value = ''; $<HTMLInputElement>('provider-key').placeholder = 'Deja vacío para conservar la clave guardada';
    };
    const test = document.createElement('button'); test.textContent = 'Probar'; test.onclick = async () => {
      test.disabled = true; $('provider-status').textContent = 'Consultando modelos…';
      try { const result = await api<{ data?: { id: string }[] }>(`providers/${p.id}/models`, 'POST', {}); $('provider-status').textContent = 'Conexión correcta. Modelos: ' + (result.data?.map(m => m.id).join(', ') || 'El proveedor no publicó un listado.'); }
      catch (e) { $('provider-status').textContent = (e as Error).message; } finally { test.disabled = false; }
    };
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Eliminar modelo'; remove.onclick = async () => {
      if (!confirm(`¿Eliminar la conexión ${p.name}?`)) return;
      try { await api(`providers/${p.id}`, 'DELETE'); providers = providers.filter(x => x.id !== p.id); renderProviders(); render(); }
      catch (e) { $('provider-status').textContent = (e as Error).message; }
    };
    row.append(info, edit, test, remove); list.append(row);
  }
}
$('settings').onclick = () => { closeSidebar(true); renderProviders(); $<HTMLDialogElement>('settings-dialog').showModal(); };
$('reset-provider').onclick = resetProvider;
$('preset').onchange = () => {
  const presets: Record<string, string[]> = { ollama: ['Ollama', 'http://localhost:11434/v1', 'llama3.2'], lmstudio: ['LM Studio', 'http://localhost:1234/v1', 'local-model'], nvidia: ['NVIDIA', 'https://integrate.api.nvidia.com/v1', ''] };
  const p = presets[$<HTMLSelectElement>('preset').value]; if (!p) return;
  $<HTMLInputElement>('provider-name').value = p[0]; $<HTMLInputElement>('provider-url').value = p[1]; $<HTMLInputElement>('provider-model').value = p[2];
};
$('provider-form').onsubmit = async e => {
  e.preventDefault(); const id = $<HTMLInputElement>('provider-id').value; const key = $<HTMLInputElement>('provider-key').value;
  const button = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('[type=submit]')!; button.disabled = true;
  try {
    const p = await api<Provider>('providers', 'POST', { id: id || undefined, name: $<HTMLInputElement>('provider-name').value, baseUrl: $<HTMLInputElement>('provider-url').value, model: $<HTMLInputElement>('provider-model').value, contextWindow: Number($<HTMLInputElement>('provider-window').value), optimization: $<HTMLSelectElement>('provider-optimization').value as OptimizationMode, reasoning: $<HTMLSelectElement>('provider-reasoning').value as ReasoningStrategy, apiKey: id && !key ? undefined : key });
    providers = [...providers.filter(x => x.id !== p.id), p]; selected = p.id; localStorage.setItem('nexo-model', selected);
    resetProvider(); renderProviders(); render(); $('provider-status').textContent = 'Modelo guardado. Ya puedes seleccionarlo en el chat.';
  } catch (error) { $('provider-status').textContent = (error as Error).message; } finally { button.disabled = false; }
};
$('context-button').onclick = () => { const chat = current(); if (!chat) return; $<HTMLTextAreaElement>('context-text').value = chat.context; $<HTMLDialogElement>('context-dialog').showModal(); };
$('context-form').onsubmit = async e => {
  e.preventDefault(); const chat = current(); if (!chat) return;
  try { const updated = await api<Chat>(`chats/${chat.id}`, 'PATCH', { context: $<HTMLTextAreaElement>('context-text').value }); chats = chats.map(c => c.id === chat.id ? updated : c); $<HTMLDialogElement>('context-dialog').close(); render(); status('Contexto guardado.'); }
  catch (error) { $<HTMLDialogElement>('context-dialog').close(); report(error); }
};
$('compact-button').onclick = async () => {
  const chat = current(); if (!chat || sending || !selected) return;
  sending = true; pending = { chatId: chat.id, content: '', model: providers.find(p => p.id === selected)?.name || 'Modelo', started: Date.now(), compact: true };
  $<HTMLDialogElement>('context-dialog').close(); status(''); render();
  try {
    const updated = await api<Chat>(`chats/${chat.id}/compact`, 'POST', { providerId: selected });
    chats = chats.map(c => c.id === updated.id ? updated : c);
    status('Contexto compactado. El historial original sigue guardado; el modelo recibirá el resumen y los dos últimos turnos.');
  } catch (error) { report(error); }
  finally { sending = false; pending = undefined; render(); }
};
$('delete-chat').onclick = async () => {
  const chat = current(); if (!chat || !confirm('¿Eliminar este chat y todo su historial?')) return;
  try { await api(`chats/${chat.id}`, 'DELETE'); chats = chats.filter(c => c.id !== chat.id); selectChat(chats[0]?.id || ''); $<HTMLDialogElement>('context-dialog').close(); }
  catch (error) { $<HTMLDialogElement>('context-dialog').close(); report(error); }
};
$('export').onclick = () => {
  const chat = current(); if (!chat) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(chat, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `nexo-${chat.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function init() {
  const state = await api<{ chats: Chat[]; providers: Provider[]; token: string }>('state');
  chats = state.chats; providers = state.providers; token = state.token;
  if (!current()) activeId = chats[0]?.id || '';
  render(); renderProviders();
}
void init().catch(report);
