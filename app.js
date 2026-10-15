/* Vistoria RS — agenda, relatórios com fotos marcadas, PDF no Google Drive e financeiro.
   • Rascunhos com fotos: só neste aparelho (IndexedDB).
   • Agenda, clientes, valores, cadastros e ajustes: neste aparelho + arquivo JSON no Drive (sincroniza celular/computador).
   • PDF final: Drive em <pasta>/<condomínio>/<arquivo>.pdf  */
(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const todayISO = () => iso(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const fmtDateBR = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DIAS = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlShort = n => n >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : 'R$ ' + Math.round(n);
const parseMoney = s => { if (typeof s === 'number') return s; s = String(s || '').replace(/[^\d,.-]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return Math.round((parseFloat(s) || 0) * 100) / 100; };
const moneyInput = n => n ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
const clone = o => JSON.parse(JSON.stringify(o));
const LS = { get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
             set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
             del(k) { try { localStorage.removeItem(k); } catch {} } };
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }

/* ================= navegação: abas e folhas (com botão voltar do celular) ================= */
const stack = []; let zTop = 40; const closeHooks = {}; let popWaiters = [];
function openSheet(id) { const el = $('#' + id); el.style.zIndex = ++zTop; el.hidden = false; el.scrollTop = 0; stack.push(id); history.pushState({ vrs: stack.length }, ''); }
function closeTop() { return new Promise(res => { if (!stack.length) return res(); popWaiters.push(res); history.back(); }); }
addEventListener('popstate', () => {
  const id = stack.pop();
  if (id) { $('#' + id).hidden = true; if (closeHooks[id]) closeHooks[id](); }
  const w = popWaiters; popWaiters = []; w.forEach(f => f());
});
let page = 'pAgenda';
function showPage(id) { page = id; $$('.page').forEach(p => p.hidden = p.id !== id); $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.page === id)); scrollTo(0, 0); renderPage(); }
$$('#tabbar button').forEach(b => b.onclick = () => showPage(b.dataset.page));
function renderPage() { renderDriveNote(); if (page === 'pAgenda') renderAgenda(); else if (page === 'pRel') renderList(); else if (page === 'pFin') renderFin(); }

/* ================= banco local (IndexedDB) ================= */
const idb = {
  db: null,
  open() { return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
    const r = indexedDB.open('vistoria-rs', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('vist', { keyPath: 'id' }); d.createObjectStore('kv'); d.createObjectStore('fila', { keyPath: 'id' }); };
    r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
  async tx(store, mode, fn) { const d = await this.open(); return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  put(store, val, key) { return this.tx(store, 'readwrite', s => key === undefined ? s.put(val) : s.put(val, key)); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
};

/* ================= dados sincronizados (ajustes, cadastros, agenda) ================= */
const ASSET = { logo: 'assets/logo-cw-branco.png', capa: 'assets/logo-vistoria-rs.png', selo: 'assets/selo-vistoria-rs.png' };
const ARR = ['construtoras', 'condominios', 'clientes', 'servicos'];
const DEFAULT_CFG = {
  nome: 'Cícero Wilker', registro: 'Arquiteto e Urbanista', whatsapp: '(51) 99414-1816', instagram: 'vistorias_rs',
  pasta: 'Vistorias', logo: null, capa: null, selo: null, precoVistoria: '', precoRevistoria: '', pix: '',
  objetivo: 'Tem como objetivo verificar possíveis danos no imóvel, bem como a conformidade dos materiais de construção especificados no memorial descritivo.',
  objetivoRev: 'Tem como objetivo verificar se os itens apontados na vistoria de entrega foram corrigidos e se há novos danos no imóvel.',
  ambientes: 'Sala de estar/jantar\nCozinha / A. Serviço\nBanheiro\nQuarto 1\nQuarto 2\nSuíte\nCirculação\nSacada\nÁrea externa',
  frases: 'Retocar pintura;\nMelhorar acabamento da parede;\nMelhorar acabamento;\nGuarnição com marcas;\nGuarnição danificada;\nNivelar guarnição;\nGuarnição menor;\nGuarnição com buraco aparente;\nRefazer calafetação;\nRemover resto de material;\nRemover excesso de concreto no piso/laje;\nPiso danificado;\nRejunte falhado;\nParafuso sem vedação;\nAdaptador de despejo solto;\nTomada/interruptor desalinhado;\nPorta não fecha corretamente;\nEsquadria riscada;\nVidro riscado;',
  msgConfirma: 'Olá, {cliente}! Aqui é {profissional}, da Vistoria RS. Confirmando a {tipo} do apartamento {unidade} no {condominio}, dia {data} às {hora}. Qualquer dúvida, estou à disposição.',
  msgEnvio: 'Olá, {cliente}! Segue o relatório da {tipo} do apartamento {unidade} – {condominio}. Qualquer dúvida, estou à disposição.',
  msgCobranca: 'Olá, {cliente}, tudo bem? Passando para lembrar do valor de {valor} referente à {tipo} do apartamento {unidade} ({data}). Chave Pix: {pix}. Obrigado!',
  construtoras: [{ id: 'c_mrv', nome: 'MRV', updatedAt: 1 }],
  condominios: [{ id: 'e_portoversalhes', nome: 'Porto Versalhes', construtoraId: 'c_mrv', endereco: '', updatedAt: 1 }],
  clientes: [], servicos: [], frasesUso: {}, setAt: 0, updatedAt: 0,
};
let cfg = clone(DEFAULT_CFG);
const live = a => (a || []).filter(x => !x.deleted);
const upd = r => { r.updatedAt = Date.now(); return r; };
function mergeCfg(a, b) {
  const base = (b.setAt || 0) > (a.setAt || 0) ? b : a;
  const out = { ...clone(DEFAULT_CFG), ...base };
  for (const k of ARR) { const m = new Map();
    for (const r of [...(a[k] || []), ...(b[k] || [])]) { const o = m.get(r.id); if (!o || (r.updatedAt || 0) > (o.updatedAt || 0)) m.set(r.id, r); }
    out[k] = [...m.values()]; }
  out.frasesUso = { ...(a.frasesUso || {}) }; for (const [k, v] of Object.entries(b.frasesUso || {})) out.frasesUso[k] = Math.max(out.frasesUso[k] || 0, v);
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0); return out;
}
async function loadCfg() { const c = await idb.get('kv', 'cfg'); if (c) cfg = mergeCfg(clone(DEFAULT_CFG), c); }
let saveCfgT;
function saveCfg(now) { cfg.updatedAt = Date.now(); LS.set('vrs_cfg_dirty', true); clearTimeout(saveCfgT);
  const go = () => idb.put('kv', cfg, 'cfg').then(pushCfgSoon).catch(() => toast('Sem espaço para salvar no aparelho'));
  if (now) return go(); saveCfgT = setTimeout(go, 500); }

const conName = id => (cfg.construtoras.find(c => c.id === id) || {}).nome || '';
const emp = id => cfg.condominios.find(e => e.id === id);
const empName = id => (emp(id) || {}).nome || '';
const cli = id => cfg.clientes.find(c => c.id === id);
const cliName = id => (cli(id) || {}).nome || '';
const sv = id => cfg.servicos.find(s => s.id === id && !s.deleted);
const services = () => live(cfg.servicos);
const pago = s => (s.pagamentos || []).reduce((t, p) => t + (Number(p.valor) || 0), 0);
const pend = s => s.cancelado ? 0 : Math.max(0, (Number(s.valor) || 0) - pago(s));
const tipoTxt = s => s.tipo === 'revistoria' ? 'revistoria' : 'vistoria';
const isDone = s => s.etapa === 'pdf' || s.etapa === 'enviado';
const revDe = s => services().find(x => x.origemId === s.id && !x.cancelado);
function etapaPill(s, only) {
  if (s.cancelado) return '<span class="pill can">Cancelado</span>';
  const m = { agendado: ['Agendado', 'ag'], andamento: ['Em andamento', 'and'], pdf: ['PDF gerado', 'pdf'], enviado: ['Enviado ao cliente', 'ok'] }[s.etapa || 'agendado'];
  let h = `<span class="pill ${m[1]}">${m[0]}</span>`;
  if (!only && s.tipo === 'vistoria' && revDe(s)) h += '<span class="pill revi">Revistoria agendada</span>';
  return h;
}
const tipoPill = s => s.tipo === 'revistoria' ? '<span class="pill revi plain">Revistoria</span>' : '<span class="pill vist plain">Vistoria</span>';
function payPill(s) { if (s.cancelado || !Number(s.valor)) return ''; const p = pend(s); return p <= 0 ? '<span class="pill ok">Pago</span>' : pago(s) > 0 ? `<span class="pill wait">Falta ${brl(p)}</span>` : `<span class="pill wait">A receber ${brl(p)}</span>`; }

/* ---------- WhatsApp e Google Agenda ---------- */
function fillMsg(tpl, s) {
  const map = { cliente: (cliName(s.clienteId) || '').split(' ')[0] || 'tudo bem', tipo: tipoTxt(s), unidade: s.unidade || '', condominio: empName(s.condominioId) || '',
    data: fmtDateBR(s.data), hora: s.hora || '', valor: brl(pend(s) || s.valor), pix: cfg.pix || '', profissional: cfg.nome || '' };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => k in map ? map[k] : m);
}
function waOpen(phone, text) {
  let n = String(phone || '').replace(/\D/g, ''); if (n && n.length <= 11) n = '55' + n;
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(text || '')}`, '_blank');
}
function gcalLink(s) {
  const d = (s.data || todayISO()).replace(/-/g, ''), [h, m] = (s.hora || '09:00').split(':').map(Number);
  const st = new Date(2000, 0, 1, h || 9, m || 0), en = new Date(st.getTime() + 90 * 60000), t = x => String(x.getHours()).padStart(2, '0') + String(x.getMinutes()).padStart(2, '0') + '00';
  const e = emp(s.condominioId), c = cli(s.clienteId), title = `${s.tipo === 'revistoria' ? 'Revistoria' : 'Vistoria'} – ${empName(s.condominioId)} ${s.unidade || ''}`.trim();
  const det = [c ? `Cliente: ${c.nome}` : '', c && c.telefone ? `Telefone: ${c.telefone}` : '', s.obs || ''].filter(Boolean).join('\n');
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${d}T${t(st)}/${d}T${t(en)}`, ctz: 'America/Sao_Paulo', location: (e && e.endereco) || empName(s.condominioId), details: det });
}

