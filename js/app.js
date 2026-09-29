/* Expense Vault — local-first PWA. No API keys or paid services required. */
let TX = [];
let CATS = [];
let INCOME_CATS = [];
let BUDGETS = [];
let PAYMENTS = [];
let PROFILE = {};
let SETTINGS = {};
const RECEIPTS = new Map();
const RECEIPT_URLS = new Map();
let draft = null;
let ocrWorker = null;
let ocrLogger = null;
let deferredInstallPrompt = null;
let restorePayload = null;

const TODAY = localDateISO(new Date());
const S = {
  v: 'home', mo: 0, q: '', range: 'all', from: '', to: '',
  f: { type: '', cat: '', pay: '', min: '', max: '', sort: 'new' },
  rf: { cat: '', from: '', to: '', min: '', max: '' },
  per: 'month', theme: 'system', rq: ''
};
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function localDateISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const D = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const ds = d => localDateISO(d);
const add = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return ds(d); };
const fd = s => D(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fdl = s => D(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const sum = l => l.reduce((a, t) => a + Number(t.amount || 0), 0);
const expenses = l => l.filter(t => (t.type || 'expense') === 'expense');
const incomes = l => l.filter(t => t.type === 'income');
const expenseSum = l => sum(expenses(l));
const incomeSum = l => sum(incomes(l));
const eur = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: PROFILE.currency || 'EUR' }).format(Number(n || 0));
const cat = n => CATS.find(c => c.name === n) || CATS.find(c => c.name === 'Other') || { name: n || 'Other', icon: '📦', color: '#8b8f98' };
const incomeCat = n => INCOME_CATS.find(c => c.name === n) || INCOME_CATS.find(c => c.name === 'Other Income') || { name: n || 'Other Income', icon: '＋', color: '#1f9d63' };
const txCat = t => t?.type === 'income' ? incomeCat(t.category) : cat(t?.category);
const monthKey = off => { const d = D(TODAY); d.setDate(1); d.setMonth(d.getMonth() + off); return ds(d).slice(0, 7); };
const monthName = k => D(k + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const inMonth = k => TX.filter(t => t.date.startsWith(k));
const between = (a, b) => TX.filter(t => t.date >= a && t.date <= b);
const uid = p => `${p}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
const catIco = c => `<div class="ico" style="background:${cat(c).color}22" aria-hidden="true">${cat(c).icon}</div>`;
const txCatIco = t => `<div class="ico" style="background:${txCat(t).color}22" aria-hidden="true">${txCat(t).icon}</div>`;
const status = p => p >= 100 ? ['ov', 'Over budget', 'var(--bad)'] : p >= 80 ? ['wn', 'Approaching', 'var(--warn)'] : ['ok', 'On track', 'var(--ok)'];

async function init() {
  await DB.open();
  await reloadData();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; if (S.v === 'more' || S.v === 'settings') render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (matchMedia) matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => S.theme === 'system' && render());
  render();
}

async function reloadData() {
  TX = await DB.all('transactions');
  CATS = await DB.getMeta('categories', structuredClone(CATS_DEFAULT));
  INCOME_CATS = await DB.getMeta('incomeCategories', structuredClone(INCOME_CATS_DEFAULT));
  const legacy = TX.filter(t => !t.type);
  legacy.forEach(t => t.type = 'expense');
  if (legacy.length) await Promise.all(legacy.map(t => DB.put('transactions', t)));
  BUDGETS = await DB.getMeta('budgets', structuredClone(BUDGETS_DEFAULT));
  PAYMENTS = await DB.getMeta('payments', structuredClone(PAYMENTS_DEFAULT));
  PROFILE = await DB.getMeta('profile', structuredClone(PROFILE_DEFAULT));
  SETTINGS = await DB.getMeta('settings', structuredClone(SETTINGS_DEFAULT));
  S.theme = SETTINGS.theme || 'system';
  RECEIPT_URLS.forEach(u => URL.revokeObjectURL(u)); RECEIPT_URLS.clear(); RECEIPTS.clear();
  (await DB.all('receipts')).forEach(r => RECEIPTS.set(r.id, r));
  await ensureDefaultsSaved();
}

async function ensureDefaultsSaved() {
  if ((await DB.getMeta('categories', null)) === null) await DB.setMeta('categories', CATS);
  if ((await DB.getMeta('incomeCategories', null)) === null) await DB.setMeta('incomeCategories', INCOME_CATS);
  if ((await DB.getMeta('budgets', null)) === null) await DB.setMeta('budgets', BUDGETS);
  if ((await DB.getMeta('payments', null)) === null) await DB.setMeta('payments', PAYMENTS);
  if ((await DB.getMeta('profile', null)) === null) await DB.setMeta('profile', PROFILE);
  if ((await DB.getMeta('settings', null)) === null) await DB.setMeta('settings', SETTINGS);
}

const store = {
  all: () => TX,
  get: id => TX.find(t => t.id === id),
  async save(t) {
    const i = TX.findIndex(x => x.id === t.id);
    i < 0 ? TX.push(t) : (TX[i] = t);
    await DB.put('transactions', t);
  },
  async remove(id) {
    const t = this.get(id);
    TX = TX.filter(x => x.id !== id);
    await DB.remove('transactions', id);
    if (t?.receiptId && !TX.some(x => x.receiptId === t.receiptId)) await deleteReceipt(t.receiptId);
  }
};

async function saveMeta(key, value) { await DB.setMeta(key, value); }
async function deleteReceipt(id) {
  if (!id) return;
  const u = RECEIPT_URLS.get(id); if (u) URL.revokeObjectURL(u);
  RECEIPT_URLS.delete(id); RECEIPTS.delete(id); await DB.remove('receipts', id);
}
function receiptUrl(id) {
  if (!id) return '';
  if (RECEIPT_URLS.has(id)) return RECEIPT_URLS.get(id);
  const r = RECEIPTS.get(id); if (!r?.blob) return '';
  const u = URL.createObjectURL(r.blob); RECEIPT_URLS.set(id, u); return u;
}

/* ---------- charts ---------- */
function bars(vals, labels, color = 'var(--acc)') {
  const max = Math.max(...vals, 1), w = 300 / Math.max(vals.length, 1);
  return `<svg viewBox="0 0 300 110" width="100%" role="img" aria-label="Bar chart">${vals.map((v, i) => {
    const h = v / max * 80;
    return `<rect x="${i * w + w * .15}" y="${90 - h}" width="${w * .7}" height="${h}" rx="${Math.min(4, w / 3)}" fill="${color}"/>`;
  }).join('')}${labels.map((l, i) => l ? `<text x="${i * w + w / 2}" y="104" text-anchor="middle">${esc(l)}</text>` : '').join('')}</svg>`;
}
function donut(items) {
  const tot = items.reduce((a, i) => a + i.v, 0) || 1; let off = 25;
  return `<svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label="Spending by category"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line)" stroke-width="6"/>${items.map(i => {
    const p = i.v / tot * 100, el = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${i.c}" stroke-width="6" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${off}"/>`; off -= p; return el;
  }).join('')}<text x="21" y="22.5" text-anchor="middle" style="font-size:5px;fill:var(--tx);font-weight:700">${esc(eur(tot).replace('.00', ''))}</text></svg>`;
}
const byCat = l => Object.entries(l.reduce((m, t) => (m[t.category] = (m[t.category] || 0) + Number(t.amount), m), {})).sort((a, b) => b[1] - a[1]);
const legend = l => byCat(l).slice(0, 5).map(([n, v]) => `<div class="row sp" style="margin:6px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cat(n).color};margin-right:8px"></i>${esc(n)}</span><b>${eur(v)}</b></div>`).join('');
const donutCard = l => `<div class="row donut-wrap"><div>${donut(byCat(l).slice(0, 6).map(([n, v]) => ({ v, c: cat(n).color })))}</div><div class="grow">${legend(l)}</div></div>`;

