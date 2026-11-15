import { useEffect, useState } from 'react'
import { createId, createShoppingStore, STORE_KEY } from './shopping-store'
import { requestSheet } from './transport'

const STORES = ['Costco', 'Superstore', 'Independent', 'Liquor Store', 'Home Hardware']
const ACTIVE_KEY = 'family_grocery_active_list_v3'
const stamp = () => new Date().toISOString()
const blank = { name: '', qty: '1', category: '', note: '' }

export default function App() {
  const [store] = useState(() => createShoppingStore({ request: requestSheet, lock: fn => navigator.locks ? navigator.locks.request('shoppinglist-sync', fn) : fn() }))
  const [data, setData] = useState(() => store.snapshot())
  const [online, setOnline] = useState(navigator.onLine)
  const [screen, setScreen] = useState('shop')
  const [quickAdd, setQuickAdd] = useState(false)
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) || 'home')
  const [filter, setFilter] = useState('All Stores')
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [listName, setListName] = useState('')
  const [uiError, setUiError] = useState('')
  const builder = screen === 'build'
  const list = data.lists.find(row => row.id === activeId) || data.lists.find(row => row.id === 'home') || data.lists[0]
  const listItems = data.items.filter(item => item.list_id === list?.id)
  const visible = listItems.filter(item => filter === 'All Stores' || !item.category || item.category === filter).sort((a, b) => a.name.localeCompare(b.name))
  const need = visible.filter(item => !item.checked)
  const cart = visible.filter(item => item.checked)

  useEffect(() => store.subscribe(() => setData(store.snapshot())), [store])
  useEffect(() => {
    const refresh = () => { setOnline(navigator.onLine); if (navigator.onLine) store.sync() }
    const foreground = () => { if (document.visibilityState === 'visible') refresh() }
    const localChange = e => { if (e.key === STORE_KEY) { store.refresh(); refresh() } }
    refresh()
    const timer = setInterval(foreground, 20000)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', localChange)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh)
      window.removeEventListener('focus', refresh); window.removeEventListener('storage', localChange)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [store])
  useEffect(() => {
    if (!data.pending || !online) return
    const timer = setTimeout(() => store.sync(), 400)
    return () => clearTimeout(timer)
  }, [data.pending, online, store])

  function change(ops) {
    try { store.change(ops); setUiError(''); return true }
    catch (error) { setUiError(`Could not save on this device: ${error.message}`); return false }
  }
  function selectList(id) {
    setActiveId(id); localStorage.setItem(ACTIVE_KEY, id); setFilter('All Stores'); setEditing(null); setForm(blank)
  }
  function navigate(next) { setScreen(next); setEditing(null); setForm(blank); setQuickAdd(false); setUiError('') }
  function submitItem(e) {
    e.preventDefault()
    if (!form.name.trim() || !list) return
    const value = { name: form.name.trim(), qty: form.qty.trim() || '1', category: form.category, note: form.note.trim() }
    let op
    if (editing) {
      const patch = Object.fromEntries(Object.entries(value).filter(([key, val]) => val !== editing[key]))
      op = { entity: 'item', type: 'patch', recordId: editing.id, value: patch }
    } else op = { entity: 'item', type: 'put', recordId: createId(), value: { ...value, list_id: list.id, checked: false, created_at: stamp() } }
    if (change([op])) { setEditing(null); setForm({ ...blank, category: builder ? form.category : '' }) }
  }
  function editItem(item) { setEditing(item); setForm({ name: item.name, qty: String(item.qty), category: item.category || '', note: item.note || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function addList(e) {
    e.preventDefault()
    if (!listName.trim()) return
    const id = createId()
    if (change([{ entity: 'list', type: 'put', recordId: id, value: { name: listName.trim(), created_at: stamp() } }])) { selectList(id); setListName('') }
  }
  function renameList() {
    const name = window.prompt('List name:', list.name)?.trim()
    if (name) change([{ entity: 'list', type: 'patch', recordId: list.id, value: { name } }])
  }
  function deleteList() {
    if (list.id === 'home' || !window.confirm(`Delete ${list.name} and its items?`)) return
    if (change([{ entity: 'list', type: 'delete', recordId: list.id }])) selectList('home')
  }
  function removeItem(item) { change([{ entity: 'item', type: 'delete', recordId: item.id }]) }
  function toggleItem(item) { change([{ entity: 'item', type: 'patch', recordId: item.id, value: { checked: !item.checked } }]) }
  const status = !online ? `Offline${data.pending ? ` · ${data.pending} saved changes` : ''}` : data.error ? 'Sync needs attention' : data.syncing ? 'Syncing…' : data.pending ? `${data.pending} changes waiting` : data.ready ? 'Up to date' : 'Connecting…'

  return <main className="app">
    <header className="app-header"><h1>{builder ? 'Build your list' : 'Shopping List'}</h1><button type="button" onClick={() => navigate(builder ? 'shop' : 'build')}>{builder ? 'Go shopping' : 'Create / edit list'}</button></header>
    <div className="list-toolbar">
      <label className="list-picker">List<select value={list?.id || 'home'} onChange={e => selectList(e.target.value)}>{data.lists.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {!builder ? <button type="button" onClick={() => setQuickAdd(!quickAdd)} aria-expanded={quickAdd}>＋ Add item</button> : null}
    </div>
    <details className="sync-line">
      <summary><span className={`sync-dot ${!online || data.error || data.pending ? 'waiting' : ''}`} />{status}</summary>
      <div className="tool-content"><p className="muted">{online ? 'Updates automatically while open and when you return to the app.' : 'Changes stay on this device and upload when you reconnect.'}{data.lastSync ? ` Last checked ${new Date(data.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
        <button type="button" onClick={() => store.sync()} disabled={data.syncing || !online}>Retry sync</button>
        {data.recovery ? <div className="recovery"><p>A copy of this device’s earlier list was saved because it differs from the shared sheet. You can recover it into a separate list for review.</p><button type="button" onClick={() => { try { const id = store.recover(); if (id) { selectList(id); setScreen('build') } } catch (e) { setUiError(e.message) } }}>Recover saved device copy</button></div> : null}
      </div>
    </details>
    {data.recovery ? <p className="notice">Earlier items from this device are saved. Open sync details above to recover them into a separate list.</p> : null}
    {data.error || uiError ? <p className="error" role="alert">{uiError || data.error} Your saved changes will retry automatically.</p> : null}
    {builder ? <section className="panel builder-settings"><h2>List settings</h2><form className="add-list" onSubmit={addList}><input aria-label="New list name" placeholder="New list name, e.g. Camping" value={listName} onChange={e => setListName(e.target.value)} /><button type="submit" className="primary">Create list</button></form><div className="actions"><button type="button" onClick={renameList} disabled={list?.id === 'home'}>Rename list</button><button type="button" onClick={deleteList} className="danger" disabled={list?.id === 'home'}>Delete list</button></div></section> : null}
    {builder || quickAdd ? <form className="panel add-item" onSubmit={submitItem}>
      {builder ? <h2>{editing ? `Edit ${editing.name}` : `Add to ${list?.name}`}</h2> : null}
      <div className="quick-add"><input aria-label="Item name" placeholder="Item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /><input aria-label="Quantity" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /><button type="submit" className="primary">{editing ? 'Save' : 'Add'}</button></div>
      {builder ? <ItemOptions form={form} setForm={setForm} builder /> : <details className="item-options"><summary>Store &amp; note (optional)</summary><ItemOptions form={form} setForm={setForm} /></details>}
      {editing ? <button type="button" onClick={() => { setEditing(null); setForm(blank) }}>Cancel edit</button> : null}
    </form> : null}
    <nav className="store-filters" aria-label="Filter by store">{['All Stores', ...STORES].map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</nav>
    <div className={builder ? 'builder-items' : 'columns'}>
      <section className="panel shopping-section" aria-labelledby="need-title"><div className="section-header"><h2 id="need-title">{builder ? list?.name : 'Need to Buy'}</h2><span className="count">{builder ? visible.length : need.length}</span></div>
        {(builder ? visible : need).map(item => <ShoppingItem key={item.id} item={item} builder={builder} onClick={builder ? editItem : toggleItem} onDelete={removeItem} />)}
        {!(builder ? visible : need).length ? <p className="empty">{builder ? 'Add items above to build this list.' : 'Nothing to buy in this store view.'}</p> : null}
      </section>
      {!builder ? <details className="panel shopping-section cart"><summary>In Cart <span className="count">{cart.length}</span></summary><div className="cart-content">{cart.length ? <button type="button" onClick={() => change(listItems.filter(item => item.checked).map(item => ({ entity: 'item', type: 'delete', recordId: item.id })))}>Clear Cart</button> : <p className="empty">Your cart is empty.</p>}{cart.map(item => <ShoppingItem key={item.id} item={item} onClick={toggleItem} onDelete={removeItem} />)}</div></details> : null}
    </div>
  </main>
}
function ItemOptions({ form, setForm, builder }) {
  return <div className="optional-fields"><label>Store{builder ? ' (kept for next item)' : ''}<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="">Any Store</option>{STORES.map(name => <option key={name}>{name}</option>)}</select></label><label>Note<input value={form.note} placeholder="Brand, size, ripeness…" onChange={e => setForm({ ...form, note: e.target.value })} /></label></div>
}
function ShoppingItem({ item, builder, onClick, onDelete }) {
  return <div className={`item-row${item.checked ? ' checked' : ''}`}><button type="button" className="item-toggle" onClick={() => onClick(item)} aria-label={`${builder ? 'Edit' : item.checked ? 'Move back to list' : 'Put in cart'}: ${item.name}, quantity ${item.qty}`} aria-pressed={builder ? undefined : item.checked}><span className="check" aria-hidden="true">{builder ? '✎' : item.checked ? '✓' : '○'}</span><span className="item-copy"><strong>{item.name}</strong><span className="item-meta">{item.category || 'Any Store'}{item.note ? ` · ${item.note}` : ''}{builder && item.checked ? ' · In cart' : ''}</span></span><span className="quantity">×{item.qty}</span></button><button type="button" className="delete-item" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}>×</button></div>
}