/* ================= Google: login e Drive ================= */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const clientId = () => (LS.get('vrs_client') || (window.VRS_CONFIG && window.VRS_CONFIG.clientId) || '').trim();
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
let token = LS.get('vrs_token');
const hasToken = () => token && token.exp > Date.now() + 60000;
function captureTokenFromUrl() {
  if (!location.hash.includes('access_token')) { if (location.hash.includes('error=')) { toast('Conexão com o Google cancelada.'); history.replaceState(null, '', location.pathname); } return; }
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('state') && p.get('state') === LS.get('vrs_state')) { token = { t: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 }; LS.set('vrs_token', token); LS.set('vrs_connected', true); }
  LS.del('vrs_state'); history.replaceState(null, '', location.pathname + location.search);
}
function connectGoogle() {
  const id = clientId();
  if (!id) { openSettings(); toast('Cole o Client ID do Google primeiro.'); return; }
  const state = uid(); LS.set('vrs_state', state);
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state });
}
function disconnect() { token = null; ['vrs_token', 'vrs_connected', 'vrs_folders', 'vrs_cfg_file'].forEach(k => LS.del(k)); renderDriveNote(); paintGState(); }
async function g(url, opts = {}) {
  if (!hasToken()) throw { code: 'auth' };
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token.t } });
  if (r.status === 401) { token = null; LS.del('vrs_token'); renderDriveNote(); throw { code: 'auth' }; }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch {} throw { code: 'http', status: r.status, message: m }; }
  return r;
}
const API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files';
const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function folderId(name, parent) {
  const cache = LS.get('vrs_folders', {}), key = (parent || 'root') + '/' + name;
  if (cache[key]) return cache[key];
  const q = `name='${qs(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent || 'root'}' in parents`;
  const r = await (await g(`${API}?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json();
  let id = r.files && r.files[0] && r.files[0].id;
  if (!id) id = (await (await g(`${API}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent || 'root'] }) })).json()).id;
  cache[key] = id; LS.set('vrs_folders', cache); return id;
}
function multipart(meta, blob, type) {
  const b = 'vrs' + uid();
  return { body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, blob, `\r\n--${b}--`]), headers: { 'Content-Type': `multipart/related; boundary=${b}` } };
}
async function nameTaken(name, parent) { const q = `name='${qs(name)}' and '${parent}' in parents and trashed=false`; const r = await (await g(`${API}?q=${encodeURIComponent(q)}&fields=files(id)`)).json(); return r.files && r.files.length > 0; }
async function uploadReport(job, retry = true) {
  const pasta = cfg.pasta || 'Vistorias', condo = job.condo || 'Sem condomínio';
  try {
    const root = await folderId(pasta), sub = await folderId(condo, root);
    if (job.fileId && job.folder === condo) {
      try { const r = await (await g(`${UP}/${job.fileId}?uploadType=media&fields=id,webViewLink,name`, { method: 'PATCH', headers: { 'Content-Type': 'application/pdf' }, body: job.blob })).json(); return { id: r.id, link: r.webViewLink, name: r.name, folder: condo }; }
      catch (e) { if (!(e.code === 'http' && e.status === 404)) throw e; }
    }
    let name = job.name; if (await nameTaken(name, sub)) name = name.replace(/\.pdf$/i, '') + '_' + fmtDate(todayISO()).replace(/\./g, '-') + '.pdf';
    const mp = multipart({ name, parents: [sub], mimeType: 'application/pdf', appProperties: { vrs: '1', condo, tipo: job.tipo || 'vistoria', unidade: (job.unidade || '').slice(0, 100) } }, job.blob, 'application/pdf');
    const r = await (await g(`${UP}?uploadType=multipart&fields=id,webViewLink,name`, { method: 'POST', headers: mp.headers, body: mp.body })).json();
    return { id: r.id, link: r.webViewLink, name: r.name, folder: condo };
  } catch (e) { if (retry && e.code === 'http' && (e.status === 404 || e.status === 403)) { LS.del('vrs_folders'); return uploadReport(job, false); } throw e; }
}
let queueBusy = false;
async function processQueue() {
  if (queueBusy || !hasToken() || !navigator.onLine) return; queueBusy = true;
  try {
    for (const job of (await idb.all('fila')).sort((a, b) => a.ts - b.ts)) {
      try {
        const res = await uploadReport(job); await idb.del('fila', job.id);
        const s = sv(job.sid); if (s) { Object.assign(s, { driveId: res.id, driveLink: res.link, driveFolder: res.folder, pdfNome: res.name }); upd(s); saveCfg(); }
        onUploaded(job, res);
      } catch (e) { if (e.code !== 'auth') toast('Não consegui enviar ao Drive agora. O PDF fica na fila.'); break; }
    }
  } finally { queueBusy = false; if (curId) renderDriveState(); renderPage(); }
}
const CFG_FILE = '_dados-vistoria-rs.json';
let pushTimer, pulling = false;
function pushCfgSoon() { clearTimeout(pushTimer); pushTimer = setTimeout(pushCfg, 1500); }
async function pushCfg() {
  if (!hasToken() || !LS.get('vrs_cfg_dirty') || pulling) return;
  try {
    const blob = new Blob([JSON.stringify(cfg)], { type: 'application/json' }); let fid = LS.get('vrs_cfg_file');
    if (fid) { try { await g(`${UP}/${fid}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: blob }); LS.set('vrs_cfg_dirty', false); return; } catch (e) { if (e.code === 'auth') return; fid = null; } }
    const root = await folderId(cfg.pasta || 'Vistorias');
    const mp = multipart({ name: CFG_FILE, parents: [root], appProperties: { vrscfg: '2' } }, blob, 'application/json');
    LS.set('vrs_cfg_file', (await (await g(`${UP}?uploadType=multipart&fields=id`, { method: 'POST', headers: mp.headers, body: mp.body })).json()).id); LS.set('vrs_cfg_dirty', false);
  } catch (e) { console.warn('push', e); }
}
let lastPull = 0;
async function pullCfg() {
  if (!hasToken() || pulling) return; pulling = true; lastPull = Date.now();
  try {
    const q = `appProperties has { key='vrscfg' and value='2' } and trashed=false`;
    const f = ((await (await g(`${API}?q=${encodeURIComponent(q)}&fields=files(id)&orderBy=modifiedTime desc`)).json()).files || [])[0];
    if (f) {
      LS.set('vrs_cfg_file', f.id);
      const remote = await (await g(`${API}/${f.id}?alt=media`)).json();
      const before = JSON.stringify(cfg), merged = mergeCfg(cfg, remote);
      if (JSON.stringify(merged) !== JSON.stringify(mergeCfg(remote, remote))) LS.set('vrs_cfg_dirty', true);
      cfg = merged; await idb.put('kv', cfg, 'cfg');
      if (JSON.stringify(cfg) !== before) { renderPage(); if (curId) { fillReportForm(); renderHead(); } }
    } else LS.set('vrs_cfg_dirty', true);
  } catch (e) { console.warn('pull', e); }
  pulling = false; pushCfg();
}
async function listDrive() {
  const q = `appProperties has { key='vrs' and value='1' } and trashed=false`; const out = []; let pg = '';
  do { const r = await (await g(`${API}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,webViewLink,modifiedTime,appProperties)&orderBy=modifiedTime desc&pageSize=200${pg ? '&pageToken=' + pg : ''}`)).json(); out.push(...(r.files || [])); pg = r.nextPageToken; } while (pg && out.length < 1000);
  return out;
}
function renderDriveNote() {
  const n = $('#driveNote'); $('#setDot').hidden = !!clientId();
  if (!clientId()) { n.hidden = false; n.className = 'notice warn'; n.innerHTML = 'Falta ligar o app ao seu Google Drive. Vá em <b>Mais → Ajustes</b> e siga o guia.'; return; }
  if (!hasToken()) { n.hidden = false; n.className = 'notice'; n.innerHTML = `<div class="row between"><span>${LS.get('vrs_connected') ? 'A sessão do Google expirou.' : 'Google Drive não conectado.'}</span><button class="btn sm primary" id="noteConnect">Conectar</button></div>`; $('#noteConnect').onclick = connectGoogle; return; }
  n.hidden = true;
}

/* ================= AGENDA ================= */
let calMonth = new Date(); calMonth.setDate(1); let selDay = todayISO();
$('#calPrev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderAgenda(); };
$('#calNext').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderAgenda(); };
$('#btnToday').onclick = () => { calMonth = new Date(); calMonth.setDate(1); selDay = todayISO(); renderAgenda(); };
$('#fabAgendar').onclick = () => openServ(null, { data: selDay });
const byDay = () => { const m = {}; for (const s of services()) if (!s.cancelado) (m[s.data] = m[s.data] || []).push(s); return m; };
function svcCard(s, showDate) {
  const c = cli(s.clienteId), place = [empName(s.condominioId), s.unidade].filter(Boolean).join(' · ');
  return `<button class="svc ${s.tipo === 'revistoria' ? 'r' : 'v'} ${s.cancelado ? 'c' : ''}" data-s="${esc(s.id)}">
    <div class="time"><b>${esc(s.hora || '--:--')}</b>${showDate ? `<span class="muted" style="font-size:11.5px">${fmtDate(s.data).slice(0, 5).replace('.', '/')}</span>` : '<i></i>'}</div>
    <div style="min-width:0"><div class="t">${esc(c ? c.nome : 'Sem cliente')}</div><div class="s">${esc(place || 'Condomínio não informado')}</div>
    <div class="meta">${tipoPill(s)}${etapaPill(s)}${payPill(s)}</div></div>
    <svg class="chev" width="18" height="18"><use href="#i-next"/></svg></button>`;
}
const bindSvc = box => box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => openServ(b.dataset.s));
function renderAgenda() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), map = byDay(), today = todayISO();
  $('#calTitle').textContent = `${MESES[m]} ${y}`;
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
  let h = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d), list = map[k] || [];
    if (i >= 35 && d.getMonth() !== m) break;
    const open = list.filter(s => !isDone(s)), cls = ['day'];
    if (d.getMonth() !== m) cls.push('out'); if (k === today) cls.push('today'); if (k === selDay) cls.push('sel');
    if (open.some(s => s.tipo !== 'revistoria')) cls.push('has-v'); if (open.some(s => s.tipo === 'revistoria')) cls.push('has-r');
    if (list.length && !open.length) cls.push('done');
    const dots = list.slice(0, 3).map(s => `<i class="${isDone(s) ? 'd' : s.tipo === 'revistoria' ? 'r' : 'v'}"></i>`).join('');
    h += `<button class="${cls.join(' ')}" data-d="${k}" aria-label="${d.getDate()} de ${MESES[d.getMonth()]}${list.length ? ', ' + list.length + ' marcado(s)' : ''}"><span>${d.getDate()}</span><div class="dots">${dots}</div></button>`;
  }
  $('#cal').innerHTML = h;
  $$('#cal [data-d]').forEach(b => b.onclick = () => { selDay = b.dataset.d; const d = parseISO(selDay); if (d.getMonth() !== m) calMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderAgenda(); });
  const sd = parseISO(selDay), list = (map[selDay] || []).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  $('#dayTitle').textContent = selDay === today ? 'Hoje' : `${DIAS[sd.getDay()]}, ${sd.getDate()} de ${MESES[sd.getMonth()]}`;
  $('#dayCount').textContent = list.length ? `${list.length} marcado${list.length > 1 ? 's' : ''}` : '';
  $('#dayList').innerHTML = list.length ? list.map(s => svcCard(s)).join('') : `<div class="empty" style="padding:20px"><p style="margin:0 auto 12px">Nada marcado neste dia.</p><button class="btn sm primary" id="dayAdd"><svg><use href="#i-plus"/></svg>Agendar neste dia</button></div>`;
  bindSvc($('#dayList')); const da = $('#dayAdd'); if (da) da.onclick = () => openServ(null, { data: selDay });
  const next = services().filter(s => !s.cancelado && !isDone(s) && s.data > selDay).sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || ''))).slice(0, 5);
  $('#nextBox').innerHTML = next.length ? `<h2 style="margin-top:10px">Próximos</h2>` + next.map(s => svcCard(s, true)).join('') : '';
  bindSvc($('#nextBox'));
}

/* ================= SERVIÇO (agendamento) ================= */
let svD = null, svNew = false;
function blankServ(p = {}) {
  const tipo = p.tipo || 'vistoria';
  return { id: 's' + uid(), tipo, data: todayISO(), hora: '09:00', clienteId: '', construtoraId: '', condominioId: '', unidade: '', obs: '',
    valor: parseMoney(tipo === 'revistoria' ? cfg.precoRevistoria : cfg.precoVistoria) || 0, pagamentos: [], etapa: 'agendado', createdAt: Date.now(), ...p };
}
function openServ(id, preset) {
  svNew = !id; svD = id ? clone(sv(id)) : blankServ(preset);
  fillServ(); $('#svPayForm').hidden = true; $('#svQuick').hidden = true; openSheet('vServ');
}
function fillServ() {
  const s = svD;
  $('#svTitle').textContent = svNew ? 'Novo agendamento' : (s.tipo === 'revistoria' ? 'Revistoria' : 'Vistoria');
  $('#svSub').textContent = svNew ? 'Preencha e salve' : [cliName(s.clienteId), fmtDateBR(s.data)].filter(Boolean).join(' · ');
  $('#svStatus').innerHTML = svNew ? '' : etapaPill(s, true);
  $$('#svTipo button').forEach(b => b.classList.toggle('on', b.dataset.v === s.tipo));
  $('#svData').value = s.data || ''; $('#svHora').value = s.hora || ''; $('#svUni').value = s.unidade || ''; $('#svObs').value = s.obs || '';
  $('#svValor').value = moneyInput(s.valor);
  fillPick(PICK_SV); renderPays();
  const local = [...vist.values()].find(v => v.servicoId === s.id);
  $('#svStartTxt').textContent = local ? 'Abrir relatório' : s.tipo === 'revistoria' ? 'Iniciar revistoria' : 'Iniciar vistoria';
  $('#svWaCob').hidden = !(pend(s) > 0); $('#svSent').hidden = s.etapa !== 'pdf';
  $('#svGcal').href = gcalLink(s);
  let ban = '';
  if (s.cancelado) ban = '<div class="notice">Agendamento cancelado. Ele não conta no financeiro.</div>';
  else if (s.tipo === 'vistoria' && revDe(s)) { const r = revDe(s); ban = `<div class="banner"><span>Revistoria marcada para <b>${fmtDateBR(r.data)}</b>${r.hora ? ' às ' + esc(r.hora) : ''}</span><button class="btn sm" id="svGoRev">Ver</button></div>`; }
  else if (s.tipo === 'vistoria' && isDone(s) && !svNew) ban = `<div class="banner"><span><b>Agendar a revistoria?</b><br><span class="muted" style="font-size:13px">Cliente e unidade já preenchidos.</span></span><button class="btn sm blue" id="svRev">Agendar</button></div>`;
  else if (s.origemId && sv(s.origemId)) ban = `<div class="notice info">Revistoria da vistoria de ${fmtDateBR(sv(s.origemId).data)}.</div>`;
  $('#svBanner').innerHTML = ban;
  const r1 = $('#svRev'); if (r1) r1.onclick = async () => { commitServ(); const o = svD; svD = null; await closeTop(); openServ(null, revPreset(o)); };
  const r2 = $('#svGoRev'); if (r2) r2.onclick = async () => { const r = revDe(svD); commitServ(); svD = null; await closeTop(); openServ(r.id); };
  $('#svDelZone').innerHTML = svNew ? '' : `<div class="row"><button class="btn sm ghost" id="svCancel">${s.cancelado ? 'Reativar agendamento' : 'Cancelar agendamento'}</button><button class="btn sm danger" id="svDel">Excluir</button></div>`;
  bindServDel();
}
const revPreset = o => ({ tipo: 'revistoria', origemId: o.id, clienteId: o.clienteId, construtoraId: o.construtoraId, condominioId: o.condominioId, unidade: o.unidade, data: addDays(todayISO(), 30), valor: parseMoney(cfg.precoRevistoria) || 0 });
function bindServDel() {
  const c = $('#svCancel'); if (c) c.onclick = () => { readServ(); svD.cancelado = !svD.cancelado; commitServ(); fillServ(); toast(svD.cancelado ? 'Agendamento cancelado' : 'Agendamento reativado'); };
  const d = $('#svDel'); if (d) d.onclick = () => {
    $('#svDelZone').innerHTML = '<div class="confirm"><span>Excluir este serviço da agenda e do financeiro?</span><button class="btn sm danger" id="svDelYes">Excluir</button><button class="btn sm" id="svDelNo">Cancelar</button></div>';
    $('#svDelNo').onclick = fillServ;
    $('#svDelYes').onclick = async () => { const s = cfg.servicos.find(x => x.id === svD.id); if (s) { s.deleted = true; upd(s); saveCfg(true); } svD = null; await closeTop(); toast('Serviço excluído'); };
  };
}
function readServ() { const s = svD; s.data = $('#svData').value || s.data; s.hora = $('#svHora').value; s.unidade = $('#svUni').value.trim(); s.obs = $('#svObs').value.trim(); s.valor = parseMoney($('#svValor').value); }
$$('#svTipo button').forEach(b => b.onclick = () => { readServ(); const old = svD.tipo; svD.tipo = b.dataset.v;
  const pOld = parseMoney(old === 'revistoria' ? cfg.precoRevistoria : cfg.precoVistoria), pNew = parseMoney(svD.tipo === 'revistoria' ? cfg.precoRevistoria : cfg.precoVistoria);
  if (!svD.valor || svD.valor === pOld) svD.valor = pNew; fillServ(); });
['#svData', '#svHora', '#svValor', '#svUni'].forEach(s => $(s).addEventListener('change', () => { readServ(); renderPays(); $('#svGcal').href = gcalLink(svD); $('#svWaCob').hidden = !(pend(svD) > 0); }));
function renderPays() {
  const s = svD, pe = pend(s);
  $('#svPayState').innerHTML = !Number(s.valor) ? '<span class="muted">Sem valor</span>' : pe <= 0 ? `<span class="pill ok">Pago</span>` : `<span class="money red">${brl(pe)} pendente</span>`;
  $('#svPays').innerHTML = (s.pagamentos || []).length ? `<div>${s.pagamentos.map((x, i) => `<div class="pay"><span>${fmtDateBR(x.data)} · ${esc(x.forma)}</span><span class="money green">${brl(x.valor)}</span><button class="mini" data-rp="${i}" aria-label="Remover pagamento"><svg width="14" height="14"><use href="#i-x"/></svg></button></div>`).join('')}</div>` : '';
  $$('#svPays [data-rp]').forEach(b => b.onclick = () => { s.pagamentos.splice(+b.dataset.rp, 1); renderPays(); });
}
$('#svAddPay').onclick = () => { readServ(); $('#svPayForm').hidden = false; $('#pyValor').value = moneyInput(pend(svD) || svD.valor); $('#pyData').value = todayISO(); $('#pyValor').focus(); };
$('#pyNo').onclick = () => $('#svPayForm').hidden = true;
$('#pyOk').onclick = () => { const v = parseMoney($('#pyValor').value); if (!v) { $('#pyValor').focus(); return; }
  readServ(); svD.pagamentos = svD.pagamentos || []; svD.pagamentos.push({ id: uid(), valor: v, data: $('#pyData').value || todayISO(), forma: $('#pyForma').value });
  $('#svPayForm').hidden = true; commitServ(); renderPays(); $('#svWaCob').hidden = !(pend(svD) > 0); toast('Pagamento registrado'); };
function commitServ() {
  readServ(); const s = upd(svD), i = cfg.servicos.findIndex(x => x.id === s.id);
  if (i >= 0) cfg.servicos[i] = clone(s); else cfg.servicos.push(clone(s));
  svNew = false; saveCfg(true);
}
const servEmpty = () => svNew && !svD.clienteId && !svD.condominioId && !svD.unidade && !(svD.pagamentos || []).length;
closeHooks.vServ = () => { if (svD) { readServ(); if (!servEmpty()) commitServ(); svD = null; } renderPage(); };
$('#svClose').onclick = () => closeTop();
$('#svSave').onclick = async () => { readServ(); if (!svD.data) { toast('Informe a data'); return; } commitServ(); svD = null; await closeTop(); toast('Agendamento salvo'); };
$('#svStart').onclick = async () => { commitServ(); const s = sv(svD.id); svD = null; await closeTop(); startReport(s); };
$('#svWaConf').onclick = () => { readServ(); const c = cli(svD.clienteId); waOpen(c && c.telefone, fillMsg(cfg.msgConfirma, svD)); };
$('#svWaCob').onclick = () => { readServ(); const c = cli(svD.clienteId); waOpen(c && c.telefone, fillMsg(cfg.msgCobranca, svD)); };
$('#svSent').onclick = () => { svD.etapa = 'enviado'; svD.enviadoEm = Date.now(); commitServ(); fillServ(); toast('Marcado como enviado ao cliente'); };

/* ---------- seletores reutilizáveis: cliente, construtora, condomínio ---------- */
const PICK_SV = { cli: '#svCli', con: '#svCon', emp: '#svEmp', quick: '#svQuick', get: () => svD, changed: () => { $('#svGcal').href = gcalLink(svD); } };
const PICK_RP = { cli: '#fCli', con: '#fCon', emp: '#fEmp', quick: '#quickAdd', get: () => cur() && sv(cur().servicoId),
  changed: () => { const s = sv(cur().servicoId); upd(s); saveCfg(); const e = emp(s.condominioId); if (e && e.endereco && !$('#fEnd').value) { $('#fEnd').value = e.endereco; cur().endereco = e.endereco; touch(cur()); } renderHead(); } };
const sortN = a => [...a].sort((x, y) => (x.nome || '').localeCompare(y.nome || '', 'pt-BR'));
function fillPick(P) {
  const o = P.get(); if (!o) return;
  $(P.cli).innerHTML = `<option value="">Selecione o cliente…</option>` + sortN(live(cfg.clientes)).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.telefone ? ' · ' + esc(c.telefone) : ''}</option>`).join('') + `<option value="__new">+ Novo cliente…</option>`;
  $(P.cli).value = o.clienteId || '';
  $(P.con).innerHTML = `<option value="">Selecione…</option>` + sortN(live(cfg.construtoras)).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('') + `<option value="__new">+ Nova construtora…</option>`;
  $(P.con).value = o.construtoraId || '';
  const emps = sortN(live(cfg.condominios).filter(e => !o.construtoraId || e.construtoraId === o.construtoraId));
  $(P.emp).innerHTML = `<option value="">${emps.length ? 'Selecione…' : 'Nenhum cadastrado'}</option>` + emps.map(e => `<option value="${esc(e.id)}">${esc(e.nome)}${o.construtoraId ? '' : ' — ' + esc(conName(e.construtoraId))}</option>`).join('') + `<option value="__new">+ Novo condomínio…</option>`;
  $(P.emp).value = o.condominioId || '';
}
function bindPick(P) {
  $(P.cli).addEventListener('change', e => { const o = P.get(); if (e.target.value === '__new') { fillPick(P); return quick(P, 'cli'); } o.clienteId = e.target.value; P.changed(); });
  $(P.con).addEventListener('change', e => { const o = P.get(); if (e.target.value === '__new') { fillPick(P); return quick(P, 'con'); }
    o.construtoraId = e.target.value; if (o.condominioId && (emp(o.condominioId) || {}).construtoraId !== o.construtoraId) o.condominioId = ''; fillPick(P); P.changed(); });
  $(P.emp).addEventListener('change', e => { const o = P.get(); if (e.target.value === '__new') { fillPick(P); return quick(P, 'emp'); }
    o.condominioId = e.target.value; const x = emp(o.condominioId); if (x && x.construtoraId) o.construtoraId = x.construtoraId; fillPick(P); P.changed(); });
}
function quick(P, kind) {
  const box = $(P.quick), o = P.get(); box.hidden = false;
  const btns = `<div class="row"><button class="btn sm primary" data-q="ok">Cadastrar e usar</button><button class="btn sm ghost" data-q="no">Cancelar</button></div>`;
  if (kind === 'cli') box.innerHTML = `<b>Novo cliente</b><div class="grid2"><div class="field"><input data-q="nome" placeholder="Nome completo"></div><div class="field"><input data-q="tel" inputmode="tel" placeholder="WhatsApp (51) 99999-9999"></div></div>${btns}`;
  else if (kind === 'con') box.innerHTML = `<b>Nova construtora</b><div class="field"><input data-q="nome" placeholder="Nome da construtora"></div>${btns}`;
  else box.innerHTML = `<b>Novo condomínio</b><div class="grid2"><div class="field"><input data-q="nome" placeholder="Nome do condomínio"></div><div class="field"><select data-q="con"><option value="">Construtora…</option>${sortN(live(cfg.construtoras)).map(c => `<option value="${esc(c.id)}" ${c.id === o.construtoraId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div></div><div class="field"><input data-q="end" placeholder="Endereço (opcional)"></div>${btns}`;
  const q = k => box.querySelector(`[data-q="${k}"]`); q('nome').focus();
  q('no').onclick = () => box.hidden = true;
  q('ok').onclick = () => {
    const nome = q('nome').value.trim(); if (!nome) return q('nome').focus();
    if (kind === 'cli') { const c = upd({ id: 'p' + uid(), nome, telefone: q('tel').value.trim() }); cfg.clientes.push(c); o.clienteId = c.id; }
    else if (kind === 'con') { const c = upd({ id: 'c' + uid(), nome }); cfg.construtoras.push(c); o.construtoraId = c.id; o.condominioId = ''; }
    else { const e = upd({ id: 'e' + uid(), nome, construtoraId: q('con').value, endereco: q('end').value.trim() }); cfg.condominios.push(e); o.condominioId = e.id; if (e.construtoraId) o.construtoraId = e.construtoraId; }
    saveCfg(); box.hidden = true; fillPick(P); P.changed(); toast('Cadastrado');
  };
}
bindPick(PICK_SV); bindPick(PICK_RP);

/* ================= RELATÓRIOS (rascunhos locais) ================= */
const vist = new Map(); let curId = null;
const urlCache = new WeakMap();
const blobURL = b => { if (!b) return ''; if (!urlCache.has(b)) urlCache.set(b, URL.createObjectURL(b)); return urlCache.get(b); };
const saveTimers = {};
const persist = v => idb.put('vist', v);
function touch(v) { v.updatedAt = Date.now(); clearTimeout(saveTimers[v.id]); saveTimers[v.id] = setTimeout(() => persist(v).catch(() => toast('Sem espaço no aparelho para salvar.')), 400); }
const cur = () => vist.get(curId);
function ensureServ(v) { // relatórios da versão anterior (sem agenda) ganham um serviço
  if (v.servicoId && sv(v.servicoId)) return sv(v.servicoId);
  const conId = (live(cfg.construtoras).find(c => c.nome === v.construtora) || {}).id || '';
  const s = upd(blankServ({ id: v.servicoId || 's' + uid(), tipo: v.tipo || 'vistoria', data: v.data || todayISO(), hora: '', construtoraId: v.construtoraId || conId, condominioId: v.empreendimentoId || '', unidade: v.unidade || '', etapa: 'andamento', relatorioId: v.id, valor: 0 }));
  if (v.proprietario) { let c = live(cfg.clientes).find(x => x.nome === v.proprietario); if (!c) { c = upd({ id: 'p' + uid(), nome: v.proprietario, telefone: '' }); cfg.clientes.push(c); } s.clienteId = c.id; }
  cfg.servicos.push(s); v.servicoId = s.id; touch(v); saveCfg(); return s;
}
function names(v) { const s = sv(v.servicoId) || {}; return { tipo: s.tipo || v.tipo || 'vistoria', proprietario: cliName(s.clienteId), construtora: conName(s.construtoraId), empreendimento: empName(s.condominioId), unidade: s.unidade || '', data: s.data || todayISO(), s }; }

let relTab = 'local';
$$('#pRel .seg button').forEach(b => b.onclick = () => { relTab = b.dataset.tab; $$('#pRel .seg button').forEach(x => x.classList.toggle('on', x === b)); renderList(); });
$('#q').addEventListener('input', () => renderList());
function renderList() {
  if (relTab === 'drive') return renderDriveTab();
  $('#cards').hidden = false; $('#driveList').hidden = true;
  const all = [...vist.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), q = ($('#q').value || '').toLowerCase().trim();
  const list = q ? all.filter(v => { const n = names(v); return [n.proprietario, n.empreendimento, n.unidade, n.construtora].join(' ').toLowerCase().includes(q); }) : all;
  $('#filterRow').hidden = all.length < 4; $('#listCount').textContent = all.length ? `${all.length} rascunho${all.length > 1 ? 's' : ''}` : '';
  if (!all.length) { $('#cards').innerHTML = `<div class="empty"><h1 style="font-size:18px">Nenhum relatório neste aparelho</h1><p>Comece por aqui ou pela agenda, no botão <b>Iniciar vistoria</b> do agendamento.</p></div>`; return; }
  idb.all('fila').then(f => {
    const waiting = new Set(f.map(j => j.vid));
    $('#cards').innerHTML = list.map(v => { const n = names(v), its = v.items || [];
      const ph = its.filter(i => i.photo).slice(0, 3).map(i => `<i style="background-image:url('${blobURL(i.photo)}')"></i>`).join('') || '<i></i>';
      return `<button class="rcard" data-id="${esc(v.id)}"><div class="strip">${ph}</div><div style="min-width:0">
        <div class="t">${esc(n.unidade || 'Sem unidade')}</div><div class="s">${esc([n.empreendimento, n.proprietario].filter(Boolean).join(' · '))}</div>
        <div class="meta">${tipoPill(n)}${n.s.id ? etapaPill(n.s, true) : ''}${waiting.has(v.id) ? '<span class="pill wait">Na fila do Drive</span>' : ''}<span class="s mono">${fmtDate(n.data)} · ${its.length} ite${its.length === 1 ? 'm' : 'ns'}</span></div></div></button>`; }).join('') || '<p class="muted">Nada encontrado.</p>';
    $$('#cards [data-id]').forEach(b => b.onclick = () => openVist(b.dataset.id));
  });
}
async function renderDriveTab() {
  $('#cards').hidden = true; $('#filterRow').hidden = true; const box = $('#driveList'); box.hidden = false; $('#listCount').textContent = '';
  if (!hasToken()) { box.innerHTML = `<div class="empty"><p>Conecte ao Google Drive para ver os PDFs enviados, separados por condomínio.</p><button class="btn primary" id="dConnect">Conectar ao Google Drive</button></div>`; $('#dConnect').onclick = connectGoogle; return; }
  box.innerHTML = '<p class="muted">Carregando do Drive…</p>';
  try {
    const files = await listDrive();
    if (!files.length) { box.innerHTML = `<div class="empty"><p>Nenhum PDF enviado ainda. Eles aparecem aqui em <b>${esc(cfg.pasta)}</b>, uma pasta por condomínio.</p></div>`; return; }
    const groups = {}; files.forEach(f => { const c = (f.appProperties && f.appProperties.condo) || 'Sem condomínio'; (groups[c] = groups[c] || []).push(f); });
    $('#listCount').textContent = `${files.length} PDF${files.length > 1 ? 's' : ''}`;
    box.innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(c => `<div class="folder"><svg><use href="#i-drive"/></svg>${esc(c)} <span class="muted" style="font-weight:500">${groups[c].length}</span></div>` +
      groups[c].map(f => `<a class="lrow" href="${esc(f.webViewLink)}" target="_blank" rel="noopener"><div class="grow"><b class="mono" style="font-size:13px;overflow-wrap:anywhere">${esc(f.name)}</b><small>${new Date(f.modifiedTime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${f.appProperties && f.appProperties.tipo === 'revistoria' ? ' · Revistoria' : ''}</small></div><svg width="18" height="18" class="muted"><use href="#i-next"/></svg></a>`).join('')).join('');
  } catch (e) { box.innerHTML = `<div class="notice warn">Não consegui ler o Drive${e.message ? ': ' + esc(e.message) : ''}.</div>`; }
}
function newReport(tipo) {
  const now = new Date(), s = upd(blankServ({ tipo, hora: String(now.getHours()).padStart(2, '0') + ':' + (now.getMinutes() < 30 ? '00' : '30'), etapa: 'andamento' }));
  cfg.servicos.push(s); saveCfg(); startReport(s, true);
}
$('#btnNew').onclick = () => newReport('vistoria');
$('#btnNewRev').onclick = () => newReport('revistoria');
function startReport(s, isNew) {
  let v = [...vist.values()].find(x => x.servicoId === s.id);
  if (!v) {
    if (s.relatorioId && !vist.has(s.relatorioId) && s.etapa !== 'agendado') toast('Este relatório foi começado em outro aparelho. Criando um novo aqui.', 4000);
    const e = emp(s.condominioId);
    v = { id: 'v' + uid(), servicoId: s.id, endereco: (e && e.endereco) || '', obs: '', items: [], lastAmb: lines(cfg.ambientes)[0] || '', createdAt: Date.now(), updatedAt: Date.now() };
    vist.set(v.id, v); touch(v); s.relatorioId = v.id; if (!s.etapa || s.etapa === 'agendado') s.etapa = 'andamento'; upd(s); saveCfg();
  }
  openVist(v.id, isNew || !s.clienteId || !s.condominioId);
}

/* ---------- tela do relatório ---------- */
function openVist(id, openId) {
  curId = id; LS.set('vrs_last', id); const v = cur(); ensureServ(v);
  fillReportForm(); $('#quickAdd').hidden = true; $('#idBox').open = !!openId;
  resetDel(); renderHead(); renderDriveState(); renderItems(); openSheet('vInsp');
}
function fillReportForm() { const v = cur(); if (!v) return; const s = sv(v.servicoId); if (!s) return; fillPick(PICK_RP); $('#fUni').value = s.unidade || ''; $('#fDat').value = s.data || ''; $('#fEnd').value = v.endereco || ''; $('#fObs').value = v.obs || ''; }
function renderHead() {
  const v = cur(); if (!v) return; const n = names(v);
  $('#iType').textContent = n.tipo === 'revistoria' ? 'Revistoria' : 'Vistoria';
  $('#iSub').textContent = [n.proprietario, n.empreendimento].filter(Boolean).join(' · ') || 'Preencha a identificação';
  $('#iStatus').innerHTML = n.s.id ? etapaPill(n.s, true) : '';
  $('#idLine').innerHTML = `<b>${esc(n.unidade || 'Identificação do imóvel')}</b><span class="muted">${esc([n.empreendimento, n.construtora].filter(Boolean).join(' · ') || 'Toque para preencher')} · ${fmtDate(n.data)}</span>`;
}
$('#fUni').addEventListener('input', e => { const s = sv(cur().servicoId); s.unidade = e.target.value; upd(s); saveCfg(); renderHead(); });
$('#fDat').addEventListener('change', e => { const s = sv(cur().servicoId); if (e.target.value) { s.data = e.target.value; upd(s); saveCfg(); renderHead(); } });
$('#fEnd').addEventListener('input', e => { cur().endereco = e.target.value; touch(cur()); });
$('#fObs').addEventListener('input', e => { cur().obs = e.target.value; touch(cur()); });
function renderDriveState() {
  const v = cur(); if (!v) return; const s = sv(v.servicoId) || {}, el = $('#driveState');
  idb.all('fila').then(f => {
    if (f.some(j => j.vid === v.id)) { el.innerHTML = '<div class="notice">PDF gerado e na fila para o Drive. Envia sozinho quando houver internet e o Google estiver conectado.</div>'; return; }
    if (s.driveId) { const changed = (v.updatedAt || 0) > (v.pdfAt || 0);
      el.innerHTML = `<div class="notice ${changed ? 'warn' : 'good'}">${changed ? 'Você alterou o relatório depois do último PDF. Gere de novo para atualizar o arquivo no Drive.' : 'PDF salvo no Drive'} · <span class="mono">${esc(s.driveFolder || '')}</span>${s.driveLink ? ` · <a href="${esc(s.driveLink)}" target="_blank" rel="noopener">abrir</a>` : ''}</div>`; return; }
    el.innerHTML = '';
  });
}
function resetDel() { $('#delZone').innerHTML = '<button class="btn danger sm" id="btnDel">Excluir rascunho deste aparelho</button>'; $('#btnDel').onclick = askDel; }
function askDel() {
  const s = sv(cur().servicoId) || {};
  $('#delZone').innerHTML = `<div class="confirm"><span>Excluir o rascunho e as fotos deste aparelho?${s.driveId ? ' O PDF no Drive continua lá.' : ''} A agenda e os valores não são apagados.</span><button class="btn danger sm" id="delYes">Excluir</button><button class="btn sm" id="delNo">Cancelar</button></div>`;
  $('#delNo').onclick = resetDel;
  $('#delYes').onclick = async () => { const id = curId; clearTimeout(saveTimers[id]); vist.delete(id); await idb.del('vist', id); curId = null; LS.del('vrs_last'); await closeTop(); toast('Rascunho excluído do aparelho'); };
}
closeHooks.vInsp = () => { const v = cur(); if (v) { clearTimeout(saveTimers[v.id]); persist(v); } curId = null; LS.del('vrs_last'); renderPage(); };
$('#btnBack').onclick = () => closeTop();

/* ---------- marcações ---------- */
function shapeSVG(shapes, w, h) {
  const H = 100 * h / w;
  return `<svg viewBox="0 0 100 ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` + (shapes || []).map(s => {
    const st = 'fill="none" stroke="#E3241B" stroke-width="2.4" vector-effect="non-scaling-stroke"';
    if (s.t === 'rect') return `<rect x="${s.x * 100}" y="${s.y * H}" width="${s.w * 100}" height="${s.h * H}" ${st}/>`;
    if (s.t === 'ellipse') return `<ellipse cx="${(s.x + s.w / 2) * 100}" cy="${(s.y + s.h / 2) * H}" rx="${s.w * 50}" ry="${s.h * H / 2}" ${st}/>`;
    if (s.t === 'arrow') { const x1 = s.x1 * 100, y1 = s.y1 * H, x2 = s.x2 * 100, y2 = s.y2 * H, a = Math.atan2(y2 - y1, x2 - x1), L = 7;
      return `<path d="M${x1} ${y1}L${x2} ${y2}M${x2 - L * Math.cos(a - .45)} ${y2 - L * Math.sin(a - .45)}L${x2} ${y2}L${x2 - L * Math.cos(a + .45)} ${y2 - L * Math.sin(a + .45)}" ${st} stroke-linecap="round" stroke-linejoin="round"/>`; }
    return '';
  }).join('') + '</svg>';
}
function drawShapes(ctx, shapes, W, H) {
  const lw = Math.max(3, Math.round(Math.max(W, H) * .009));
  ctx.save(); ctx.strokeStyle = '#E3241B'; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of shapes || []) {
    ctx.beginPath();
    if (s.t === 'rect') ctx.strokeRect(s.x * W, s.y * H, s.w * W, s.h * H);
    else if (s.t === 'ellipse') { ctx.ellipse((s.x + s.w / 2) * W, (s.y + s.h / 2) * H, s.w * W / 2, s.h * H / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (s.t === 'arrow') { const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H, a = Math.atan2(y2 - y1, x2 - x1), L = lw * 5;
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.moveTo(x2 - L * Math.cos(a - .45), y2 - L * Math.sin(a - .45)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a + .45), y2 - L * Math.sin(a + .45)); ctx.stroke(); }
  }
  ctx.restore();
}
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = src; });
function renderItems() {
  const v = cur(), box = $('#items');
  if (!v.items.length) { box.innerHTML = `<div class="empty"><h1 style="font-size:18px">Nenhum item ainda</h1><p>Toque em <b>Tirar foto</b>, marque o defeito e escreva o que precisa ser corrigido. O ambiente fica salvo para a próxima foto.</p></div>`; return; }
  let html = '', last = null;
  v.items.forEach((it, i) => {
    if (it.amb !== last) { const n = v.items.filter(x => x.amb === it.amb).length; html += `<div class="amb"><h3>${esc(it.amb || 'Sem ambiente')}</h3><span class="muted" style="font-size:13px">${n} ite${n === 1 ? 'm' : 'ns'}</span></div>`; last = it.amb; }
    html += `<div class="item"><button class="thumb" data-edit="${i}" aria-label="Editar item ${i + 1}">${it.photo ? `<img src="${blobURL(it.photo)}" alt="">${shapeSVG(it.shapes, it.w || 3, it.h || 4)}` : ''}</button>
      <div style="min-width:0"><div class="num">${String(i + 1).padStart(2, '0')}</div><div class="desc ${it.desc ? '' : 'none'}" data-edit="${i}">${esc(it.desc || 'Sem descrição')}</div></div>
      <div class="tools"><button class="mini" data-mv="-1" data-i="${i}" aria-label="Subir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg></button><button class="mini" data-mv="1" data-i="${i}" aria-label="Descer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button></div></div>`;
  });
  box.innerHTML = html;
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(+b.dataset.edit));
  box.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = +b.dataset.i, j = i + +b.dataset.mv; if (j < 0 || j >= v.items.length) return; [v.items[i], v.items[j]] = [v.items[j], v.items[i]]; touch(v); renderItems(); });
}

