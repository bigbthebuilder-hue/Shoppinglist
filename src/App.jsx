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
    <div style={styles.page}>
      <div style={styles.appCard}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Family Grocery List</h1>
            <p style={styles.subtitle}>Offline-first shared shopping lists</p>
          </div>
          <div style={{ ...styles.statusPillOnline, background: isOnline ? '#23713e' : '#a86800' }}>{isOnline ? 'Online' : 'Offline'}</div>
        </div>

        <div style={styles.syncPanel}>
          <div>
            <strong>{activeList.name}:</strong> {currentListItems.length} item{currentListItems.length === 1 ? '' : 's'}
            <div style={styles.syncText}>Last synced: {lastSync ? formatTimestamp(lastSync) : 'Not synced yet'}</div>
            {syncMessage ? <div style={styles.syncText}>{syncMessage}</div> : null}
          </div>
          <div style={styles.syncButtons}>
            <button type="button" onClick={syncNow} style={styles.primaryButton} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync Now'}</button>
            <button type="button" onClick={replaceLocalFromSheet} style={styles.secondaryButton}>Pull From Sheet</button>
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.listPanelHeader}>
            <div>
              <h2 style={styles.storeBarTitle}>Shopping Lists</h2>
              <span style={styles.storeBarSubtitle}>Keep Home separate from camping, dinners, holidays, or projects.</span>
            </div>
            <div style={styles.listActions}>
              <button type="button" onClick={renameActiveList} disabled={activeList.id === HOME_LIST_ID} style={styles.secondaryButtonSmall}>Rename</button>
              <button type="button" onClick={deleteActiveList} disabled={activeList.id === HOME_LIST_ID} style={styles.deleteButtonSmall}>Delete List</button>
            </div>
          </div>

          <div style={styles.tabWrap}>
            {lists.map((list) => {
              const isActive = activeList.id === list.id
              const itemCount = items.filter((item) => item.list_id === list.id && !item.deleted).length
              return (
                <button key={list.id} type="button" onClick={() => selectList(list.id)} style={isActive ? styles.storeTabActive : styles.storeTab}>
                  {list.name} ({itemCount})
                </button>
              )
            })}
          </div>

          <form onSubmit={handleAddList} style={styles.addListForm}>
            <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="New list: Camping, Special Dinner..." style={styles.input} />
            <button type="submit" style={styles.primaryButton}>Add List</button>
          </form>
        </div>

        <form onSubmit={handleAddItem} style={styles.panel}>
          <div style={styles.activeListBanner}>Adding items to: <strong>{activeList.name}</strong></div>
          <div style={styles.grid}>
            <div style={styles.fieldSpan2}>
              <label style={styles.label}>Item</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Milk, bananas, bread..." style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Qty</label>
              <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Store</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.input}>
                <option value="">No Store / Any Store</option>
                {STORE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div style={styles.fieldSpan3}>
              <label style={styles.label}>Note</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="2%, ripe, brand, size..." style={styles.input} />
            </div>
          </div>
          <button type="submit" style={styles.primaryButton} disabled={saving}>{saving ? 'Adding...' : 'Add Item'}</button>
        </form>

        <div style={styles.panel}>
          <div style={styles.storeBarHeader}>
            <h2 style={styles.storeBarTitle}>Store View</h2>
            <span style={styles.storeBarSubtitle}>Store views show store-specific items plus unassigned items for the selected list.</span>
          </div>
          <div style={styles.tabWrap}>
            {STORE_TABS.map((store) => (
              <button key={store} type="button" onClick={() => setActiveStore(store)} style={activeStore === store ? styles.storeTabActive : styles.storeTab}>{store}</button>
            ))}
          </div>
        </div>

        {error ? <div style={styles.errorBox}>{error}</div> : null}

        <div style={styles.columns}>
          <section style={styles.panel}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Need to Buy</h2>
              <span style={styles.countBadge}>{activeItems.length}</span>
            </div>
            {loading ? <p style={styles.emptyText}>Loading items...</p> : null}
            {!loading && !activeItems.length ? <p style={styles.emptyText}>Nothing on this list for this store view.</p> : null}
            <div style={styles.listWrap}>
              {activeItems.map((item) => <ShoppingItem key={item.id} item={item} checked={false} onToggle={toggleChecked} onDelete={deleteItem} />)}
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>In Cart</h2>
              <div style={styles.headerActions}>
                <span style={styles.countBadgeChecked}>{checkedItems.length}</span>
                <button onClick={clearCheckedItems} style={styles.secondaryButtonSmall} type="button">Clear Cart</button>
              </div>
            </div>
            {!checkedItems.length ? <p style={styles.emptyText}>Items you put in the cart will show here.</p> : null}
            <div style={styles.listWrap}>
              {checkedItems.map((item) => <ShoppingItem key={item.id} item={item} checked onToggle={toggleChecked} onDelete={deleteItem} />)}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ShoppingItem({ item, checked, onToggle, onDelete }) {
  return (
    <button type="button" onClick={() => onToggle(item)} style={checked ? styles.cartCardButtonChecked : styles.cartCardButton}>
      <div style={styles.itemHeader}>
        <div style={styles.itemHeaderLeft}>
          <span style={checked ? styles.inCartBadge : styles.cartBadge}>{checked ? 'In Cart' : 'Put in Cart'}</span>
          <strong style={checked ? styles.itemNameChecked : styles.itemName}>{item.name}</strong>
        </div>
        <span style={styles.itemQty}>{item.qty}</span>
      </div>
      <div style={styles.itemBottomRow}>
        <span style={checked ? styles.storeTagChecked : styles.storeTag}>{getStoreLabel(item.category)}</span>
        {checked ? <span style={styles.timeText}>{formatTimestamp(item.updated_at)}</span> : null}
        {!checked && item.note ? <span style={styles.noteText}>{item.note}</span> : null}
      </div>
      <div style={styles.itemFooter}>
        <span style={styles.tapHint}>{checked ? 'Tap card to move back to shopping list' : 'Tap card to mark as in cart'}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} style={styles.deleteButton}>Delete</button>
      </div>
    </button>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#f4f6fb', padding: '20px', fontFamily: 'Arial, sans-serif', color: '#142033' },
  appCard: { maxWidth: '980px', margin: '0 auto' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  title: { margin: 0, fontSize: '32px', lineHeight: 1.1 },
  subtitle: { margin: '6px 0 0', color: '#576277', fontSize: '16px' },
  panel: { background: '#ffffff', border: '1px solid #d9e1ef', borderRadius: '20px', padding: '18px', boxShadow: '0 8px 24px rgba(20,32,51,0.06)', marginBottom: '16px' },
  syncPanel: { background: '#ffffff', border: '1px solid #d9e1ef', borderRadius: '20px', padding: '18px', boxShadow: '0 8px 24px rgba(20,32,51,0.06)', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' },
  syncText: { color: '#576277', fontSize: '14px', marginTop: '6px' },
  syncButtons: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  statusPillOnline: { borderRadius: '999px', color: '#fff', padding: '9px 14px', fontSize: '14px', fontWeight: 700 },
  label: { display: 'block', fontSize: '14px', fontWeight: 700, marginBottom: '6px' },
  input: { width: '100%', boxSizing: 'border-box', minHeight: '48px', borderRadius: '14px', border: '1px solid #c8d2e2', padding: '12px 14px', fontSize: '16px', background: '#fff' },
  primaryButton: { minHeight: '48px', border: 'none', borderRadius: '14px', background: '#1f6fff', color: '#fff', padding: '0 18px', fontSize: '16px', fontWeight: 700, cursor: 'pointer' },
  secondaryButton: { minHeight: '44px', borderRadius: '14px', border: '1px solid #c8d2e2', background: '#fff', padding: '0 16px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' },
  secondaryButtonSmall: { minHeight: '36px', borderRadius: '12px', border: '1px solid #c8d2e2', background: '#fff', padding: '0 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  deleteButtonSmall: { minHeight: '36px', borderRadius: '12px', border: '1px solid #f0c4c4', background: '#fff5f5', color: '#a22a2a', padding: '0 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  errorBox: { background: '#ffe8e8', color: '#9f1d1d', padding: '12px 14px', borderRadius: '14px', border: '1px solid #f1b3b3', marginBottom: '16px' },
  grid: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '14px' },
  fieldSpan2: { gridColumn: 'span 2' },
  fieldSpan3: { gridColumn: 'span 3' },
  storeBarHeader: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' },
  storeBarTitle: { margin: 0, fontSize: '22px' },
  storeBarSubtitle: { fontSize: '14px', color: '#576277' },
  listPanelHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '12px' },
  listActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  addListForm: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', marginTop: '14px' },
  activeListBanner: { background: '#eef4ff', color: '#1747aa', borderRadius: '14px', padding: '10px 12px', marginBottom: '14px', fontSize: '15px' },
  tabWrap: { display: 'flex', flexWrap: 'wrap', gap: '10px' },
  storeTab: { minHeight: '40px', borderRadius: '999px', border: '1px solid #c8d2e2', background: '#fff', padding: '0 14px', fontSize: '14px', fontWeight: 700, color: '#142033', cursor: 'pointer' },
  storeTabActive: { minHeight: '40px', borderRadius: '999px', border: '1px solid #1f6fff', background: '#1f6fff', color: '#fff', padding: '0 14px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  columns: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '8px' },
  sectionTitle: { margin: 0, fontSize: '22px' },
  countBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '34px', height: '34px', borderRadius: '999px', background: '#e9efff', color: '#1747aa', fontWeight: 700, fontSize: '14px', padding: '0 10px' },
  countBadgeChecked: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '34px', height: '34px', borderRadius: '999px', background: '#e9fff0', color: '#23713e', fontWeight: 700, fontSize: '14px', padding: '0 10px' },
  listWrap: { display: 'flex', flexDirection: 'column', gap: '12px' },
  cartCardButton: { width: '100%', textAlign: 'left', border: '1px solid #d9e1ef', borderRadius: '18px', padding: '14px', background: '#ffffff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px' },
  cartCardButtonChecked: { width: '100%', textAlign: 'left', border: '1px solid #b8dfc2', borderRadius: '18px', padding: '14px', background: '#eefcf2', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px' },
  itemHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' },
  itemHeaderLeft: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
  cartBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 'fit-content', borderRadius: '999px', background: '#eef4ff', color: '#1747aa', fontSize: '12px', fontWeight: 700, padding: '6px 10px' },
  inCartBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 'fit-content', borderRadius: '999px', background: '#dff8e7', color: '#23713e', fontSize: '12px', fontWeight: 700, padding: '6px 10px' },
  itemName: { fontSize: '28px', lineHeight: 1 },
  itemNameChecked: { fontSize: '28px', lineHeight: 1, color: '#1f5e35' },
  itemQty: { fontSize: '22px', fontWeight: 700, color: '#576277', whiteSpace: 'nowrap', paddingTop: '4px' },
  itemBottomRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
  storeTag: { fontSize: '12px', fontWeight: 700, color: '#1747aa', background: '#e9efff', borderRadius: '999px', padding: '4px 8px' },
  storeTagChecked: { fontSize: '12px', fontWeight: 700, color: '#23713e', background: '#dff8e7', borderRadius: '999px', padding: '4px 8px' },
  noteText: { fontSize: '20px', color: '#576277' },
  timeText: { fontSize: '12px', color: '#576277' },
  itemFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  tapHint: { fontSize: '13px', color: '#576277' },
  deleteButton: { minHeight: '38px', borderRadius: '12px', border: '1px solid #f0c4c4', background: '#fff5f5', color: '#a22a2a', padding: '0 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  emptyText: { color: '#576277', fontSize: '15px', margin: 0 },
}
