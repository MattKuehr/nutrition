// Calculations, goal status, step paste, and CSV files.
// This file has no screen code, so the tests can check it directly.

export const GOAL_KEYS = ['kcal', 'protein', 'steps', 'carbs', 'fat'];
export const GOAL_INFO = {
  kcal: { label: 'Calories', unit: 'kcal' },
  protein: { label: 'Protein', unit: 'g' },
  steps: { label: 'Steps', unit: '' },
  carbs: { label: 'Carbs', unit: 'g' },
  fat: { label: 'Fat', unit: 'g' },
};

// Start values. Height and age are empty: you type them in the settings.
export function defaultSettings() {
  return {
    goals: {
      kcal: { value: 2100, type: 'ceiling' },
      protein: { value: 140, type: 'floor' },
      steps: { value: 11000, type: 'floor' },
      carbs: { value: null, type: 'none' },
      fat: { value: null, type: 'none' },
    },
    heightFt: null,
    heightIn: null,
    age: null,
    sex: 'male',
    neat: 300,
    kcalPerLbMile: 0.53,
    stepsPerMile: 2000,
  };
}

/* ---------- Numbers and dates ---------- */

// Reads a number from text. A comma is a decimal mark, for example "1,5".
// Returns null for empty or bad text.
export function numOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function num(v) { return numOrNull(v) ?? 0; }

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Day values and goals ---------- */

export function totals(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) for (const k in t) t[k] += (e[k] || 0) * e.mult;
  return t;
}

export function dayValues(data, date) {
  const list = data.entries.filter((e) => e.date === date);
  const day = data.days[date] || {};
  return { ...totals(list), steps: day.steps ?? null, weight: day.weight ?? null, hasData: list.length > 0 };
}

// Floor: below = not met, equal = met, above = exceeded (good).
// Ceiling: at or below = met, above = exceeded (bad).
// Returns null when the item has no goal.
export function status(value, goal) {
  if (!goal || goal.type === 'none' || goal.value == null) return null;
  const v = value ?? 0;
  if (goal.type === 'floor') return v < goal.value ? 'not' : v === goal.value ? 'met' : 'exceeded-good';
  return v <= goal.value ? 'met' : 'exceeded-bad';
}

// Calendar result: 'none' (no food data), 'red', 'light' (all met), or 'dark' (all met, a floor exceeded).
export function dayResult(data, date) {
  const v = dayValues(data, date);
  if (!v.hasData) return 'none';
  const all = GOAL_KEYS.map((k) => status(v[k], data.settings.goals[k])).filter(Boolean);
  if (all.some((s) => s === 'not' || s === 'exceeded-bad')) return 'red';
  return all.includes('exceeded-good') ? 'dark' : 'light';
}

// Current and longest streak of days with all goals met.
// Today counts only after midnight, so the count stops at yesterday.
export function streaks(data, today) {
  const dates = Object.keys(data.days).concat(data.entries.map((e) => e.date)).sort();
  const yesterday = addDays(today, -1);
  let current = 0, longest = 0;
  if (!dates.length) return { current, longest };
  for (let d = dates[0]; d <= yesterday; d = addDays(d, 1)) {
    const r = dayResult(data, d);
    current = r === 'light' || r === 'dark' ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return { current, longest };
}

/* ---------- Energy calculation ---------- */

// The weight for the formulas: the average of the weights in the 7 days that end on this date.
// With no weight in those days, the most recent weight before them.
export function weightUsed(data, date) {
  const found = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(date, -i);
    const w = data.days[d]?.weight;
    if (w != null) found.push({ date: d, lb: w });
  }
  if (found.length) {
    const lb = found.reduce((a, f) => a + f.lb, 0) / found.length;
    return { lb, kind: 'average', count: found.length, from: found[0].date, to: found[found.length - 1].date };
  }
  const older = Object.keys(data.days).filter((d) => d < date && data.days[d].weight != null).sort().pop();
  if (older) return { lb: data.days[older].weight, kind: 'recent', count: 1, from: older, to: older };
  return null;
}

