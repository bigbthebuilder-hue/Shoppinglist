import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const STORE_OPTIONS = [
  'Costco',
  'Superstore',
  'Independent',
  'Liquor Store',
  'Home Hardware',
]

const SORT_ORDER = {
  Costco: 1,
  Superstore: 2,
  Independent: 3,
  'Liquor Store': 4,
  'Home Hardware': 5,
}

function normalizeHouseholdCode(value) {
  return (value || '').trim().toUpperCase()
}

function loadSavedHouseholdCode() {
  return normalizeHouseholdCode(localStorage.getItem('grocery_household_code') || '')
}

function saveHouseholdCode(code) {
  localStorage.setItem('grocery_household_code', normalizeHouseholdCode(code))
}

function clearHouseholdCode() {
  localStorage.removeItem('grocery_household_code')
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

export default function App() {
  const [householdCodeInput, setHouseholdCodeInput] = useState(loadSavedHouseholdCode())
  const [householdCode, setHouseholdCode] = useState(loadSavedHouseholdCode())
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('Costco')

  const loadItems = useCallback(async () => {
    if (!householdCode) {
      setItems([])
      return
    }

    setLoading(true)
    setError('')

    const { data, error: queryError } = await supabase
      .from('grocery_items')
      .select('*')
      .eq('household_code', householdCode)
      .order('checked', { ascending: true })
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (queryError) {
      setError(queryError.message)
      setItems([])
    } else {
      setItems(data || [])
    }

    setLoading(false)
  }, [householdCode])

  const activeItems = useMemo(
    () =>
      items
        .filter((item) => !item.checked)
        .sort((a, b) => {
          const catDiff = (SORT_ORDER[a.category] || 999) - (SORT_ORDER[b.category] || 999)
          if (catDiff !== 0) return catDiff
          return a.name.localeCompare(b.name)
        }),
    [items]
  )

  const checkedItems = useMemo(
    () =>
      items
        .filter((item) => item.checked)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    [items]
  )

  useEffect(() => {
    if (!householdCode) {
      setItems([])
      return
    }

    let channel

    loadItems()

    channel = supabase
      .channel(`grocery_items_${householdCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grocery_items',
          filter: `household_code=eq.${householdCode}`,
        },
        () => {
          loadItems()
        }
      )
      .subscribe()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [householdCode, loadItems])

  async function handleJoinHousehold(e) {
    e.preventDefault()
    const normalized = normalizeHouseholdCode(householdCodeInput)
    if (!normalized) {
      setError('Enter a household code.')
      return
    }
    saveHouseholdCode(normalized)
    setHouseholdCode(normalized)
    setError('')
  }

  function handleLeaveHousehold() {
    clearHouseholdCode()
    setHouseholdCode('')
    setHouseholdCodeInput('')
    setItems([])
    setError('')
  }

  async function handleAddItem(e) {
    e.preventDefault()
    if (!householdCode) {
      setError('Join a household first.')
      return
    }

    const trimmedName = name.trim()
    const trimmedQty = qty.trim() || '1'
    const trimmedNote = note.trim()

    if (!trimmedName) {
      setError('Enter an item name.')
      return
    }

    setSaving(true)
    setError('')

    const { error: insertError } = await supabase.from('grocery_items').insert({
      household_code: householdCode,
      name: trimmedName,
      qty: trimmedQty,
      note: trimmedNote,
      category,
      checked: false,
    })

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setName('')
    setQty('1')
    setNote('')
    setCategory('Costco')
    await loadItems()
  }

  async function toggleChecked(item) {
    setError('')
    const { error: updateError } = await supabase
      .from('grocery_items')
      .update({ checked: !item.checked })
      .eq('id', item.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await loadItems()
  }

  async function deleteItem(itemId) {
    setError('')
    const { error: deleteError } = await supabase
      .from('grocery_items')
      .delete()
      .eq('id', itemId)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    await loadItems()
  }

  async function clearCheckedItems() {
    setError('')
    const checkedIds = checkedItems.map((item) => item.id)
    if (!checkedIds.length) return

    const { error: deleteError } = await supabase
      .from('grocery_items')
      .delete()
      .in('id', checkedIds)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    await loadItems()
  }

  return (
    <div style={styles.page}>
      <div style={styles.appCard}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Family Grocery List</h1>
            <p style={styles.subtitle}>Shared live list for the whole house</p>
          </div>
          {householdCode ? (
            <button onClick={handleLeaveHousehold} style={styles.secondaryButton}>
              Switch House
            </button>
          ) : null}
        </div>

        {!householdCode ? (
          <form onSubmit={handleJoinHousehold} style={styles.panel}>
            <label style={styles.label}>Household code</label>
            <input
              value={householdCodeInput}
              onChange={(e) => setHouseholdCodeInput(e.target.value.toUpperCase())}
              placeholder="Example: HOUK-FAMILY"
              style={styles.input}
            />
            <p style={styles.helpText}>
              Put the same code on every family device. No usernames or passwords.
            </p>
            <button type="submit" style={styles.primaryButton}>
              Open Shared List
            </button>
          </form>
        ) : (
          <>
            <div style={styles.householdBanner}>
              Shared household: <strong>{householdCode}</strong>
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

            {error ? <div style={styles.errorBox}>{error}</div> : null}

            <div style={styles.columns}>
              <section style={styles.panel}>
                <div style={styles.sectionHeader}>
                  <h2 style={styles.sectionTitle}>Need to Buy</h2>
                  <span style={styles.countBadge}>{activeItems.length}</span>
                </div>

                {loading ? <p style={styles.emptyText}>Loading items...</p> : null}
                {!loading && !activeItems.length ? <p style={styles.emptyText}>Nothing on the list yet.</p> : null}

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
                        <span style={styles.storeTag}>{item.category}</span>
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
                        <span style={styles.storeTagChecked}>{item.category}</span>
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
          </>
        )}
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
  householdBanner: {
    background: '#142033',
    color: '#ffffff',
    borderRadius: '16px',
    padding: '14px 16px',
    marginBottom: '16px',
    fontSize: '15px',
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
  helpText: {
    color: '#576277',
    fontSize: '14px',
    margin: '10px 0 14px',
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