/* ---------- fotos ---------- */
async function compress(file, max = 1600) {
  let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await loadImg(URL.createObjectURL(file)); }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { blob: await new Promise(r => c.toBlob(r, 'image/jpeg', .84)), w: c.width, h: c.height };
}
$('#inCam').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await addPhoto(f, true); });
$('#inGal').addEventListener('change', async e => {
  const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return;
  if (fs.length === 1) return addPhoto(fs[0], true);
  toast(`Adicionando ${fs.length} fotos…`); for (const f of fs) await addPhoto(f, false);
  toast(`${fs.length} fotos em "${cur().lastAmb}". Toque em cada uma para marcar e descrever.`, 4200);
});
async function addPhoto(file, openNow) {
  const v = cur(), { blob, w, h } = await compress(file), it = { id: uid(), amb: v.lastAmb || lines(cfg.ambientes)[0] || '', desc: '', shapes: [], w, h, photo: blob };
  if (openNow) openEditor(-1, it); else { v.items.push(it); touch(v); renderItems(); }
}

/* ---------- editor do item ---------- */
let ed = null; const cv = $('#cv'), cx = cv.getContext('2d');
async function openEditor(idx, newItem) {
  const v = cur(), base = newItem || { ...v.items[idx], shapes: [...(v.items[idx].shapes || [])] };
  ed = { idx, item: base, isNew: !!newItem, shapes: [...(base.shapes || [])], tool: (ed && ed.tool) || 'rect', draft: null };
  $('#edTitle').textContent = newItem ? 'Novo item' : `Item ${String(idx + 1).padStart(2, '0')}`;
  $('#edDesc').value = base.desc || ''; $('#edDel').hidden = !!newItem; $('#edDelZone').innerHTML = '';
  $$('.tool [data-t]').forEach(x => x.classList.toggle('on', x.dataset.t === ed.tool));
  renderAmbChips(); renderPhrases(); openSheet('vEdit');
  try { ed.img = await loadImg(blobURL(base.photo)); } catch { ed.img = null; } fitCanvas();
}
closeHooks.vEdit = () => { ed = null; };
function fitCanvas() {
  if (!ed) return; const img = ed.img, W = img ? img.naturalWidth : 900, H = img ? img.naturalHeight : 1200;
  const maxW = $('#cbox').clientWidth || 360, maxH = Math.max(300, innerHeight * .55), k = Math.min(maxW / W, maxH / H), dpr = devicePixelRatio || 1;
  cv.style.width = Math.round(W * k) + 'px'; cv.style.height = Math.round(H * k) + 'px'; cv.width = Math.round(W * k * dpr); cv.height = Math.round(H * k * dpr); redraw();
}
function redraw() { if (!ed) return; cx.clearRect(0, 0, cv.width, cv.height); if (ed.img) cx.drawImage(ed.img, 0, 0, cv.width, cv.height); else { cx.fillStyle = '#333'; cx.fillRect(0, 0, cv.width, cv.height); } drawShapes(cx, ed.draft ? [...ed.shapes, ed.draft] : ed.shapes, cv.width, cv.height); }
addEventListener('resize', () => { if (!$('#vEdit').hidden) fitCanvas(); });
const pt = e => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
let start = null;
cv.addEventListener('pointerdown', e => { if (!ed) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); start = pt(e); ed.draft = null; });
cv.addEventListener('pointermove', e => { if (!start || !ed) return; const p = pt(e);
  ed.draft = ed.tool === 'arrow' ? { t: 'arrow', x1: start.x, y1: start.y, x2: p.x, y2: p.y } : { t: ed.tool, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }; redraw(); });