/* ---------- shell ---------- */
const NAV = [['home', '⌂', 'Home'], ['tx', '▤', 'Activity'], ['add', '＋', 'Add'], ['analytics', '▥', 'Analytics'], ['more', '☰', 'More']];
const SUBS = ['budgets', 'receipts', 'cats', 'backup', 'settings', 'profile'];
function go(v) { S.v = v; if (v !== 'tx') S.q = ''; closeSheet(); render(); scrollTo(0, 0); }
function render() {
  const t = S.theme === 'system' ? (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light') : S.theme;
  document.documentElement.dataset.theme = t;
  const on = SUBS.includes(S.v) ? 'more' : S.v;
  const viewFn = { home, tx: txView, analytics, more, budgets, receipts, cats, backup, settings, profile }[S.v] || home;
  $('#app').innerHTML = `<main id="main">${viewFn()}</main><nav aria-label="Main">${NAV.map(([k, i, l]) => k === 'add'
    ? `<button class="fab" aria-label="Add transaction" onclick="addChoose()">${i}</button>`
    : `<button class="${on === k ? 'on' : ''}" aria-current="${on === k ? 'page' : 'false'}" onclick="go('${k}')"><span aria-hidden="true">${i}</span>${l}</button>`).join('')}</nav>`;
}
function sheet(html, full = false) { const s = $('#sheet'); s.innerHTML = `<div class="pane ${full ? 'full' : ''}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`; s.classList.add('open'); }
function closeSheet() { const s = $('#sheet'); if (s) s.classList.remove('open'); }
document.addEventListener('click', e => { if (e.target?.id === 'sheet') closeSheet(); });
const back = t => `<div class="row" style="margin-bottom:8px"><button class="icon-btn" aria-label="Back" onclick="go('more')">←</button><h1 style="margin:0">${esc(t)}</h1></div>`;
const empty = (e, t, m, b, a) => `<div class="empty"><div class="e">${e}</div><h3>${esc(t)}</h3><p>${esc(m)}</p>${b ? `<button class="btn" style="max-width:260px" onclick="${a}">${esc(b)}</button>` : ''}</div>`;
const txRow = t => `<button class="item" onclick="txDetail('${t.id}')">${txCatIco(t)}<div class="grow"><b>${esc(t.merchant)}</b><div class="mut">${t.type === 'income' ? 'Income · ' : ''}${esc(t.category)} · ${fd(t.date)} ${t.receiptId ? '· 📎' : ''}</div></div><span class="amt ${t.type === 'income' ? 'income-amt' : ''}">${t.type === 'income' ? '+' : ''}${eur(t.amount)}</span></button>`;

function detailList(title, list, opts = {}) {
  const sorted = list.slice().sort((a,b) => b.date.localeCompare(a.date) || String(b.time || '').localeCompare(String(a.time || '')));
  const inc = incomeSum(sorted), out = expenseSum(sorted), singleDay = sorted.length && sorted.every(t => t.date === sorted[0].date);
  let last = '';
  const rows = sorted.map(t => {
    const dateHead = !singleDay && t.date !== last ? `<div class="detail-date">${fdl(t.date)}</div>` : '';
    last = t.date;
    return dateHead + `<button class="detail-item" onclick="txDetail('${t.id}')">${txCatIco(t)}<div class="grow"><b>${esc(t.merchant)}</b><div class="mut">${esc(t.category)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}${t.time ? ' · ' + esc(t.time) : ''}${t.receiptId ? ' · 📎' : ''}</div></div><span class="amt ${t.type === 'income' ? 'income-amt' : ''}">${t.type === 'income' ? '+' : ''}${eur(t.amount)}</span></button>`;
  }).join('');
  const summary = opts.type === 'income'
    ? `<div><span class="mut">Income</span><div class="detail-total income-amt">${eur(inc)}</div></div>`
    : opts.type === 'expense'
      ? `<div><span class="mut">Spent</span><div class="detail-total">${eur(out)}</div></div>`
      : `<div><span class="mut">Balance</span><div class="detail-total ${inc-out >= 0 ? 'income-amt' : 'up'}">${eur(inc-out)}</div></div><div class="detail-mini"><span>In ${eur(inc)}</span><span>Out ${eur(out)}</span></div>`;
  sheet(`<div class="detail-head"><div><h2 style="margin:0">${esc(title)}</h2>${opts.subtitle ? `<div class="mut">${esc(opts.subtitle)}</div>` : ''}</div><button class="icon-btn" aria-label="Close" onclick="closeSheet()">×</button></div>
    <div class="card detail-summary"><div>${summary}</div><div class="mut">${sorted.length} transaction${sorted.length===1?'':'s'}</div></div>
    <div class="card detail-list">${rows || empty('🧾','Nothing recorded','There are no matching transactions yet.')}</div>`, true);
}

function drillPeriod(type, from, to, title) {
  let l = between(from, to);
  if (type === 'expense') l = expenses(l);
  if (type === 'income') l = incomes(l);
  detailList(title, l, { type, subtitle: from === to ? fdl(from) : `${fd(from)} – ${fd(to)}` });
}
function drillMonth(type, key, title) {
  const l = type === 'income' ? incomes(inMonth(key)) : type === 'expense' ? expenses(inMonth(key)) : inMonth(key);
  detailList(title || monthName(key), l, { type, subtitle: monthName(key) });
}
function drillCategory(name, key = TODAY.slice(0,7)) {
  const l = expenses(inMonth(key)).filter(t => t.category === name);
  detailList(name, l, { type:'expense', subtitle: monthName(key) });
}
function drillMerchant(name, from, to) {
  const l = expenses(between(from,to)).filter(t => t.merchant === name);
  detailList(name, l, { type:'expense', subtitle: from === to ? fdl(from) : `${fd(from)} – ${fd(to)}` });
}
function categoryBreakdown(key = TODAY.slice(0,7)) {
  const l = expenses(inMonth(key));
  const rows = byCat(l).map(([n,v]) => `<button class="detail-item" onclick="drillCategory('${String(n).replace(/'/g,"\\'")}','${key}')"><div class="ico" style="background:${cat(n).color}22">${cat(n).icon}</div><div class="grow"><b>${esc(n)}</b><div class="mut">${l.filter(t=>t.category===n).length} transaction${l.filter(t=>t.category===n).length===1?'':'s'}</div></div><span class="amt">${eur(v)}</span></button>`).join('');
  sheet(`<div class="detail-head"><div><h2 style="margin:0">Spending categories</h2><div class="mut">${monthName(key)}</div></div><button class="icon-btn" aria-label="Close" onclick="closeSheet()">×</button></div>
    <div class="card detail-list">${rows || empty('🏷️','No category spending yet','Expenses will appear here once you add them.')}</div>`, true);
}

function monthOverview(key) {
  const l = inMonth(key), inc = incomeSum(l), out = expenseSum(l), bal = inc - out;
  const cats = byCat(expenses(l)).slice(0, 6);
  const catRows = cats.map(([n,v]) => `<button class="detail-item" onclick="drillCategory('${String(n).replace(/'/g,"\\'")}','${key}')"><div class="ico" style="background:${cat(n).color}22">${cat(n).icon}</div><div class="grow"><b>${esc(n)}</b><div class="mut">${expenses(l).filter(t=>t.category===n).length} transaction${expenses(l).filter(t=>t.category===n).length===1?'':'s'}</div></div><span class="amt">${eur(v)}</span></button>`).join('');
  const recent = l.slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.time||'').localeCompare(String(a.time||''))).slice(0,8);
  sheet(`<div class="detail-head"><div><h2 style="margin:0">${monthName(key)}</h2><div class="mut">Monthly breakdown</div></div><button class="icon-btn" aria-label="Close" onclick="closeSheet()">×</button></div>
    <div class="month-overview-grid">
      <button onclick="drillMonth('income','${key}','Income · ${monthName(key)}')"><span class="mut">Income</span><b class="income-amt">${eur(inc)}</b><span class="tap-more">View ›</span></button>
      <button onclick="drillMonth('expense','${key}','Expenses · ${monthName(key)}')"><span class="mut">Spent</span><b>${eur(out)}</b><span class="tap-more">View ›</span></button>
      <button onclick="drillMonth('all','${key}','Activity · ${monthName(key)}')"><span class="mut">Balance</span><b class="${bal>=0?'income-amt':'up'}">${eur(bal)}</b><span class="tap-more">View ›</span></button>
    </div>
    <div class="card"><div class="row sp"><h2>Top spending categories</h2><button class="detail-link" onclick="categoryBreakdown('${key}')">See all ›</button></div>${catRows || '<p class="mut">No spending this month.</p>'}</div>
    <div class="card"><div class="row sp"><h2>Recent activity</h2><button class="detail-link" onclick="drillMonth('all','${key}','Activity · ${monthName(key)}')">See all ›</button></div>${recent.map(txRow).join('') || '<p class="mut">No activity this month.</p>'}</div>`, true);
}

function dailySpendingBreakdown(key) {
  const l = expenses(inMonth(key));
  const byDay = {};
  l.forEach(t => { (byDay[t.date] ||= []).push(t); });
  const rows = Object.keys(byDay).sort((a,b)=>b.localeCompare(a)).map(date => {
    const dayList = byDay[date], total = sum(dayList);
    return `<button class="detail-item day-row" onclick="drillPeriod('expense','${date}','${date}','Expenses · ${fdl(date)}')"><div class="day-badge"><b>${D(date).getDate()}</b><span>${D(date).toLocaleDateString('en-GB',{weekday:'short'})}</span></div><div class="grow"><b>${dayList.length} purchase${dayList.length===1?'':'s'}</b><div class="mut">${dayList.slice(0,2).map(t=>esc(t.merchant)).join(' · ')}${dayList.length>2?' · +'+(dayList.length-2)+' more':''}</div></div><span class="amt">${eur(total)}</span></button>`;
  }).join('');
  sheet(`<div class="detail-head"><div><h2 style="margin:0">Daily spending</h2><div class="mut">${monthName(key)}</div></div><button class="icon-btn" aria-label="Close" onclick="closeSheet()">×</button></div>
    <div class="card detail-list">${rows || empty('📅','No daily spending yet','Expenses will appear here once you add them.')}</div>`, true);
}

/* ---------- home ---------- */
function home() {
  const k = monthKey(S.mo), cur = S.mo === 0, l = inMonth(k), out = expenseSum(l), inc = incomeSum(l), balance = inc - out, budget = Number(SETTINGS.monthlyBudget || 0), rem = budget - out;
  const days = cur ? Math.max(1, +TODAY.slice(8)) : new Date(+k.slice(0, 4), +k.slice(5), 0).getDate();
  const pk = monthKey(S.mo - 1), pl = expenses(inMonth(pk)).filter(t => +t.date.slice(8) <= days), ps = sum(pl), ch = ps ? (out - ps) / ps * 100 : 0;
  const wk = between(add(TODAY, -6), TODAY), dim = new Date(+k.slice(0, 4), +k.slice(5), 0).getDate();
  const dv = Array.from({ length: dim }, (_, i) => expenseSum(l.filter(t => +t.date.slice(8) === i + 1)));
  const pct = budget > 0 ? Math.min(100, out / budget * 100) : 0;
  return `<div class="month"><button aria-label="Previous month" onclick="S.mo--;render()">‹</button><h1 style="margin:0;font-size:20px">${monthName(k)}</h1><button aria-label="Next month" ${S.mo >= 0 ? 'disabled style="opacity:.3"' : ''} onclick="S.mo++;render()">›</button></div>
  <div class="card hero"><div class="row sp"><span>${cur ? 'This month · balance' : 'Monthly balance'}</span><button class="icon-btn hero-search" aria-label="Search" onclick="gsearch()">⌕</button></div>
  <button class="hero-summary" onclick="monthOverview('${k}')" aria-label="Open monthly breakdown">
    <div class="big">${eur(balance)}</div>
    <div class="row sp hero-money-row"><span>Income <b>${eur(inc)}</b></span><span>Expenses <b>${eur(out)}</b></span></div>
    ${budget > 0 ? `<div class="bar" style="margin:12px 0 8px"><i style="width:${pct}%"></i></div><div class="row sp"><span>${rem >= 0 ? eur(rem) + ' budget remaining' : eur(-rem) + ' over budget'}</span><span>of ${eur(budget)}</span></div>` : '<div style="margin-top:10px">No monthly budget set</div>'}
    <span class="hero-breakdown-label">View monthly breakdown ›</span>
  </button></div>
  <div class="grid2"><button class="card stat tap-card" onclick="drillPeriod('expense',TODAY,TODAY,'Today’s expenses')"><span class="mut">Today spent</span><b>${eur(expenseSum(TX.filter(t => t.date === TODAY)))}</b><span class="tap-more">View details ›</span></button><button class="card stat tap-card" onclick="drillPeriod('expense',add(TODAY,-6),TODAY,'This week’s expenses')"><span class="mut">This week spent</span><b>${eur(expenseSum(wk))}</b><span class="tap-more">View details ›</span></button>
  <button class="card stat tap-card" onclick="drillMonth('income','${k}','Income · ${monthName(k)}')"><span class="mut">Income this month</span><b class="income-amt">${eur(inc)}</b><span class="tap-more">View details ›</span></button><button class="card stat tap-card" onclick="drillMonth('expense','${k}','Expenses · ${monthName(k)}')"><span class="mut">Monthly spending</span><b>${eur(out)}</b><span class="tap-more">View details ›</span></button></div>
  <button class="card daily-spending-card" style="margin-top:14px" onclick="dailySpendingBreakdown('${k}')" aria-label="Open daily spending breakdown"><div class="row sp"><h2>Daily spending</h2><span class="tap-more" style="margin:0">View days ›</span></div>${bars(dv, dv.map((_, i) => (i + 1) % 5 === 0 ? i + 1 : ''))}</button>
  <div class="card"><div class="row sp"><h2>Where it went</h2><button class="mut detail-link" onclick="categoryBreakdown('${k}')">View categories ›</button></div>${expenses(l).length ? donutCard(expenses(l)) : '<p class="mut">No spending this month.</p>'}</div>
  <div class="card"><div class="row sp"><h2>Recent activity</h2><button class="mut" onclick="go('tx')">See all</button></div>${TX.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created)).slice(0, 6).map(txRow).join('') || empty('🧾', 'No activity yet', 'Add your first income or expense.', 'Add transaction', 'addChoose()')}</div>`;
}

