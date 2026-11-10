import * as db from './db.js';
import {
  GOAL_INFO, defaultSettings, num, numOrNull, ymd, parseYmd, addDays,
  dayValues, status, dayResult, streaks, energy, parseStepsClipboard,
  compactCsv, fullCsv, parseFullCsv,
} from './logic.js';

/* ---------- State ---------- */

const data = { settings: defaultSettings(), foods: [], entries: [], days: {} };
const ui = { tab: 'today', today: ymd(new Date()), date: ymd(new Date()) };

/* ---------- Small helpers ---------- */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const short = (s) => parseYmd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function dateLabel(s) {
  if (s === ui.today) return 'Today';
  if (s === addDays(ui.today, -1)) return 'Yesterday';
  return parseYmd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_TEXT = { not: 'Not met', met: 'Met', 'exceeded-good': 'Exceeded', 'exceeded-bad': 'Exceeded' };

let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Runs a database write. If it fails, the app tells you.
async function save(promise) {
  try {
    await promise;
    return true;
  } catch (err) {
    console.error(err);
    toast('The app could not save this change. Try again.', 5000);
    return false;
  }
}

/* ---------- Bottom sheet ---------- */

const overlay = $('#overlay');
function openSheet(title, html, mount) {
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">✕</button></div>${html}</div>`;
  overlay.classList.add('open');
  document.body.classList.add('locked');
  overlay.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeSheet));
  if (mount) mount(overlay);
}
function closeSheet() {
  overlay.classList.remove('open');
  overlay.innerHTML = '';
  document.body.classList.remove('locked');
  render();
}
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

/* ---------- Today ---------- */

