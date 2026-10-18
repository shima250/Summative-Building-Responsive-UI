/* ================= Validation and search helpers ================= */
window.TrackyRules = (() => {
  'use strict';
  const patterns = {
    description: /^\S(?:.*\S)?$/,
    amount: /^(0|[1-9]\d*)(\.\d{1,2})?$/,
    date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    category: /^[A-Za-z]+(?:[ -][A-Za-z]+)*$/,
    duplicate: /\b(\w+)\s+\1\b/i,
  };
  const validDate = value => {
    if (!patterns.date.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return !isNaN(date) && date.toISOString().slice(0, 10) === value;
  };
  function compile(pattern, insensitive = true) {
    try { return { regex: pattern ? new RegExp(pattern, insensitive ? 'i' : '') : null, error: '' }; }
    catch (error) { return { regex: null, error: 'Invalid regex: ' + error.message }; }
  }
  function highlight(value, regex) {
    const fragment = document.createDocumentFragment();
    const text = String(value);
    if (!regex) { fragment.append(text); return fragment; }
    const global = new RegExp(regex.source, regex.flags.replace(/g/g, '') + 'g');
    let end = 0;
    for (const match of text.matchAll(global)) {
      if (!match[0]) continue;
      fragment.append(text.slice(end, match.index));
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      fragment.append(mark);
      end = match.index + match[0].length;
    }
    fragment.append(text.slice(end));
    return fragment;
  }
  function validateBackup(raw) {
    const fail = message => { throw new Error(message); };
    if (!raw || raw.version !== 2 || !Array.isArray(raw.transactions) || !Array.isArray(raw.categories)) fail('Expected a version 2 Tracky backup with transactions and categories.');
    const ids = new Set();
    for (const c of raw.categories) {
      if (!c || typeof c.id !== 'string' || ! /^[A-Za-z0-9_-]+$/.test(c.id) || ids.has(c.id) || typeof c.name !== 'string' || c.name.length > 32 || !patterns.category.test(c.name) || !['income', 'expense'].includes(c.type)) fail('Invalid or duplicate category.');
      ids.add(c.id);
    }
    const records = new Set();
    for (const t of raw.transactions) {
      if (!t || typeof t !== 'object') fail('Invalid transaction.');
      const category = raw.categories.find(c => c.id === t.categoryId);
      if (!t || typeof t.id !== 'string' || ! /^[A-Za-z0-9_-]+$/.test(t.id) || records.has(t.id) || !['income', 'expense'].includes(t.type) || typeof t.amount !== 'number' || !Number.isFinite(t.amount) || t.amount <= 0 || t.amount > 1e10 || !patterns.amount.test(String(t.amount)) || typeof t.description !== 'string' || t.description.length > 60 || !patterns.description.test(t.description) || / {2,}/.test(t.description) || !validDate(t.date) || !category || category.type !== t.type || !['cash', 'momo', 'card', 'bank'].includes(t.method) || !Number.isFinite(t.createdAt) || !Number.isFinite(t.updatedAt) || t.updatedAt < t.createdAt) fail('Invalid transaction fields, timestamps, or category reference.');
      if (t.origAmount != null && (typeof t.origAmount !== 'number' || !Number.isFinite(t.origAmount) || t.origAmount <= 0)) fail('Invalid original amount.');
      if (!['RWF','USD','EUR','GBP','KES','UGX','TZS'].includes(t.origCurrency)) fail('Invalid original currency.');
      records.add(t.id);
    }
    const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e10;
    if (!raw.budget || (raw.budget.monthly !== null && !positive(raw.budget.monthly)) || !raw.budget.categories || typeof raw.budget.categories !== 'object' || Array.isArray(raw.budget.categories)) fail('Invalid budget.');
    for (const [id, limit] of Object.entries(raw.budget.categories)) if (!ids.has(id) || !positive(limit)) fail('Invalid category budget.');
    if (!raw.settings || !['RWF','USD','EUR','GBP','KES','UGX','TZS'].includes(raw.settings.currency) || !['light','dark','system'].includes(raw.settings.theme) || !raw.settings.rates) fail('Invalid settings.');
    for (const code of ['USD','EUR','GBP','KES','UGX','TZS']) if (!positive(raw.settings.rates[code])) fail('Invalid exchange rate.');
    return raw;
  }
  return { patterns, validDate, compile, highlight, validateBackup };
})();

(() => {
'use strict';
// Tracky — student finance tracker
// All data lives in localStorage. No server, no account.

const STORAGE_KEY = 'tracky:data:v2';
const PAGES = ['overview', 'transactions', 'budget', 'settings', 'about'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CURRENCIES = {
  RWF: { name: 'Rwandan franc', decimals: 0 },
  USD: { name: 'US dollar', decimals: 2 },
  EUR: { name: 'Euro', decimals: 2 },
  GBP: { name: 'British pound', decimals: 2 },
  KES: { name: 'Kenyan shilling', decimals: 0 },
  UGX: { name: 'Ugandan shilling', decimals: 0 },
  TZS: { name: 'Tanzanian shilling', decimals: 0 },
};
// How many RWF one unit of each currency is worth
const DEFAULT_RATES = { USD: 1450, EUR: 1690, GBP: 1950, KES: 11.2, UGX: 0.39, TZS: 0.56 };

const METHODS = { momo: 'Mobile money', cash: 'Cash', card: 'Card', bank: 'Bank transfer' };

const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', type: 'expense' },
  { id: 'transport', name: 'Transport', type: 'expense' },
  { id: 'rent', name: 'Fees', type: 'expense' },
  { id: 'school', name: 'Books', type: 'expense' },
  { id: 'airtime', name: 'Airtime', type: 'expense' },
  { id: 'health', name: 'Health', type: 'expense' },
  { id: 'fun', name: 'Entertainment', type: 'expense' },
  { id: 'shopping', name: 'Shopping', type: 'expense' },
  { id: 'other', name: 'Other', type: 'expense' },
  { id: 'allowance', name: 'Allowance', type: 'income' },
  { id: 'salary', name: 'Salary', type: 'income' },
  { id: 'scholarship', name: 'Scholarship', type: 'income' },
  { id: 'freelance', name: 'Side work', type: 'income' },
  { id: 'gifts', name: 'Gifts', type: 'income' },
  { id: 'other-income', name: 'Other income', type: 'income' },
];
// These two can't be deleted — deleted categories move their transactions here
const FIXED_CATEGORIES = ['other', 'other-income'];

const TRASH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';


/* ================= Helpers ================= */

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDate(new Date());
const thisMonth = () => todayIso().slice(0, 7);

function parseYm(ym) { return ym.split('-').map(Number); }
function monthLabel(ym) { const [y, m] = parseYm(ym); return MONTHS[m - 1] + ' ' + y; }
function monthName(ym) { return MONTHS[parseYm(ym)[1] - 1]; }
function daysInMonth(ym) { const [y, m] = parseYm(ym); return new Date(y, m, 0).getDate(); }
function shiftMonth(ym, by) {
  const [y, m] = parseYm(ym);
  const d = new Date(y, m - 1 + by, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

function makeId() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5); }

function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

// Accepts "2500", "2,500", "2 500", "12.5". Returns NaN for anything else.
function parseAmount(value) {
  const clean = String(value ?? '');
  if (!clean || clean === '.' || !TrackyRules.patterns.amount.test(clean)) return NaN;
  return Number(clean);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const sum = (list) => list.reduce((total, t) => total + t.amount, 0);


/* ================= Data ================= */

// Roughly three months of believable student spending, so the app isn't empty on first visit
function makeSampleTransactions() {
  let seed = 20261017;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const now = new Date();
  const list = [];

  function add(date, type, categoryId, description, amount, method) {
    list.push({
      id: makeId(), type, categoryId, description, method,
      amount: Math.max(100, Math.round(amount / 100) * 100),
      origAmount: null, origCurrency: 'RWF',
      date: isoDate(date), createdAt: date.getTime() + list.length, updatedAt: date.getTime() + list.length,
    });
  }

  add(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 96), 'income', 'other-income', 'Savings carried over', 120000, 'bank');

  for (let i = 95; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const day = d.getDate();
    if (day === 1) add(d, 'income', 'allowance', 'Monthly allowance from home', 150000, 'momo');
    if (day === 14) add(d, 'income', 'freelance', 'Tutoring sessions', 35000 + random() * 30000, 'momo');
    if (day === 2) add(d, 'expense', 'rent', 'Room rent', 60000, 'momo');
    if (random() < 0.85) add(d, 'expense', 'food', pick(['Lunch at the canteen', 'Groceries', 'Brochettes with friends', 'Coffee and mandazi', 'Chapati and tea', 'Fruit from the market']), 1200 + random() * 4300, pick(['cash', 'momo', 'momo']));
    if (random() < 0.6) add(d, 'expense', 'transport', pick(['Moto to campus', 'Bus to town', 'Moto home']), 400 + random() * 900, pick(['cash', 'card']));
    if (d.getDay() === 1) add(d, 'expense', 'airtime', pick(['MTN data bundle', 'Airtel airtime', 'Weekly internet bundle']), 1500 + random() * 2500, 'momo');
    if (random() < 0.1) add(d, 'expense', 'school', pick(['Photocopies', 'Printing assignment', 'Course textbook', 'Notebooks and pens']), 500 + random() * 9000, 'cash');
    if (random() < 0.08) add(d, 'expense', 'fun', pick(['Cinema with friends', 'Football match ticket', 'Weekend outing']), 3000 + random() * 7000, 'momo');
    if (random() < 0.04) add(d, 'expense', 'health', 'Pharmacy', 2000 + random() * 5000, 'cash');
    if (random() < 0.05) add(d, 'expense', 'shopping', pick(['Phone case', 'Toiletries', 'Kitenge shirt', 'Sandals']), 3000 + random() * 11000, pick(['card', 'momo']));
  }
  return list;
}

function freshData(withSample) {
  return {
    version: 2,
    sample: withSample,
    transactions: withSample ? makeSampleTransactions() : [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    budget: {
      monthly: withSample ? 200000 : null,
      categories: withSample ? { food: 70000, transport: 20000, fun: 15000 } : {},
    },
    settings: { currency: 'RWF', rates: { ...DEFAULT_RATES }, ratesUpdated: null, theme: 'system' },
    savedAt: null,
  };
}

// Cleans up anything loaded from storage or an imported file
function normalize(raw) {
  const base = freshData(false);
  const d = { ...base, ...raw };

  d.categories = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : base.categories;
  d.categories = d.categories.map(c => ({...c, name: c.name.replace(/&/g, 'and')}));
  for (const id of FIXED_CATEGORIES) {
    if (!d.categories.some((c) => c.id === id)) d.categories.push(DEFAULT_CATEGORIES.find((c) => c.id === id));
  }

  d.budget = { ...base.budget, ...(raw.budget || {}), categories: { ...((raw.budget || {}).categories || {}) } };
  d.settings = { ...base.settings, ...(raw.settings || {}), rates: { ...DEFAULT_RATES, ...((raw.settings || {}).rates || {}) } };
  if (!CURRENCIES[d.settings.currency]) d.settings.currency = 'RWF';

  d.transactions = (raw.transactions || [])
    .filter((t) => t && (t.type === 'income' || t.type === 'expense') && Number(t.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .map((t) => ({
      id: t.id || makeId(),
      type: t.type,
      amount: Number(t.amount),
      origAmount: t.origAmount ?? null,
      origCurrency: t.origCurrency || 'RWF',
      description: String(t.description || '').slice(0, 60) || 'Untitled',
      categoryId: d.categories.some((c) => c.id === t.categoryId) ? t.categoryId : (t.type === 'income' ? 'other-income' : 'other'),
      date: t.date,
      method: METHODS[t.method] ? t.method : 'cash',
      createdAt: t.createdAt || Date.now(),
      updatedAt: t.updatedAt || t.createdAt || Date.now(),
    }));
  return d;
}

let data;
let storageOk = true;

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalize(JSON.parse(saved));
    const first = freshData(true);
    first.savedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(first));
    return first;
  } catch (e) {
    storageOk = false;
    return freshData(true);
  }
}

function save() {
  data.savedAt = Date.now();
  if (!storageOk) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    toast("Couldn't save to this device", 'Browser storage is full or blocked. Export a backup from Settings.', 'error');
  }
}

// Change the data, save it, redraw the screen
function update(change) {
  const restoreFocus = rememberFocus();
  change(data);
  save();
  render();
  restoreFocus();
}

// Redrawing replaces the inline-edit inputs, so put the cursor back where it was
function rememberFocus() {
  const el = document.activeElement;
  if (!el || !el.matches('.limit-input, .rate-input, .cat-name-input')) return () => {};
  let sel = `.cat-name-input[data-id="${el.dataset.id}"]`;
  if (el.matches('.limit-input')) sel = `.limit-input[data-cat="${el.dataset.cat}"]`;
  if (el.matches('.rate-input')) sel = `.rate-input[data-code="${el.dataset.code}"]`;
  return () => { const again = $(sel); if (again) again.focus(); };
}


/* ================= Lookups & formatting ================= */

function category(id) { return data.categories.find((c) => c.id === id); }
function categoryName(id) { const c = category(id); return c ? c.name : 'Uncategorized'; }
function methodLabel(id) { return METHODS[id] || id; }
const expensesIn = (ym) => data.transactions.filter((t) => t.type === 'expense' && t.date.startsWith(ym));
const incomeIn = (ym) => data.transactions.filter((t) => t.type === 'income' && t.date.startsWith(ym));

// Amounts are stored in RWF; this converts to the display currency
function money(rwf, { currency, sign } = {}) {
  const s = data.settings;
  const cur = currency || s.currency;
  const value = cur === 'RWF' ? rwf : rwf / (s.rates[cur] || 1);
  const decimals = CURRENCIES[cur].decimals;
  const text = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
  let prefix = value < 0 ? '−' : '';
  if (sign) prefix = value < 0 ? '−' : '+';
  return prefix + cur + ' ' + text;
}

function yesterdayIso() { const n = new Date(); return isoDate(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1)); }

function shortDate(ds) {
  if (ds === todayIso()) return 'Today';
  if (ds === yesterdayIso()) return 'Yesterday';
  const d = parseDate(ds);
  const year = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
  return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + year;
}

function longDate(ds) {
  if (ds === todayIso()) return 'Today';
  if (ds === yesterdayIso()) return 'Yesterday';
  const d = parseDate(ds);
  const year = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
  return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + year;
}

function newestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.createdAt - a.createdAt;
}

