// Used identically by the client and Apps Script. Patches never recreate deleted rows.
export function applyOperations(snapshot, operations) {
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