const endDraw = () => { if (!start || !ed) return; start = null; const d = ed.draft; ed.draft = null; if (d && (d.t === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > .03 : d.w > .02 && d.h > .02)) ed.shapes.push(d); redraw(); };
cv.addEventListener('pointerup', endDraw); cv.addEventListener('pointercancel', endDraw);
$$('.tool [data-t]').forEach(b => b.onclick = () => { ed.tool = b.dataset.t; $$('.tool [data-t]').forEach(x => x.classList.toggle('on', x === b)); });
$('#edUndo').onclick = () => { ed.shapes.pop(); redraw(); };
$('#edSwap').onclick = () => $('#inSwap').click();
$('#inSwap').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f || !ed) return; const { blob, w, h } = await compress(f); Object.assign(ed.item, { photo: blob, w, h }); ed.shapes = []; ed.img = await loadImg(blobURL(blob)); fitCanvas(); });
function renderAmbChips() {
  const list = lines(cfg.ambientes), a = ed.item.amb; if (a && !list.includes(a)) list.push(a);
  $('#edAmbs').innerHTML = list.map(x => `<button class="chip ${x === a ? 'on' : ''}" data-a="${esc(x)}">${esc(x)}</button>`).join('') + '<button class="chip add" data-a="__o">+ Outro</button>';
  $('#edAmbOther').hidden = true;
  $('#edAmbs').querySelectorAll('.chip').forEach(b => b.onclick = () => { if (b.dataset.a === '__o') { $('#edAmbOther').hidden = false; $('#edAmbOther').value = ''; $('#edAmbOther').focus(); return; } ed.item.amb = b.dataset.a; renderAmbChips(); });
  const on = $('#edAmbs .chip.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}
$('#edAmbOther').addEventListener('change', e => { const val = e.target.value.trim(); if (val) { ed.item.amb = val; renderAmbChips(); } });
/* frases rápidas inteligentes: as mais usadas sobem; frases digitadas 2+ vezes viram sugestão */
const normF = s => s.trim().replace(/\s+/g, ' ');
function smartPhrases() {
  const base = lines(cfg.frases), uso = cfg.frasesUso || {}, set = new Set(base);
  const extras = Object.entries(uso).filter(([k, n]) => n >= 2 && !set.has(k) && k.length <= 80).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  return [...base, ...extras].map((p, i) => ({ p, n: uso[p] || 0, i })).sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.p);
}
function renderPhrases() {
  $('#edPhr').innerHTML = smartPhrases().map(p => `<button class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  $('#edPhr').querySelectorAll('.chip').forEach(b => b.onclick = () => { const t = $('#edDesc'), c = t.value.trimEnd(); t.value = (c ? c + '\n' : '') + b.dataset.p; });
}
function countPhrases(desc, before) { const old = new Set(lines(before).map(normF)); cfg.frasesUso = cfg.frasesUso || {};
  for (const l of lines(desc)) { const k = normF(l); if (!old.has(k)) cfg.frasesUso[k] = (cfg.frasesUso[k] || 0) + 1; } saveCfg(); }
$('#edClose').onclick = () => closeTop();
$('#edSave').onclick = async () => {
  const v = cur(), amb = !$('#edAmbOther').hidden && $('#edAmbOther').value.trim() ? $('#edAmbOther').value.trim() : ed.item.amb;
  const it = { ...ed.item, amb, desc: $('#edDesc').value.trim(), shapes: ed.shapes };
  if (it.desc && it.desc !== (ed.item.desc || '')) countPhrases(it.desc, ed.item.desc);
  if (ed.isNew) { let pos = -1; v.items.forEach((x, i) => { if (x.amb === amb) pos = i; }); if (pos >= 0) v.items.splice(pos + 1, 0, it); else v.items.push(it); } else v.items[ed.idx] = it;
  v.lastAmb = amb; touch(v); await closeTop(); renderItems(); renderDriveState(); toast('Item salvo');
};
$('#edDel').onclick = () => {
  $('#edDelZone').innerHTML = '<div class="confirm"><span>Excluir este item?</span><button class="btn danger sm" id="edDelYes">Excluir</button><button class="btn sm" id="edDelNo">Cancelar</button></div>';
  $('#edDelNo').onclick = () => $('#edDelZone').innerHTML = '';
  $('#edDelYes').onclick = async () => { const v = cur(); v.items.splice(ed.idx, 1); touch(v); await closeTop(); renderItems(); toast('Item excluído'); };
  $('#edDelZone').scrollIntoView({ block: 'center' });
};

/* ================= PDF ================= */
function fileName(v) {
  const n = names(v), clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const un = clean(n.unidade).replace(/BLOCO\s*/g, 'BL').replace(/\bAPARTAMENTO\s*|\bAPTO?\s*/g, '').replace(/\s+/g, '_').replace(/\bBL(\d)\b/, 'BL0$1');
  return [n.tipo === 'revistoria' ? 'REVISTORIA' : 'RELATORIO', un, clean(n.proprietario).split(' ')[0] || ''].filter(Boolean).join('_') + '.pdf';
}
let lastPdf = null;
$('#btnPdf').onclick = () => {
  const v = cur(), n = names(v);
  if (!v.items.length) return toast('Adicione ao menos um item com foto');
  if (!n.empreendimento) { $('#idBox').open = true; toast('Selecione o condomínio: é a pasta do Drive'); $('#fEmp').focus(); return; }
  $('#pdfSub').textContent = `${v.items.length} itens · ${n.unidade}`;
  $('#oName').value = n.s.pdfNome || fileName(v); paintPath();
  $('#pdfMsg').hidden = true; $('#pdfProg').hidden = true; $('#pdfAfter').hidden = true; $('#pdfGo').disabled = false; lastPdf = null;
  openSheet('vPdf');
};
const paintPath = () => { $('#pdfPath').textContent = `${cfg.pasta || 'Vistorias'} / ${names(cur()).empreendimento} / ${$('#oName').value}`; };
$('#oName').addEventListener('input', paintPath);
$('#pdfClose').onclick = () => closeTop();
closeHooks.vPdf = () => { renderDriveState(); renderHead(); };
async function imgForPdf(blob, shapes, boxW, boxH) {
  const img = await loadImg(blobURL(blob)), W = img.naturalWidth, H = img.naturalHeight, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g2 = c.getContext('2d'); g2.drawImage(img, 0, 0); drawShapes(g2, shapes, W, H);
  const ar = W / H, boxAr = boxW / boxH, scale = Math.min(1, 1100 / Math.max(W, H)), out = document.createElement('canvas');
  if (Math.abs(ar - boxAr) / boxAr <= .18) { let sw = W, sh = H, sx = 0, sy = 0; if (ar > boxAr) { sw = H * boxAr; sx = (W - sw) / 2; } else { sh = W / boxAr; sy = (H - sh) / 2; }
    out.width = Math.round(sw * scale); out.height = Math.round(sh * scale); out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height); return { data: out.toDataURL('image/jpeg', .82), w: boxW, h: boxH, dx: 0, dy: 0 }; }
  out.width = Math.round(W * scale); out.height = Math.round(H * scale); const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(c, 0, 0, out.width, out.height);
  const k = Math.min(boxW / W, boxH / H); return { data: out.toDataURL('image/jpeg', .82), w: W * k, h: H * k, dx: (boxW - W * k) / 2, dy: (boxH - H * k) / 2 };
}
async function brandImg(src) { try { const i = await loadImg(src), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return { data: c.toDataURL('image/png'), ar: i.naturalWidth / i.naturalHeight }; } catch { return null; } }

async function buildPdf(v, opt, onProg) {
  const rev = v.tipo === 'revistoria', items = v.items.map((it, i) => ({ ...it, n: i + 1 }));
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const logo = await brandImg(cfg.logo || ASSET.logo), capa = await brandImg(cfg.capa || ASSET.capa), selo = await brandImg(cfg.selo || ASSET.selo);
  const DARK = [33, 31, 32], RED = [211, 38, 28];
  const title = rev ? 'RELATÓRIO DE REVISTORIA DO APARTAMENTO' : 'RELATÓRIO DE VISTORIA PARA ENTREGA DO APARTAMENTO';
  const objetivo = rev ? (cfg.objetivoRev || DEFAULT_CFG.objetivoRev) : (cfg.objetivo || DEFAULT_CFG.objetivo);
  let pageNo = 0;
  const header = () => {
    if (pageNo++ > 0) doc.addPage();
    doc.setDrawColor(...DARK); doc.setLineWidth(.4); doc.rect(6, 6, 198, 285); doc.setFillColor(...DARK); doc.rect(6, 6, 198, 36, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.text('IDENTIFICAÇÃO', 11, 14);
    const rows = [['Construtora: ', v.construtora, false], ['Empreendimento: ', v.empreendimento, true], ['Proprietário (a): ', v.proprietario, false], ['Unidade: ', v.unidade, true], ['Data: ', fmtDate(v.data), true]];
    let y = 19.6; doc.setFontSize(9.6);
    for (const [l, val, b] of rows) { doc.setFont('helvetica', 'normal'); doc.text(l, 11, y); const lw = doc.getTextWidth(l); doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.text(doc.splitTextToSize(String(val || ''), 118 - lw)[0] || '', 11 + lw, y); y += 4.6; }
    if (logo) { let h = 28, w = h * logo.ar; if (w > 60) { w = 60; h = w / logo.ar; } doc.addImage(logo.data, 'PNG', 199 - w, 10 + (28 - h) / 2, w, h); }
    doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(title, 105, 52, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 70, 70); doc.text(doc.splitTextToSize(objetivo, 150), 105, 58.5, { align: 'center', lineHeightFactor: 1.25 });
    doc.setFontSize(7.5); doc.setTextColor(140, 140, 140); doc.text(String(pageNo), 200, 288, { align: 'right' });
  };
  const obsBlock = (x, y, w, size) => { if (!v.obs) return; doc.setTextColor(...RED); doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.text(doc.splitTextToSize(('OBSERVAÇÃO: ' + v.obs).toUpperCase(), w), x, y, { align: 'center', lineHeightFactor: 1.2 }); };
  if (opt.cover) {
    header(); obsBlock(105, 80, 170, 13);
    if (capa) { let w = 150, h = w / capa.ar; if (h > 110) { h = 110; w = h * capa.ar; } doc.addImage(capa.data, 'PNG', 105 - w / 2, 105 + (110 - h) / 2, w, h); }
    doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const cl = []; if (cfg.whatsapp) cl.push('WhatsApp  ' + cfg.whatsapp); if (cfg.instagram) cl.push('Instagram  @' + cfg.instagram.replace(/^@/, ''));
    let cy = 279 - cl.length * 6; for (const s of cl) { doc.text(s, 197, cy, { align: 'right' }); cy += 6; }
    if (cfg.nome || cfg.registro) { doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.text(cfg.nome || '', 13, 273); doc.setFont('helvetica', 'normal'); doc.text(cfg.registro || '', 13, 278); }
  }
  const FW = 65, FH = 86, XS = [22, 123], YS = [68, 174];
  for (let p = 0; p < items.length; p += 4) {
    header(); const pg = items.slice(p, p + 4);
    for (let k = 0; k < pg.length; k++) {
      const it = pg[k], col = k % 2, row = k >> 1, x = XS[col], y = YS[row];
      try { const im = await imgForPdf(it.photo, it.shapes, FW, FH); doc.addImage(im.data, 'JPEG', x + im.dx, y + im.dy, im.w, im.h); } catch { doc.setFillColor(230, 230, 230); doc.rect(x, y, FW, FH, 'F'); }
      doc.setDrawColor(...DARK); doc.setLineWidth(.9); doc.rect(x, y, FW, FH);
      const ty = y + FH + 5.5; doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text((opt.num ? String(it.n).padStart(2, '0') + '  ' : '') + (it.amb || '') + ':', x + 2, ty);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(doc.splitTextToSize(it.desc || '', FW + 4).slice(0, row ? 3 : 4), x + 2, ty + 4.8, { lineHeightFactor: 1.18 });
      onProg((p + k + 1) / items.length);
    }
    if (opt.selo && selo) for (const row of [0, 1]) if (pg[row * 2] && pg[row * 2 + 1]) { const w = 26, h = w / selo.ar; doc.addImage(selo.data, 'PNG', 105 - w / 2 + .5, YS[row] + FH / 2 - h / 2, w, h); }
    if (pg.length < 4 && p + 4 >= items.length && v.obs && !opt.sum) { const k = pg.length; obsBlock(XS[k % 2] + FW / 2, YS[k >> 1] + FH / 2 - 8, FW, 12); }
  }
  if (opt.sum) {
    header(); let y = 72; doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('RESUMO DOS ITENS', 14, y); y += 6;
    const head = () => { doc.setFillColor(238, 238, 234); doc.rect(12, y - 4.2, 186, 6.5, 'F'); doc.setTextColor(...DARK); doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.text('Nº', 15, y); doc.text('AMBIENTE', 26, y); doc.text('ITEM', 78, y); y += 6.5; };
    head();
    for (const it of items) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); const L = doc.splitTextToSize((it.desc || '').replace(/\n/g, ' '), 116), hh = Math.max(1, L.length) * 4.2 + 2;
      if (y + hh > 262) { header(); y = 72; head(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
      doc.setTextColor(...DARK); doc.text(String(it.n).padStart(2, '0'), 15, y); doc.text(doc.splitTextToSize(it.amb || '', 48), 26, y); doc.text(L, 78, y, { lineHeightFactor: 1.2 });
      doc.setDrawColor(220, 220, 215); doc.setLineWidth(.2); doc.line(12, y + hh - 3.4, 198, y + hh - 3.4); y += hh;
    }
    if (v.obs) { if (y > 245) { header(); y = 72; } obsBlock(105, y + 6, 170, 11); y += 18; }
    if (y > 255) header();
    doc.setTextColor(...DARK); doc.setDrawColor(...DARK); doc.setLineWidth(.3); doc.line(60, 272, 150, 272);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(cfg.nome || 'Responsável técnico', 105, 277, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); if (cfg.registro) doc.text(cfg.registro, 105, 281.5, { align: 'center' });
  }
  return doc.output('blob');
}
function onUploaded(job, res) {
  if (!$('#vPdf').hidden && lastPdf && lastPdf.jobId === job.id) {
    const m = $('#pdfMsg'); m.hidden = false; m.className = 'notice good'; m.innerHTML = `Salvo no Drive: <span class="mono">${esc(cfg.pasta)} / ${esc(res.folder)} / ${esc(res.name)}</span>`;
    if (res.link) { $('#pdfOpen').href = res.link; $('#pdfOpen').hidden = false; }
  } else toast('PDF salvo no Drive: ' + res.name);
}
$('#pdfGo').onclick = async () => {
  const v = cur(); if (!window.jspdf) return toast('Biblioteca de PDF não carregou. Recarregue o app.');
  const n = names(v), s = n.s, opt = { cover: $('#oCover').checked, num: $('#oNum').checked, sum: $('#oSum').checked, selo: $('#oSelo').checked };
  $('#pdfGo').disabled = true; $('#pdfAfter').hidden = true; $('#pdfOpen').hidden = true;
  const prog = $('#pdfProg'), bar = prog.firstElementChild; prog.hidden = false; bar.style.width = '2%';
  const msg = $('#pdfMsg'); msg.hidden = false; msg.className = 'notice'; msg.textContent = 'Montando as páginas…';
  try {
    clearTimeout(saveTimers[v.id]);
    const blob = await buildPdf({ ...v, ...n }, opt, f => bar.style.width = Math.round(f * 95) + '%'); bar.style.width = '100%';
    let name = $('#oName').value.trim() || fileName(v); if (!/\.pdf$/i.test(name)) name += '.pdf';
    s.itens = v.items.map(i => [i.amb, i.desc]); s.pdfNome = name; if (s.etapa !== 'enviado') s.etapa = 'pdf'; upd(s); saveCfg(true);
    v.pdfAt = Date.now(); v.updatedAt = v.pdfAt; await persist(v);
    const job = { id: uid(), vid: v.id, sid: s.id, name, condo: n.empreendimento, tipo: n.tipo, unidade: n.unidade, blob, ts: Date.now(), fileId: s.driveFolder === n.empreendimento ? s.driveId : null, folder: s.driveFolder || null };
    await idb.put('fila', job); lastPdf = { blob, name, jobId: job.id }; $('#pdfAfter').hidden = false; renderHead();
    if (!hasToken()) { msg.className = 'notice warn'; msg.innerHTML = `PDF pronto e guardado na fila. Conecte ao Google para enviar ao Drive.<div style="margin-top:8px"><button class="btn sm primary" id="msgConnect">Conectar ao Google Drive</button></div>`; $('#msgConnect').onclick = connectGoogle; }
    else if (!navigator.onLine) { msg.className = 'notice warn'; msg.textContent = 'PDF pronto. Sem internet agora: ele vai para o Drive sozinho quando a conexão voltar.'; }
    else { msg.textContent = 'Enviando ao Drive…'; await processQueue(); }
  } catch (err) { msg.className = 'notice warn'; msg.textContent = 'Erro ao montar o PDF: ' + (err && err.message || err); }
  $('#pdfGo').disabled = false;
};
function markSent(s) {
  s.etapa = 'enviado'; s.enviadoEm = Date.now(); upd(s); saveCfg(true); renderHead();
  const m = $('#pdfMsg'); m.hidden = false; m.className = 'notice good';
  m.innerHTML = s.tipo === 'vistoria' && !revDe(s) ? `Relatório marcado como enviado ao cliente.<div style="margin-top:8px"><button class="btn sm blue" id="msgRev">Agendar revistoria</button></div>` : 'Relatório marcado como enviado ao cliente.';
  const r = $('#msgRev'); if (r) r.onclick = async () => { await closeTop(); await closeTop(); openServ(null, revPreset(s)); };
}
$('#pdfShare').onclick = async () => {
  if (!lastPdf) return; const s = names(cur()).s, c = cli(s.clienteId), text = fillMsg(cfg.msgEnvio, s);
  const file = new File([lastPdf.blob], lastPdf.name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); markSent(s); } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível compartilhar'); }
  } else { $('#pdfDown').click(); waOpen(c && c.telefone, text); toast('Anexe no WhatsApp o PDF que acabou de baixar.', 4500); }
};
$('#pdfMark').onclick = () => markSent(names(cur()).s);
$('#pdfDown').onclick = () => { if (!lastPdf) return; const a = document.createElement('a'); a.href = URL.createObjectURL(lastPdf.blob); a.download = lastPdf.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); };

/* ================= FINANCEIRO ================= */
let finMonth = new Date(); finMonth.setDate(1);
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
$('#finPrev').onclick = () => { finMonth.setMonth(finMonth.getMonth() - 1); renderFin(); };
$('#finNext').onclick = () => { finMonth.setMonth(finMonth.getMonth() + 1); renderFin(); };
function monthStats(key) {
  const list = services().filter(s => !s.cancelado && (s.data || '').startsWith(key));
  return { list, v: list.filter(s => s.tipo !== 'revistoria').length, r: list.filter(s => s.tipo === 'revistoria').length,
    cobrado: list.reduce((t, s) => t + (Number(s.valor) || 0), 0), recebido: list.reduce((t, s) => t + pago(s), 0), pendente: list.reduce((t, s) => t + pend(s), 0) };
}
function renderFin() {
  const st = monthStats(ym(finMonth));
  $('#finTitle').textContent = `${MESES[finMonth.getMonth()]} ${finMonth.getFullYear()}`;
  const pct = st.cobrado ? Math.min(100, Math.round(st.recebido / st.cobrado * 100)) : 0;
  $('#kpis').innerHTML = `
    <div class="kpi"><small>Vistorias</small><b>${st.v}</b></div>
    <div class="kpi"><small>Revistorias</small><b>${st.r}</b></div>
    <div class="kpi"><small>Cobrado</small><b>${brl(st.cobrado)}</b></div>
    <div class="kpi good"><small>Recebido</small><b>${brl(st.recebido)}</b></div>
    <div class="kpi wide ${st.pendente ? 'warn' : ''}"><div><small>A receber deste mês</small><b>${brl(st.pendente)}</b></div><div style="flex:0 1 150px;min-width:110px"><div class="sub" style="text-align:right;margin-bottom:6px">${pct}% recebido</div><div class="bar"><i style="width:${pct}%"></i></div></div></div>`;
  renderChart();
  const pendAll = services().filter(s => pend(s) > 0 && (s.data || '') <= todayISO()).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  $('#pendTotal').textContent = pendAll.length ? brl(pendAll.reduce((t, s) => t + pend(s), 0)) + ' no total' : '';
  $('#pendList').innerHTML = pendAll.length ? pendAll.map(s => { const days = Math.round((parseISO(todayISO()) - parseISO(s.data)) / 864e5);
    return `<div class="lrow"><button class="grow" data-s="${esc(s.id)}" style="border:0;background:none;text-align:left;padding:0;color:inherit"><b>${esc(cliName(s.clienteId) || 'Sem cliente')}</b><small>${esc([empName(s.condominioId), s.unidade].filter(Boolean).join(' · '))} · ${fmtDateBR(s.data)}${days > 0 ? ` · há ${days} dia${days > 1 ? 's' : ''}` : ''}</small><span class="money red">${brl(pend(s))}</span></button>
      <button class="btn sm wa" data-cob="${esc(s.id)}" aria-label="Cobrar pelo WhatsApp"><svg><use href="#i-wa"/></svg>Cobrar</button></div>`; }).join('') : '<div class="empty" style="padding:18px"><p style="margin:0 auto">Nada pendente. Tudo recebido.</p></div>';
  bindSvc($('#pendList'));
  $$('#pendList [data-cob]').forEach(b => b.onclick = () => { const s = sv(b.dataset.cob), c = cli(s.clienteId); waOpen(c && c.telefone, fillMsg(cfg.msgCobranca, s)); });
}
function renderChart() {
  const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(finMonth.getFullYear(), finMonth.getMonth() - i, 1); months.push({ d, ...monthStats(ym(d)) }); }
  const W = 600, H = 210, L = 56, B = 26, T = 10, max = Math.max(100, ...months.map(m => m.cobrado));
  const p10 = Math.pow(10, Math.floor(Math.log10(max))), nice = Math.ceil(max / p10) * p10;
  const y = v => T + (H - T - B) * (1 - v / nice), gw = (W - L) / 6, bw = Math.min(24, gw * .28);
  const bar = (x, v, tok) => { if (!(v > 0)) return ''; const top = y(v), h = (H - B) - top, r = Math.min(4, h, bw / 2);
    return `<path d="M${x} ${H - B}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${H - B}Z" fill="var(${tok})"/>`; };
  let g = '';
  for (let i = 0; i <= 3; i++) { const v = nice * i / 3, yy = y(v); g += `<line x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${i ? brlShort(v) : '0'}</text>`; }
  months.forEach((m, i) => { const cx = L + gw * i + gw / 2, sel = i === 5;
    g += bar(cx - bw - 1, m.cobrado, '--bar-a') + bar(cx + 1, m.recebido, '--bar-b');
    g += `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="12" font-weight="${sel ? 700 : 500}" fill="var(${sel ? '--ink' : '--muted'})">${MESES[m.d.getMonth()].slice(0, 3)}</text>`;
    g += `<rect x="${L + gw * i}" y="0" width="${gw}" height="${H}" fill="transparent" data-m="${i}" style="cursor:pointer"><title>${MESES[m.d.getMonth()]}: cobrado ${brl(m.cobrado)}, recebido ${brl(m.recebido)}</title></rect>`; });
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cobrado e recebido nos últimos 6 meses">${g}</svg>`;
  const tip = i => { const m = months[i]; $('#chartTip').innerHTML = `<b style="text-transform:capitalize">${MESES[m.d.getMonth()]}</b> · cobrado ${brl(m.cobrado)} · recebido ${brl(m.recebido)} · ${m.v + m.r} serviço${m.v + m.r === 1 ? '' : 's'}`; };
  $$('#chart [data-m]').forEach(r => { r.addEventListener('click', () => tip(+r.dataset.m)); r.addEventListener('mouseenter', () => tip(+r.dataset.m)); });
  tip(5);
}

/* ---------- exportar para planilha Google ---------- */
async function exportSheet() {
  if (!hasToken()) { toast('Conecte ao Google Drive para exportar'); return connectGoogle(); }
  const rows = [['Data', 'Hora', 'Tipo', 'Cliente', 'Telefone', 'Construtora', 'Condomínio', 'Unidade', 'Valor cobrado', 'Valor recebido', 'Pendente', 'Formas de pagamento', 'Situação', 'PDF']];
  const num = n => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');
  for (const s of services().sort((a, b) => (a.data || '').localeCompare(b.data || ''))) {
    const c = cli(s.clienteId) || {};
    rows.push([fmtDateBR(s.data), s.hora || '', s.tipo === 'revistoria' ? 'Revistoria' : 'Vistoria', c.nome || '', c.telefone || '', conName(s.construtoraId), empName(s.condominioId), s.unidade || '',
      num(s.valor), num(pago(s)), num(pend(s)), [...new Set((s.pagamentos || []).map(p => p.forma))].join(', '),
      s.cancelado ? 'Cancelado' : { agendado: 'Agendado', andamento: 'Em andamento', pdf: 'PDF gerado', enviado: 'Enviado ao cliente' }[s.etapa || 'agendado'], s.driveLink || '']);
  }
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  try {
    toast('Criando a planilha…');
    const root = await folderId(cfg.pasta || 'Vistorias'), now = new Date();
    const name = `Controle Vistoria RS – ${fmtDate(todayISO()).replace(/\./g, '-')} ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
    const mp = multipart({ name, parents: [root], mimeType: 'application/vnd.google-apps.spreadsheet' }, new Blob([csv], { type: 'text/csv' }), 'text/csv');
    const r = await (await g(`${UP}?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: mp.headers, body: mp.body })).json();
    toast('Planilha criada na pasta ' + (cfg.pasta || 'Vistorias')); if (r.webViewLink) window.open(r.webViewLink, '_blank');
  } catch (e) { toast('Não consegui criar a planilha' + (e.message ? ': ' + e.message : '')); }
}
$('#btnExport').onclick = exportSheet; $('#mExp').onclick = exportSheet;