// A wheel. Above the goal, a second lap starts on top of the first.
// The second lap is a stronger good color for a floor and a bad color for a ceiling.
function wheel(value, goal, unit) {
  const g = goal.value ?? 0;
  const r = 42, c = 2 * Math.PI * r;
  const ratio = g > 0 ? value / g : 0;
  const lap1 = Math.min(ratio, 1);
  const lap2 = Math.min(Math.max(ratio - 1, 0), 1);
  const lap2Color = goal.type === 'floor' ? 'var(--ring-good)' : 'var(--ring-bad)';
  return `<div class="wheel"><svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--track)" stroke-width="10"/>
      ${lap1 > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--ring)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${lap1 * c} ${c}"/>` : ''}
      ${lap2 > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${lap2Color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${lap2 * c} ${c}"/>` : ''}
    </svg>
    <div class="center"><span class="val num">${fmt(value)}</span><span class="of num">/ ${fmt(g)}${unit ? ' ' + unit : ''}</span></div></div>`;
}

function renderToday() {
  const v = dayValues(data, ui.date);
  const G = data.settings.goals;
  const en = energy(data, ui.date);
  const list = data.entries.filter((e) => e.date === ui.date).sort((a, b) => a.createdAt - b.createdAt);

  const wheels = ['kcal', 'protein', 'steps'].map((k) => {
    const g = G[k];
    if (g.type === 'none' || g.value == null) {
      return `<div><div class="wheel nogoal"><span class="val num">${fmt(v[k] ?? 0)}</span></div>
        <div class="wlabel">${GOAL_INFO[k].label}</div><div class="small muted">No goal</div></div>`;
    }
    const st = status(v[k] ?? 0, g);
    return `<div>${wheel(v[k] ?? 0, g, GOAL_INFO[k].unit)}
      <div class="wlabel">${GOAL_INFO[k].label}</div>
      <div class="status st-${st}">${STATUS_TEXT[st]}</div>
      <div class="small muted">${g.type}</div></div>`;
  }).join('');

  const minis = ['carbs', 'fat'].map((k) => {
    const st = status(v[k], G[k]);
    return `<div><b class="num">${fmt(v[k])} g</b><span class="small muted">${GOAL_INFO[k].label}${st ? ` · <span class="st-${st}">${STATUS_TEXT[st]}</span>` : ''}</span></div>`;
  }).join('');

  let energyHtml;
  if (en.missing) {
    const need = [];
    if (en.missing.includes('height') || en.missing.includes('age')) need.push('your height and age in Settings');
    if (en.missing.includes('weight')) need.push('a weight');
    energyHtml = `<p class="muted">To see the estimate, add ${need.join(' and ')}.</p>`;
  } else {
    const deficit = en.net >= 0;
    const w = en.weight;
    const wText = w.kind === 'average'
      ? `Average of ${w.count} weight${w.count === 1 ? '' : 's'} in the 7 days up to ${short(ui.date)} (${w.count === 1 ? short(w.from) : `${short(w.from)} – ${short(w.to)}`}).`
      : `No weight in the 7 days up to ${short(ui.date)}. This is the most recent weight (${short(w.from)}).`;
    energyHtml = `
      <div class="small muted">Estimated ${deficit ? 'deficit' : 'surplus'}${ui.date === ui.today ? ' so far (full-day burn)' : ''}</div>
      <div class="big num" style="color:${deficit ? 'var(--ring)' : 'var(--bad)'}">${fmt(Math.abs(en.net))} kcal</div>
      <table class="calc">
        <tr><td>Base burn (Mifflin-St Jeor)</td><td>${fmt(en.bmr)}</td></tr>
        <tr><td>Daily life</td><td>+ ${fmt(en.neat)}</td></tr>
        <tr><td>Steps (${fmt(en.steps)})</td><td>+ ${fmt(en.stepBurn)}</td></tr>
        <tr><td>Eaten</td><td>− ${fmt(en.eaten)}</td></tr>
        <tr class="total"><td>${deficit ? 'Deficit' : 'Surplus'}</td><td>${fmt(Math.abs(en.net))}</td></tr>
      </table>
      <p class="hint">Weight in the formulas: <b>${fmt1(w.lb)} lb</b>. ${wText}</p>`;
  }

  return `
    <div class="datebar">
      <button class="round" data-act="prev" aria-label="Previous day">‹</button>
      <button class="date" data-act="today">${dateLabel(ui.date)}</button>
      <button class="round" data-act="next" aria-label="Next day" ${ui.date >= ui.today ? 'disabled' : ''}>›</button>
    </div>

    <section class="card">
      <div class="wheels">${wheels}</div>
      <div class="minis">
        ${minis}
        <button class="mini-btn" data-act="weight"><b class="num">${v.weight != null ? fmt1(v.weight) + ' lb' : 'Add'}</b><span class="small muted">Weight</span></button>
      </div>
    </section>

    <section class="card">
      <div class="row"><h2 style="margin:0">Steps</h2><button class="btn" data-act="paste">Paste steps</button></div>
    </section>

    <section class="card">${energyHtml}</section>

    <section class="card">
      <h2>Food</h2>
      ${list.length ? list.map((e) => `
        <button class="entry" data-act="edit" data-id="${esc(e.id)}">
          <span>${esc(e.name)}<small>${e.foodId ? `${fmt1(e.mult)} × ${esc(e.serving)}` : 'One-time food'} · P ${fmt1(e.protein * e.mult)} · C ${fmt1(e.carbs * e.mult)} · F ${fmt1(e.fat * e.mult)}</small></span>
          <span class="kc num">${fmt(e.kcal * e.mult)} kcal</span>
        </button>`).join('') : '<p class="muted">No food on this day.</p>'}
      <div class="btns2">
        <button class="btn primary" data-act="addSaved">Add saved food</button>
        <button class="btn" data-act="addOnce">One-time food</button>
      </div>
    </section>`;
}

function macroText(x, m = 1) {
  return `${fmt(x.kcal * m)} kcal · P ${fmt1(x.protein * m)} g · C ${fmt1(x.carbs * m)} g · F ${fmt1(x.fat * m)} g`;
}

function pickSavedFood() {
  const foods = [...data.foods].sort((a, b) => a.name.localeCompare(b.name));
  openSheet('Add saved food', foods.length
    ? foods.map((f) => `<button class="entry" data-id="${esc(f.id)}"><span>${esc(f.name)}<small>per ${esc(f.serving)}</small></span><span class="kc num">${fmt(f.kcal)} kcal</span></button>`).join('')
    : '<p class="muted">You have no saved foods. Add them in the Foods tab.</p>',
  (root) => root.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => multiplierSheet(foods.find((f) => f.id === b.dataset.id)))));
}

// Add a saved food with a multiplier, or change the multiplier of an entry.
function multiplierSheet(food, entry) {
  const base = entry || food;
  openSheet(base.name, `
    <p class="hint">Per ${esc(base.serving)}: ${macroText(base)}</p>
    <label class="field">Multiplier of the serving<input id="m" inputmode="decimal" autocomplete="off" value="${entry ? entry.mult : 1}"></label>
    <div class="preview" id="pv"></div>
    <button class="btn primary wide" id="ok">${entry ? 'Save' : 'Add'}</button>
    ${entry ? '<button class="btn danger wide" id="del">Delete entry</button>' : ''}`, (root) => {
    const m = $('#m', root);
    const upd = () => ($('#pv', root).textContent = `Total: ${macroText(base, num(m.value))}`);
    upd();
    m.oninput = upd;
    $('#ok', root).onclick = async () => {
      const mult = num(m.value);
      if (mult <= 0) return toast('Type a multiplier more than 0.');
      if (entry) {
        const updated = { ...entry, mult };
        if (await save(db.putEntry(updated))) Object.assign(entry, updated);
      } else {
        // The entry keeps its own copy of the food values.
        // A later change to the saved food does not change old days.
        const e = { id: uid(), date: ui.date, foodId: food.id, name: food.name, serving: food.serving,
          kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, mult, createdAt: Date.now() };
        if (await save(db.putEntry(e))) data.entries.push(e);
      }
      closeSheet();
    };
    if (entry) $('#del', root).onclick = () => deleteEntry(entry);
  });
}

async function deleteEntry(entry) {
  if (await save(db.deleteEntry(entry.id))) {
    data.entries = data.entries.filter((e) => e !== entry);
    toast('Entry deleted.');
  }
  closeSheet();
}

function numberFields(x = {}) {
  return `<div class="grid2">${[['kcal', 'Calories (kcal)'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)']]
    .map(([k, l]) => `<label class="field">${l}<input name="${k}" inputmode="decimal" autocomplete="off" value="${x[k] ?? ''}" placeholder="0"></label>`).join('')}</div>`;
}
function readNumbers(root) {
  const o = {};
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) o[k] = num($(`[name=${k}]`, root).value);
  return o;
}

// A one-time food: the app does not add it to the saved foods.
function oneTimeSheet(entry) {
  openSheet(entry ? 'Edit one-time food' : 'One-time food', `
    <label class="field">Name<input name="name" autocomplete="off" value="${esc(entry?.name || '')}"></label>
    ${numberFields(entry)}
    <button class="btn primary wide" id="ok">${entry ? 'Save' : 'Add'}</button>
    ${entry ? '<button class="btn danger wide" id="del">Delete entry</button>' : ''}`, (root) => {
    $('#ok', root).onclick = async () => {
      const name = $('[name=name]', root).value.trim();
      if (!name) return toast('Type a name.');
      const n = readNumbers(root);
      if (entry) {
        const updated = { ...entry, name, ...n };
        if (await save(db.putEntry(updated))) Object.assign(entry, updated);
      } else {
        const e = { id: uid(), date: ui.date, foodId: null, name, serving: 'one-time', mult: 1, ...n, createdAt: Date.now() };
        if (await save(db.putEntry(e))) data.entries.push(e);
      }
      closeSheet();
    };
    if (entry) $('#del', root).onclick = () => deleteEntry(entry);
  });
}

function weightSheet() {
  const day = data.days[ui.date] || { date: ui.date };
  openSheet(`Weight — ${dateLabel(ui.date)}`, `
    <label class="field">Weight (lb)<input id="w" inputmode="decimal" autocomplete="off" value="${day.weight ?? ''}"></label>
    <button class="btn primary wide" id="ok">Save</button>
    ${day.weight != null ? '<button class="btn danger wide" id="del">Remove weight</button>' : ''}`, (root) => {
    $('#ok', root).onclick = async () => {
      const w = numOrNull($('#w', root).value);
      if (w == null || w <= 0) return toast('Type a weight.');
      await setDay(ui.date, { weight: w });
      closeSheet();
    };
    if (day.weight != null) $('#del', root).onclick = async () => { await setDay(ui.date, { weight: null }); closeSheet(); };
  });
}

// Changes the steps or the weight of one day. A null value removes it.
async function setDay(date, changes) {
  const day = { ...(data.days[date] || {}), date };
  for (const [k, v] of Object.entries(changes)) {
    if (v == null) delete day[k];
    else day[k] = v;
  }
  if (await save(db.putDay(day))) data.days[date] = day;
}

// Reads the step totals that the shortcut copied. A new total replaces the old total.
async function pasteSteps() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    toast('The app could not read the clipboard.');
    return;
  }
  const found = parseStepsClipboard(text, ui.today);
  if (!found.length) {
    toast('The clipboard has no steps for yesterday or today. Run the shortcut first.', 4500);
    return;
  }
  for (const { date, steps } of found) await setDay(date, { steps });
  render();
  toast(found.map((f) => `${dateLabel(f.date)}: ${fmt(f.steps)}`).join(' · '), 4000);
}

/* ---------- Foods ---------- */

function renderFoods() {
  const foods = [...data.foods].sort((a, b) => a.name.localeCompare(b.name));
  return `<h1>Foods</h1>
    <button class="btn primary wide" data-act="newFood" style="margin:0 0 12px">New saved food</button>
    <section class="card">
      ${foods.length ? foods.map((f) => `
        <button class="entry" data-act="editFood" data-id="${esc(f.id)}">
          <span>${esc(f.name)}<small>per ${esc(f.serving)} · P ${fmt1(f.protein)} · C ${fmt1(f.carbs)} · F ${fmt1(f.fat)}</small></span>
          <span class="kc num">${fmt(f.kcal)} kcal</span>
        </button>`).join('') : '<p class="muted">You have no saved foods.</p>'}
    </section>`;
}

function foodSheet(food) {
  openSheet(food ? 'Edit saved food' : 'New saved food', `
    <label class="field">Name<input name="name" autocomplete="off" value="${esc(food?.name || '')}"></label>
    <label class="field">Serving<input name="serving" autocomplete="off" value="${esc(food?.serving || '')}" placeholder="For example: 100 g, 1 scoop"></label>
    <p class="hint">Values for one serving:</p>
    ${numberFields(food)}
    <button class="btn primary wide" id="ok">Save</button>
    ${food ? '<button class="btn danger wide" id="del">Delete saved food</button><p class="hint">Old days keep their entries.</p>' : ''}`, (root) => {
    $('#ok', root).onclick = async () => {
      const name = $('[name=name]', root).value.trim();
      if (!name) return toast('Type a name.');
      const f = { ...(food || { id: uid() }), name, serving: $('[name=serving]', root).value.trim() || '1 serving', ...readNumbers(root) };
      if (await save(db.putFood(f))) {
        if (food) Object.assign(food, f);
        else data.foods.push(f);
      }
      closeSheet();
    };
    if (food) {
      $('#del', root).onclick = async () => {
        if (!confirm(`Delete "${food.name}" from your saved foods?`)) return;
        if (await save(db.deleteFood(food.id))) {
          data.foods = data.foods.filter((x) => x !== food);
          toast('Saved food deleted.');
        }
        closeSheet();
      };
    }
  });
}

/* ---------- Overview ---------- */

const RESULT_TEXT = { red: 'a goal not met', light: 'all goals met', dark: 'all met, a floor exceeded', none: 'no data' };

function renderOverview() {
  const s = streaks(data, ui.today);
  const weeks = 14;
  const end = parseYmd(ui.today);
  const start = new Date(end);
  start.setDate(start.getDate() - end.getDay() - (weeks - 1) * 7);
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = ymd(d);
    if (ds > ui.today) { cells += '<div class="c future"></div>'; continue; }
    const cls = ds === ui.today ? 'today' : dayResult(data, ds);
    const title = `${short(ds)}: ${ds === ui.today ? 'today, not finished' : RESULT_TEXT[cls]}`;
    cells += `<button class="c ${cls}" title="${title}" aria-label="${title}" data-act="openDay" data-date="${ds}"></button>`;
  }

  // Weight chart for the last 60 days.
  const pts = [];
  for (let i = 59; i >= 0; i--) {
    const d = addDays(ui.today, -i);
    if (data.days[d]?.weight != null) pts.push([59 - i, data.days[d].weight, d]);
  }
  let chart = '<p class="muted">The chart starts when you have two weights in the last 60 days.</p>';
  if (pts.length > 1) {
    const W = 330, H = 150, P = 6;
    const ws = pts.map((p) => p[1]);
    const lo = Math.floor(Math.min(...ws)) - 0.5, hi = Math.ceil(Math.max(...ws)) + 0.5;
    const x = (i) => P + (i / 59) * (W - 2 * P);
    const y = (w) => P + (1 - (w - lo) / (hi - lo)) * (H - 2 * P);
    chart = `
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Weight chart">
        <line x1="0" x2="${W}" y1="${y(hi)}" y2="${y(hi)}" stroke="var(--line)"/>
        <line x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}" stroke="var(--line)"/>
        <polyline points="${pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        ${pts.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.5" fill="var(--accent)"><title>${short(p[2])}: ${p[1]} lb</title></circle>`).join('')}
      </svg>
      <div class="row small muted"><span>${short(pts[0][2])}</span><span>${lo}–${hi} lb</span><span>${short(pts[pts.length - 1][2])}</span></div>`;
  }

  return `<h1>Overview</h1>
    <section class="card streaks">
      <div><div class="big num">${s.current}</div><div class="small muted">Current streak</div></div>
      <div><div class="big num">${s.longest}</div><div class="small muted">Longest streak</div></div>
    </section>
    <section class="card">
      <h2>Goals by day</h2>
      <div class="calwrap">
        <div class="daylbl"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
        <div class="cal">${cells}</div>
      </div>
      <div class="legend">
        <span><i style="background:var(--cal-red)"></i>Not met</span>
        <span><i style="background:var(--cal-light)"></i>All met</span>
        <span><i style="background:var(--cal-dark)"></i>All met + floor exceeded</span>
        <span><i style="background:var(--cal-none)"></i>No data</span>
      </div>
    </section>
    <section class="card">
      <h2>Weight, last 60 days</h2>
      ${chart}
    </section>`;
}

