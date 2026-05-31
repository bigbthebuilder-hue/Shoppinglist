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

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback || 'callback';
  const action = params.action || 'load';

  try {
    let result;

    if (action === 'save') {
      const items = params.payload ? parseBase64Json_(params.payload) : [];
      const lists = params.listsPayload ? parseBase64Json_(params.listsPayload) : getDefaultLists_();
      saveLists_(lists);
      saveItems_(items);
      result = { ok: true, savedItems: items.length, savedLists: lists.length };
    } else {
      result = {
        ok: true,
        items: loadItems_(),
        lists: loadLists_(),
      };
    }

    return jsonp_(callback, result);
  } catch (err) {
    return jsonp_(callback, { ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function getSheet_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = firstRow.every((cell) => cell === '') || headers.some((header, index) => firstRow[index] !== header);

  if (needsHeaders) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