// Mifflin-St Jeor base burn + daily-life calories + step burn − calories eaten.
// A positive "net" is a deficit. A negative "net" is a surplus.
// Returns { missing: [...] } when a value is not set.
export function energy(data, date) {
  const s = data.settings;
  const missing = [];
  if (s.heightFt == null) missing.push('height');
  if (s.age == null) missing.push('age');
  const w = weightUsed(data, date);
  if (!w) missing.push('weight');
  if (missing.length) return { missing };

  const kg = w.lb * 0.45359237;
  const cm = (s.heightFt * 12 + (s.heightIn ?? 0)) * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * s.age + (s.sex === 'female' ? -161 : 5);
  const v = dayValues(data, date);
  const stepBurn = s.stepsPerMile > 0 ? ((v.steps ?? 0) / s.stepsPerMile) * w.lb * s.kcalPerLbMile : 0;
  const burn = bmr + s.neat + stepBurn;
  return { weight: w, bmr, neat: s.neat, stepBurn, steps: v.steps ?? 0, burn, eaten: v.kcal, net: burn - v.kcal };
}

/* ---------- Steps from the clipboard ---------- */

// Reads a count such as "8432", "8,432", "8.432", or "8432.0".
export function parseCount(text) {
  const m = String(text || '').match(/\d[\d.,   ]*/);
  if (!m) return null;
  let s = m[0].replace(/[\s  ]/g, '').replace(/[.,]$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  const n = Math.round(parseFloat(s));
  return Number.isFinite(n) && n >= 0 && n < 200000 ? n : null;
}

// The shortcut copies one line for each day, for example:
//   2026-11-08 12034
//   2026-11-09 3021
// The app uses only the lines for yesterday and today. A later line for the same day wins.
// Text with no date and only one number counts as the total for today.
export function parseStepsClipboard(text, today) {
  const yesterday = addDays(today, -1);
  const lines = String(text || '').split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  const byDate = new Map();
  let sawDate = false;
  for (const line of lines) {
    const m = line.match(/\d{4}-\d{2}-\d{2}/);
    if (!m) continue;
    sawDate = true;
    const steps = parseCount(line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length));
    if (steps != null && (m[0] === today || m[0] === yesterday)) byDate.set(m[0], steps);
  }
  if (sawDate) return [...byDate].map(([date, steps]) => ({ date, steps })).sort((a, b) => a.date.localeCompare(b.date));
  const steps = parseCount(text);
  return steps == null ? [] : [{ date: today, steps }];
}

/* ---------- CSV ---------- */

function cell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const STATUS_CSV = { not: 'not_met', met: 'met', 'exceeded-good': 'exceeded', 'exceeded-bad': 'exceeded' };
const RESULT_CSV = { none: 'no_data', red: 'not_met', light: 'all_met', dark: 'all_met_floor_exceeded' };

export const COMPACT_HEADER = ['date', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'steps', 'weight_lb',
  'weight_used_lb', 'burn_kcal', 'net_kcal', 'calories_status', 'protein_status', 'steps_status',
  'carbs_status', 'fat_status', 'day_result'];

// One row for each day, from the first day with data to today.
// net_kcal: positive = deficit, negative = surplus.
export function compactCsv(data, today) {
  const dates = Object.keys(data.days).concat(data.entries.map((e) => e.date)).filter((d) => d <= today).sort();
  const rows = [COMPACT_HEADER];
  if (dates.length) {
    for (let d = dates[0]; d <= today; d = addDays(d, 1)) {
      const v = dayValues(data, d);
      const en = energy(data, d);
      const ok = !en.missing;
      const st = (k) => STATUS_CSV[status(v[k], data.settings.goals[k])] ?? '';
      rows.push([d, v.kcal, v.protein, v.carbs, v.fat, v.steps, v.weight,
        ok ? en.weight.lb : null, ok ? Math.round(en.burn) : null, ok ? Math.round(en.net) : null,
        st('kcal'), st('protein'), st('steps'), st('carbs'), st('fat'),
        d === today ? 'in_progress' : RESULT_CSV[dayResult(data, d)]]);
    }
  }
  return toCsv(rows);
}

export const FULL_HEADER = ['row_type', 'id', 'date', 'name', 'serving', 'food_id', 'multiplier',
  'calories', 'protein_g', 'carbs_g', 'fat_g',
  'total_calories', 'total_protein_g', 'total_carbs_g', 'total_fat_g', 'value'];

const SETTING_KEYS = [
  ['height_ft', 'heightFt'], ['height_in', 'heightIn'], ['age', 'age'], ['sex', 'sex'],
  ['daily_life_kcal', 'neat'], ['kcal_per_lb_per_mile', 'kcalPerLbMile'], ['steps_per_mile', 'stepsPerMile'],
];