/* ---------- Settings ---------- */

function renderSettings() {
  const st = data.settings;
  const goalRow = (k) => {
    const g = st.goals[k];
    const canNone = k === 'carbs' || k === 'fat';
    const unit = GOAL_INFO[k].unit;
    return `<div class="goalrow">
      <label class="field">${GOAL_INFO[k].label}${unit ? ` (${unit})` : ''}
        <input data-goal="${k}" data-f="value" inputmode="numeric" autocomplete="off" value="${g.value ?? ''}" ${g.type === 'none' ? 'disabled placeholder="No goal"' : ''}></label>
      <label class="field">Type<select data-goal="${k}" data-f="type">
        ${canNone ? `<option value="none" ${g.type === 'none' ? 'selected' : ''}>No goal</option>` : ''}
        <option value="floor" ${g.type === 'floor' ? 'selected' : ''}>Floor (minimum)</option>
        <option value="ceiling" ${g.type === 'ceiling' ? 'selected' : ''}>Ceiling (maximum)</option>
      </select></label></div>`;
  };
  const field = (key, label, mode = 'decimal') =>
    `<label class="field">${label}<input data-set="${key}" inputmode="${mode}" autocomplete="off" value="${st[key] ?? ''}"></label>`;

  return `<h1>Settings</h1>
    <section class="card"><h2>Goals</h2>${['kcal', 'protein', 'steps', 'carbs', 'fat'].map(goalRow).join('')}</section>
    <section class="card"><h2>Body</h2>
      <div class="grid2">${field('heightFt', 'Height (feet)', 'numeric')}${field('heightIn', 'Height (inches)', 'decimal')}</div>
      <div class="grid2">${field('age', 'Age', 'numeric')}
        <label class="field">Sex<select data-set="sex">
          <option value="male" ${st.sex === 'male' ? 'selected' : ''}>Male</option>
          <option value="female" ${st.sex === 'female' ? 'selected' : ''}>Female</option></select></label></div>
      <p class="hint">Your weight comes from the daily weights: the average of the last 7 days.</p>
    </section>
    <section class="card"><h2>Formula values</h2>
      ${field('neat', 'Daily-life calories (kcal)')}
      ${field('kcalPerLbMile', 'Calories per pound per mile')}
      ${field('stepsPerMile', 'Steps per mile', 'numeric')}
    </section>
    <section class="card"><h2>Export and import</h2>
      <p class="hint">Each export opens the share menu. Choose LocalSend to send the file to your PC.</p>
      <button class="btn wide" data-act="exportCompact">Export compact CSV (one row per day)</button>
      <button class="btn wide" data-act="exportFull">Export full CSV (everything)</button>
      <button class="btn wide" data-act="import">Import full CSV</button>
      <input type="file" id="importFile" accept=".csv,text/csv,text/comma-separated-values" hidden>
      <p class="hint">An import replaces all data in the app. Export a full CSV first if you want to keep the current data.</p>
    </section>
    <section class="card"><h2>Steps shortcut</h2>${SHORTCUT_HELP}</section>`;
}

