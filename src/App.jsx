import { useCallback, useEffect, useMemo, useState } from 'react'

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw15K7lid0XYhUHG4By3mtU0-32c-oLHkORZo9ImyukP17t0ZIUDWD-I1N4ydnLuyHF/exec'

const LOCAL_ITEMS_KEY = 'family_grocery_items_v3_lists'
const LOCAL_LISTS_KEY = 'family_grocery_lists_v3'
const ACTIVE_LIST_KEY = 'family_grocery_active_list_v3'
const LAST_SYNC_KEY = 'family_grocery_last_sync_v3'
const HOME_LIST_ID = 'home'

const STORE_OPTIONS = ['Costco', 'Superstore', 'Independent', 'Liquor Store', 'Home Hardware']
const STORE_TABS = ['All Stores', ...STORE_OPTIONS]
const SORT_ORDER = {
  '': 0,
  Costco: 1,
  Superstore: 2,
  Independent: 3,
  'Liquor Store': 4,
  'Home Hardware': 5,
}

const defaultLists = [
  {
    id: HOME_LIST_ID,
    name: 'Home List',
    is_default: true,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
]

function createId(prefix = 'item') {
  if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function nowIso() {
  return new Date().toISOString()
}

function formatTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getStoreLabel(value) {
  return value || 'Any Store'
}

function safeJsonParse(raw, fallback) {
  try {
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function cleanListName(value) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeLists(value) {
  const incoming = Array.isArray(value) ? value : []
  const byId = new Map()

  defaultLists.forEach((list) => byId.set(list.id, list))

  incoming.forEach((list) => {
    if (!list || !list.id) return
    const name = cleanListName(String(list.name || '')) || 'Untitled List'
    byId.set(String(list.id), {
      id: String(list.id),
      name,
      is_default: String(list.id) === HOME_LIST_ID || Boolean(list.is_default),
      created_at: list.created_at || nowIso(),
      updated_at: list.updated_at || nowIso(),
      deleted: Boolean(list.deleted),
    })
  })

  const lists = Array.from(byId.values())
    .filter((list) => !list.deleted || list.id === HOME_LIST_ID)
    .sort((a, b) => {
      if (a.id === HOME_LIST_ID) return -1
      if (b.id === HOME_LIST_ID) return 1
      return a.name.localeCompare(b.name)
    })

  return lists.length ? lists : defaultLists
}

function normalizeItems(value) {
  const incoming = Array.isArray(value) ? value : []
  return incoming
    .filter((item) => item && !item.deleted)
    .map((item) => ({
      id: item.id || createId(),
      list_id: item.list_id || HOME_LIST_ID,
      name: item.name || '',
      qty: item.qty || '1',
      note: item.note || '',
      category: item.category || '',
      checked: item.checked === true || item.checked === 'TRUE' || item.checked === 'true',
      updated_at: item.updated_at || nowIso(),
      created_at: item.created_at || item.updated_at || nowIso(),
      deleted: false,
    }))
    .filter((item) => item.name.trim())
}

function loadLocalItems() {
  return normalizeItems(safeJsonParse(localStorage.getItem(LOCAL_ITEMS_KEY), []))
}

function loadLocalLists() {
  return normalizeLists(safeJsonParse(localStorage.getItem(LOCAL_LISTS_KEY), defaultLists))
}

function saveLocalItems(items) {
  localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items))
}

function saveLocalLists(lists) {
  localStorage.setItem(LOCAL_LISTS_KEY, JSON.stringify(lists))
}

function loadLastSync() {
  return localStorage.getItem(LAST_SYNC_KEY) || ''
}

function saveLastSync(value) {
  localStorage.setItem(LAST_SYNC_KEY, value)
}

function encodePayload(data) {
  const json = JSON.stringify(data)
  const utf8 = new TextEncoder().encode(json)
  let binary = ''
  utf8.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function jsonpRequest(url, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = `shoppingListCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Sync timed out. Check internet connection.'))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timeout)
      delete window[callbackName]
      if (script.parentNode) script.parentNode.removeChild(script)
    }

    window[callbackName] = (data) => {
      cleanup()
      resolve(data)
    }

    const searchParams = new URLSearchParams({
      ...params,
      callback: callbackName,
      cacheBust: String(Date.now()),
    })

    script.src = `${url}?${searchParams.toString()}`
    script.onerror = () => {
      cleanup()
      reject(new Error('Could not reach Google Sheet sync.'))
    }

    document.body.appendChild(script)
  })
}

export default function App() {
  const [items, setItems] = useState(() => loadLocalItems())
  const [lists, setLists] = useState(() => loadLocalLists())
  const [activeListId, setActiveListId] = useState(() => localStorage.getItem(ACTIVE_LIST_KEY) || HOME_LIST_ID)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState(() => loadLastSync())
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('')
  const [activeStore, setActiveStore] = useState('All Stores')
  const [newListName, setNewListName] = useState('')

  const activeList = lists.find((list) => list.id === activeListId) || lists[0] || defaultLists[0]

  const persistItems = useCallback((nextItems) => {
    const normalized = normalizeItems(nextItems)
    setItems(normalized)
    saveLocalItems(normalized)
  }, [])

  const persistLists = useCallback((nextLists) => {
    const normalized = normalizeLists(nextLists)
    setLists(normalized)
    saveLocalLists(normalized)
  }, [])

  useEffect(() => {
    if (!lists.some((list) => list.id === activeListId)) {
      setActiveListId(HOME_LIST_ID)
      localStorage.setItem(ACTIVE_LIST_KEY, HOME_LIST_ID)
    }
  }, [activeListId, lists])

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      setSyncMessage('Back online. Press Sync Now to update the shared sheet.')
    }

    function handleOffline() {
      setIsOnline(false)
      setSyncMessage('Offline mode. Changes are saved on this device.')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  function selectList(listId) {
    setActiveListId(listId)
    localStorage.setItem(ACTIVE_LIST_KEY, listId)
    setActiveStore('All Stores')
  }

  function matchesActiveStore(item) {
    if (activeStore === 'All Stores') return true
    return !item.category || item.category === activeStore
  }

  const currentListItems = useMemo(
    () => items.filter((item) => item.list_id === activeList.id && !item.deleted),
    [items, activeList.id]
  )

  const activeItems = useMemo(
    () =>
      currentListItems
        .filter((item) => !item.checked && matchesActiveStore(item))
        .sort((a, b) => {
          const catDiff = (SORT_ORDER[a.category || ''] || 999) - (SORT_ORDER[b.category || ''] || 999)
          if (catDiff !== 0) return catDiff
          return a.name.localeCompare(b.name)
        }),
    [currentListItems, activeStore]
  )

  const checkedItems = useMemo(
    () =>
      currentListItems
        .filter((item) => item.checked && matchesActiveStore(item))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    [currentListItems, activeStore]
  )

  async function pullFromSheet() {
    if (!navigator.onLine) {
      setSyncMessage('Offline. Using the saved list on this device.')
      return
    }

    setLoading(true)
    setSyncing(true)
    setError('')

    try {
      const result = await jsonpRequest(GOOGLE_SCRIPT_URL, { action: 'load' })
      if (!result.ok) throw new Error(result.error || 'Could not load from Google Sheet.')

      const incomingItems = normalizeItems(result.items || [])
      const incomingLists = normalizeLists(result.lists || lists)
      const fixedItems = incomingItems.map((item) => ({ ...item, list_id: item.list_id || HOME_LIST_ID }))

      persistLists(incomingLists)
      persistItems(fixedItems)

      const stamp = nowIso()
      saveLastSync(stamp)
      setLastSync(stamp)
      setSyncMessage(`Pulled ${fixedItems.length} item${fixedItems.length === 1 ? '' : 's'} from Google Sheet.`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }

  async function pushToSheet(nextItems = items, nextLists = lists) {
    if (!navigator.onLine) {
      setSyncMessage('Offline. Changes are saved on this device and can be synced later.')
      return false
    }

    setSyncing(true)
    setError('')

    try {
      const itemsToSave = normalizeItems(nextItems).filter((item) => !item.deleted)
      const listsToSave = normalizeLists(nextLists).filter((list) => !list.deleted)
      const result = await jsonpRequest(GOOGLE_SCRIPT_URL, {
        action: 'save',
        payload: encodePayload(itemsToSave),
        listsPayload: encodePayload(listsToSave),
      })

      if (!result.ok) throw new Error(result.error || 'Could not save to Google Sheet.')

      const stamp = nowIso()
      saveLastSync(stamp)
      setLastSync(stamp)
      setSyncMessage(`Synced ${itemsToSave.length} item${itemsToSave.length === 1 ? '' : 's'} across ${listsToSave.length} list${listsToSave.length === 1 ? '' : 's'}.`)
      return true
    } catch (err) {
      setError(err.message || String(err))
      return false
    } finally {
      setSyncing(false)
    }
  }

  async function syncNow() {
    await pushToSheet(items, lists)
  }

  async function handleAddList(e) {
    e.preventDefault()
    const listName = cleanListName(newListName)
    if (!listName) return

    const newList = {
      id: createId('list'),
      name: listName,
      is_default: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    }

    const nextLists = normalizeLists([...lists, newList])
    persistLists(nextLists)
    setNewListName('')
    selectList(newList.id)

    if (navigator.onLine) await pushToSheet(items, nextLists)
    else setSyncMessage('List added offline. Press Sync Now when you have service.')
  }

  async function renameActiveList() {
    if (activeList.id === HOME_LIST_ID) return
    const nextName = cleanListName(window.prompt('Rename this list:', activeList.name) || '')
    if (!nextName) return

    const nextLists = lists.map((list) =>
      list.id === activeList.id ? { ...list, name: nextName, updated_at: nowIso() } : list
    )
    persistLists(nextLists)
    if (navigator.onLine) await pushToSheet(items, nextLists)
    else setSyncMessage('List renamed offline. Press Sync Now when you have service.')
  }

  async function deleteActiveList() {
    if (activeList.id === HOME_LIST_ID) return
    const confirmed = window.confirm(`Delete "${activeList.name}" and all items in that list?`)
    if (!confirmed) return

    const nextLists = lists.filter((list) => list.id !== activeList.id)
    const nextItems = items.filter((item) => item.list_id !== activeList.id)
    persistLists(nextLists)
    persistItems(nextItems)
    selectList(HOME_LIST_ID)

    if (navigator.onLine) await pushToSheet(nextItems, nextLists)
    else setSyncMessage('List deleted offline. Press Sync Now when you have service.')
  }

  async function handleAddItem(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedQty = qty.trim() || '1'
    const trimmedNote = note.trim()

    if (!trimmedName) {
      setError('Enter an item name.')
      return
    }

    setSaving(true)
    setError('')

    const newItem = {
      id: createId(),
      list_id: activeList.id,
      name: trimmedName,
      qty: trimmedQty,
      note: trimmedNote,
      category,
      checked: false,
      created_at: nowIso(),
      updated_at: nowIso(),
      deleted: false,
    }

    const nextItems = [...items, newItem]
    persistItems(nextItems)
    setName('')
    setQty('1')
    setNote('')
    setCategory('')
    setSaving(false)

    if (navigator.onLine) await pushToSheet(nextItems, lists)
    else setSyncMessage('Item added offline. Press Sync Now when you have service.')
  }

  async function toggleChecked(item) {
    const nextItems = items.map((current) =>
      current.id === item.id ? { ...current, checked: !current.checked, updated_at: nowIso() } : current
    )
    persistItems(nextItems)
    if (navigator.onLine) await pushToSheet(nextItems, lists)
    else setSyncMessage('Cart change saved offline. Press Sync Now when you have service.')
  }

  async function deleteItem(itemId) {
    const nextItems = items.filter((item) => item.id !== itemId)
    persistItems(nextItems)
    if (navigator.onLine) await pushToSheet(nextItems, lists)
    else setSyncMessage('Item deleted offline. Press Sync Now when you have service.')
  }

  async function clearCheckedItems() {
    const nextItems = items.filter((item) => !(item.list_id === activeList.id && item.checked))
    persistItems(nextItems)
    if (navigator.onLine) await pushToSheet(nextItems, lists)
    else setSyncMessage('Cart cleared offline. Press Sync Now when you have service.')
  }

  async function replaceLocalFromSheet() {
    const confirmed = window.confirm('Replace this device with the Google Sheet lists? Unsynced local changes on this device will be overwritten.')
    if (!confirmed) return
    await pullFromSheet()
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>Family Grocery List</h1>
        <span className={isOnline ? 'status online' : 'status offline'}>{isOnline ? 'Online' : 'Offline'}</span>
      </header>

      <div className="list-toolbar">
        <label className="list-picker">List
          <select value={activeList.id} onChange={(e) => selectList(e.target.value)}>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({items.filter((item) => item.list_id === list.id).length})</option>)}
          </select>
        </label>
        <details className="tools">
          <summary>Manage lists</summary>
          <div className="tool-content">
            <div className="actions">
              <button type="button" onClick={renameActiveList} disabled={activeList.id === HOME_LIST_ID}>Rename</button>
              <button type="button" onClick={deleteActiveList} disabled={activeList.id === HOME_LIST_ID} className="danger">Delete list</button>
            </div>
            <form onSubmit={handleAddList} className="add-list">
              <input aria-label="New list name" value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="New list name" />
              <button type="submit" className="primary">Add list</button>
            </form>
          </div>
        </details>
      </div>

      <details className="panel sync-tools">
        <summary>{syncing ? 'Syncing…' : 'Sync controls'} <span className="muted">{lastSync ? `Last: ${formatTimestamp(lastSync)}` : 'Not synced yet'}</span></summary>
        <div className="tool-content">
          <div className="actions">
            <button type="button" onClick={syncNow} className="primary" disabled={syncing}>Sync Now</button>
            <button type="button" onClick={replaceLocalFromSheet} disabled={syncing}>Pull From Sheet</button>
          </div>
          <p className="muted">Changes save on this device. Pull replaces this device’s lists with the sheet.</p>
        </div>
      </details>
      {syncMessage ? <p className="notice" role="status">{syncMessage}</p> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      <form onSubmit={handleAddItem} className="panel add-item">
        <div className="quick-add">
          <input aria-label="Item name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an item…" />
          <input aria-label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" />
          <button type="submit" className="primary" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
        </div>
        <details className="item-options">
          <summary>Store &amp; note{category || note ? ' • added' : ' (optional)'}</summary>
          <div className="optional-fields">
            <label>Store<select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Any Store</option>
              {STORE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select></label>
            <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Brand, size, ripeness…" /></label>
          </div>
        </details>
      </form>

      <nav className="store-filters" aria-label="Filter by store">
        {STORE_TABS.map((store) => <button key={store} type="button" aria-pressed={activeStore === store} onClick={() => setActiveStore(store)}>{store}</button>)}
      </nav>
      <div className="columns">
        <section className="panel shopping-section" aria-labelledby="need-title">
          <div className="section-header"><h2 id="need-title">Need to Buy</h2><span className="count">{activeItems.length}</span></div>
          {loading ? <p className="empty">Loading items…</p> : null}
          {!loading && !activeItems.length ? <p className="empty">Nothing to buy in this store view.</p> : null}
          <div>{activeItems.map((item) => <ShoppingItem key={item.id} item={item} checked={false} onToggle={toggleChecked} onDelete={deleteItem} />)}</div>
        </section>
        <details className="panel shopping-section cart">
          <summary>In Cart <span className="count">{checkedItems.length}</span></summary>
          <div className="cart-content">
            {checkedItems.length ? <button onClick={clearCheckedItems} type="button">Clear Cart</button> : <p className="empty">Your cart is empty.</p>}
            {checkedItems.map((item) => <ShoppingItem key={item.id} item={item} checked onToggle={toggleChecked} onDelete={deleteItem} />)}
          </div>
        </details>
      </div>
    </main>
  )
}

function ShoppingItem({ item, checked, onToggle, onDelete }) {
  return (
    <div className={`item-row${checked ? ' checked' : ''}`}>
      <button type="button" className="item-toggle" aria-label={`${checked ? 'Move back to list' : 'Put in cart'}: ${item.name}, quantity ${item.qty}`} aria-pressed={checked} onClick={() => onToggle(item)}>
        <span className="check" aria-hidden="true">{checked ? '✓' : '○'}</span>
        <span className="item-copy"><strong>{item.name}</strong><span className="item-meta">{getStoreLabel(item.category)}{item.note ? ` · ${item.note}` : ''}</span></span>
        <span className="quantity">×{item.qty}</span>
      </button>
      <button type="button" className="delete-item" aria-label={`Delete ${item.name}`} title={`Delete ${item.name}`} onClick={() => onDelete(item.id)}>×</button>
    </div>
  )
}
