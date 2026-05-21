import { useCallback, useEffect, useMemo, useState } from 'react'

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw15K7lid0XYhUHG4By3mtU0-32c-oLHkORZo9ImyukP17t0ZIUDWD-I1N4ydnLuyHF/exec'

const LOCAL_STORAGE_KEY = 'family_grocery_items_v2'
const LAST_SYNC_KEY = 'family_grocery_last_sync_v2'

const STORE_OPTIONS = [
  'Costco',
  'Superstore',
  'Independent',
  'Liquor Store',
  'Home Hardware',
]

const STORE_TABS = ['All Stores', ...STORE_OPTIONS]

const SORT_ORDER = {
  '': 0,
  Costco: 1,
  Superstore: 2,
  Independent: 3,
  'Liquor Store': 4,
  'Home Hardware': 5,
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `item_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function nowIso() {
  return new Date().toISOString()
}

function getStoreLabel(value) {
  return value || 'Any Store'
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

function loadLocalItems() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLocalItems(items) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items))
}

function loadLastSync() {
  return localStorage.getItem(LAST_SYNC_KEY) || ''
}

function saveLastSync(value) {
  localStorage.setItem(LAST_SYNC_KEY, value)
}

function encodePayload(items) {
  const json = JSON.stringify(items)
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

  const persistItems = useCallback((nextItems) => {
    setItems(nextItems)
    saveLocalItems(nextItems)
  }, [])

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

  useEffect(() => {
    saveLocalItems(items)
  }, [items])

  function matchesActiveStore(item) {
    if (activeStore === 'All Stores') return true
    return !item.category || item.category === activeStore
  }

  const activeItems = useMemo(
    () =>
      items
        .filter((item) => !item.checked && !item.deleted && matchesActiveStore(item))
        .sort((a, b) => {
          const catDiff = (SORT_ORDER[a.category || ''] || 999) - (SORT_ORDER[b.category || ''] || 999)
          if (catDiff !== 0) return catDiff
          return a.name.localeCompare(b.name)
        }),
    [items, activeStore]
  )

  const checkedItems = useMemo(
    () =>
      items
        .filter((item) => item.checked && !item.deleted && matchesActiveStore(item))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    [items, activeStore]
  )

  const visibleItems = useMemo(() => items.filter((item) => !item.deleted), [items])

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

      if (!result.ok) {
        throw new Error(result.error || 'Could not load from Google Sheet.')
      }

      const incoming = Array.isArray(result.items) ? result.items : []
      persistItems(incoming)

      const stamp = nowIso()
      saveLastSync(stamp)
      setLastSync(stamp)
      setSyncMessage(`Pulled ${incoming.length} item${incoming.length === 1 ? '' : 's'} from Google Sheet.`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }

  async function pushToSheet(nextItems = items) {
    if (!navigator.onLine) {
      setSyncMessage('Offline. Changes are saved on this device and can be synced later.')
      return false
    }

    setSyncing(true)
    setError('')

    try {
      const itemsToSave = nextItems.filter((item) => !item.deleted)
      const payload = encodePayload(itemsToSave)
      const result = await jsonpRequest(GOOGLE_SCRIPT_URL, {
        action: 'save',
        payload,
      })

      if (!result.ok) {
        throw new Error(result.error || 'Could not save to Google Sheet.')
      }

      const stamp = nowIso()
      saveLastSync(stamp)
      setLastSync(stamp)
      setSyncMessage(`Synced ${itemsToSave.length} item${itemsToSave.length === 1 ? '' : 's'} to Google Sheet.`)
      return true
    } catch (err) {
      setError(err.message || String(err))
      return false
    } finally {
      setSyncing(false)
    }
  }

  async function syncNow() {
    await pushToSheet(items)
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
      name: trimmedName,
      qty: trimmedQty,
      note: trimmedNote,
      category,
      checked: false,
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

    if (navigator.onLine) {
      await pushToSheet(nextItems)
    } else {
      setSyncMessage('Item added offline. Press Sync Now when you have service.')
    }
  }

  async function toggleChecked(item) {
    const nextItems = items.map((current) =>
      current.id === item.id
        ? { ...current, checked: !current.checked, updated_at: nowIso() }
        : current
    )

    persistItems(nextItems)

    if (navigator.onLine) {
      await pushToSheet(nextItems)
    } else {
      setSyncMessage('Cart change saved offline. Press Sync Now when you have service.')
    }
  }

  async function deleteItem(itemId) {
    const nextItems = items.filter((item) => item.id !== itemId)
    persistItems(nextItems)

    if (navigator.onLine) {
      await pushToSheet(nextItems)
    } else {
      setSyncMessage('Item deleted offline. Press Sync Now when you have service.')
    }
  }

  async function clearCheckedItems() {
    const nextItems = items.filter((item) => !item.checked)
    persistItems(nextItems)

    if (navigator.onLine) {
      await pushToSheet(nextItems)
    } else {
      setSyncMessage('Cart cleared offline. Press Sync Now when you have service.')
    }
  }

  async function replaceLocalFromSheet() {
    const confirmed = window.confirm(
      'Replace this device list with the Google Sheet list? Any unsynced local changes on this device will be overwritten.'
    )

    if (!confirmed) return
    await pullFromSheet()
  }

  return (
    <div style={styles.page}>
      <div style={styles.appCard}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Family Grocery List</h1>
            <p style={styles.subtitle}>Offline-first shared shopping list</p>
          </div>
          <div style={styles.statusPillOnline}>
            {isOnline ? 'Online' : 'Offline'}
          </div>
        </div>

        <div style={styles.syncPanel}>
          <div>
            <strong>Local list:</strong> {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}
            <div style={styles.syncText}>
              Last synced: {lastSync ? formatTimestamp(lastSync) : 'Not synced yet'}
            </div>
            {syncMessage ? <div style={styles.syncText}>{syncMessage}</div> : null}
          </div>

          <div style={styles.syncButtons}>
            <button type="button" onClick={syncNow} style={styles.primaryButton} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button type="button" onClick={replaceLocalFromSheet} style={styles.secondaryButton}>
              Pull From Sheet
            </button>
          </div>
        </div>

        <form onSubmit={handleAddItem} style={styles.panel}>
          <div style={styles.grid}>
            <div style={styles.fieldSpan2}>
              <label style={styles.label}>Item</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Milk, bananas, bread..."
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Qty</label>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="1"
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Store</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.input}>
                <option value="">No Store / Any Store</option>
                {STORE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.fieldSpan3}>
              <label style={styles.label}>Note</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="2%, ripe, brand, size..."
                style={styles.input}
              />
            </div>
          </div>

          <button type="submit" style={styles.primaryButton} disabled={saving}>
            {saving ? 'Adding...' : 'Add Item'}
          </button>
        </form>

        <div style={styles.panel}>
          <div style={styles.storeBarHeader}>
            <h2 style={styles.storeBarTitle}>Store View</h2>
            <span style={styles.storeBarSubtitle}>
              Pick the store you are shopping. That view shows store-specific items plus any unassigned items.
            </span>
          </div>

          <div style={styles.tabWrap}>
            {STORE_TABS.map((store) => {
              const isActive = activeStore === store
              return (
                <button
                  key={store}
                  type="button"
                  onClick={() => setActiveStore(store)}
                  style={isActive ? styles.storeTabActive : styles.storeTab}
                >
                  {store}
                </button>
              )
            })}
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
            {!loading && !activeItems.length ? <p style={styles.emptyText}>Nothing on the list for this store view.</p> : null}

            <div style={styles.listWrap}>
              {activeItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleChecked(item)}
                  style={styles.cartCardButton}
                >
                  <div style={styles.itemHeader}>
                    <div style={styles.itemHeaderLeft}>
                      <span style={styles.cartBadge}>Put in Cart</span>
                      <strong style={styles.itemName}>{item.name}</strong>
                    </div>
                    <span style={styles.itemQty}>{item.qty}</span>
                  </div>

                  <div style={styles.itemBottomRow}>
                    <span style={styles.storeTag}>{getStoreLabel(item.category)}</span>
                    {item.note ? <span style={styles.noteText}>{item.note}</span> : null}
                  </div>

                  <div style={styles.itemFooter}>
                    <span style={styles.tapHint}>Tap card to mark as in cart</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteItem(item.id)
                      }}
                      style={styles.deleteButton}
                    >
                      Delete
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>In Cart</h2>
              <div style={styles.headerActions}>
                <span style={styles.countBadgeChecked}>{checkedItems.length}</span>
                <button onClick={clearCheckedItems} style={styles.secondaryButtonSmall}>
                  Clear Cart
                </button>
              </div>
            </div>

            {!checkedItems.length ? <p style={styles.emptyText}>Items you put in the cart will show here.</p> : null}

            <div style={styles.listWrap}>
              {checkedItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleChecked(item)}
                  style={styles.cartCardButtonChecked}
                >
                  <div style={styles.itemHeader}>
                    <div style={styles.itemHeaderLeft}>
                      <span style={styles.inCartBadge}>In Cart</span>
                      <strong style={styles.itemNameChecked}>{item.name}</strong>
                    </div>
                    <span style={styles.itemQty}>{item.qty}</span>
                  </div>

                  <div style={styles.itemBottomRow}>
                    <span style={styles.storeTagChecked}>{getStoreLabel(item.category)}</span>
                    <span style={styles.timeText}>{formatTimestamp(item.updated_at)}</span>
                  </div>

                  <div style={styles.itemFooter}>
                    <span style={styles.tapHint}>Tap card to move back to shopping list</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteItem(item.id)
                      }}
                      style={styles.deleteButton}
                    >
                      Delete
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f4f6fb',
    padding: '20px',
    fontFamily: 'Arial, sans-serif',
    color: '#142033',
  },
  appCard: {
    maxWidth: '980px',
    margin: '0 auto',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  title: {
    margin: 0,
    fontSize: '32px',
    lineHeight: 1.1,
  },
  subtitle: {
    margin: '6px 0 0',
    color: '#576277',
    fontSize: '16px',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #d9e1ef',
    borderRadius: '20px',
    padding: '18px',
    boxShadow: '0 8px 24px rgba(20,32,51,0.06)',
    marginBottom: '16px',
  },
  syncPanel: {
    background: '#ffffff',
    border: '1px solid #d9e1ef',
    borderRadius: '20px',
    padding: '18px',
    boxShadow: '0 8px 24px rgba(20,32,51,0.06)',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  syncText: {
    color: '#576277',
    fontSize: '14px',
    marginTop: '6px',
  },
  syncButtons: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  statusPillOnline: {
    borderRadius: '999px',
    background: isOnlineColor(),
    color: '#fff',
    padding: '9px 14px',
    fontSize: '14px',
    fontWeight: 700,
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 700,
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '48px',
    borderRadius: '14px',
    border: '1px solid #c8d2e2',
    padding: '12px 14px',
    fontSize: '16px',
    background: '#fff',
  },
  primaryButton: {
    minHeight: '48px',
    border: 'none',
    borderRadius: '14px',
    background: '#1f6fff',
    color: '#fff',
    padding: '0 18px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    minHeight: '44px',
    borderRadius: '14px',
    border: '1px solid #c8d2e2',
    background: '#fff',
    padding: '0 16px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButtonSmall: {
    minHeight: '36px',
    borderRadius: '12px',
    border: '1px solid #c8d2e2',
    background: '#fff',
    padding: '0 12px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  errorBox: {
    background: '#ffe8e8',
    color: '#9f1d1d',
    padding: '12px 14px',
    borderRadius: '14px',
    border: '1px solid #f1b3b3',
    marginBottom: '16px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr',
    gap: '12px',
    marginBottom: '14px',
  },
  fieldSpan2: {
    gridColumn: 'span 2',
  },
  fieldSpan3: {
    gridColumn: 'span 3',
  },
  storeBarHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '12px',
  },
  storeBarTitle: {
    margin: 0,
    fontSize: '22px',
  },
  storeBarSubtitle: {
    fontSize: '14px',
    color: '#576277',
  },
  tabWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
  },
  storeTab: {
    minHeight: '40px',
    borderRadius: '999px',
    border: '1px solid #c8d2e2',
    background: '#fff',
    padding: '0 14px',
    fontSize: '14px',
    fontWeight: 700,
    color: '#142033',
    cursor: 'pointer',
  },
  storeTabActive: {
    minHeight: '40px',
    borderRadius: '999px',
    border: '1px solid #1f6fff',
    background: '#1f6fff',
    color: '#fff',
    padding: '0 14px',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '14px',
    flexWrap: 'wrap',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '22px',
  },
  countBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '34px',
    height: '34px',
    borderRadius: '999px',
    background: '#e9efff',
    color: '#1747aa',
    fontWeight: 700,
    fontSize: '14px',
    padding: '0 10px',
  },
  countBadgeChecked: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '34px',
    height: '34px',
    borderRadius: '999px',
    background: '#e9fff0',
    color: '#23713e',
    fontWeight: 700,
    fontSize: '14px',
    padding: '0 10px',
  },
  listWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  cartCardButton: {
    width: '100%',
    textAlign: 'left',
    border: '1px solid #d9e1ef',
    borderRadius: '18px',
    padding: '14px',
    background: '#ffffff',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  cartCardButtonChecked: {
    width: '100%',
    textAlign: 'left',
    border: '1px solid #b8dfc2',
    borderRadius: '18px',
    padding: '14px',
    background: '#eefcf2',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  itemHeaderLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  },
  cartBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'fit-content',
    borderRadius: '999px',
    background: '#eef4ff',
    color: '#1747aa',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 10px',
  },
  inCartBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'fit-content',
    borderRadius: '999px',
    background: '#dff8e7',
    color: '#23713e',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 10px',
  },
  itemName: {
    fontSize: '28px',
    lineHeight: 1,
  },
  itemNameChecked: {
    fontSize: '28px',
    lineHeight: 1,
    color: '#1f5e35',
  },
  itemQty: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#576277',
    whiteSpace: 'nowrap',
    paddingTop: '4px',
  },
  itemBottomRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  storeTag: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#1747aa',
    background: '#e9efff',
    borderRadius: '999px',
    padding: '4px 8px',
  },
  storeTagChecked: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#23713e',
    background: '#dff8e7',
    borderRadius: '999px',
    padding: '4px 8px',
  },
  noteText: {
    fontSize: '20px',
    color: '#576277',
  },
  timeText: {
    fontSize: '12px',
    color: '#576277',
  },
  itemFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  tapHint: {
    fontSize: '13px',
    color: '#576277',
  },
  deleteButton: {
    minHeight: '38px',
    borderRadius: '12px',
    border: '1px solid #f0c4c4',
    background: '#fff5f5',
    color: '#a22a2a',
    padding: '0 12px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  emptyText: {
    color: '#576277',
    fontSize: '15px',
    margin: 0,
  },
}

function isOnlineColor() {
  return navigator.onLine ? '#23713e' : '#a86800'
}