const SHORTCUT_HELP = `
  <p class="hint">Make this shortcut one time in the Shortcuts app. The names in your version of iOS can be a little different.</p>
  <ol class="small">
    <li>Open <b>Shortcuts</b> and tap <b>+</b>. Name the shortcut <b>Copy steps</b>.</li>
    <li>Add <b>Find Health Samples</b>. Set the type to <b>Steps</b>. Add the filter <b>Start Date is in the last 2 days</b>. Set <b>Group By</b> to <b>Day</b>.</li>
    <li>Add <b>Repeat with Each</b>. Inside it, add <b>Text</b> with this content: the <b>Start Date</b> of the Repeat Item, a space, and the <b>Value</b> of the Repeat Item. Set the date format to <b>Custom</b>: <code>yyyy-MM-dd</code>.</li>
    <li>After the Repeat, add <b>Combine Text</b> with <b>New Lines</b>.</li>
    <li>Add <b>Copy to Clipboard</b>.</li>
  </ol>
  <p class="hint">The clipboard then has one line for each day, for example <code>2026-11-08 12034</code>. The app uses only the lines for yesterday and today.</p>
  <p class="hint">If a total is larger than the total in the Health app, the phone and the watch both counted the same steps. Add the filter <b>Source is</b> your watch.</p>`;