// Everything: settings, saved foods, food entries, steps, and weights.
// "calories" to "fat_g" are the values for one serving. The "total_" columns are serving × multiplier.
export function fullCsv(data) {
  const rows = [FULL_HEADER];
  const blank = (type, extra) => {
    const r = Object.fromEntries(FULL_HEADER.map((h) => [h, null]));
    r.row_type = type;
    Object.assign(r, extra);
    return FULL_HEADER.map((h) => r[h]);
  };
  const s = data.settings;
  for (const k of GOAL_KEYS) {
    rows.push(blank('setting', { name: `goal_${k}_type`, value: s.goals[k].type }));
    rows.push(blank('setting', { name: `goal_${k}_value`, value: s.goals[k].value }));
  }
  for (const [name, key] of SETTING_KEYS) rows.push(blank('setting', { name, value: s[key] }));
  for (const f of [...data.foods].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push(blank('saved_food', { id: f.id, name: f.name, serving: f.serving,
      calories: f.kcal, protein_g: f.protein, carbs_g: f.carbs, fat_g: f.fat }));
  }
  const dates = [...new Set(Object.keys(data.days).concat(data.entries.map((e) => e.date)))].sort();
  for (const d of dates) {
    for (const e of data.entries.filter((x) => x.date === d).sort((a, b) => a.createdAt - b.createdAt)) {
      rows.push(blank('entry', { id: e.id, date: d, name: e.name, serving: e.serving, food_id: e.foodId,
        multiplier: e.mult, calories: e.kcal, protein_g: e.protein, carbs_g: e.carbs, fat_g: e.fat,
        total_calories: e.kcal * e.mult, total_protein_g: e.protein * e.mult,
        total_carbs_g: e.carbs * e.mult, total_fat_g: e.fat * e.mult }));
    }
    const day = data.days[d] || {};
    if (day.steps != null) rows.push(blank('steps', { date: d, value: day.steps }));
    if (day.weight != null) rows.push(blank('weight', { date: d, value: day.weight }));
  }
  return toCsv(rows);
}

// Reads a full CSV file. Throws an Error with a plain message when the file is not correct.
export function parseFullCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The file is empty.');
  const head = rows[0].map((h) => h.trim());
  for (const h of FULL_HEADER) {
    if (!head.includes(h)) throw new Error(`This is not a full CSV file from this app. The column "${h}" is missing.`);
  }
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const data = { settings: defaultSettings(), foods: [], entries: [], days: {} };
  const settingMap = Object.fromEntries(SETTING_KEYS);
  let order = 0;

  rows.slice(1).forEach((r, i) => {
    const get = (h) => (r[col[h]] ?? '').trim();
    const line = i + 2;
    const need = (h) => {
      const n = numOrNull(get(h));
      if (n == null) throw new Error(`Line ${line}: the column "${h}" must have a number.`);
      return n;
    };
    const needDate = () => {
      const d = get('date');
      if (!ISO_DATE.test(d)) throw new Error(`Line ${line}: the date must look like 2026-11-09.`);
      return d;
    };
    const type = get('row_type');
    if (type === 'setting') {
      const name = get('name');
      const m = name.match(/^goal_(\w+)_(type|value)$/);
      if (m && GOAL_KEYS.includes(m[1])) {
        if (m[2] === 'type') {
          const t = get('value');
          if (!['floor', 'ceiling', 'none'].includes(t)) throw new Error(`Line ${line}: a goal type must be floor, ceiling, or none.`);
          data.settings.goals[m[1]].type = t;
        } else data.settings.goals[m[1]].value = numOrNull(get('value'));
      } else if (settingMap[name]) {
        const key = settingMap[name];
        data.settings[key] = key === 'sex' ? (get('value') === 'female' ? 'female' : 'male') : numOrNull(get('value'));
      }
    } else if (type === 'saved_food') {
      data.foods.push({ id: get('id') || `f${line}`, name: get('name'), serving: get('serving') || '1 serving',
        kcal: need('calories'), protein: need('protein_g'), carbs: need('carbs_g'), fat: need('fat_g') });
    } else if (type === 'entry') {
      data.entries.push({ id: get('id') || `e${line}`, date: needDate(), name: get('name'), serving: get('serving'),
        foodId: get('food_id') || null, mult: need('multiplier'),
        kcal: need('calories'), protein: need('protein_g'), carbs: need('carbs_g'), fat: need('fat_g'),
        createdAt: ++order });
    } else if (type === 'steps' || type === 'weight') {
      const d = needDate();
      (data.days[d] ||= { date: d })[type] = need('value');
    } else {
      throw new Error(`Line ${line}: unknown row type "${type}".`);
    }
  });
  for (const k of ['neat', 'kcalPerLbMile', 'stepsPerMile']) {
    if (data.settings[k] == null) data.settings[k] = defaultSettings()[k];
  }
  return data;
}