// One transaction row. "sub" is the small text under the amount.
function txRow(t, sub, withDelete) {
  const foreign = t.origCurrency && t.origCurrency !== 'RWF' && t.origAmount;
  let meta = categoryName(t.categoryId) + ' · ' + methodLabel(t.method);
  if (foreign) meta += ' · ' + money(t.origAmount * (data.settings.rates[t.origCurrency] || 1), { currency: t.origCurrency }) + ' paid';

  const amount = money(t.type === 'expense' ? -t.amount : t.amount, { sign: true });
  const deleteBtn = withDelete
    ? `<button type="button" class="icon-btn hide-mobile" data-action="delete" data-id="${escapeHtml(t.id)}" aria-label="Delete ${escapeHtml(t.description)}" title="Delete">${TRASH_ICON}</button>`
    : '';

  return `
    <div class="tx-line">
      <button type="button" class="tx-row" data-action="edit" data-id="${escapeHtml(t.id)}" title="Edit transaction">
        <span class="avatar" aria-hidden="true">${escapeHtml(categoryName(t.categoryId).charAt(0).toUpperCase())}</span>
        <span class="tx-main">
          <span class="tx-desc">${escapeHtml(t.description)}</span>
          <span class="tx-meta">${escapeHtml(meta)}</span>
        </span>
        <span class="tx-side">
          <span class="tx-amount ${t.type === 'income' ? 'income' : ''}">${amount}</span>
          <span class="tx-sub">${sub}</span>
        </span>
      </button>
      ${deleteBtn}
      ${withDelete ? inlineEditor(t) : ''}
    </div>`;
}

function budgetStats(ym) {
  const limit = data.budget.monthly;
  const spent = sum(expensesIn(ym));
  const days = daysInMonth(ym);
  const pct = limit ? spent / limit * 100 : 0;
  const over = !!limit && spent > limit;
  return {
    limit, spent, days, pct, over,
    isCurrent: ym === thisMonth(),
    remaining: limit ? limit - spent : 0,
    daysLeft: days - new Date().getDate() + 1,
    color: over ? 'var(--error-text)' : pct >= 85 ? 'var(--warning-text)' : 'var(--gray-12)',
  };
}


/* ================= App state ================= */

const state = {
  page: 'overview',
  search: '',
  type: 'All',
  category: 'all',
  month: 'all',
  method: 'all',
  sort: 'newest',
  limit: 60,
  budgetMonth: thisMonth(),
  catTab: 'expense',
};

let form = null;          // values of the add/edit form while it's open
let confirmAction = null; // function to run if the user confirms


/* ================= Rendering ================= */