async function saveSettings() {
  await save(db.putSettings(data.settings));
}

function onSettingsChange(e) {
  const t = e.target;
  const st = data.settings;
  if (t.dataset.goal) {
    const g = st.goals[t.dataset.goal];
    if (t.dataset.f === 'type') {
      g.type = t.value;
      if (g.type !== 'none' && g.value == null) g.value = 0;
      render();
    } else {
      g.value = numOrNull(t.value);
    }
  } else if (t.dataset.set) {
    const k = t.dataset.set;
    st[k] = k === 'sex' ? t.value : numOrNull(t.value);
    // The formula values must always have a number.
    if (['neat', 'kcalPerLbMile', 'stepsPerMile'].includes(k) && st[k] == null) {
      st[k] = defaultSettings()[k];
      t.value = st[k];
    }
  } else {
    return;
  }
  saveSettings();
}

async function shareFile(name, text) {
  const file = new File([text], name, { type: 'text/csv' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast('The export did not work.');
  }
}

async function importFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let incoming;
  try {
    incoming = parseFullCsv(await file.text());
  } catch (err) {
    toast(err.message, 6000);
    return;
  }
  const counts = `${incoming.entries.length} food entries, ${incoming.foods.length} saved foods, ${Object.keys(incoming.days).length} days with steps or weight`;
  if (!confirm(`Replace ALL data in the app with this file?\n\nThe file has ${counts}.`)) return;
  if (await save(db.replaceAll(incoming))) {
    Object.assign(data, incoming);
    toast('Import complete.');
    render();
  }
}