/* ---------- transactions ---------- */
function filtered() {
  const f = S.f, q = S.q.toLowerCase();
  let l = TX.filter(t => {
    if (S.range === 'today' && t.date !== TODAY) return false;
    if (S.range === 'week' && (t.date < add(TODAY, -6) || t.date > TODAY)) return false;
    if (S.range === 'month' && !t.date.startsWith(TODAY.slice(0, 7))) return false;
    if (S.range === 'custom' && (t.date < (S.from || '0000-00-00') || t.date > (S.to || '9999-99-99'))) return false;
    if (f.type && (t.type || 'expense') !== f.type) return false;
    if (f.cat && t.category !== f.cat) return false;
    if (f.pay && t.payment !== f.pay) return false;
    if (f.min !== '' && t.amount < +f.min) return false;
    if (f.max !== '' && t.amount > +f.max) return false;
    return !q || `${t.merchant} ${t.category} ${t.subcategory || ''} ${t.notes || ''} ${t.payment}`.toLowerCase().includes(q);
  });
  const so = { new: (a, b) => b.date.localeCompare(a.date) || b.modified.localeCompare(a.modified), old: (a, b) => a.date.localeCompare(b.date), high: (a, b) => b.amount - a.amount, low: (a, b) => a.amount - b.amount };
  return l.sort(so[f.sort]);
}
function txView() {
  const l = filtered(), af = [S.f.type, S.f.cat, S.f.pay, S.f.min, S.f.max].filter(x => x !== '').length;
  let last = '';
  const rows = l.slice(0, 120).map(t => { const h = t.date !== last ? `<div class="mut date-group">${fdl(t.date)}</div>` : ''; last = t.date; return h + txRow(t); }).join('');
  return `<h1>Transactions</h1><input type="search" id="q" placeholder="Search merchant, category, notes" aria-label="Search transactions" value="${esc(S.q)}" oninput="S.q=this.value;liveTx()">
  <div class="chips" style="margin-top:10px">${[['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, n]) => `<button class="pill ${S.range === k ? 'on' : ''}" onclick="setRange('${k}')">${n}</button>`).join('')}<button class="pill ${af ? 'on' : ''}" onclick="filterSheet()">Filters${af ? ' (' + af + ')' : ''}</button></div>
  <div class="row sp mut" style="margin-bottom:6px"><span>${l.length} results · In ${eur(incomeSum(l))} · Out ${eur(expenseSum(l))}</span></div>
  <div class="card" id="txl">${rows || empty('🔎', 'No transactions match these filters', 'Try removing a filter.', 'Clear filters', 'clearF()')}</div>`;
}
function liveTx() { const p = $('#q'), pos = p.selectionStart; render(); const n = $('#q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
function setRange(k) { S.range = k; if (k === 'custom') return customSheet(); render(); }
function clearF() { S.f = { type: '', cat: '', pay: '', min: '', max: '', sort: 'new' }; S.range = 'all'; S.q = ''; closeSheet(); render(); }
function customSheet() { sheet(`<h2>Custom dates</h2><label for="cf">From</label><input type="date" id="cf" value="${S.from || TODAY.slice(0, 8) + '01'}"><label for="ct">To</label><input type="date" id="ct" value="${S.to || TODAY}"><button class="btn" style="margin-top:16px" onclick="S.from=$('#cf').value;S.to=$('#ct').value;closeSheet();render()">Apply</button>`); }
function filterSheet() {
  const f = S.f, o = (a, v) => a.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  sheet(`<h2>Filters</h2><label for="ftype">Type</label><select id="ftype"><option value="">All</option><option value="expense" ${f.type==='expense'?'selected':''}>Expenses</option><option value="income" ${f.type==='income'?'selected':''}>Income</option></select><label for="fc">Category</label><select id="fc"><option value="">All</option>${o([...CATS.map(c => c.name), ...INCOME_CATS.map(c => c.name)], f.cat)}</select>
  <label for="fp">Payment method</label><select id="fp"><option value="">All</option>${o(PAYMENTS, f.pay)}</select>
  <div class="grid2"><div><label for="fmin">Min amount</label><input id="fmin" type="number" inputmode="decimal" value="${f.min}"></div><div><label for="fmax">Max amount</label><input id="fmax" type="number" inputmode="decimal" value="${f.max}"></div></div>
  <label for="fs">Sort by</label><select id="fs">${[['new', 'Newest first'], ['old', 'Oldest first'], ['high', 'Highest amount'], ['low', 'Lowest amount']].map(([k, n]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
  <div class="btns"><button class="btn ghost" onclick="clearF()">Reset</button><button class="btn" onclick="S.f={type:$('#ftype').value,cat:$('#fc').value,pay:$('#fp').value,min:$('#fmin').value,max:$('#fmax').value,sort:$('#fs').value};closeSheet();render()">Apply</button></div>`);
}
function txDetail(id) {
  const t = store.get(id); if (!t) return;
  const url = receiptUrl(t.receiptId), isIncome = t.type === 'income';
  sheet(`<div class="row">${txCatIco(t)}<div class="grow"><h2 style="margin:0">${esc(t.merchant)}</h2><span class="mut">${isIncome ? 'Income · ' : ''}${esc(t.category)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}</span></div></div><div class="big ${isIncome ? 'income-amt' : ''}" style="margin:12px 0">${isIncome ? '+' : ''}${eur(t.amount)}</div>
  <div class="card">${[['Type', isIncome ? 'Income' : 'Expense'], ['Date', fdl(t.date) + ' · ' + (t.time || '')], [isIncome ? 'Received via' : 'Payment', t.payment], ...(isIncome || !(Number(t.taxTotal || 0) > 0) ? [] : [['Tax / VAT', eur(t.taxTotal)], ['Subtotal before tax', eur(t.subtotal ?? Math.max(0, Number(t.amount || 0) - Number(t.taxTotal || 0)))], ['Tax rate', (t.taxRates || []).length ? t.taxRates.join(', ') + '%' : '—']]), ['Notes', t.notes || '—'], ['Created', fd(t.created.slice(0, 10))], ['Last edited', fd(t.modified.slice(0, 10))]].map(([a, b]) => `<div class="row sp detail-row"><span class="mut">${a}</span><span>${esc(b)}</span></div>`).join('')}</div>
  ${url ? `<img class="rcp" alt="Attached document" src="${url}" style="max-height:220px;object-fit:contain;margin-bottom:10px">` : ''}
  <div class="btns" style="flex-wrap:wrap">${url ? `<button class="btn sec" onclick="rcpView('${id}')">View attachment</button>` : ''}<button class="btn sec" onclick="txForm('${id}')">Edit</button><button class="btn del" onclick="confirmDel('${id}')">Delete</button></div>`, true);
}
function confirmDel(id) {
  const t = store.get(id); if (!t) return;
  sheet(`<h2>Delete this transaction?</h2><div class="card"><b>${esc(t.merchant)}</b><div>${eur(t.amount)}</div><div class="mut">${fdl(t.date)}</div></div><div class="btns"><button class="btn ghost" onclick="closeSheet()">Cancel</button><button class="btn del" onclick="deleteTx('${id}')">Delete</button></div>`);
}
async function deleteTx(id) { await store.remove(id); closeSheet(); render(); }
function rcpView(id) {
  const t = store.get(id), url = t ? receiptUrl(t.receiptId) : ''; if (!t || !url) return;
  sheet(`<img class="rcp" alt="Receipt from ${esc(t.merchant)}" src="${url}"><div class="card" style="margin-top:12px"><div class="row sp"><b>${esc(t.merchant)}</b><b>${eur(t.amount)}</b></div><div class="mut">${esc(t.category)} · ${fd(t.date)}</div></div>
  <div class="btns" style="flex-wrap:wrap"><button class="btn sec" onclick="txForm('${id}')">Edit</button><button class="btn sec" onclick="downloadReceipt('${id}')">Download</button><button class="btn del" onclick="confirmDel('${id}')">Delete</button></div>`, true);
}
function downloadReceipt(id) {
  const t = store.get(id), r = t && RECEIPTS.get(t.receiptId); if (!r) return;
  downloadBlob(r.blob, r.name || `receipt-${t.date}.jpg`);
}
function toast(m) { sheet(`<h2>${esc(m)}</h2><button class="btn" onclick="closeSheet()">OK</button>`); }

/* ---------- receipt capture + OCR ---------- */
function addChoose() {
  draft = null;
  sheet(`<h2>Add transaction</h2><button class="choice" onclick="incomeForm()"><span class="ico" style="background:#1f9d6322">💶</span><span><b>Add Income</b><br><span class="mut">Salary, tips, private work or other income</span></span></button>
  <button class="choice" onclick="pick('photo')"><span class="ico" style="background:var(--acc2)">📷</span><span><b>Take Photo</b><br><span class="mut">Snap an expense receipt or invoice</span></span></button>
  <button class="choice" onclick="pick('upload')"><span class="ico" style="background:var(--acc2)">🖼️</span><span><b>Upload Receipt</b><br><span class="mut">Choose an existing expense image</span></span></button>
  <button class="choice" onclick="txForm()"><span class="ico" style="background:var(--acc2)">✏️</span><span><b>Manual Expense</b><br><span class="mut">No receipt? Enter it quickly</span></span></button>`);
}
function pick(kind) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,image/*'; if (kind === 'photo') i.capture = 'environment';
  i.onchange = () => i.files?.[0] && scanPreview(i.files[0]); i.click();
}
async function scanPreview(file) {
  try {
    const blob = await compressReceipt(file);
    if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    const previewUrl = URL.createObjectURL(blob);
    draft = { file: blob, originalName: file.name || `receipt-${TODAY}.jpg`, previewUrl, date: TODAY, notes: '', scanned: true, ocrText: '' };
    sheet(`<h2>Receipt preview</h2><img class="rcp" alt="Receipt preview" src="${previewUrl}" style="max-height:56vh;object-fit:contain"><div class="btns"><button class="btn ghost" onclick="addChoose()">Retake</button><button class="btn" onclick="processReceipt()">Read receipt</button></div>`);
  } catch (e) { toast('Could not open this image. Please try another photo.'); }
}
async function compressReceipt(file) {
  const bmp = await createImageBitmap(file);
  const maxSide = 2000, scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.86));
}
async function waitForTesseract() {
  if (window.Tesseract) return;
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 100)); if (window.Tesseract) return; }
  throw new Error('OCR library could not load. Connect to the internet once and try again.');
}
async function getOcrWorker() {
  await waitForTesseract();
  if (ocrWorker) return ocrWorker;
  const logger = m => ocrLogger?.(m);
  try { ocrWorker = await Tesseract.createWorker(SETTINGS.ocrLanguages || 'eng+spa+deu', 1, { logger }); }
  catch (_) { ocrWorker = await Tesseract.createWorker('eng', 1, { logger }); }
  return ocrWorker;
}
function ocrScreen(label = 'Preparing OCR…', pct = 4) {
  sheet(`<div style="text-align:center;padding:30px 0"><div class="spin"></div><h2 id="ocr-label" aria-live="polite">${esc(label)}</h2><div class="bar" style="max-width:260px;margin:auto"><i id="ocr-bar" style="width:${Math.max(4, pct)}%;background:var(--acc)"></i></div><p class="mut" style="margin-top:12px">Processing happens on this device. The first scan may take longer while the OCR engine is loaded.</p></div>`);
}
async function processReceipt() {
  if (!draft?.file) return scanFail('No receipt image is available.');
  ocrScreen();
  try {
    ocrLogger = m => {
      const p = Math.round((m.progress || 0) * 100), label = m.status ? m.status.replace(/_/g, ' ') : 'Reading receipt…';
      const el = $('#ocr-label'), bar = $('#ocr-bar'); if (el) el.textContent = label[0].toUpperCase() + label.slice(1); if (bar) bar.style.width = Math.max(4, p) + '%';
    };
    const worker = await getOcrWorker();
    const result = await worker.recognize(draft.file);
    const text = result?.data?.text || '';
    draft = { ...draft, ...parseReceipt(text), ocrText: text, scanned: true };
    txForm(null, draft);
  } catch (e) {
    scanFail(e.message || 'The receipt could not be read.');
  } finally { ocrLogger = null; }
}
function scanFail(message) {
  sheet(`<div style="text-align:center"><div style="font-size:44px">🧾</div><h2>We couldn't read this receipt reliably</h2><p class="mut">${esc(message || 'The image may be blurry, dark, or use an unusual layout.')}</p></div>
  <div class="btns" style="flex-direction:column"><button class="btn" onclick="processReceipt()">Try Again</button><button class="btn sec" onclick="txForm(null,{...draft,amount:draft?.amount||'',merchant:draft?.merchant||''})">Use Current Image</button><button class="btn ghost" onclick="txForm()">Enter Details Manually</button></div>`);
}
function parseReceipt(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
  const low = raw.toLowerCase();
  const totalWords = /(total|importe|a pagar|amount due|grand total|summe|gesamt|zu zahlen|betrag)/i;
  const moneyRe = /(?:€|eur\s*)?(-?\d{1,4}(?:[.,]\d{2}))(?:\s*€|\s*eur)?/ig;
  let amount = null;
  for (const line of lines.filter(x => totalWords.test(x)).reverse()) {
    const vals = [...line.matchAll(moneyRe)].map(m => parseMoney(m[1])).filter(Number.isFinite);
    if (vals.length) { amount = vals[vals.length - 1]; break; }
  }
  if (!Number.isFinite(amount)) {
    const vals = [...raw.matchAll(moneyRe)].map(m => parseMoney(m[1])).filter(v => Number.isFinite(v) && v > 0 && v < 100000);
    if (vals.length) amount = Math.max(...vals);
  }
  let date = TODAY;
  const dm = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2}|\d{2})\b/);
  const ym = raw.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (ym) date = safeDate(+ym[1], +ym[2], +ym[3]) || TODAY;
  else if (dm) date = safeDate(+((dm[3].length === 2 ? '20' : '') + dm[3]), +dm[2], +dm[1]) || TODAY;
  let payment = 'Other';
  if (/(visa|mastercard|maestro|tarjeta|card|kontaktlos|contactless)/i.test(raw)) payment = 'Debit Card';
  else if (/(cash|efectivo|barzahlung|bargeld)/i.test(raw)) payment = 'Cash';
  const merchant = detectMerchant(lines);
  const category = categorizeReceipt(merchant, low);
  const tax = parseTaxInfo(raw, Number.isFinite(amount) ? amount : null);
  return { merchant, amount: Number.isFinite(amount) ? amount : '', date, category, payment, notes: '', ...tax };
}

function parseTaxInfo(raw, totalAmount) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
  const money = s => [...String(s).matchAll(/(?:€|eur\s*)?(-?\d{1,6}(?:[.,]\d{2}))(?:\s*€|\s*eur)?/ig)]
    .map(m => parseMoney(m[1])).filter(v => Number.isFinite(v) && v >= 0);
  const rateRe = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g;
  const explicitTax = /(total\s*(?:iva|vat|tax)|(?:iva|vat|tax)\s*total|cuota\s*(?:iva|tributaria)?|vat\s*amount|tax\s*amount|mwst\.?\s*(?:betrag)?|impuesto\s*total)/i;
  const taxContext = /(iva|vat|tax|mwst|impuesto|base\s*imponible|tipo|cuota)/i;
  let taxTotal = null;
  const rates = [];
  const lineTaxAmounts = [];

  for (const line of lines) {
    const rateMatches = [...line.matchAll(rateRe)].map(m => parseMoney(m[1])).filter(v => v > 0 && v <= 50);
    rateMatches.forEach(r => { if (!rates.some(x => Math.abs(x - r) < 0.001)) rates.push(r); });

    if (explicitTax.test(line)) {
      const vals = money(line.replace(rateRe, ''));
      const plausible = vals.filter(v => !Number.isFinite(totalAmount) || v <= totalAmount);
      if (plausible.length) taxTotal = plausible[plausible.length - 1];
      continue;
    }

    if (taxContext.test(line) && rateMatches.length) {
      const vals = money(line.replace(rateRe, ''));
      if (vals.length >= 2) {
        const candidate = vals[vals.length - 1];
        if (candidate >= 0 && (!Number.isFinite(totalAmount) || candidate <= totalAmount)) lineTaxAmounts.push(candidate);
      }
    }
  }

  if (!Number.isFinite(taxTotal) && lineTaxAmounts.length) {
    const s = lineTaxAmounts.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(totalAmount) || s <= totalAmount) taxTotal = Math.round(s * 100) / 100;
  }

  const included = /(iva\s*(?:incluido|incl\.?|included)|vat\s*included|tax\s*included|inkl\.?\s*(?:mwst|ust)|mwst\s*inkl)/i.test(raw);
  if (!Number.isFinite(taxTotal) && included && rates.length === 1 && Number.isFinite(totalAmount) && totalAmount > 0) {
    taxTotal = Math.round((totalAmount - totalAmount / (1 + rates[0] / 100)) * 100) / 100;
  }

  if (!Number.isFinite(taxTotal) || taxTotal < 0 || (Number.isFinite(totalAmount) && taxTotal > totalAmount)) taxTotal = 0;
  const subtotal = Number.isFinite(totalAmount) ? Math.round(Math.max(0, totalAmount - taxTotal) * 100) / 100 : 0;
  return { taxTotal, taxRates: rates, subtotal };
}

function parseMoney(s) {
  s = String(s).replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return Number(s);
}
function safeDate(y, m, d) {
  if (y < 2000 || y > new Date().getFullYear() + 1 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? localDateISO(dt) : '';
}
function detectMerchant(lines) {
  const reject = /(ticket|receipt|factura|invoice|cif|nif|vat|iva|tel\.?|www\.|https?|fecha|date|hora|time|total|importe|gracias|thank|cliente|customer)/i;
  const candidates = lines.slice(0, 10).filter(l => /[a-záéíóúüñäöüß]/i.test(l) && !reject.test(l) && l.length >= 2 && l.length <= 55);
  return (candidates[0] || lines.find(l => /[a-z]/i.test(l)) || '').replace(/[^\p{L}\p{N}&.'’\- ]/gu, '').trim();
}
function categorizeReceipt(merchant, text) {
  const s = `${merchant} ${text}`.toLowerCase();
  const rules = [
    ['Groceries', /mercadona|lidl|aldi|carrefour|supermerc|hipermerc|grocery|spar\b|consum\b/],
    ['Pharmacy', /farmacia|pharmacy|apotheke/], ['Dental', /dentist|dental|odont/], ['Medical', /clinic|hospital|medical|medico|médico/],
    ['Fuel', /repsol|cepsa|shell|bp\b|gasolin|petrol|diesel/], ['Dining', /restaurant|restaurante|cafe|café|bar\b|bistro|tapas/],
    ['Takeaway', /just eat|ubereats|uber eats|glovo|takeaway|delivery/], ['Pets', /veterinar|pet shop|mascota/],
    ['Internet & Phone', /vodafone|movistar|orange|telefon|internet|fiber|fibra/], ['Utilities', /electric|iberdrola|endesa|water|agua|gas natural/],
    ['Transport', /renfe|metro|bus|taxi|uber|cabify|train/], ['Clothing', /zara|primark|h&m|mango|clothing|fashion|ropa/],
    ['Household', /ikea|leroy merlin|ferreter|hardware/], ['Shopping', /amazon|shopping|store|tienda/]
  ];
  return (rules.find(([, re]) => re.test(s)) || ['Other'])[0];
}

/* ---------- expense form ---------- */
function txForm(id, d) {
  if (id && store.get(id)?.type === 'income') return incomeForm(id, store.get(id));
  const t = id ? store.get(id) : d || { date: TODAY, payment: 'Debit Card', category: 'Groceries', notes: '', subcategory: '' };
  const o = (a, v) => a.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const existingUrl = id && t.receiptId ? receiptUrl(t.receiptId) : '';
  sheet(`<h2>${id ? 'Edit expense' : d?.scanned ? 'Review & Save' : 'Manual expense'}</h2>${d?.scanned ? '<div class="tag ok scan-tag">Detected locally from receipt — please check every field</div>' : ''}
  ${d?.previewUrl ? `<img class="rcp receipt-mini" alt="Receipt being reviewed" src="${d.previewUrl}">` : existingUrl ? `<img class="rcp receipt-mini" alt="Attached receipt" src="${existingUrl}">` : ''}
  <label for="fa">Amount</label><input id="fa" class="amt-in" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${t.amount ?? ''}">
  <div class="grid2"><div><label for="ftax">Tax / VAT (optional)</label><input id="ftax" type="number" inputmode="decimal" step="0.01" min="0" value="${Number(t.taxTotal || 0) ? t.taxTotal : ''}" placeholder="Auto-detected"></div><div><label>Tax rate</label><input value="${(t.taxRates || []).length ? esc(t.taxRates.join(', ') + '%') : ''}" placeholder="Auto-detected" readonly></div></div>
  <label for="fm">Merchant / Payee</label><input id="fm" value="${esc(t.merchant || '')}" placeholder="e.g. Mercadona">
  <div class="grid2"><div><label for="fd">Date</label><input id="fd" type="date" value="${t.date || TODAY}"></div><div><label for="fpay">Payment</label><select id="fpay">${o(PAYMENTS, t.payment)}</select></div></div>
  <label for="fcat">Category</label><select id="fcat">${o(CATS.map(c => c.name), t.category)}</select>
  <label for="fsub">Subcategory (optional)</label><input id="fsub" value="${esc(t.subcategory || '')}">
  <label for="fn">Notes</label><textarea id="fn" rows="2">${esc(t.notes || '')}</textarea>
  ${id && t.receiptId ? `<label for="fr">Replace receipt (optional)</label><input id="fr" type="file" accept="image/*"><label class="check"><input id="removeReceipt" type="checkbox"> Remove current receipt</label>` : d?.scanned ? '<p class="mut">📎 Receipt image will be saved with this expense.</p>' : '<label for="fr">Receipt image (optional)</label><input id="fr" type="file" accept="image/*" capture="environment">'}
  <p id="err" class="up" role="alert"></p><button class="btn" onclick="saveTx('${id || ''}')">${id ? 'Save changes' : 'Save Expense'}</button>`, true);
}
async function saveTx(id) {
  const a = parseFloat($('#fa').value), m = $('#fm').value.trim();
  if (!(a > 0) || !m) { $('#err').textContent = 'Enter an amount and a merchant.'; return; }
  const old = id ? store.get(id) : null, now = new Date().toISOString();
  let receiptId = old?.receiptId || null;
  try {
    if (old?.receiptId && $('#removeReceipt')?.checked) { await deleteReceipt(old.receiptId); receiptId = null; }
    let newBlob = null, newName = '';
    if (!id && draft?.file) { newBlob = draft.file; newName = draft.originalName; }
    else if ($('#fr')?.files?.[0]) { newBlob = await compressReceipt($('#fr').files[0]); newName = $('#fr').files[0].name; }
    if (newBlob) {
      if (receiptId) await deleteReceipt(receiptId);
      receiptId = uid('r');
      const row = { id: receiptId, blob: newBlob, name: newName || `receipt-${$('#fd').value || TODAY}.jpg`, type: newBlob.type || 'image/jpeg', size: newBlob.size, created: now };
      await DB.put('receipts', row); RECEIPTS.set(receiptId, row);
    }
    const taxTotal = Math.max(0, parseFloat($('#ftax')?.value) || 0);
    const taxRates = draft?.taxRates || old?.taxRates || [];
    const t = { id: id || uid('e'), type: 'expense', date: $('#fd').value || TODAY, time: old?.time || new Date().toTimeString().slice(0, 5), merchant: m, amount: a, taxTotal, taxRates, subtotal: Math.round(Math.max(0, a - taxTotal) * 100) / 100, category: $('#fcat').value, subcategory: $('#fsub').value.trim(), payment: $('#fpay').value, notes: $('#fn').value.trim(), receiptId, ocrText: draft?.ocrText || old?.ocrText || '', created: old?.created || now, modified: now };
    await store.save(t);
    if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    const wasScan = !!draft?.scanned; draft = null;
    sheet(`<div style="text-align:center;padding:24px 0"><div style="font-size:54px">✓</div><h2>Expense saved</h2><p>${eur(a)} added to ${esc(t.category)}.</p></div><button class="btn" onclick="closeSheet();go('${wasScan ? 'home' : S.v === 'tx' ? 'tx' : 'home'}')">Done</button>`);
  } catch (e) { const err = $('#err'); if (err) err.textContent = 'Could not save this expense. ' + (e.message || ''); }
}


/* ---------- income form ---------- */
function incomeForm(id, d) {
  const t = id ? store.get(id) : d || { date: TODAY, payment: 'Bank Transfer', category: 'Salary', notes: '' };
  const o = (a, v) => a.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const existingUrl = id && t.receiptId ? receiptUrl(t.receiptId) : '';
  sheet(`<h2>${id ? 'Edit income' : 'Add income'}</h2>
  ${existingUrl ? `<img class="rcp receipt-mini" alt="Income attachment" src="${existingUrl}">` : ''}
  <label for="ia">Amount received</label><input id="ia" class="amt-in" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${t.amount ?? ''}">
  <label for="im">Source / Payer</label><input id="im" value="${esc(t.merchant || '')}" placeholder="e.g. Salary, Restaurant tips, Private client">
  <div class="grid2"><div><label for="idate">Date received</label><input id="idate" type="date" value="${t.date || TODAY}"></div><div><label for="ipay">Received via</label><select id="ipay">${o(PAYMENTS, t.payment)}</select></div></div>
  <label for="icat">Income category</label><select id="icat">${o(INCOME_CATS.map(c => c.name), t.category)}</select>
  <label for="inotes">Notes</label><textarea id="inotes" rows="2">${esc(t.notes || '')}</textarea>
  ${id && t.receiptId ? `<label for="iproof">Replace attachment (optional)</label><input id="iproof" type="file" accept="image/*"><label class="check"><input id="iremove" type="checkbox"> Remove current attachment</label>` : '<label for="iproof">Payslip / proof image (optional)</label><input id="iproof" type="file" accept="image/*" capture="environment">'}
  <p id="ierr" class="up" role="alert"></p><button class="btn" onclick="saveIncome('${id || ''}')">${id ? 'Save changes' : 'Save Income'}</button>`, true);
}
async function saveIncome(id) {
  const a = parseFloat($('#ia').value), m = $('#im').value.trim();
  if (!(a > 0) || !m) { $('#ierr').textContent = 'Enter an amount and the income source.'; return; }
  const old = id ? store.get(id) : null, now = new Date().toISOString();
  let receiptId = old?.receiptId || null;
  try {
    if (old?.receiptId && $('#iremove')?.checked) { await deleteReceipt(old.receiptId); receiptId = null; }
    if ($('#iproof')?.files?.[0]) {
      const newBlob = await compressReceipt($('#iproof').files[0]);
      if (receiptId) await deleteReceipt(receiptId);
      receiptId = uid('r');
      const row = { id: receiptId, blob: newBlob, name: $('#iproof').files[0].name || `income-${$('#idate').value || TODAY}.jpg`, type: newBlob.type || 'image/jpeg', size: newBlob.size, created: now };
      await DB.put('receipts', row); RECEIPTS.set(receiptId, row);
    }
    const t = { id: id || uid('i'), type: 'income', date: $('#idate').value || TODAY, time: old?.time || new Date().toTimeString().slice(0, 5), merchant: m, amount: a, category: $('#icat').value, subcategory: '', payment: $('#ipay').value, notes: $('#inotes').value.trim(), receiptId, ocrText: '', created: old?.created || now, modified: now };
    await store.save(t);
    sheet(`<div style="text-align:center;padding:24px 0"><div style="font-size:54px">✓</div><h2>Income saved</h2><p class="income-amt">+${eur(a)} added as ${esc(t.category)}.</p></div><button class="btn" onclick="closeSheet();go('home')">Done</button>`);
  } catch (e) { const err = $('#ierr'); if (err) err.textContent = 'Could not save this income. ' + (e.message || ''); }
}

/* ---------- global search ---------- */
function gsearch() { sheet(`<input id="gs" type="search" placeholder="Mercadona, groceries, September 2026, 50-100" aria-label="Search" autofocus oninput="gres(this.value)"><div id="gr"><p class="mut">Try a merchant, category, month or amount range.</p></div>`, true); setTimeout(() => $('#gs')?.focus(), 80); }
function gres(q) {
  q = q.trim().toLowerCase(); const r = $('#gr'); if (!r) return; if (!q) { r.innerHTML = ''; return; }
  const rng = q.replace(/[€\s]/g, '').match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  const l = TX.filter(t => rng ? t.amount >= +rng[1] && t.amount <= +rng[2] : `${t.merchant} ${t.category} ${t.notes || ''} ${monthName(t.date.slice(0, 7))}`.toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date));
  const cs = [...CATS, ...INCOME_CATS].filter(c => c.name.toLowerCase().includes(q));
  r.innerHTML = `${cs.length ? `<h2 style="margin-top:14px">Categories</h2>${cs.map(c => `<button class="item" onclick="closeSheet();S.q='${esc(c.name)}';go('tx')"><div class="ico" style="background:${c.color}22">${c.icon}</div><b>${esc(c.name)}</b></button>`).join('')}` : ''}
  <h2 style="margin-top:14px">Activity (${l.length}) · In ${eur(incomeSum(l))} · Out ${eur(expenseSum(l))}</h2>${l.slice(0, 30).map(txRow).join('') || empty('🔎', 'No results', 'Try another search.')}`;
}

/* ---------- analytics ---------- */
function analytics() {
  const days = { day: 1, week: 7, month: 30, year: 365 }[S.per], from = add(TODAY, -(days - 1)), pf = add(from, -days), pt = add(from, -1);
  const l = between(from, TODAY), p = between(pf, pt), out = expenseSum(l), inc = incomeSum(l), net = inc - out, prev = expenseSum(p), ch = prev ? (out - prev) / prev * 100 : 0, big = expenses(l).slice().sort((a, b) => b.amount - a.amount)[0];
  let vals, labs, incVals;
  if (S.per === 'year') { const ks = Array.from({length:12},(_,i)=>monthKey(i-11)); vals = ks.map(k => expenseSum(inMonth(k))); incVals = ks.map(k => incomeSum(inMonth(k))); labs = ks.map(k => monthName(k).slice(0, 3)); }
  else { const n = S.per === 'day' ? 7 : days, st = add(TODAY, -(n - 1)); vals = Array.from({ length: n }, (_, i) => expenseSum(TX.filter(t => t.date === add(st, i)))); incVals = Array.from({ length: n }, (_, i) => incomeSum(TX.filter(t => t.date === add(st, i)))); labs = vals.map((_, i) => n <= 7 ? D(add(st, i)).toLocaleDateString('en-GB', { weekday: 'short' }) : (i % 5 === 4 ? add(st, i).slice(8) : '')); }
  const merch = Object.entries(expenses(l).reduce((m, t) => (m[t.merchant] = (m[t.merchant] || 0) + t.amount, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mk = [-3, -2, -1, 0].map(monthKey);
  return `<h1>Analytics</h1><div class="chips">${['day', 'week', 'month', 'year'].map(k => `<button class="pill ${S.per === k ? 'on' : ''}" onclick="S.per='${k}';render()">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
  <div class="grid2"><button class="card stat tap-card" onclick="drillPeriod('income','${from}',TODAY,'Income · ${S.per}')"><span class="mut">Income</span><b class="income-amt">${eur(inc)}</b><span class="tap-more">View details ›</span></button><button class="card stat tap-card" onclick="drillPeriod('expense','${from}',TODAY,'Expenses · ${S.per}')"><span class="mut">Expenses</span><b>${eur(out)}</b><span class="tap-more">View details ›</span></button><button class="card stat tap-card" onclick="drillPeriod('all','${from}',TODAY,'Activity · ${S.per}')"><span class="mut">Net balance</span><b class="${net >= 0 ? 'income-amt' : 'up'}">${eur(net)}</b><span class="tap-more">View activity ›</span></button><button class="card stat tap-card" onclick="drillPeriod('all','${from}',TODAY,'Transactions · ${S.per}')"><span class="mut">Transactions</span><b>${l.length}</b><span class="tap-more">View list ›</span></button></div>
  <div class="card" style="margin-top:14px"><span class="mut">Spending · ${fd(from)} – ${fd(TODAY)}</span><div class="big">${eur(out)}</div><span class="${ch > 0 ? 'up' : 'down'}">${prev ? `${ch > 0 ? '↑' : '↓'} ${Math.abs(ch).toFixed(1)}% vs previous ${S.per}` : 'No previous period comparison yet'}</span></div>
  <div class="grid2"><div class="card stat"><span class="mut">Avg spent/day</span><b>${eur(out / days)}</b></div><button class="card stat tap-card" ${big ? `onclick="txDetail('${big.id}')"` : 'disabled'}><span class="mut">Largest expense</span><b>${big ? eur(big.amount) : '—'}</b>${big ? '<span class="tap-more">View transaction ›</span>' : ''}</button></div>
  <div class="card" style="margin-top:14px"><h2>Spending over time</h2>${bars(vals, labs)}</div>
  <div class="card"><h2>Income over time</h2>${bars(incVals, labs, 'var(--ok)')}</div>
  <div class="card"><h2>Where does my money go?</h2>${expenses(l).length ? donutCard(expenses(l)) : '<p class="mut">No expense data.</p>'}</div>
  <div class="card"><h2>Top merchants</h2>${merch.map(([n, v]) => `<button class="merchant-row" onclick="drillMerchant('${String(n).replace(/'/g,"\\'")}','${from}',TODAY)"><div class="row sp"><span>${esc(n)}</span><b>${eur(v)}</b></div><div class="bar"><i style="width:${v / merch[0][1] * 100}%;background:var(--acc)"></i></div><span class="tap-more">View purchases ›</span></button>`).join('') || '<p class="mut">No expense data.</p>'}</div>
  <div class="card"><h2>Recent monthly income</h2>${bars(mk.map(k => incomeSum(inMonth(k))), mk.map(k => monthName(k).slice(0, 3)), 'var(--ok)')}</div>`;
}

/* ---------- more / budgets / categories ---------- */
function more() {
  const it = [['budgets', '🎯', 'Budgets'], ['receipts', '🧾', 'Receipts'], ['cats', '🏷️', 'Categories'], ['backup', '💾', 'Export & Backup'], ['settings', '⚙️', 'Settings'], ['profile', '👤', 'Profile']];
  return `<h1>More</h1>${deferredInstallPrompt ? '<button class="btn install-btn" onclick="installApp()">Install Expense Vault</button>' : ''}<div class="card">${it.map(([k, i, n]) => `<button class="item" onclick="go('${k}')"><span class="ico" style="background:var(--acc2)">${i}</span><b class="grow">${n}</b>›</button>`).join('')}</div>`;
}
async function installApp() { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; render(); }
function budgets() {
  const l = expenses(inMonth(TODAY.slice(0, 7))), cards = BUDGETS.map((b, i) => {
    const s = sum(l.filter(t => t.category === b.cat)), p = b.limit ? s / b.limit * 100 : 0, [c, txt, col] = status(p);
    return `<div class="card budget-card"><div class="row sp"><b>${cat(b.cat).icon} ${esc(b.cat)}</b><span class="tag ${c}">${txt}</span></div><div class="row sp" style="margin:8px 0"><span>${eur(s)} / ${eur(b.limit)}</span><b>${Math.round(p)}%</b></div><div class="bar"><i style="width:${Math.min(100, p)}%;background:${col}"></i></div><div class="mut" style="margin-top:6px">${b.limit - s >= 0 ? eur(b.limit - s) + ' remaining' : eur(s - b.limit) + ' over'}</div><div class="budget-actions"><button class="detail-link" onclick="drillCategory('${String(b.cat).replace(/'/g,"\\'")}')">View spending ›</button><button class="detail-link" onclick="budgetForm(${i})">Edit budget</button></div></div>`;
  }).join('');
  return back('Budgets') + `<div class="mut" style="margin-bottom:10px">${monthName(TODAY.slice(0, 7))}</div>${cards || empty('🎯', 'No budget created', 'Create your first monthly budget.')}<button class="btn" onclick="budgetForm(-1)">Add budget</button>`;
}
function budgetForm(i) {
  const b = BUDGETS[i] || { cat: 'Groceries', limit: '' };
  sheet(`<h2>${i < 0 ? 'Add budget' : 'Edit budget'}</h2><label for="bc">Category</label><select id="bc">${CATS.map(c => `<option value="${esc(c.name)}" ${c.name === b.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><label for="bl">Monthly limit</label><input id="bl" type="number" inputmode="decimal" value="${b.limit}">
  <div class="btns">${i >= 0 ? `<button class="btn del" onclick="removeBudget(${i})">Remove</button>` : ''}<button class="btn" onclick="saveBudget(${i})">Save</button></div>`);
}
async function saveBudget(i) { const v = { cat: $('#bc').value, limit: +$('#bl').value }; if (!(v.limit > 0)) return; i >= 0 ? BUDGETS[i] = v : BUDGETS.push(v); await saveMeta('budgets', BUDGETS); closeSheet(); render(); }
async function removeBudget(i) { BUDGETS.splice(i, 1); await saveMeta('budgets', BUDGETS); closeSheet(); render(); }
function cats() { return back('Categories') + `<div class="card">${CATS.map((c, i) => { const m=expenses(inMonth(TODAY.slice(0,7))).filter(t=>t.category===c.name), total=sum(m); return `<div class="category-manage-row">${catIco(c.name)}<button class="grow category-view" onclick="drillCategory('${String(c.name).replace(/'/g,"\\'")}')"><b>${esc(c.name)}</b><span class="mut">${m.length} this month · ${eur(total)}</span></button><button class="icon-btn category-edit" aria-label="Edit ${esc(c.name)}" onclick="catForm(${i})">✎</button></div>`; }).join('')}</div><button class="btn" onclick="catForm(-1)">New category</button>`; }
function catForm(i) {
  const c = CATS[i] || { name: '', icon: '⭐', color: '#5b6ee1', custom: true }; window._ic = c.icon; window._cc = c.color;
  sheet(`<h2>${i < 0 ? 'New category' : 'Category'}</h2><label for="cn">Name</label><input id="cn" value="${esc(c.name)}"><label>Icon</label><div class="sw">${['⭐', '🍕', '🎮', '🌿', '🏋️', '☕', '🔧', '🎓', '💼', '🚲', '🎵', '🧾'].map(x => `<button aria-label="Icon ${x}" class="${x === c.icon ? 'on' : ''}" onclick="_ic='${x}';this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${x}</button>`).join('')}</div>
  <label for="cc">Colour</label><input id="cc" type="color" value="${c.color}" onchange="_cc=this.value">
  <div class="btns">${c.custom && i >= 0 ? `<button class="btn del" onclick="removeCategory(${i})">Delete</button>` : ''}<button class="btn" onclick="saveCategory(${i})">Save</button></div>`);
}
async function saveCategory(i) {
  const n = $('#cn').value.trim(); if (!n) return;
  if (i >= 0) {
    const c = CATS[i], old = c.name; c.name = n; c.icon = window._ic; c.color = $('#cc').value || window._cc; c.id = c.id || old;
    if (old !== n) {
      const changed = TX.filter(t => (t.type || 'expense') === 'expense' && t.category === old);
      changed.forEach(t => { t.category = n; });
      await Promise.all(changed.map(t => DB.put('transactions', t)));
      BUDGETS.filter(b => b.cat === old).forEach(b => b.cat = n); await saveMeta('budgets', BUDGETS);
    }
  } else CATS.push({ id: uid('cat'), name: n, icon: window._ic, color: $('#cc').value || '#5b6ee1', custom: true });
  await saveMeta('categories', CATS); closeSheet(); render();
}
async function removeCategory(i) {
  const c = CATS[i]; if (!c?.custom) return;
  const changed = TX.filter(t => (t.type || 'expense') === 'expense' && t.category === c.name); changed.forEach(t => { t.category = 'Other'; });
  await Promise.all(changed.map(t => DB.put('transactions', t)));
  BUDGETS = BUDGETS.filter(b => b.cat !== c.name); CATS.splice(i, 1);
  await saveMeta('categories', CATS); await saveMeta('budgets', BUDGETS); closeSheet(); render();
}

/* ---------- receipts ---------- */
function receiptFiltered() {
  const q = S.rq.toLowerCase(), f = S.rf;
  return TX.filter(t => (t.type || 'expense') === 'expense' && t.receiptId && RECEIPTS.has(t.receiptId)).filter(t => {
    if (q && !`${t.merchant} ${t.category} ${t.amount}`.toLowerCase().includes(q)) return false;
    if (f.cat && t.category !== f.cat) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.min !== '' && t.amount < +f.min) return false;
    if (f.max !== '' && t.amount > +f.max) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));
}
function receipts() {
  const l = receiptFiltered(), af = Object.values(S.rf).filter(Boolean).length;
  return back('Receipts') + `<input type="search" placeholder="Search merchant, category or amount" aria-label="Search receipts" value="${esc(S.rq)}" oninput="S.rq=this.value;const p=this.selectionStart;render();const n=document.querySelector('[type=search]');n?.focus();n?.setSelectionRange(p,p)" style="margin-bottom:10px">
  <div class="chips"><button class="pill ${af ? 'on' : ''}" onclick="receiptFilterSheet()">Filters${af ? ' (' + af + ')' : ''}</button></div>
  ${l.length ? `<div class="rgrid">${l.slice(0, 80).map(t => `<button onclick="rcpView('${t.id}')"><img class="rcp" alt="" src="${receiptUrl(t.receiptId)}" style="height:130px;object-fit:cover;object-position:top"><b>${esc(t.merchant)}</b><div class="mut">${fd(t.date)} · ${esc(t.category)}</div><b>${eur(t.amount)}</b></button>`).join('')}</div>` : empty('🧾', 'No receipts found', 'Scan a receipt to build your archive.', 'Scan receipt', 'addChoose()')}`;
}
function receiptFilterSheet() {
  const f = S.rf;
  sheet(`<h2>Receipt filters</h2><label for="rfc">Category</label><select id="rfc"><option value="">All</option>${CATS.map(c => `<option value="${esc(c.name)}" ${c.name === f.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  <div class="grid2"><div><label for="rff">From</label><input type="date" id="rff" value="${f.from}"></div><div><label for="rft">To</label><input type="date" id="rft" value="${f.to}"></div></div>
  <div class="grid2"><div><label for="rfmin">Min amount</label><input id="rfmin" type="number" value="${f.min}"></div><div><label for="rfmax">Max amount</label><input id="rfmax" type="number" value="${f.max}"></div></div>
  <div class="btns"><button class="btn ghost" onclick="S.rf={cat:'',from:'',to:'',min:'',max:''};closeSheet();render()">Reset</button><button class="btn" onclick="S.rf={cat:$('#rfc').value,from:$('#rff').value,to:$('#rft').value,min:$('#rfmin').value,max:$('#rfmax').value};closeSheet();render()">Apply</button></div>`);
}

/* ---------- backup / export ---------- */
function backup() {
  return back('Export & Backup') + `<div class="card" style="text-align:center"><div style="font-size:44px">🔒</div><h2>Your records stay on this device</h2><p class="mut">Expense data and receipt images are stored in your browser's local database. Create backups regularly so clearing browser data or losing the device cannot erase your records.</p><div id="storageInfo" class="mut">${storageEstimateText()}</div></div>
  <button class="btn" onclick="createBackup()" style="margin-bottom:10px">💾 Create Full Backup</button><button class="btn sec" onclick="restoreBackupPick()" style="margin-bottom:10px">♻️ Restore Backup</button><button class="btn ghost" onclick="requestPersistentStorage()" style="margin-bottom:10px">Protect Local Storage</button>
  <div class="card" style="margin-top:14px"><h2>Export transactions</h2><div class="btns export-btns"><button class="btn sec" onclick="exportCsv()">CSV</button><button class="btn sec" onclick="exportExcel()">Excel</button></div></div>
  <div class="card" style="margin-top:14px"><h2>Reset</h2><p class="mut">Permanently remove all local transactions, receipt images, budgets and personal settings from this installation.</p><button class="btn del" onclick="resetLocalDataPrompt()">Erase all local data</button></div>`;
}
function storageEstimateText() { updateStorageEstimateSoon(); return 'Checking local storage…'; }
async function updateStorageEstimateSoon() {
  if (!navigator.storage?.estimate) return;
  const e = await navigator.storage.estimate(), used = formatBytes(e.usage || 0), quota = formatBytes(e.quota || 0); const el = $('#storageInfo'); if (el) el.textContent = `Storage used: ${used} of approximately ${quota}`;
}
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return toast('Persistent storage is not supported by this browser. Regular backups are still recommended.');
  const ok = await navigator.storage.persist(); toast(ok ? 'The browser has granted persistent local storage.' : 'The browser did not grant persistent storage. Keep creating regular backups.');
}
async function createBackup() {
  try {
    const payload = await DB.exportAll();
    payload.receipts = await Promise.all(payload.receipts.map(async r => ({ ...r, blob: undefined, dataUrl: await blobToDataURL(r.blob) })));
    payload.app = 'Expense Vault';
    downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `expense-vault-backup-${TODAY}.json`);
    await DB.setMeta('lastBackupAt', new Date().toISOString());
    toast('Backup created. Keep that file somewhere safe.');
  } catch (e) { toast('Could not create the backup: ' + (e.message || 'Unknown error')); }
}
function restoreBackupPick() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
  i.onchange = async () => {
    try {
      const raw = JSON.parse(await i.files[0].text());
      if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.transactions)) throw new Error('Invalid backup file.');
      raw.receipts = await Promise.all((raw.receipts || []).map(async r => ({ ...r, blob: await dataURLToBlob(r.dataUrl), dataUrl: undefined })));
      restorePayload = raw;
      sheet(`<h2>Restore this backup?</h2><div class="card"><b>${raw.transactions.length} transactions</b><div class="mut">${raw.receipts.length} receipt images</div><div class="mut">Backup: ${raw.exportedAt ? new Date(raw.exportedAt).toLocaleString() : 'Unknown date'}</div></div><p class="mut">This replaces the current local database.</p><div class="btns"><button class="btn ghost" onclick="restorePayload=null;closeSheet()">Cancel</button><button class="btn del" onclick="confirmRestore()">Restore</button></div>`);
    } catch (e) { toast('That file could not be restored. ' + (e.message || '')); }
  }; i.click();
}
async function confirmRestore() {
  if (!restorePayload) return; await DB.importAll(restorePayload); restorePayload = null; await reloadData(); closeSheet(); go('home');
}
function resetLocalDataPrompt() {
  sheet(`<h2>Erase all local data?</h2><p>This permanently deletes every transaction, saved receipt image, budget and customised setting on this device.</p><p class="mut">Create a full backup first if you may need the records again.</p><label for="resetWord">Type <b>DELETE</b> to confirm</label><input id="resetWord" autocomplete="off" placeholder="DELETE"><div class="btns"><button class="btn ghost" onclick="closeSheet()">Cancel</button><button class="btn del" onclick="resetLocalData()">Erase data</button></div>`);
}
async function resetLocalData() {
  if (($('#resetWord')?.value || '').trim().toUpperCase() !== 'DELETE') return toast('Type DELETE to confirm.');
  await DB.clear('transactions'); await DB.clear('receipts'); await DB.clear('meta');
  draft = null; S.mo = 0; S.q = ''; S.range = 'all'; S.from = ''; S.to = ''; S.f = { type: '', cat: '', pay: '', min: '', max: '', sort: 'new' }; S.rf = { cat: '', from: '', to: '', min: '', max: '' }; S.rq = '';
  await reloadData(); closeSheet(); go('home'); toast('Local data erased. Expense Vault is ready for a fresh start.');
}
function exportCsv() {
  const rows = [['ID', 'Type', 'Date', 'Time', 'Merchant / Source', 'Amount', 'Subtotal before tax', 'Tax / VAT', 'Tax rate(s)', 'Category', 'Subcategory', 'Payment / Received via', 'Notes'], ...TX.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(t => [t.id, t.type || 'expense', t.date, t.time, t.merchant, t.amount, t.type === 'income' ? '' : (t.subtotal ?? ''), t.type === 'income' ? '' : (t.taxTotal || ''), t.type === 'income' ? '' : ((t.taxRates || []).join(', ')), t.category, t.subcategory || '', t.payment, t.notes || ''])];
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `expenses-${TODAY}.csv`);
}
async function exportExcel() {
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX');
    const txRows = TX.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(t => ({ Type: t.type || 'expense', Date: t.date, Time: t.time, 'Merchant / Source': t.merchant, Amount: t.amount, 'Subtotal before tax': t.type === 'income' ? '' : (t.subtotal ?? ''), 'Tax / VAT': t.type === 'income' ? '' : (t.taxTotal || ''), 'Tax rate(s)': t.type === 'income' ? '' : ((t.taxRates || []).join(', ')), Category: t.category, Subcategory: t.subcategory || '', 'Payment / Received via': t.payment, Notes: t.notes || '', Attachment: t.receiptId ? 'Yes' : 'No' }));
    const months = [...new Set(TX.map(t => t.date.slice(0,7)))].sort();
    const summary = months.map(m => ({ Month: monthName(m), Income: incomeSum(inMonth(m)), Expenses: expenseSum(inMonth(m)), Balance: incomeSum(inMonth(m)) - expenseSum(inMonth(m)), Transactions: inMonth(m).length }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), 'Transactions'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Monthly Summary'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...CATS.map(c => ({ Type: 'Expense', Category: c.name })), ...INCOME_CATS.map(c => ({ Type: 'Income', Category: c.name }))]), 'Categories');
    XLSX.writeFile(wb, `expenses-${TODAY}.xlsx`);
  } catch (e) { toast('Excel export could not load. CSV export is available offline.'); }
}
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
}
function downloadBlob(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000); }
function blobToDataURL(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); }); }
async function dataURLToBlob(dataUrl) { if (!dataUrl) return new Blob(); const r = await fetch(dataUrl); return r.blob(); }
function formatBytes(n) { if (!n) return '0 B'; const u = ['B','KB','MB','GB']; let i = 0; while(n >= 1024 && i < u.length-1){ n/=1024; i++; } return `${n.toFixed(i?1:0)} ${u[i]}`; }