function render() {
  applyTheme();

  document.querySelectorAll('[data-page]').forEach((btn) => {
    if (btn.classList.contains('nav-link') || btn.classList.contains('bn-item')) {
      if (btn.dataset.page === state.page) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  });

  PAGES.forEach((p) => { $('#page-' + p).hidden = p !== state.page; });

  $('#storage-banner').hidden = storageOk;
  $('#storage-note').textContent = storageOk
    ? 'Only in this browser. No account, nothing uploaded.'
    : 'Storage is blocked — export a backup to keep changes.';

  renderRubricStats();
  if (state.page === 'overview') renderOverview();
  if (state.page === 'transactions') renderTransactions();
  if (state.page === 'budget') renderBudget();
  if (state.page === 'settings') renderSettings();
}

function renderOverview() {
  const txs = data.transactions;
  const ym = thisMonth();
  const day = new Date().getDate();

  $('#ov-sub').textContent = `${monthLabel(ym)} · Day ${day} of ${daysInMonth(ym)}`;
  $('#sample-banner').hidden = !(data.sample && txs.length);
  $('#ov-empty').hidden = txs.length > 0;
  $('#ov-content').hidden = txs.length === 0;
  if (!txs.length) return;

  document.querySelectorAll('.month-short').forEach((el) => { el.textContent = monthName(ym); });
  $('#ov-month-name').textContent = monthLabel(ym);

  // Top stats
  const spent = sum(expensesIn(ym));
  const allIncome = sum(txs.filter((t) => t.type === 'income'));
  const allExpenses = sum(txs.filter((t) => t.type === 'expense'));
  const incomeCount = incomeIn(ym).length;

  $('#ov-balance').textContent = money(allIncome - allExpenses);
  $('#ov-income').textContent = money(sum(incomeIn(ym)));
  $('#ov-income-sub').textContent = incomeCount ? plural(incomeCount, 'payment') + ' received' : 'No income recorded yet';
  $('#ov-expenses').textContent = money(spent);

  // Compare with the same point last month
  const prevYm = shiftMonth(ym, -1);
  const prevSoFar = sum(expensesIn(prevYm).filter((t) => +t.date.slice(8) <= day));
  let delta = 'Nothing to compare with last month yet';
  if (prevSoFar > 0) {
    const p = Math.round((spent - prevSoFar) / prevSoFar * 100);
    delta = p === 0
      ? 'Same as this point in ' + monthName(prevYm)
      : Math.abs(p) + '% ' + (p > 0 ? 'more' : 'less') + ' than this point in ' + monthName(prevYm);
  }
  $('#ov-exp-delta').textContent = delta;

  // Budget card
  const b = budgetStats(ym);
  if (b.limit) {
    const hint = b.over
      ? 'Any more spending this month adds to the overrun.'
      : `About ${money(Math.floor(b.remaining / b.daysLeft))} a day for the remaining ${plural(b.daysLeft, 'day')}.`;
    $('#ov-budget').innerHTML = `
      <div class="stack-12">
        <div class="stack-2">
          <span class="big-number" style="color:${b.over ? 'var(--error-text)' : 'var(--text-primary)'}">${money(Math.abs(b.remaining))}</span>
          <span class="muted-13">${b.over ? 'over your limit' : 'left to spend this month'}</span>
        </div>
        <div class="progress" role="progressbar" aria-label="Budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(b.pct)}">
          <div class="progress-fill" style="width:${Math.min(100, b.pct).toFixed(1)}%;background:${b.color}"></div>
        </div>
        <div class="bar-legend"><span>${money(b.spent)} spent</span><span>${money(b.limit)} limit</span></div>
        <p class="muted-13">${hint}</p>
      </div>`;
  } else {
    $('#ov-budget').innerHTML = `
      <div class="stack-6" style="align-items:flex-start;gap:10px">
        <p class="muted-13">No monthly limit yet. Set one to see what's left to spend each day.</p>
        <button type="button" class="btn btn-secondary btn-md" data-page="budget">Set a limit</button>
      </div>`;
  }

  // Spending by category (top 5, rest grouped)
  const totals = {};
  expensesIn(ym).forEach((t) => { totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount; });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const rows = sorted.slice(0, 5).map(([id, v]) => ({ name: categoryName(id), v }));
  if (sorted.length > 5) {
    rows.push({ name: (sorted.length - 5) + ' more categories', v: sorted.slice(5).reduce((a, x) => a + x[1], 0) });
  }

  $('#ov-cats').innerHTML = rows.length
    ? '<ul class="cat-totals">' + rows.map((r) => `
        <li>
          <span class="name">${escapeHtml(r.name)}</span>
          <span class="value"><b>${money(r.v)}</b> · ${Math.round(r.v / Math.max(1, spent) * 100)}%</span>
        </li>`).join('') + '</ul>'
    : `<p class="muted-13">No spending recorded in ${monthLabel(ym)} yet.</p>`;

  // Recent
  $('#ov-recent').innerHTML = [...txs].sort(newestFirst).slice(0, 6).map((t) => txRow(t, shortDate(t.date), false)).join('');
}

function filteredTransactions() {
  const result = TrackyRules.compile(state.search, $('#search-case').checked);
  $('#search-error').textContent = result.error;
  $('#search').setAttribute('aria-invalid', String(!!result.error));
  const regex = result.regex;

  const list = data.transactions.filter((t) => {
    if (state.type === 'Expenses' && t.type !== 'expense') return false;
    if (state.type === 'Income' && t.type !== 'income') return false;
    if (state.category !== 'all' && t.categoryId !== state.category) return false;
    if (state.month !== 'all' && !t.date.startsWith(state.month)) return false;
    if (state.method !== 'all' && t.method !== state.method) return false;
    if (result.error) return false;
    if (!regex) return true;
    return regex.test([t.description, categoryName(t.categoryId), methodLabel(t.method), t.date, t.amount.toFixed(2)].join(' '));
  });

  const sorters = {
    az: (a, b) => a.description.localeCompare(b.description),
    za: (a, b) => b.description.localeCompare(a.description),
    newest: newestFirst,
    oldest: (a, b) => -newestFirst(a, b),
    high: (a, b) => b.amount - a.amount,
    low: (a, b) => a.amount - b.amount,
  };
  return list.sort(sorters[state.sort] || newestFirst);
}

function renderTransactions() {
  const txs = data.transactions;
  $('#tx-total').textContent = plural(txs.length, 'transaction') + ' recorded';
  $('#tx-empty').hidden = txs.length > 0;
  $('#tx-content').hidden = txs.length === 0;
  if (!txs.length) return;

  // Fill filter dropdowns (they depend on the data)
  const catSelect = $('#f-cat');
  const cats = [...data.categories].sort((a, b) => (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1));
  catSelect.innerHTML = '<option value="all">All categories</option>' +
    cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.type === 'income' ? ' (income)' : ''}</option>`).join('');
  catSelect.value = state.category;

  const monthSelect = $('#f-month');
  const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort().reverse();
  monthSelect.innerHTML = '<option value="all">All time</option>' +
    months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  monthSelect.value = state.month;

  $('#f-method').value = state.method;
  $('#f-sort').value = state.sort;
  if ($('#search').value !== state.search) $('#search').value = state.search;
  setPressed('#type-filter', 'type', state.type);

  renderTransactionList();
}

// Separate from renderTransactions so typing in search doesn't rebuild the dropdowns
function renderTransactionList() {
  const txs = data.transactions;
  const list = filteredTransactions();
  const shown = list;
  const filtered = !!state.search.trim() || state.type !== 'All' || state.category !== 'all' || state.month !== 'all' || state.method !== 'all';

  $('#clear-filters').hidden = !filtered;
  $('#tx-count').textContent = (filtered ? list.length + ' of ' + txs.length : list.length) + ' shown';
  $('#tx-in').textContent = money(sum(list.filter((t) => t.type === 'income')));
  $('#tx-out').textContent = money(sum(list.filter((t) => t.type === 'expense')));
  $('#tx-nomatch').hidden = list.length > 0;

  const otherCurrency = data.settings.currency !== 'RWF';
  let html = '';

  if (state.sort === 'newest' || state.sort === 'oldest') {
    // Group by day
    const groups = [];
    shown.forEach((t) => {
      const last = groups[groups.length - 1];
      if (last && last.date === t.date) last.items.push(t);
      else groups.push({ date: t.date, items: [t] });
    });
    html = groups.map((g) => {
      const net = g.items.reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0);
      const rows = g.items.map((t) => txRow(t, otherCurrency ? money(t.amount, { currency: 'RWF' }) : '', true)).join('');
      return `
        <section class="card tx-group">
          <div class="group-head"><h2>${longDate(g.date)}</h2><span>${money(net, { sign: true })}</span></div>
          ${rows}
        </section>`;
    }).join('');
  } else if (shown.length) {
    html = `<section class="card tx-group">${shown.map((t) => txRow(t, shortDate(t.date), true)).join('')}</section>`;
  }
  $('#tx-groups').innerHTML = html;

  $('#tx-more-wrap').hidden = true;
  const regex = TrackyRules.compile(state.search, $('#search-case').checked).regex;
  if (state.search) document.querySelectorAll('#tx-groups .tx-desc, #tx-groups .tx-meta, #tx-groups .tx-amount').forEach(el => el.replaceChildren(TrackyRules.highlight(el.textContent, regex)));
  $('#tx-more').textContent = 'Show ' + Math.min(60, list.length - state.limit) + ' more';
}

function renderBudget() {
  const ym = state.budgetMonth;
  const prevYm = shiftMonth(ym, -1);
  const isPast = ym < thisMonth();
  const day = new Date().getDate();
  const b = budgetStats(ym);

  $('#bp-month').textContent = monthLabel(ym);
  $('#bp-next').disabled = ym >= thisMonth();

  // Summary
  if (b.limit) {
    let label;
    if (b.over) label = isPast ? 'Went over the limit by' : 'Over your limit by';
    else label = isPast ? 'Stayed under the limit by' : 'Left to spend in ' + monthName(ym);

    const facts = [];
    if (b.isCurrent && !b.over) facts.push(['Per day for ' + plural(b.daysLeft, 'day'), money(Math.floor(b.remaining / b.daysLeft))]);
    if (b.isCurrent) {
      const projected = Math.round(b.spent / day * b.days);
      facts.push([`At this pace, by ${b.days} ${monthName(ym).slice(0, 3)}`, money(projected) + (projected > b.limit ? ' · over' : ' · under')]);
    }
    facts.push(['Spent in ' + monthName(prevYm), money(sum(expensesIn(prevYm)))]);

    const pace = b.isCurrent
      ? `<div class="pace-mark" title="Where you'd be at an even pace" style="left:${(day / b.days * 100).toFixed(1)}%"></div>`
      : '';

    $('#bp-summary').innerHTML = `
      <div class="stack-12" style="gap:14px;margin-bottom:16px">
        <div class="stack-2">
          <span class="muted-13">${label}</span>
          <span class="big-number xl" style="color:${b.over ? 'var(--error-text)' : 'var(--text-primary)'}">${money(Math.abs(b.remaining))}</span>
        </div>
        <div class="progress lg" role="progressbar" aria-label="Monthly budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(b.pct)}">
          <div class="progress-fill" style="width:${Math.min(100, b.pct).toFixed(1)}%;background:${b.color}"></div>
          ${pace}
        </div>
        <div class="bar-legend lg"><span>${money(b.spent)} spent · ${Math.round(b.pct)}%</span><span>of ${money(b.limit)}</span></div>
        <ul class="facts">${facts.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('')}</ul>
      </div>`;
  } else {
    $('#bp-summary').innerHTML = `
      <div class="stack-6" style="margin-bottom:16px">
        <h2 class="card-title-lg">Set a monthly spending limit</h2>
        <p class="muted-13">Tracky will show what's left, how much you can spend per day, and warn you when you go over. You spent ${money(b.spent)} in ${monthLabel(ym)}.</p>
      </div>`;
  }

  const input = $('#budget-input');
  if (document.activeElement !== input) {
    input.value = b.limit ? String(b.limit) : '';
    input.classList.remove('invalid');
    $('#budget-err').textContent = '';
  }
  $('#budget-save').textContent = b.limit ? 'Update' : 'Set limit';
  $('#budget-remove').hidden = !b.limit;

  // Category totals for this month and last month
  const thisTotals = {};
  const prevTotals = {};
  expensesIn(ym).forEach((t) => { thisTotals[t.categoryId] = (thisTotals[t.categoryId] || 0) + t.amount; });
  expensesIn(prevYm).forEach((t) => { prevTotals[t.categoryId] = (prevTotals[t.categoryId] || 0) + t.amount; });
  const ranked = Object.entries(thisTotals).sort((a, c) => c[1] - a[1]);

  // Insights
  const insights = [];
  if (b.spent > 0) {
    const [topId, topValue] = ranked[0];
    insights.push(['var(--gray-12)', `${categoryName(topId)} is your biggest expense — ${Math.round(topValue / b.spent * 100)}% of spending in ${monthName(ym)}.`]);

    // Biggest rise vs last month (scaled to the same point in the month)
    const factor = b.isCurrent ? day / b.days : 1;
    const rises = ranked
      .map(([id, v]) => ({ id, v, p: (prevTotals[id] || 0) * factor }))
      .filter((x) => x.p > 0 && x.v > x.p * 1.15 && x.v - x.p > 2000)
      .sort((a, c) => (c.v - c.p) - (a.v - a.p));
    if (rises[0]) {
      const r = rises[0];
      insights.push(['var(--warning-text)', `${categoryName(r.id)} is up ${Math.round((r.v / r.p - 1) * 100)}% compared with ${b.isCurrent ? 'the same point in ' : ''}${monthName(prevYm)}.`]);
    }

    const overCats = ranked.filter(([id, v]) => data.budget.categories[id] && v > data.budget.categories[id]);
    if (overCats.length) {
      const one = overCats.length === 1;
      insights.push(['var(--error-text)', overCats.map(([id]) => categoryName(id)).join(', ') + (one ? ' has gone past its limit.' : ' have gone past their limit.')]);
    }

    const byMethod = {};
    expensesIn(ym).forEach((t) => { byMethod[t.method] = (byMethod[t.method] || 0) + t.amount; });
    const topMethod = Object.entries(byMethod).sort((a, c) => c[1] - a[1])[0];
    if (topMethod) insights.push(['var(--gray-8)', `${methodLabel(topMethod[0])} covers ${Math.round(topMethod[1] / b.spent * 100)}% of what you spent.`]);

    const activeDays = new Set(expensesIn(ym).map((t) => t.date)).size;
    const span = b.isCurrent ? day : b.days;
    if (span > 3) insights.push(['var(--gray-8)', `You spent money on ${activeDays} of ${span} days.`]);
  }

  $('#bp-insights').innerHTML = insights.length
    ? '<ul class="insights">' + insights.slice(0, 4).map(([dot, text]) =>
        `<li><span class="dot" aria-hidden="true" style="background:${dot}"></span><span>${escapeHtml(text)}</span></li>`).join('') + '</ul>'
    : `<p class="muted-13">Insights appear once you've recorded some spending this month.</p>`;

  // Per-category limits
  $('#bp-cats-sub').textContent = `Spending in ${monthLabel(ym)} compared with ${monthName(prevYm)}. Add a limit to any category — leave blank for none.`;

  const expenseCats = data.categories.filter((c) => c.type === 'expense');
  const biggest = Math.max(1, ...expenseCats.map((c) => thisTotals[c.id] || 0));

  $('#bp-cats').innerHTML = expenseCats
    .map((c) => ({ c, v: thisTotals[c.id] || 0 }))
    .sort((x, y) => y.v - x.v)
    .map(({ c, v }) => {
      const limit = data.budget.categories[c.id];
      const prev = prevTotals[c.id] || 0;
      const overLimit = limit && v > limit;

      let width = 0;
      if (limit) width = Math.min(100, v / limit * 100);
      else if (b.spent) width = v / biggest * 100;

      let color = 'var(--gray-8)';
      if (overLimit) color = 'var(--error-text)';
      else if (limit && v / limit >= 0.85) color = 'var(--warning-text)';
      else if (limit) color = 'var(--gray-12)';

      let delta;
      if (overLimit) delta = 'Over limit by ' + money(v - limit);
      else if (prev) delta = v === prev ? 'Same as ' + monthName(prevYm) : money(Math.abs(v - prev)) + (v > prev ? ' more' : ' less') + ' than ' + monthName(prevYm);
      else delta = v ? 'Nothing in ' + monthName(prevYm) : 'No spending';

      return `
        <div class="bcat">
          <div class="bcat-info">
            <div class="bcat-top">
              <span class="name">${escapeHtml(c.name)}</span>
              <span class="value"><b>${money(v)}</b><span>${limit ? ' of ' + money(limit) : ''}</span></span>
            </div>
            <div class="progress thin"><div class="progress-fill" style="width:${width.toFixed(1)}%;background:${color}"></div></div>
            <span class="bcat-delta ${overLimit ? 'over' : ''}">${delta}</span>
          </div>
          <div class="bcat-limit">
            <label>
              <span>Limit</span>
              <input class="input limit-input" data-cat="${c.id}" inputmode="numeric" autocomplete="off" placeholder="None"
                     value="${limit || ''}" aria-label="${escapeHtml(c.name)} monthly limit in RWF">
            </label>
            <span class="error-text" role="alert"></span>
          </div>
        </div>`;
    }).join('');
}