/* ================= CLIENTES ================= */
$('#mCli').onclick = () => { $('#cliQ').value = ''; renderCli(); openSheet('vCli'); };
$('#cliClose').onclick = () => closeTop();
$('#cliQ').addEventListener('input', renderCli);
function renderCli() {
  const q = ($('#cliQ').value || '').toLowerCase(), all = sortN(live(cfg.clientes)), list = all.filter(c => (c.nome + ' ' + (c.telefone || '')).toLowerCase().includes(q));
  $('#cliSub').textContent = `${all.length} cliente${all.length === 1 ? '' : 's'}`;
  $('#cliList').innerHTML = list.map(c => { const ss = services().filter(s => s.clienteId === c.id && !s.cancelado), p = ss.reduce((t, s) => t + pend(s), 0);
    return `<button class="lrow" data-c="${esc(c.id)}"><div class="grow"><b>${esc(c.nome)}</b><small>${esc(c.telefone || 'Sem telefone')} · ${ss.length} serviço${ss.length === 1 ? '' : 's'}</small></div>${p > 0 ? `<span class="pill wait">${brl(p)}</span>` : ''}<svg width="18" height="18" class="muted"><use href="#i-next"/></svg></button>`; }).join('')
    || `<div class="empty"><p>${all.length ? 'Ninguém encontrado.' : 'Nenhum cliente ainda. Eles são cadastrados no agendamento ou pelo botão +.'}</p></div>`;
  $$('#cliList [data-c]').forEach(b => b.onclick = () => openCli(b.dataset.c));
}
let cliD = null;
$('#cliNew').onclick = () => openCli(null);
function openCli(id) {
  cliD = id ? clone(cli(id)) : { id: 'p' + uid(), nome: '', telefone: '', email: '', novo: true };
  $('#cdTitle').textContent = cliD.nome || 'Novo cliente'; $('#cdNome').value = cliD.nome; $('#cdTel').value = cliD.telefone || ''; $('#cdEmail').value = cliD.email || '';
  const ss = services().filter(s => s.clienteId === cliD.id).sort((a, b) => (b.data || '').localeCompare(a.data || '')), ok = ss.filter(s => !s.cancelado);
  $('#cdSub').textContent = ok.length ? `${ok.length} serviço${ok.length > 1 ? 's' : ''}` : '';
  $('#cdKpis').innerHTML = ok.length ? `<div class="kpi"><small>Cobrado</small><b>${brl(ok.reduce((t, s) => t + (Number(s.valor) || 0), 0))}</b></div><div class="kpi ${ok.some(s => pend(s) > 0) ? 'warn' : 'good'}"><small>Pendente</small><b>${brl(ok.reduce((t, s) => t + pend(s), 0))}</b></div>` : '';
  $('#cdHist').innerHTML = ss.length ? ss.map(s => svcCard(s, true)).join('') : '<p class="muted" style="margin:0">Nenhum serviço ainda.</p>';
  bindSvc($('#cdHist'));
  $('#cdDelZone').innerHTML = cliD.novo ? '' : '<button class="btn sm danger" id="cdDel">Excluir cliente</button>';
  const d = $('#cdDel'); if (d) d.onclick = () => { $('#cdDelZone').innerHTML = `<div class="confirm"><span>Excluir ${esc(cliD.nome)}? Os serviços continuam no financeiro.</span><button class="btn sm danger" id="cdDelYes">Excluir</button></div>`;
    $('#cdDelYes').onclick = async () => { const c = cli(cliD.id); c.deleted = true; upd(c); saveCfg(true); await closeTop(); toast('Cliente excluído'); }; };
  openSheet('vCliDet'); if (cliD.novo) $('#cdNome').focus();
}
$('#cdClose').onclick = () => closeTop();
closeHooks.vCliDet = () => { if (!$('#vCli').hidden) renderCli(); };
$('#cdSave').onclick = () => { const nome = $('#cdNome').value.trim(); if (!nome) return $('#cdNome').focus();
  const c = upd({ ...cliD, nome, telefone: $('#cdTel').value.trim(), email: $('#cdEmail').value.trim() }); delete c.novo;
  const i = cfg.clientes.findIndex(x => x.id === c.id); if (i >= 0) cfg.clientes[i] = c; else cfg.clientes.push(c);
  cliD = clone(c); saveCfg(true); $('#cdTitle').textContent = nome; toast('Cliente salvo'); };