/* ---------- settings / profile ---------- */
function settings() {
  return back('Settings') + `<div class="card"><h2>General</h2><label for="currency">Currency</label><select id="currency" onchange="updateProfileSetting('currency',this.value)"><option value="EUR" ${PROFILE.currency==='EUR'?'selected':''}>EUR €</option></select><label for="language">Language preference</label><select id="language" onchange="updateProfileSetting('language',this.value)">${['English','Español','Deutsch'].map(x=>`<option ${PROFILE.language===x?'selected':''}>${x}</option>`).join('')}</select></div>
  <div class="card"><h2>Appearance</h2><div class="chips">${['light', 'dark', 'system'].map(k => `<button class="pill ${S.theme === k ? 'on' : ''}" onclick="setTheme('${k}')">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
  <div class="card"><h2>Finance</h2><label for="monthlyBudget">Overall monthly budget</label><input id="monthlyBudget" type="number" value="${SETTINGS.monthlyBudget || ''}" onchange="setMonthlyBudget(this.value)">${[['Categories', 'cats'], ['Budgets', 'budgets']].map(([n, k]) => `<button class="item" onclick="go('${k}')"><b class="grow">${n}</b>›</button>`).join('')}<button class="item" onclick="paymentMethods()"><b class="grow">Payment methods</b>›</button></div>
  <div class="card"><h2>Data</h2><button class="item" onclick="go('backup')"><b class="grow">Export & Backup</b>›</button>${deferredInstallPrompt ? '<button class="item" onclick="installApp()"><b class="grow">Install Expense Vault</b>›</button>' : ''}</div>
  <div class="card"><h2>Receipt recognition</h2><label for="ocrlang">OCR languages</label><select id="ocrlang" onchange="setOcrLanguages(this.value)"><option value="eng" ${SETTINGS.ocrLanguages==='eng'?'selected':''}>English</option><option value="eng+spa" ${SETTINGS.ocrLanguages==='eng+spa'?'selected':''}>English + Spanish</option><option value="eng+deu" ${SETTINGS.ocrLanguages==='eng+deu'?'selected':''}>English + German</option><option value="eng+spa+deu" ${SETTINGS.ocrLanguages==='eng+spa+deu'?'selected':''}>English + Spanish + German</option></select><p class="mut">More languages improve coverage but make the first OCR download larger.</p></div>
  <div class="card"><h2>Privacy</h2><p class="mut">Transactions and receipt images are stored locally in this browser. OCR is performed in your browser using Tesseract.js; no paid OCR account or API key is used.</p></div>
  <div class="card"><h2>Testing</h2><p class="mut">Optional: add sample income and expense transactions so you can test charts and filters. They can be deleted like normal transactions.</p><button class="btn sec" onclick="loadDemoData()">Add demo transactions</button></div>`;
}
async function setTheme(k) { S.theme = k; SETTINGS.theme = k; await saveMeta('settings', SETTINGS); render(); }
async function setMonthlyBudget(v) { SETTINGS.monthlyBudget = Math.max(0, Number(v) || 0); await saveMeta('settings', SETTINGS); }
async function setOcrLanguages(v) { SETTINGS.ocrLanguages = v; await saveMeta('settings', SETTINGS); if (ocrWorker) { try { await ocrWorker.terminate(); } catch (_) {} ocrWorker = null; } }
async function updateProfileSetting(k, v) { PROFILE[k] = v; await saveMeta('profile', PROFILE); render(); }
function paymentMethods() { sheet(`<h2>Payment methods</h2><div class="card">${PAYMENTS.map((p,i)=>`<div class="item"><b class="grow">${esc(p)}</b>${PAYMENTS_DEFAULT.includes(p)?'':`<button class="mut" onclick="removePayment(${i})">Remove</button>`}</div>`).join('')}</div><label for="newpay">Add custom method</label><input id="newpay" placeholder="e.g. Revolut"><button class="btn" style="margin-top:12px" onclick="addPayment()">Add</button>`); }
async function addPayment() { const v = $('#newpay').value.trim(); if (!v || PAYMENTS.includes(v)) return; PAYMENTS.push(v); await saveMeta('payments', PAYMENTS); paymentMethods(); }
async function removePayment(i) { if (PAYMENTS_DEFAULT.includes(PAYMENTS[i])) return; PAYMENTS.splice(i,1); await saveMeta('payments', PAYMENTS); paymentMethods(); }
function profile() { return back('Profile') + `<div class="card" style="text-align:center"><div class="ico profile-avatar">${esc((PROFILE.name || 'M')[0])}</div><h2>${esc(PROFILE.name || 'My Profile')}</h2></div><div class="card"><label for="pn">Name</label><input id="pn" value="${esc(PROFILE.name || '')}"><div class="row sp profile-row"><span class="mut">Currency</span><b>${esc(PROFILE.currency || 'EUR')}</b></div><div class="row sp profile-row"><span class="mut">Language preference</span><b>${esc(PROFILE.language || 'English')}</b></div><button class="btn" style="margin-top:16px" onclick="saveProfile()">Save</button></div>`; }
async function saveProfile() { PROFILE.name = $('#pn').value.trim() || PROFILE.name || 'My Profile'; await saveMeta('profile', PROFILE); render(); }

/* ---------- demo data, useful for testing only ---------- */
async function loadDemoData() {
  if (TX.length && !confirm('This will add demo transactions alongside your existing data. Continue?')) return;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pool = [['Mercadona','Groceries',12,68,'Debit Card'],['Lidl','Groceries',9,44,'Debit Card'],['Local Restaurant','Dining',18,55,'Credit Card'],['Repsol','Fuel',30,58,'Credit Card'],['Pharmacy','Pharmacy',5,28,'Debit Card'],['Amazon','Shopping',10,70,'Credit Card']];
  await store.save({id:uid('i'),type:'income',date:add(TODAY,-58),time:'10:00',merchant:'Salary',amount:900,category:'Salary',subcategory:'',payment:'Bank Transfer',notes:'Demo salary',receiptId:null,ocrText:'',created:new Date().toISOString(),modified:new Date().toISOString()});
  await store.save({id:uid('i'),type:'income',date:add(TODAY,-21),time:'22:30',merchant:'Tips',amount:85,category:'Tips',subcategory:'',payment:'Cash',notes:'Demo tips',receiptId:null,ocrText:'',created:new Date().toISOString(),modified:new Date().toISOString()});
  await store.save({id:uid('i'),type:'income',date:add(TODAY,-8),time:'16:00',merchant:'Private client',amount:120,category:'Private Work',subcategory:'',payment:'Bank Transfer',notes:'Demo private work',receiptId:null,ocrText:'',created:new Date().toISOString(),modified:new Date().toISOString()});
  for (let daysAgo=70; daysAgo>=0; daysAgo--) {
    const date=add(TODAY,-daysAgo); if (D(date).getDate()===1) await store.save({id:uid('e'),type:'expense',date,time:'09:00',merchant:'Rent',amount:700,category:'Housing',subcategory:'',payment:'Bank Transfer',notes:'Monthly rent',receiptId:null,ocrText:'',created:new Date().toISOString(),modified:new Date().toISOString()});
    if (rnd()<0.72) { const p=pool[Math.floor(rnd()*pool.length)]; await store.save({id:uid('e'),type:'expense',date,time:'12:00',merchant:p[0],amount:Math.round((p[2]+rnd()*(p[3]-p[2]))*100)/100,category:p[1],subcategory:'',payment:p[4],notes:'',receiptId:null,ocrText:'',created:new Date().toISOString(),modified:new Date().toISOString()}); }
  }
  render(); toast('Demo transactions added.');
}

init().catch(e => { document.body.innerHTML = `<main style="padding:24px;font-family:system-ui"><h1>Expense Vault</h1><p>Could not open the local database.</p><pre>${esc(e.message || e)}</pre></main>`; });