function renderSettings() {
  const s = data.settings;
  const txs = data.transactions;

  $('#display-cur').value = s.currency;
  $('#rates-note').textContent = s.ratesUpdated
    ? 'Last changed ' + shortDate(isoDate(new Date(s.ratesUpdated))).toLowerCase() + '.'
    : 'These are approximate defaults — update them to today’s rates.';

  $('#rates').innerHTML = Object.keys(DEFAULT_RATES).map((code) => `
    <div class="stack-4">
      <label class="rate-field">
        <span>1 ${code} =</span>
        <input class="rate-input" data-code="${code}" inputmode="decimal" autocomplete="off" value="${s.rates[code]}"
               aria-label="Rwandan francs per 1 ${CURRENCIES[code].name}">
        <span>RWF</span>
      </label>
      <span class="error-text" role="alert"></span>
    </div>`).join('');

  // Categories
  setPressed('#cat-tabs', 'tab', state.catTab);
  const usage = {};
  txs.forEach((t) => { usage[t.categoryId] = (usage[t.categoryId] || 0) + 1; });

  $('#cat-list').innerHTML = data.categories.filter((c) => c.type === state.catTab).map((c) => {
    const fixed = FIXED_CATEGORIES.includes(c.id);
    const n = usage[c.id] || 0;
    const right = fixed
      ? '<span class="cat-fixed">Fixed</span>'
      : `<button type="button" class="icon-btn wide" data-action="delete-cat" data-id="${c.id}" aria-label="Delete category ${escapeHtml(c.name)}" title="Delete category">${TRASH_ICON}</button>`;
    return `
      <li>
        <div class="cat-row">
          <input class="cat-name-input" data-id="${c.id}" value="${escapeHtml(c.name)}" maxlength="32"
                 aria-label="Category name: ${escapeHtml(c.name)}" ${fixed ? 'readonly' : ''}>
          <span class="cat-usage">${n ? n + ' used' : 'Unused'}</span>
          ${right}
        </div>
        <span class="error-text" role="alert"></span>
      </li>`;
  }).join('');

  $('#new-cat').placeholder = state.catTab === 'expense' ? 'New expense category, e.g. Gym' : 'New income category, e.g. Pocket money';

  setPressed('#theme-tabs', 'themeOption', s.theme);

  // Data stats
  $('#stat-count').textContent = txs.length.toLocaleString('en-US');
  const bytes = new Blob([JSON.stringify(data)]).size;
  $('#stat-size').textContent = bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';

  let saved = '—';
  if (!storageOk) saved = 'Not saved — storage blocked';
  else if (data.savedAt) {
    const when = new Date(data.savedAt);
    saved = isoDate(when) === todayIso()
      ? 'Today, ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : shortDate(isoDate(when));
  }
  $('#stat-saved').textContent = saved;

  $('#reset-title').textContent = txs.length ? 'Erase everything' : 'Try Tracky with sample data';
  $('#reset-desc').textContent = txs.length
    ? 'Deletes all transactions, categories, budget and settings from this browser. You’ll be asked to confirm.'
    : 'Loads about three months of example student spending. You can clear it anytime.';
  $('#erase-btn').hidden = !txs.length;
  $('#sample-btn').hidden = txs.length > 0;
}