/* ---------- Navigation ---------- */

const actions = {
  prev: () => { ui.date = addDays(ui.date, -1); render(); },
  next: () => { if (ui.date < ui.today) { ui.date = addDays(ui.date, 1); render(); } },
  today: () => { ui.date = ui.today; render(); },
  openDay: (b) => { ui.date = b.dataset.date; showTab('today'); },
  weight: weightSheet,
  paste: pasteSteps,
  addSaved: pickSavedFood,
  addOnce: () => oneTimeSheet(),
  edit: (b) => {
    const e = data.entries.find((x) => x.id === b.dataset.id);
    if (e) (e.foodId ? multiplierSheet(null, e) : oneTimeSheet(e));
  },
  newFood: () => foodSheet(),
  editFood: (b) => foodSheet(data.foods.find((f) => f.id === b.dataset.id)),
  exportCompact: () => shareFile(`nutrition-compact-${ui.today}.csv`, compactCsv(data, ui.today)),
  exportFull: () => shareFile(`nutrition-full-${ui.today}.csv`, fullCsv(data)),
  import: () => $('#importFile').click(),
};

const view = $('#view');
view.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act](b);
});
view.addEventListener('change', (e) => {
  if (e.target.id === 'importFile') importFile(e);
  else onSettingsChange(e);
});

