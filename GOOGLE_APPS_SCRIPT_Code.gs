const ITEMS_SHEET_NAME = 'Items';
const LISTS_SHEET_NAME = 'Lists';

const ITEM_HEADERS = [
  'id',
  'list_id',
  'name',
  'qty',
  'note',
  'category',
  'checked',
  'created_at',
  'updated_at',
];

const LIST_HEADERS = [
  'id',
  'name',
  'is_default',
  'created_at',
  'updated_at',
];

// Protocol 2: item changes under a shared lock; no full-device overwrites.
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback || 'callback';
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (params.action === 'save') throw new Error('Please close and reopen the shopping app to update automatic sync. No shared data was replaced.');
    const ledger = getSheet_('_ShoppingSync', ['revision', 'operation_id']);
    let revision = Number(ledger.getRange(2, 1).getValue()) || 0;
    let snapshot = { items: loadItems_(), lists: loadLists_() };
    let acknowledged = [];
    let conflict = false;
    if (params.action === 'sync') {
      const operations = parseBase64Json_(params.payload || 'W10');
      if (!Array.isArray(operations) || operations.length > 10) throw new Error('Invalid sync batch.');
      const count = ledger.getLastRow();
      const seen = new Set(count > 2 ? ledger.getRange(3, 2, count - 2, 1).getValues().map(row => row[0]) : []);
      acknowledged = operations.filter(op => seen.has(op.id)).map(op => op.id);
      const fresh = operations.filter(op => !seen.has(op.id));
      conflict = fresh.length > 0 && Number(params.revision) !== revision;
      if (!conflict && fresh.length) {
        snapshot = applyOperations(snapshot, fresh);
        saveLists_(snapshot.lists);
        saveItems_(snapshot.items);
        revision++;
        ledger.getRange(2, 1).setValue(revision);
        ledger.getRange(Math.max(3, count + 1), 2, fresh.length, 1).setValues(fresh.map(op => [op.id]));
        SpreadsheetApp.flush();
        acknowledged = operations.map(op => op.id);
      }
    }
    return jsonp_(callback, { ok: true, protocol: 2, revision, conflict, acknowledged, items: snapshot.items, lists: snapshot.lists });
  } catch (err) {
    return jsonp_(callback, { ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function getSheet_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (firstRow.every(cell => cell === '')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (headers.some((header, index) => firstRow[index] !== header)) {
    // The original deployment used store/deleted and no list_id. Preserve a full
    // sheet copy before mapping its known historical columns into the new schema.
    const width = sheet.getLastColumn();
    const oldHeaders = sheet.getRange(1, 1, 1, width).getValues()[0];
    const allowed = ITEM_HEADERS.concat(['store', 'deleted']);
    if (sheetName !== ITEMS_SHEET_NAME || !['id', 'name', 'qty', 'checked'].every(key => oldHeaders.includes(key)) || oldHeaders.some(key => !allowed.includes(key))) throw new Error('Unexpected headers in ' + sheetName + '. Existing data was preserved.');
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues() : [];
    const converted = rows.map(row => {
      const value = {};
      oldHeaders.forEach((key, index) => { if (value[key] === undefined || value[key] === '') value[key] = row[index]; });
      return headers.map(key => key === 'list_id' ? (value.list_id || 'home') : key === 'category' ? (value.category || value.store || '') : key === 'created_at' ? (value.created_at || value.updated_at || new Date().toISOString()) : (value[key] === undefined ? '' : value[key]));
    }).filter((row, index) => ![true, 'TRUE', 'true'].includes(rows[index][oldHeaders.indexOf('deleted')]));
    sheet.copyTo(ss).setName('_Items before autosync ' + Date.now());
    sheet.getRange(1, 1, Math.max(1, rows.length + 1), Math.max(width, headers.length)).clearContent();
    sheet.getRange(1, 1, converted.length + 1, headers.length).setValues([headers].concat(converted));
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function loadItems_() {
  return loadRows_(ITEMS_SHEET_NAME, ITEM_HEADERS).map((item) => ({
    id: item.id,
    list_id: item.list_id || 'home',
    name: item.name,
    qty: item.qty || '1',
    note: item.note || '',
    category: item.category || '',
    checked: item.checked === true || item.checked === 'TRUE' || item.checked === 'true',
    created_at: item.created_at || item.updated_at || new Date().toISOString(),
    updated_at: item.updated_at || new Date().toISOString(),
  })).filter((item) => item.id && item.name);
}

function loadLists_() {
  const lists = loadRows_(LISTS_SHEET_NAME, LIST_HEADERS).map((list) => ({
    id: list.id,
    name: list.name,
    is_default: list.is_default === true || list.is_default === 'TRUE' || list.is_default === 'true',
    created_at: list.created_at || new Date().toISOString(),
    updated_at: list.updated_at || new Date().toISOString(),
  })).filter((list) => list.id && list.name);

  if (!lists.length) {
    const defaults = getDefaultLists_();
    saveLists_(defaults);
    return defaults;
  }

  if (!lists.some((list) => list.id === 'home')) {
    lists.unshift(getDefaultLists_()[0]);
    saveLists_(lists);
  }

  return lists;
}

function loadRows_(sheetName, headers) {
  const sheet = getSheet_(sheetName, headers);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function saveItems_(items) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.id && item.name)
    .map((item) => [
      item.id,
      item.list_id || 'home',
      item.name || '',
      item.qty || '1',
      item.note || '',
      item.category || '',
      Boolean(item.checked),
      item.created_at || item.updated_at || new Date().toISOString(),
      item.updated_at || new Date().toISOString(),
    ]);

  saveRows_(ITEMS_SHEET_NAME, ITEM_HEADERS, rows);
}

function saveLists_(lists) {
  const cleaned = (Array.isArray(lists) ? lists : getDefaultLists_())
    .filter((list) => list && list.id && list.name)
    .map((list) => [
      list.id,
      list.name || 'Untitled List',
      list.id === 'home' || Boolean(list.is_default),
      list.created_at || new Date().toISOString(),
      list.updated_at || new Date().toISOString(),
    ]);

  if (!cleaned.some((row) => row[0] === 'home')) {
    const home = getDefaultLists_()[0];
    cleaned.unshift([home.id, home.name, true, home.created_at, home.updated_at]);
  }

  saveRows_(LISTS_SHEET_NAME, LIST_HEADERS, cleaned);
}

function saveRows_(sheetName, headers, rows) {
  const sheet = getSheet_(sheetName, headers);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.autoResizeColumns(1, headers.length);
}

function getDefaultLists_() {
  const now = new Date().toISOString();
  return [{ id: 'home', name: 'Home List', is_default: true, created_at: now, updated_at: now }];
}

function parseBase64Json_(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const bytes = Utilities.base64Decode(base64);
  const json = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  return JSON.parse(json);
}

function jsonp_(callback, data) {
  const safeCallback = String(callback || 'callback').replace(/[^a-zA-Z0-9_.$]/g, '');
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// Used identically by the client and Apps Script. Patches never recreate deleted rows.
function applyOperations(snapshot, operations) {
  const items = new Map(snapshot.items.map(row => [row.id, { ...row }]))
  const lists = new Map(snapshot.lists.map(row => [row.id, { ...row }]))
  for (const op of operations) {
    if (!op || !op.id || !op.recordId || !['item', 'list'].includes(op.entity) || !['put', 'patch', 'delete'].includes(op.type)) throw new Error('Invalid shopping change.')
    const table = op.entity === 'item' ? items : lists
    if (op.type === 'delete') {
      if (op.entity === 'list' && op.recordId === 'home') continue
      table.delete(op.recordId)
      if (op.entity === 'list') for (const [id, item] of items) if (item.list_id === op.recordId) items.delete(id)
      continue
    }
    const fields = op.entity === 'item' ? ['list_id', 'name', 'qty', 'note', 'category', 'checked', 'created_at', 'updated_at'] : ['name', 'created_at', 'updated_at']
    const value = {}
    for (const key of fields) if (Object.prototype.hasOwnProperty.call(op.value || {}, key)) value[key] = op.value[key]
    if (op.type === 'put' && !table.has(op.recordId)) {
      if (!String(value.name || '').trim()) throw new Error('A name is required.')
      table.set(op.recordId, { ...value, id: op.recordId })
    } else if (op.type === 'patch' && table.has(op.recordId)) {
      table.set(op.recordId, { ...table.get(op.recordId), ...value })
    }
  }
  // A stale offline add must not recreate an already-deleted list.
  return { items: [...items.values()].filter(row => lists.has(row.list_id || 'home')), lists: [...lists.values()] }
}