// Marks the matching button in a segmented control as pressed
function setPressed(groupSel, dataKey, value) {
  document.querySelectorAll(groupSel + ' button').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset[dataKey] === value ? 'true' : 'false');
  });
}

function isDark() {
  const theme = data.settings.theme;
  return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyTheme() {
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
}


/* ================= Navigation ================= */

function goTo(page) {
  if (!PAGES.includes(page)) return;
  if (page !== state.page) {
    state.page = page;
    history.replaceState(null, '', '#' + page);
    window.scrollTo({ top: 0 });
  }
  render();
  const heading = $('#page-' + page).querySelector('h1');
  if (heading) { heading.tabIndex = -1; heading.focus(); }
}


/* ================= Toasts ================= */

function toast(title, description = '', kind = 'default', action = null) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="toast-body">
      <strong>${escapeHtml(title)}</strong>
      ${description ? `<span>${escapeHtml(description)}</span>` : ''}
    </div>
    ${action ? `<button type="button" class="toast-action">${escapeHtml(action.label)}</button>` : ''}
    <button type="button" class="toast-close" aria-label="Dismiss notification">${CLOSE_ICON}</button>`;

  el.querySelector('.toast-close').onclick = () => el.remove();
  if (action) el.querySelector('.toast-action').onclick = () => { el.remove(); action.run(); };

  box.appendChild(el);
  setTimeout(() => el.remove(), action ? 7000 : 4000);
}


/* ================= Confirm dialog ================= */

function askConfirm({ title, description, label, danger, action }) {
  $('#cf-title').textContent = title;
  $('#cf-desc').textContent = description;
  const ok = $('#cf-ok');
  ok.textContent = label;
  ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
  confirmReturnFocus = document.activeElement;
  confirmAction = action;
  $('#confirm-overlay').hidden = false;
  $('#cf-ok').focus();
}

function closeConfirm() {
  $('#confirm-overlay').hidden = true;
  confirmAction = null;
  if (confirmReturnFocus?.isConnected) confirmReturnFocus.focus();
  else $('#main-content').focus();
}


/* ================= Add / edit form ================= */

function lastUsed(type, key) {
  const last = data.transactions.filter((t) => t.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];
  return last ? last[key] : null;
}

function blankForm(keep) {
  const type = keep ? keep.type : 'expense';
  return {
    mode: 'add',
    id: null,
    type,
    amount: '',
    currency: keep ? keep.currency : 'RWF',
    description: '',
    categoryId: keep ? keep.categoryId : (lastUsed(type, 'categoryId') || (type === 'expense' ? 'food' : 'allowance')),
    date: keep ? keep.date : todayIso(),
    method: keep ? keep.method : (lastUsed(type, 'method') || 'momo'),
    touched: {},
    submitted: false,
  };
}

function openAdd() {
  form = blankForm();
  showForm();
}

function openEdit(id) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return;
  const foreign = t.origCurrency && t.origCurrency !== 'RWF' && t.origAmount;
  form = {
    mode: 'edit',
    id,
    type: t.type,
    amount: String(foreign ? t.origAmount : t.amount),
    currency: foreign ? t.origCurrency : 'RWF',
    description: t.description,
    categoryId: t.categoryId,
    date: t.date,
    method: t.method,
    touched: {},
    submitted: false,
  };
  showForm();
}

let formReturnFocus = null;
let confirmReturnFocus = null;
function showForm() {
  formReturnFocus = document.activeElement;
  $('#form-overlay').hidden = false;
  fillForm();
  setTimeout(() => $('#tx-amount').focus(), 60);
}

function closeForm() {
  $('#form-overlay').hidden = true;
  form = null;
  if (formReturnFocus?.isConnected) formReturnFocus.focus();
  else $('[data-action="add"]').focus();
}

// Puts the form values into the inputs
function fillForm() {
  $('#tx-amount').value = form.amount;
  $('#tx-currency').value = form.currency;
  $('#tx-desc').value = form.description;
  $('#tx-date').value = form.date;
  $('#tx-date').max = todayIso();
  $('#tx-method').value = form.method;
  renderFormState();
}

function validate(f) {
  const errors = {};
  const amount = parseAmount(f.amount);

  if (!String(f.amount).trim()) errors.amount = 'Enter an amount';
  else if (isNaN(amount)) errors.amount = 'Use digits and up to two decimal places, e.g. 2500.50';
  else if (amount <= 0) errors.amount = 'Amount must be more than 0';
  else if (amount > 1e10) errors.amount = 'That amount looks too large';
  else {
    const converted = amount * (f.currency && f.currency !== 'RWF' ? data.settings.rates[f.currency] : 1);
    if (!Number.isFinite(converted) || converted > 1e10) errors.amount = 'Converted amount exceeds the supported limit';
    else if (Math.round(converted * 100) < 1) errors.amount = 'Converted amount must be at least 0.01 RWF';
  }

  if (!TrackyRules.patterns.description.test(f.description)) errors.description = 'Enter a description without leading or trailing spaces';
  else if (TrackyRules.patterns.duplicate.test(f.description)) errors.description = 'Remove the repeated word';
  if (!data.categories.some((c) => c.id === f.categoryId && c.type === f.type)) errors.categoryId = 'Pick a category';

  if (!TrackyRules.validDate(f.date)) errors.date = 'Enter a real date in YYYY-MM-DD format';
  else if (f.date > todayIso()) errors.date = "Date can't be in the future";

  return errors;
}

// Updates labels, chips and error messages (not the input values, so typing isn't interrupted)
function renderFormState() {
  const isEdit = form.mode === 'edit';
  const errors = validate(form);
  const show = (key) => (form.submitted || form.touched[key]) ? errors[key] || '' : '';

  $('#form-title').textContent = isEdit ? 'Edit transaction' : 'New transaction';
  $('#form-delete').hidden = !isEdit;
  $('#form-another').hidden = isEdit;
  $('#form-save').textContent = isEdit ? 'Save changes' : form.type === 'expense' ? 'Add expense' : 'Add income';
  setPressed('#form-type', 'formType', form.type);

  // Amount: show the error, or the RWF conversion if a foreign currency is picked
  const amountErr = show('amount');
  const amount = parseAmount(form.amount);
  const rate = data.settings.rates[form.currency] || 1;
  let msg = amountErr;
  if (!msg && form.currency !== 'RWF' && amount > 0) {
    msg = `≈ ${money(Math.round(amount * rate), { currency: 'RWF' })} at 1 ${form.currency} = ${rate.toLocaleString('en-US')} RWF`;
  }
  $('#tx-amount-msg').textContent = msg;
  $('#tx-amount-msg').classList.toggle('is-error', !!amountErr);
  setInvalid('#tx-amount', amountErr);

  $('#desc-count').textContent = form.description.length + '/60';
  $('#tx-desc').placeholder = form.type === 'expense' ? 'e.g. Lunch at the canteen' : 'e.g. Monthly allowance';
  $('#tx-desc-err').textContent = show('description');
  setInvalid('#tx-desc', show('description'));

  $('#form-chips').innerHTML = data.categories.filter((c) => c.type === form.type).map((c) =>
    `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id === form.categoryId}">${escapeHtml(c.name)}</button>`
  ).join('');
  $('#tx-cat-err').textContent = show('categoryId');

  $('#tx-date-err').textContent = show('date');
  setInvalid('#tx-date', show('date'));
}