$('#cdWa').onclick = () => waOpen($('#cdTel').value, '');

/* ================= CADASTROS ================= */
let editEmp = null;
$('#mCad').onclick = () => { renderCad(); openSheet('vCad'); };
$('#cadClose').onclick = () => closeTop();
function renderCad() {
  const cons = sortN(live(cfg.construtoras));
  $('#cNewEmpCon').innerHTML = '<option value="">Selecione…</option>' + cons.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  $('#cConList').innerHTML = cons.map(c => { const n = live(cfg.condominios).filter(e => e.construtoraId === c.id).length;
    return `<div class="lrow"><div class="grow"><b>${esc(c.nome)}</b><small>${n} condomínio${n === 1 ? '' : 's'}</small></div><button class="btn sm ghost" data-ren="${esc(c.id)}">Renomear</button><button class="btn sm danger" data-delc="${esc(c.id)}">Excluir</button></div>`; }).join('') || '<p class="muted" style="margin:0">Nenhuma construtora cadastrada.</p>';
  const groups = {}; live(cfg.condominios).forEach(e => (groups[e.construtoraId] = groups[e.construtoraId] || []).push(e));
  $('#cEmpList').innerHTML = Object.keys(groups).sort((a, b) => conName(a).localeCompare(conName(b), 'pt-BR')).map(cid => `<div class="folder">${esc(conName(cid) || 'Sem construtora')}</div>` +
    sortN(groups[cid]).map(e => `<div class="lrow"><div class="grow"><b>${esc(e.nome)}</b>${e.endereco ? `<small>${esc(e.endereco)}</small>` : ''}</div><button class="btn sm ghost" data-ede="${esc(e.id)}">Editar</button><button class="btn sm danger" data-dele="${esc(e.id)}">Excluir</button></div>`).join('')).join('') || '<p class="muted" style="margin:0">Nenhum condomínio cadastrado.</p>';
  $$('#cConList [data-ren]').forEach(b => b.onclick = () => { const c = cfg.construtoras.find(x => x.id === b.dataset.ren), row = b.closest('.lrow');
    row.innerHTML = `<div class="field grow"><input value="${esc(c.nome)}" aria-label="Nome"></div><button class="btn sm primary">Salvar</button>`; const inp = row.querySelector('input'); inp.focus();
    row.querySelector('button').onclick = () => { const n = inp.value.trim(); if (!n) return; c.nome = n; upd(c); saveCfg(); renderCad(); }; });
  $$('#cConList [data-delc]').forEach(b => b.onclick = () => confirmRow(b, 'Excluir a construtora? Os condomínios dela ficam sem construtora.', () => {
    const c = cfg.construtoras.find(x => x.id === b.dataset.delc); c.deleted = true; upd(c); cfg.condominios.forEach(e => { if (e.construtoraId === c.id) { e.construtoraId = ''; upd(e); } }); saveCfg(); renderCad(); }));
  $$('#cEmpList [data-ede]').forEach(b => b.onclick = () => { const e = emp(b.dataset.ede); editEmp = e.id; $('#cNewEmp').value = e.nome; $('#cNewEmpCon').value = e.construtoraId || ''; $('#cNewEmpEnd').value = e.endereco || '';
    $('#cAddEmp').textContent = 'Salvar alterações'; $('#cCancelEmp').hidden = false; $('#cNewEmp').focus(); $('#cNewEmp').scrollIntoView({ block: 'center' }); });
  $$('#cEmpList [data-dele]').forEach(b => b.onclick = () => confirmRow(b, 'Excluir este condomínio da lista?', () => { const e = emp(b.dataset.dele); e.deleted = true; upd(e); saveCfg(); renderCad(); }));
}
function confirmRow(btn, msg, yes) { const row = btn.closest('.lrow'); row.innerHTML = `<span class="grow">${esc(msg)}</span><button class="btn sm danger">Excluir</button><button class="btn sm">Cancelar</button>`; const [y, n] = row.querySelectorAll('button'); y.onclick = yes; n.onclick = renderCad; }
$('#cAddCon').onclick = () => { const n = $('#cNewCon').value.trim(); if (!n) return $('#cNewCon').focus();
  if (live(cfg.construtoras).some(c => c.nome.toLowerCase() === n.toLowerCase())) return toast('Essa construtora já está na lista');
  cfg.construtoras.push(upd({ id: 'c' + uid(), nome: n })); $('#cNewCon').value = ''; saveCfg(); renderCad(); toast('Construtora adicionada'); };