function showTab(tab) {
  ui.tab = tab;
  window.scrollTo(0, 0);
  render();
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === ui.tab));
  const fn = { today: renderToday, foods: renderFoods, overview: renderOverview, settings: renderSettings }[ui.tab];
  try {
    view.innerHTML = fn();
  } catch (err) {
    console.error(err);
    view.innerHTML = `<section class="card"><h2>Something went wrong</h2><p class="muted">${esc(err?.message || err)}</p></section>`;
  }
}

// When the app opens again on a new day, "Today" moves to the new date.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = ymd(new Date());
  if (now === ui.today) return;
  if (ui.date === ui.today) ui.date = now;
  ui.today = now;
  if (!overlay.classList.contains('open')) render();
});

/* ---------- Start ---------- */

async function start() {
  try {
    const stored = await db.loadAll();
    const defaults = defaultSettings();
    data.settings = stored.settings
      ? { ...defaults, ...stored.settings, goals: { ...defaults.goals, ...stored.settings.goals } }
      : defaults;
    data.foods = stored.foods;
    data.entries = stored.entries;
    data.days = stored.days;
  } catch (err) {
    console.error(err);
    view.innerHTML = '<section class="card"><h2>The app could not open its data</h2><p class="muted">Close the app and open it again.</p></section>';
    return;
  }
  render();

  // Ask the browser to keep the data when the device is low on space. iOS can say no.
  navigator.storage?.persist?.().catch(() => {});

  // The offline copy is off on a local test server, so that code changes show at once.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !local) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
    // When a new version takes control, reload one time. Not on the first install, and not with a form open.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || overlay.classList.contains('open')) return;
      reloaded = true;
      location.reload();
    });
  }
}

start();
