import { applyOperations } from './operations.js'
export const STORE_KEY = 'family_grocery_sync_v4'
const LEGACY_ITEMS = 'family_grocery_items_v3_lists'
const LEGACY_LISTS = 'family_grocery_lists_v3'
const home = { id: 'home', name: 'Home List', is_default: true }
const parse = (raw, fallback) => { try { return JSON.parse(raw) ?? fallback } catch { return fallback } }
export const createId = () => crypto.randomUUID()

export function createShoppingStore({ storage = localStorage, request, online = () => navigator.onLine, id = createId, clock = () => new Date().toISOString(), lock = fn => fn() }) {
  const initial = () => {
    const rawItems = parse(storage.getItem(LEGACY_ITEMS), [])
    const rawLists = parse(storage.getItem(LEGACY_LISTS), [])
    return { base: {
      items: (Array.isArray(rawItems) ? rawItems : []).filter(row => row && row.id && row.name && !row.deleted).map(row => ({ ...row, list_id: row.list_id || 'home', category: row.category || row.store || '', checked: [true, 'TRUE', 'true'].includes(row.checked) })),
      lists: [home, ...(Array.isArray(rawLists) ? rawLists : []).filter(row => row && row.id && row.id !== 'home' && !row.deleted)]
    }, pending: [], ready: false, revision: -1, recovery: null, lastSync: '' }
  }

  let state = parse(storage.getItem(STORE_KEY), null) || initial()
  let syncing = false
  let error = ''
  let flight = null
  const listeners = new Set()
  const read = () => { state = parse(storage.getItem(STORE_KEY), null) || state; return state }
  const emit = () => listeners.forEach(fn => fn())
  const save = next => { storage.setItem(STORE_KEY, JSON.stringify(next)); state = next; emit() }
  function snapshot() {
    read()
    const view = applyOperations(state.base, state.pending)
    return { ...view, pending: state.pending.length, ready: state.ready, recovery: state.recovery, lastSync: state.lastSync, syncing, error }
  }
  function change(operations) {
    read()
    // Save the journal before updating the screen or attempting a network request.
    const pending = [...state.pending, ...operations.map(op => ({ ...op, id: id(), value: op.value ? { ...op.value, updated_at: clock() } : undefined }))]
    applyOperations(state.base, pending)
    save({ ...state, pending })
  }
  function receive(result) {
    if (!result.ok) throw new Error(result.error || 'Could not sync. Your changes are saved on this device.')
    if (result.protocol !== 2) throw new Error('The shared sync service needs an update. Changes are saved on this device.')
    read()
    const acknowledged = new Set(result.acknowledged || [])
    // Do not erase edits made while the request was in flight, or apply an older tab response.
    const next = { ...state, pending: state.pending.filter(op => !acknowledged.has(op.id)) }
    if (result.revision >= state.revision) {
      if (!state.ready && state.base.items.length) {
        const fields = ['list_id','name','qty','note','category','checked']
        const differs = state.base.items.some(local => !result.items.some(remote => remote.id === local.id && fields.every(k => String(remote[k] ?? '') === String(local[k] ?? ''))))
        if (differs) next.recovery = state.base
      }
      next.base = { items: result.items, lists: result.lists.length ? result.lists : [home] }
      next.revision = result.revision
      next.ready = true
    }
    next.lastSync = clock()
    save(next)
  }
  async function run() {
    if (!online()) { emit(); return }
    syncing = true; error = ''; emit()
    try {
      read()
      if (!state.ready) receive(await request({ action: 'load' }))
      for (let attempt = 0; attempt < 20; attempt++) {
        read()
        const batch = []
        for (const op of state.pending) {
          if (batch.length && JSON.stringify([...batch, op]).length > 3000) break
          batch.push(op)
          if (batch.length === 10) break
        }
        if (!batch.length) { receive(await request({ action: 'load' })); break }
        const result = await request({ action: 'sync', revision: String(state.revision), operations: batch })
        receive(result)
        if (!result.conflict && !state.pending.length) break
      }
    } catch (err) { error = err.message || String(err) }
    finally { syncing = false; emit() }
  }
  function sync() {
    if (flight) return flight
    flight = Promise.resolve().then(() => lock(run)).finally(() => { flight = null })
    return flight
  }
  function recover() {
    read()
    if (!state.recovery) return
    const listId = id()
    const operations = [{ entity: 'list', type: 'put', recordId: listId, value: { name: 'Saved device copy', created_at: clock() } }, ...state.recovery.items.map(item => ({ entity: 'item', type: 'put', recordId: id(), value: { ...item, list_id: listId } }))]
    change(operations)
    read(); save({ ...state, recovery: null })
    return listId
  }
  return { snapshot, change, sync, recover, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, refresh: () => { read(); emit() } }
}