function setInvalid(sel, error) {
  const el = $(sel);
  el.classList.toggle('invalid', !!error);
  if (error) el.setAttribute('aria-invalid', 'true');
  else el.removeAttribute('aria-invalid');
}

function submitForm(addAnother) {
  const f = form;
  f.description = f.description.replace(/ {2,}/g, ' ');
  if (Object.keys(validate(f)).length) {
    f.submitted = true;
    renderFormState();
    return;
  }

  const amount = parseAmount(f.amount);
  const rate = f.currency === 'RWF' ? 1 : (data.settings.rates[f.currency] || 1);
  const record = {
    type: f.type,
    amount: Math.round(amount * rate * 100) / 100,
    origAmount: f.currency === 'RWF' ? null : amount,
    origCurrency: f.currency,
    description: f.description.replace(/ {2,}/g, ' '),
    updatedAt: Date.now(),
    categoryId: f.categoryId,
    date: f.date,
    method: f.method,
  };

  const ym = f.date.slice(0, 7);
  const spentBefore = sum(expensesIn(ym));

  update((d) => {
    if (f.mode === 'edit') {
      const i = d.transactions.findIndex((t) => t.id === f.id);
      if (i >= 0) d.transactions[i] = { ...d.transactions[i], ...record };
    } else {
      d.transactions.push({ id: makeId(), createdAt: record.updatedAt, ...record });
    }
  });

  const label = record.description + ' · ' + money(record.amount);
  if (f.mode === 'edit') toast('Changes saved', label, 'success');
  else toast(record.type === 'expense' ? 'Expense added' : 'Income added', label, 'success');

  // Warn the moment this expense pushes the month over budget
  const limit = data.budget.monthly;
  const spentAfter = sum(expensesIn(ym));
  if (record.type === 'expense' && limit && spentBefore <= limit && spentAfter > limit) {
    toast('Over your ' + monthName(ym) + ' budget', 'You’ve spent ' + money(spentAfter - limit) + ' more than your limit.', 'warning');
  }

  if (addAnother) {
    form = blankForm(f);
    fillForm();
    $('#tx-amount').focus();
  } else {
    closeForm();
  }
}


/* ================= Actions ================= */

function deleteTransaction(id) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return;
  askConfirm({
    title: 'Delete this transaction?',
    description: t.description + ' · ' + money(t.amount),
    label: 'Delete transaction', danger: true,
    action: () => {
      update((d) => { d.transactions = d.transactions.filter((x) => x.id !== id); });
      toast('Transaction deleted', t.description, 'success');
      $('#main-content').focus();
    },
  });
}

function deleteCategory(id) {
  const cat = category(id);
  if (!cat) return;
  const count = data.transactions.filter((t) => t.categoryId === id).length;
  const target = cat.type === 'income' ? 'other-income' : 'other';
  const targetName = categoryName(target);

  const run = () => {
    update((d) => {
      d.categories = d.categories.filter((c) => c.id !== id);
      d.transactions.forEach((t) => { if (t.categoryId === id) { t.categoryId = target; t.updatedAt = Date.now(); } });
      delete d.budget.categories[id];
    });
    toast('Category deleted', count ? plural(count, 'transaction') + ' moved to “' + targetName + '”' : cat.name, 'success');
  };

  if (!count) return run();
  askConfirm({
    title: 'Delete “' + cat.name + '”?',
    description: plural(count, 'transaction') + ' will move to “' + targetName + '”. Their amounts stay the same.',
    label: 'Delete category',
    danger: true,
    action: run,
  });
}

function loadSample() {
  update((d) => {
    const sample = freshData(true);
    d.transactions = sample.transactions;
    d.sample = true;
    if (!d.budget.monthly) d.budget = sample.budget;
  });
  goTo('overview');
  toast('Sample data loaded', 'Clear it from the Overview banner when you’re done exploring.', 'info');
}

function clearSample() {
  const backup = JSON.parse(JSON.stringify(data));
  update((d) => {
    d.transactions = [];
    d.sample = false;
    d.budget = { monthly: null, categories: {} };
  });
  toast('Sample data cleared', 'You’re starting fresh.', 'default', {
    label: 'Undo',
    run: () => update((d) => Object.assign(d, backup)),
  });
}

function eraseEverything() {
  askConfirm({
    title: 'Erase all data on this device?',
    description: `This deletes all ${data.transactions.length} transactions, your categories, budget and settings from this browser. It can’t be undone — export a backup first if you might need it.`,
    label: 'Erase everything',
    danger: true,
    action: () => {
      update((d) => Object.assign(d, freshData(false)));
      toast('All data erased', 'Tracky is empty on this device.', 'success');
    },
  });
}

function removeBudget() {
  const old = data.budget.monthly;
  update((d) => { d.budget.monthly = null; });
  toast('Monthly limit removed', '', 'default', { label: 'Undo', run: () => update((d) => { d.budget.monthly = old; }) });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const name = 'tracky-backup-' + todayIso() + '.json';
  download(name, JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
  toast('Backup downloaded', name, 'success');
}

function exportCsv() {
  const quote = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const header = ['date', 'type', 'description', 'category', 'payment_method', 'amount_rwf', 'original_amount', 'original_currency'];
  const rows = [...data.transactions].sort(newestFirst).map((t) => [
    t.date, t.type, t.description, categoryName(t.categoryId), methodLabel(t.method), t.amount, t.origAmount ?? t.amount, t.origCurrency || 'RWF',
  ]);
  const csv = [header, ...rows].map((r) => r.map(quote).join(',')).join('\n');
  download('tracky-transactions-' + todayIso() + '.csv', csv, 'text/csv');
  toast('Spreadsheet downloaded', plural(data.transactions.length, 'transaction'), 'success');
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
      TrackyRules.validateBackup(parsed);
    } catch (e) {
      toast('Invalid backup', e.message, 'error');
      return;
    }
    const incoming = normalize(parsed);
    askConfirm({
      title: 'Replace your data with this backup?',
      description: `Your ${data.transactions.length} current transactions, categories, budget and settings will be replaced by ${incoming.transactions.length} transactions from “${file.name}”. Export a backup first if you want to keep what’s here.`,
      label: 'Replace data',
      danger: true,
      action: () => {
        update((d) => Object.assign(d, incoming, { sample: false }));
        toast('Backup imported', incoming.transactions.length + ' transactions from ' + file.name, 'success');
      },
    });
  };
  reader.onerror = () => toast('Import failed', 'The file could not be read.', 'error');
  reader.readAsText(file);
}

// Shows an error under an inline-edit input (rates, limits, category names)
function showFieldError(input, message, invalidTarget) {
  const holder = input.closest('.stack-4, .bcat-limit, li');
  holder.querySelector('.error-text').textContent = message;
  (invalidTarget || input).classList.toggle('invalid', !!message);
}


/* ================= Events ================= */