$('#cNewCon').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cAddCon').click(); });
$('#cAddEmp').onclick = () => { const nome = $('#cNewEmp').value.trim(); if (!nome) return $('#cNewEmp').focus();
  const data = { nome, construtoraId: $('#cNewEmpCon').value, endereco: $('#cNewEmpEnd').value.trim() }, was = editEmp;
  if (editEmp) upd(Object.assign(emp(editEmp), data)); else cfg.condominios.push(upd({ id: 'e' + uid(), ...data }));
  cancelEmpEdit(); saveCfg(); renderCad(); toast(was ? 'Condomínio atualizado' : 'Condomínio adicionado'); };
function cancelEmpEdit() { editEmp = null; $('#cNewEmp').value = ''; $('#cNewEmpEnd').value = ''; $('#cAddEmp').textContent = 'Adicionar condomínio'; $('#cCancelEmp').hidden = true; }
$('#cCancelEmp').onclick = cancelEmpEdit;

/* ================= INDICADORES ================= */
let indPer = 'ano';
$('#mInd').onclick = () => { renderInd(); openSheet('vInd'); };
$('#indClose').onclick = () => closeTop();
$$('#indPer button').forEach(b => b.onclick = () => { indPer = b.dataset.p; $$('#indPer button').forEach(x => x.classList.toggle('on', x === b)); renderInd(); });
function renderInd() {
  const t = todayISO(), from = indPer === 'ano' ? t.slice(0, 4) + '-01-01' : indPer === '12' ? addDays(t, -365) : '0000';
  const list = services().filter(s => !s.cancelado && (s.data || '') >= from), groups = {};
  list.forEach(s => (groups[s.construtoraId || ''] = groups[s.construtoraId || ''] || []).push(s));
  const total = list.reduce((a, s) => a + (Number(s.valor) || 0), 0);
  const rows = Object.entries(groups).map(([id, ss]) => {
    const cob = ss.reduce((a, s) => a + (Number(s.valor) || 0), 0), rec = ss.reduce((a, s) => a + pago(s), 0), defs = {};
    ss.forEach(s => (s.itens || []).forEach(([, d]) => lines(d).forEach(l => { const k = normF(l).replace(/;$/, ''); defs[k] = (defs[k] || 0) + 1; })));
    return { nome: conName(id) || 'Sem construtora', n: ss.length, v: ss.filter(s => s.tipo !== 'revistoria').length, r: ss.filter(s => s.tipo === 'revistoria').length, cob, rec, top: Object.entries(defs).sort((a, b) => b[1] - a[1]).slice(0, 4) };
  }).sort((a, b) => b.cob - a.cob || b.n - a.n);
  $('#indBody').innerHTML = rows.length ? rows.map(r => `<div class="group" style="gap:10px">
      <div class="row between"><b style="font-size:17px">${esc(r.nome)}</b><span class="money">${brl(r.cob)}</span></div>
      <div class="bar"><i style="width:${total ? Math.round(r.cob / total * 100) : 0}%;background:var(--ink)"></i></div>
      <div class="row" style="gap:6px"><span class="pill vist plain">${r.v} vistoria${r.v === 1 ? '' : 's'}</span><span class="pill revi plain">${r.r} revistoria${r.r === 1 ? '' : 's'}</span><span class="pill plain">Recebido ${brl(r.rec)}</span><span class="pill plain">Ticket médio ${brl(r.n ? r.cob / r.n : 0)}</span></div>
      ${r.top.length ? `<div><h2 style="margin-bottom:6px">Defeitos mais comuns</h2>${r.top.map(([k, n]) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(k)}</span><span class="muted mono">${n}×</span></div>`).join('')}</div>` : '<small class="muted">Os defeitos aparecem aqui depois que os PDFs forem gerados.</small>'}
    </div>`).join('') : '<div class="empty"><p>Nenhum serviço no período.</p></div>';
}

/* ================= AJUSTES ================= */
let draft = null;
const imgSrc = k => draft[k] || ASSET[k];
function paintPv() { for (const k of ['logo', 'capa', 'selo']) $('#pv' + k[0].toUpperCase() + k.slice(1)).style.backgroundImage = `url('${imgSrc(k)}')`; }
function paintGState() {
  const el = $('#gState'); if (!el) return;
  el.innerHTML = hasToken() ? '<span style="color:var(--ok);font-weight:700">Conectado ao Google Drive.</span>' : clientId() ? 'Client ID salvo. Toque em Conectar e entre com sua conta Google.' : 'Siga o guia de instalação e cole aqui o Client ID gerado no Google Cloud.';
  $('#gConnect').textContent = hasToken() ? 'Reconectar' : 'Conectar ao Google Drive'; $('#gOut').hidden = !LS.get('vrs_connected');
}
function openSettings() { draft = { ...cfg }; $$('#vSet [data-c]').forEach(el => el.value = draft[el.dataset.c] || ''); $('#sClient').value = clientId(); paintPv(); paintGState(); openSheet('vSet'); }
$('#mSet').onclick = openSettings;
$('#setClose').onclick = () => closeTop();
$('#sClient').addEventListener('change', e => { LS.set('vrs_client', e.target.value.trim()); paintGState(); renderDriveNote(); });
$('#gConnect').onclick = () => { LS.set('vrs_client', $('#sClient').value.trim()); connectGoogle(); };
$('#gOut').onclick = () => { disconnect(); toast('Desconectado do Google'); };
for (const k of ['logo', 'capa', 'selo']) $('#in' + k[0].toUpperCase() + k.slice(1)).addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const bmp = await createImageBitmap(f), s = Math.min(1, 1000 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); draft[k] = c.toDataURL('image/png'); paintPv(); });
$$('[data-reset]').forEach(b => b.onclick = () => { draft[b.dataset.reset] = null; paintPv(); });
$('#setSave').onclick = async () => {
  $$('#vSet [data-c]').forEach(el => draft[el.dataset.c] = el.value.trim()); if (!draft.pasta) draft.pasta = 'Vistorias';
  if (draft.pasta !== cfg.pasta) { LS.del('vrs_folders'); LS.del('vrs_cfg_file'); }
  const keep = {}; ARR.concat('frasesUso').forEach(k => keep[k] = cfg[k]);
  cfg = { ...draft, ...keep, setAt: Date.now() }; LS.set('vrs_client', $('#sClient').value.trim());
  saveCfg(true); await closeTop(); toast('Ajustes salvos');
};

/* ================= início ================= */
(async () => {
  captureTokenFromUrl();
  try { await idb.open(); } catch { toast('Este navegador bloqueou o armazenamento local.'); }
  await loadCfg();
  for (const v of await idb.all('vist')) vist.set(v.id, v);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  history.replaceState({ vrs: 0 }, '');
  showPage('pAgenda');
  const last = LS.get('vrs_last'); if (last && vist.has(last)) openVist(last);
  if (hasToken()) { await pullCfg(); processQueue(); }
  addEventListener('online', () => { processQueue(); pushCfg(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && hasToken() && Date.now() - lastPull > 60000) pullCfg(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
