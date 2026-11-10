// The local database. All data stays in the storage of this device.
// The app loads all data into memory at the start, and writes each change to the database.

const DB_NAME = 'nutrition';
const DB_VERSION = 1;
const STORES = ['kv', 'foods', 'entries', 'days'];

let dbPromise;
function openDB() {
  dbPromise ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('foods', { keyPath: 'id' });
      d.createObjectStore('entries', { keyPath: 'id' });
      d.createObjectStore('days', { keyPath: 'date' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

function finish(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The database write stopped.'));
  });
}

function read(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadAll() {
  const d = await openDB();
  const tx = d.transaction(STORES, 'readonly');
  const [settings, foods, entries, days] = await Promise.all([
    read(tx.objectStore('kv').get('settings')),
    read(tx.objectStore('foods').getAll()),
    read(tx.objectStore('entries').getAll()),
    read(tx.objectStore('days').getAll()),
  ]);
  return { settings, foods, entries, days: Object.fromEntries(days.map((x) => [x.date, x])) };
}

async function write(store, fn) {
  const d = await openDB();
  const tx = d.transaction(store, 'readwrite');
  fn(tx.objectStore(store));
  return finish(tx);
}

export const putSettings = (s) => write('kv', (os) => os.put(s, 'settings'));
export const putFood = (f) => write('foods', (os) => os.put(f));
export const deleteFood = (id) => write('foods', (os) => os.delete(id));
export const putEntry = (e) => write('entries', (os) => os.put(e));
export const deleteEntry = (id) => write('entries', (os) => os.delete(id));
export const putDay = (day) => write('days', (os) => os.put(day));

// Replaces all data in one transaction. If one part fails, nothing changes.
export async function replaceAll(data) {
  const d = await openDB();
  const tx = d.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  tx.objectStore('kv').put(data.settings, 'settings');
  for (const f of data.foods) tx.objectStore('foods').put(f);
  for (const e of data.entries) tx.objectStore('entries').put(e);
  for (const day of Object.values(data.days)) tx.objectStore('days').put(day);
  return finish(tx);
}