// Clicks — one listener for the whole page
document.addEventListener('click', (e) => {
  const pageBtn = e.target.closest('[data-page]');
  if (pageBtn) return goTo(pageBtn.dataset.page);

  // Segmented controls
  const typeBtn = e.target.closest('#type-filter button');
  if (typeBtn) { state.type = typeBtn.dataset.type; state.limit = 60; return renderTransactions(); }

  const catTabBtn = e.target.closest('#cat-tabs button');
  if (catTabBtn) { state.catTab = catTabBtn.dataset.tab; $('#new-cat-err').textContent = ''; $('#new-cat').classList.remove('invalid'); return renderSettings(); }

  const themeBtn = e.target.closest('#theme-tabs button');
  if (themeBtn) return update((d) => { d.settings.theme = themeBtn.dataset.themeOption; });

  const formTypeBtn = e.target.closest('#form-type button');
  if (formTypeBtn) {
    const type = formTypeBtn.dataset.formType;
    if (type !== form.type) {
      form.type = type;
      form.categoryId = lastUsed(type, 'categoryId') || (type === 'expense' ? 'food' : 'allowance');
      renderFormState();
    }
    return;
  }

  const chip = e.target.closest('.chip');
  if (chip) { form.categoryId = chip.dataset.cat; return renderFormState(); }

  // Clicking the dark backdrop closes the dialog
  if (e.target.id === 'form-overlay') return closeForm();
  if (e.target.id === 'confirm-overlay') return closeConfirm();

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;

  switch (btn.dataset.action) {
    case 'add': openAdd(); break;
    case 'edit': openEdit(id); break;
    case 'delete': deleteTransaction(id); break;
    case 'close-form': closeForm(); break;
    case 'save-another': submitForm(true); break;
    case 'delete-from-form': { const txId = form.id; closeForm(); deleteTransaction(txId); break; }

    case 'close-confirm': closeConfirm(); break;
    case 'run-confirm': { const action = confirmAction; closeConfirm(); if (action) action(); break; }

    case 'keep-sample': update((d) => { d.sample = false; }); break;
    case 'clear-sample': clearSample(); break;
    case 'load-sample': loadSample(); break;

    case 'clear-filters':
      Object.assign(state, { search: '', type: 'All', category: 'all', month: 'all', method: 'all', limit: 60 });
      renderTransactions();
      break;
    case 'show-more': state.limit += 60; renderTransactionList(); break;

    case 'prev-month': state.budgetMonth = shiftMonth(state.budgetMonth, -1); renderBudget(); break;
    case 'next-month':
      if (state.budgetMonth < thisMonth()) { state.budgetMonth = shiftMonth(state.budgetMonth, 1); renderBudget(); }
      break;
    case 'remove-budget': removeBudget(); break;

    case 'reset-rates':
      update((d) => { d.settings.rates = { ...DEFAULT_RATES }; d.settings.ratesUpdated = null; });
      toast('Exchange rates reset to defaults');
      break;
    case 'delete-cat': deleteCategory(id); break;
    case 'export-json': exportJson(); break;
    case 'export-csv': exportCsv(); break;
    case 'import': $('#file-input').click(); break;
    case 'erase': eraseEverything(); break;
  }
});

// Transaction filters
$('#search').addEventListener('input', (e) => { state.search = e.target.value; state.limit = 60; renderTransactionList(); });
$('#f-cat').addEventListener('change', (e) => { state.category = e.target.value; state.limit = 60; renderTransactionList(); });
$('#f-month').addEventListener('change', (e) => { state.month = e.target.value; state.limit = 60; renderTransactionList(); });
$('#f-method').addEventListener('change', (e) => { state.method = e.target.value; state.limit = 60; renderTransactionList(); });
$('#f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderTransactionList(); });

// Monthly budget
$('#budget-input').addEventListener('input', () => {
  $('#budget-err').textContent = '';
  $('#budget-input').classList.remove('invalid');
});
$('#budget-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#budget-input');
  const raw = input.value;
  const value = parseAmount(raw);
  let error = '';
  if (!raw.trim()) error = 'Enter a monthly limit, like 200000';
  else if (isNaN(value) || value <= 0) error = 'Use a number above 0, like 200000';

  if (error) {
    $('#budget-err').textContent = error;
    input.classList.add('invalid');
    return;
  }
  input.blur();
  update((d) => { d.budget.monthly = Math.round(value); });
  toast('Monthly limit saved', money(Math.round(value)) + ' per month', 'success');
});

// Inline edits: category limits, exchange rates, category names.
// They save on "change" (fires on blur); Enter just blurs the input.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t.matches || !t.matches('.limit-input, .rate-input, .cat-name-input')) return;
  if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
  if (e.key === 'Escape' && t.matches('.cat-name-input')) {
    t.value = categoryName(t.dataset.id);
    showFieldError(t, '');
    t.blur();
  }
});

document.addEventListener('change', (e) => {
  // Wait a tick so focus has moved (e.g. after Tab) before the screen redraws
  setTimeout(() => saveInlineEdit(e.target), 0);
});

function saveInlineEdit(t) {
  if (t.matches('.limit-input')) {
    const raw = t.value.trim();
    const value = parseAmount(raw);
    if (raw && (isNaN(value) || value <= 0)) return showFieldError(t, 'Enter an amount or leave blank');
    const next = raw ? Math.round(value) : null;
    const current = data.budget.categories[t.dataset.cat] || null;
    if (next !== current) {
      update((d) => { if (next) d.budget.categories[t.dataset.cat] = next; else delete d.budget.categories[t.dataset.cat]; });
    } else {
      showFieldError(t, '');
    }
  }

  if (t.matches('.rate-input')) {
    const code = t.dataset.code;
    const value = parseAmount(t.value);
    if (isNaN(value) || value <= 0) return showFieldError(t, 'Enter a rate above 0', t.closest('.rate-field'));
    if (value !== data.settings.rates[code]) {
      update((d) => { d.settings.rates[code] = value; d.settings.ratesUpdated = Date.now(); });
      toast('Rate updated', '1 ' + code + ' = ' + value.toLocaleString('en-US') + ' RWF', 'success');
    } else {
      showFieldError(t, '', t.closest('.rate-field'));
    }
  }

  if (t.matches('.cat-name-input')) {
    const cat = category(t.dataset.id);
    const name = t.value;
    let error = '';
    if (!TrackyRules.patterns.category.test(name)) error = 'Use letters separated by single spaces or hyphens';
    else if (data.categories.some((c) => c.id !== cat.id && c.type === cat.type && c.name.toLowerCase() === name.toLowerCase())) {
      error = 'You already have a category with this name';
    }
    if (error) return showFieldError(t, error);
    if (name !== cat.name) update(() => { cat.name = name; });
    else showFieldError(t, '');
  }
}

// Add category
$('#new-cat').addEventListener('input', () => { $('#new-cat-err').textContent = ''; $('#new-cat').classList.remove('invalid'); });
$('#new-cat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#new-cat');
  const name = input.value;
  const type = state.catTab;
  let error = '';
  if (!TrackyRules.patterns.category.test(name)) error = 'Use letters separated by single spaces or hyphens';
  else if (data.categories.some((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase())) error = '“' + name + '” already exists';

  if (error) {
    $('#new-cat-err').textContent = error;
    input.classList.add('invalid');
    return;
  }
  // New categories go just above "Other"
  update((d) => {
    const otherIndex = d.categories.findIndex((c) => c.id === (type === 'expense' ? 'other' : 'other-income'));
    d.categories.splice(otherIndex, 0, { id: 'c-' + makeId(), name, type });
  });
  input.value = '';
  toast('Category added', name, 'success');
});

// Display currency
$('#display-cur').addEventListener('change', (e) => {
  const value = e.target.value;
  update((d) => { d.settings.currency = value; });
  toast('Showing amounts in ' + value, '', 'success');
});

// Import
$('#file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importFile(file);
});

// Transaction form inputs
$('#tx-amount').addEventListener('input', (e) => { form.amount = e.target.value; renderFormState(); });
$('#tx-amount').addEventListener('blur', () => { if (form) { form.touched.amount = true; renderFormState(); } });
$('#tx-currency').addEventListener('change', (e) => { form.currency = e.target.value; renderFormState(); });
$('#tx-desc').addEventListener('input', (e) => { form.description = e.target.value; renderFormState(); });
$('#tx-desc').addEventListener('blur', () => { if (form) { form.touched.description = true; renderFormState(); } });
$('#tx-date').addEventListener('change', (e) => { form.date = e.target.value; form.touched.date = true; renderFormState(); });
$('#tx-method').addEventListener('change', (e) => { form.method = e.target.value; });
$('#tx-form').addEventListener('submit', (e) => { e.preventDefault(); submitForm(false); });

// Keyboard shortcuts: N = new transaction, Esc = close dialog
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#confirm-overlay').hidden) return closeConfirm();
    if (!$('#form-overlay').hidden) return closeForm();
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const dialogOpen = !$('#form-overlay').hidden || !$('#confirm-overlay').hidden;
  if (e.key && e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !dialogOpen) {
    e.preventDefault();
    openAdd();
  }
});

// Keep other open tabs in sync
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try { data = normalize(JSON.parse(e.newValue)); render(); } catch (err) { /* ignore bad data */ }
});

window.addEventListener('hashchange', () => goTo(location.hash.slice(1)));

// Follow the system theme when "System" is selected
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);



function inlineEditor(t) {
  return `<details class="inline-edit"><summary>Edit inline: ${escapeHtml(t.description)}</summary>
    <form data-inline-id="${escapeHtml(t.id)}" class="inline-form">
      <label>Description <input name="description" value="${escapeHtml(t.description)}" maxlength="60" required></label>
      <label>Amount (RWF) <input name="amount" inputmode="decimal" value="${t.amount}" required></label>
      <label>Date <input name="date" type="date" value="${t.date}" required></label>
      <label>Category <select name="categoryId">${data.categories.filter(c => c.type === t.type).map(c => `<option value="${escapeHtml(c.id)}" ${c.id === t.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
      <button class="btn btn-primary" type="submit">Save changes</button>
      <button class="btn btn-danger" type="button" data-action="delete" data-id="${escapeHtml(t.id)}">Delete</button>
      <span role="alert" class="error-text"></span>
    </form></details>`;
}
document.addEventListener('submit', event => {
  const element = event.target.closest('[data-inline-id]');
  if (!element) return;
  event.preventDefault();
  const t = data.transactions.find(t => t.id === element.dataset.inlineId);
  const fields = Object.fromEntries(new FormData(element));
  fields.description = fields.description.replace(/ {2,}/g, ' ');
  const errors = validate({...t, ...fields});
  if (Object.keys(errors).length) {
    element.querySelector('[role="alert"]').textContent = Object.values(errors).join('. ');
    return;
  }
  update(() => Object.assign(t, fields, {amount: Number(fields.amount), description: fields.description.replace(/ {2,}/g, ' '), origAmount: null, origCurrency: 'RWF', updatedAt: Date.now()}));
  toast('Changes saved', t.description, 'success');
  $('#search').focus();
});
$('#search-case').addEventListener('change', renderTransactionList);
function renderRubricStats() {
  const txs = data.transactions;
  $('#metric-count').textContent = txs.length;
  $('#metric-total').textContent = money(sum(txs));
  const totals = {};
  txs.filter(t => t.type === 'expense').forEach(t => { totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount; });
  const top = Object.keys(totals).sort((a,b) => totals[b] - totals[a])[0];
  $('#metric-top').textContent = top ? categoryName(top) : 'No expenses';
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    const date = isoDate(d);
    return {date, amount: sum(txs.filter(t => t.type === 'expense' && t.date === date))};
  });
  const max = Math.max(1, ...days.map(d => d.amount));
  $('#week-chart').innerHTML = days.map(d => `<div class="trend-day"><span class="trend-value">${money(d.amount)}</span><div class="trend-bar" style="height:${Math.max(2,d.amount/max*100)}px" aria-hidden="true"></div><span>${d.date.slice(5)}</span></div>`).join('');
  const spent = sum(expensesIn(thisMonth()));
  const cap = data.budget.monthly;
  const exceeded = cap && spent > cap;
  const message = cap ? (exceeded ? 'Monthly cap exceeded by ' + money(spent-cap) : money(cap-spent) + ' remaining in your monthly cap') : 'Set a monthly cap in Budget.';
  $('#cap-polite').textContent = exceeded ? '' : message;
  $('#cap-assertive').textContent = exceeded ? message : '';
}

document.addEventListener('keydown', event => {
  const overlay = !$('#confirm-overlay').hidden ? $('#confirm-overlay') : !$('#form-overlay').hidden ? $('#form-overlay') : null;
  if (!overlay || event.key !== 'Tab') return;
  const controls = [...overlay.querySelectorAll('button, input, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});

/* ================= Start ================= */

data = loadData();
const startPage = location.hash.slice(1);
if (PAGES.includes(startPage)) state.page = startPage;
render();
})();

/* ================= Optional test mode: index.html?tests=1 ================= */
(() => {
  if (new URLSearchParams(window.location.search).get('tests') !== '1') return;
  const panel = document.createElement('section');
  panel.className = 'card';
  panel.setAttribute('aria-labelledby', 'test-heading');
  const heading = document.createElement('h2');
  heading.id = 'test-heading';
  heading.textContent = 'Tracky tests';
  const summary = document.createElement('p');
  summary.id = 'test-summary';
  summary.setAttribute('role', 'status');
  const list = document.createElement('ol');
  list.id = 'test-results';
  panel.append(heading, summary, list);
  document.querySelector('#main-content .container').prepend(panel);
  const R = TrackyRules;
  const results = [];
  const assert = (name, predicate) => {
    try { if (!predicate()) throw new Error('Assertion failed'); results.push({name, pass:true}); }
    catch (error) { results.push({name, pass:false, error:error.message}); }
  };
  const rejects = value => { try { R.validateBackup(value); return false; } catch { return true; } };
  const fixture = () => ({version:2, transactions:[{id:'rec_0001', type:'expense', amount:12.50, description:'Lunch at cafeteria', categoryId:'food', date:'2025-09-29', method:'cash', origAmount:null, origCurrency:'RWF', createdAt:1759104000000, updatedAt:1759104000000}], categories:[{id:'food',name:'Food',type:'expense'}], budget:{monthly:100,categories:{}}, settings:{currency:'RWF',theme:'system',rates:{USD:1450,EUR:1690,GBP:1950,KES:11.2,UGX:0.39,TZS:0.56}}});
  assert('Description rejects leading and trailing spaces', () => !R.patterns.description.test(' Lunch') && !R.patterns.description.test('Lunch '));
  assert('Description permits a single character', () => R.patterns.description.test('A'));
  assert('Double spaces collapse before submission', () => 'Lunch  at   school'.replace(/ {2,}/g, ' ') === 'Lunch at school');
  assert('Amounts accept zero and two decimal places', () => ['0','12','12.50'].every(n => R.patterns.amount.test(n)));
  assert('Amounts reject leading zeroes, commas, exponent and extra decimals', () => ['01','1,000','1e2','1.234','-1'].every(n => !R.patterns.amount.test(n)));
  assert('Dates reject invalid months and impossible days', () => !R.validDate('2025-13-01') && !R.validDate('2025-02-29') && !R.validDate('2025-04-31'));
  assert('Dates accept leap day', () => R.validDate('2024-02-29'));
  assert('Categories allow letters, spaces and hyphens', () => R.patterns.category.test('School-books') && !R.patterns.category.test('Food & drinks') && !R.patterns.category.test('Food2'));
  assert('Back-reference catches adjacent duplicate words', () => R.patterns.duplicate.test('coffee Coffee') && !R.patterns.duplicate.test('coffee tea'));
  assert('Invalid search returns an error without throwing', () => !!R.compile('[').error);
  assert('Case toggle affects search', () => R.compile('tea',true).regex.test('TEA') && !R.compile('tea',false).regex.test('TEA'));
  assert('Cents pattern matches formatted amounts', () => R.compile('\\.\\d{2}\\b').regex.test('12.50'));
  assert('JSON round-trip retains all data', () => JSON.stringify(R.validateBackup(JSON.parse(JSON.stringify(fixture())))) === JSON.stringify(fixture()));
  assert('Import rejects wrong shape', () => rejects({transactions:[]}));
  assert('Import rejects null records', () => {const b=fixture(); b.transactions=[null]; return rejects(b);});
  assert('Import rejects duplicate ids', () => {const b=fixture(); b.transactions.push({...b.transactions[0]}); return rejects(b);});
  assert('Import rejects missing update timestamp', () => {const b=fixture(); delete b.transactions[0].updatedAt; return rejects(b);});
  assert('Import rejects unknown category', () => {const b=fixture(); b.transactions[0].categoryId='missing'; return rejects(b);});
  assert('Import rejects zero exchange rate', () => {const b=fixture(); b.settings.rates.USD=0; return rejects(b);});
  assert('Import rejects negative budget', () => {const b=fixture(); b.budget.monthly=-1; return rejects(b);});
  assert('Highlight creates safe text, never executable markup', () => {const el=document.createElement('div'); el.append(R.highlight('<img src=x onerror=alert(1)> tea', /tea/i)); return !el.querySelector('img') && el.querySelector('mark').textContent==='tea' && el.textContent.includes('<img');});
  assert('Zero-length highlight patterns terminate and preserve text', () => {const el=document.createElement('div'); el.append(R.highlight('tea', /(?:)/)); return el.textContent==='tea';});
  if (typeof document !== 'undefined') {
    const list=document.getElementById('test-results');
    if (list) for (const result of results) {const item=document.createElement('li'); item.textContent=(result.pass?'PASS: ':'FAIL: ')+result.name+(result.error?' — '+result.error:''); list.append(item);}
    const summary=document.getElementById('test-summary');
    if (summary) summary.textContent=results.filter(r=>r.pass).length+' / '+results.length+' passed';
  }
  globalThis.trackyTestResults=results;
})();
