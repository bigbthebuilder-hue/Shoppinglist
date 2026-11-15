import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { applyOperations } from './operations.js'
import { createShoppingStore } from './shopping-store.js'
const home = { id: 'home', name: 'Home List' }
const item = (id, extra = {}) => ({ id, name: id, list_id: 'home', qty: '1', note: '', category: '', checked: false, ...extra })
const put = id => ({ id: 'op-'+id, entity: 'item', type: 'put', recordId: id, value: item(id) })
const patch = (id, value) => ({ id: crypto.randomUUID(), entity: 'item', type: 'patch', recordId: id, value })
const del = id => ({ id: crypto.randomUUID(), entity: 'item', type: 'delete', recordId: id })
function storage() { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k,v) => map.set(k,v) } }
function backend() {
  const sheets = new Map()
  function sheet(name) {
    const cells = []
    return { cells, getLastColumn() { return Math.max(0,...cells.map(r=>r.length)) }, copyTo() { const backup=sheet('backup');backup.cells.push(...cells.map(r=>[...r]));return {setName(n){sheets.set(n,backup);return backup}} }, getLastRow() { return cells.length }, clearContents() { cells.length = 0 }, setFrozenRows() {}, autoResizeColumns() {}, getRange(r,c,h=1,w=1) { return { clearContent() { for(let i=0;i<h;i++) for(let j=0;j<w;j++) { if(cells[r+i-1]) cells[r+i-1][c+j-1]='' } }, getValues: () => Array.from({length:h}, (_,i) => Array.from({length:w},(_,j)=>cells[r+i-1]?.[c+j-1] ?? '')), getValue: () => cells[r-1]?.[c-1] ?? '', setValue(v) { this.setValues([[v]]) }, setValues(rows) { rows.forEach((row,i)=>row.forEach((v,j)=>{ cells[r+i-1] ||= []; cells[r+i-1][c+j-1]=v })) } } } }
  }
  let locked = false
  const context = vm.createContext({ console, LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked,false); locked = true }, hasLock:()=>locked, releaseLock() { locked=false } }) }, SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n=>sheets.get(n), insertSheet: n=>{ const s=sheet(n);sheets.set(n,s);return s } }), flush() {} }, Utilities: { base64Decode: value=>Buffer.from(value,'base64'), newBlob: bytes=>({getDataAsString:()=>bytes.toString()}) }, ContentService: { MimeType:{JAVASCRIPT:'js'}, createTextOutput:text=>({setMimeType:()=>text}) } })
  vm.runInContext(fs.readFileSync('GOOGLE_APPS_SCRIPT_Code.gs','utf8'),context)
  const send = async params => {
    const { operations, ...parameter } = params
    if (operations) parameter.payload = Buffer.from(JSON.stringify(operations)).toString('base64url')
    const text = context.doGet({parameter:{...parameter,callback:'test'}})
    return JSON.parse(text.slice(5,-2))
  }
  return {send,sheets}
}
function client(server, options={}) { return createShoppingStore({storage:storage(), request:server.send, online:()=>true, ...options}) }

test('two stale devices add independently without replacing each other', async()=>{
 const b=backend(),a=client(b),c=client(b);await a.sync();await c.sync()
 a.change([put('Milk')]);c.change([put('Bread')]);await Promise.all([a.sync(),c.sync()]);await a.sync();await c.sync()
 assert.deepEqual(a.snapshot().items.map(x=>x.id).sort(),['Bread','Milk']);assert.equal(c.snapshot().items.length,2)
})
test('different fields on one item merge after a revision conflict',async()=>{
 const b=backend(),a=client(b),c=client(b);await a.sync();a.change([put('Milk')]);await a.sync();await c.sync()
 a.change([patch('Milk',{qty:'3'})]);c.change([patch('Milk',{checked:true})]);await a.sync();await c.sync();await a.sync()
 assert.equal(a.snapshot().items[0].qty,'3');assert.equal(a.snapshot().items[0].checked,true)
})
test('a stale offline edit never resurrects a deleted item',async()=>{
 const b=backend(),a=client(b),c=client(b);await a.sync();a.change([put('Milk')]);await a.sync();await c.sync()
 a.change([del('Milk')]);await a.sync();c.change([patch('Milk',{qty:'3'})]);await c.sync();assert.equal(c.snapshot().items.length,0)
})
test('retries of an accepted operation are idempotent',async()=>{
 const b=backend();const base=await b.send({action:'load'});const ops=[put('Milk')]
 const first=await b.send({action:'sync',revision:base.revision,operations:ops})
 const again=await b.send({action:'sync',revision:base.revision,operations:ops})
 assert.equal(again.revision,first.revision);assert.equal(again.items.length,1);assert.equal(again.acknowledged.length,1)
})
test('offline changes survive reload then sync automatically when requested online',async()=>{
 const b=backend(),s=storage();let online=false;const a=client(b,{storage:s,online:()=>online});a.change([put('Milk')]);await a.sync();assert.equal(a.snapshot().pending,1)
 const c=client(b,{storage:s,online:()=>online});assert.equal(c.snapshot().items.length,1);online=true;await c.sync();assert.equal(c.snapshot().pending,0);assert.equal((await b.send({action:'load'})).items.length,1)
})
test('an edit made during a request stays queued and reaches the server',async()=>{
 const b=backend();let injected=false,a
 a=client(b,{request:async params=>{ const result=await b.send(params);if(params.action==='sync'&&!injected){injected=true;a.change([put('Bread')])}return result }})
 await a.sync();a.change([put('Milk')]);await a.sync();assert.equal(a.snapshot().items.length,2);assert.equal(a.snapshot().pending,0)
})
test('a lost response retains the journal and retry does not duplicate data',async()=>{
 const b=backend();let fail=true;const a=client(b,{request:async params=>{const r=await b.send(params);if(params.action==='sync'&&fail){fail=false;throw Error('Network lost')}return r}})
 await a.sync();a.change([put('Milk')]);await a.sync();assert.equal(a.snapshot().pending,1);await a.sync();assert.equal(a.snapshot().pending,0);assert.equal(a.snapshot().items.length,1)
})
test('legacy device differences are recoverable without overwriting the sheet',async()=>{
 const b=backend(),s=storage();s.setItem('family_grocery_items_v3_lists',JSON.stringify([item('Offline item')]))
 const a=client(b,{storage:s});await a.sync();assert.equal(a.snapshot().items.length,0);assert.equal(a.snapshot().recovery.items.length,1)
 const id=a.recover();await a.sync();assert.equal(a.snapshot().items[0].list_id,id)
})
test('list creation rename deletion and default Home protection',async()=>{
 const b=backend(),a=client(b);await a.sync();a.change([{id:'x',entity:'list',type:'put',recordId:'camp',value:{name:'Camping'}},{...put('Tent'),value:item('Tent',{list_id:'camp'})}]);await a.sync()
 a.change([{entity:'list',type:'patch',recordId:'camp',value:{name:'Weekend'}}]);await a.sync();assert.equal(a.snapshot().lists.find(x=>x.id==='camp').name,'Weekend')
 a.change([{entity:'list',type:'delete',recordId:'camp'},{entity:'list',type:'delete',recordId:'home'}]);await a.sync();assert.equal(a.snapshot().lists.length,1);assert.equal(a.snapshot().items.length,0)
})
test('legacy full-snapshot saves are refused and schema mismatch preserves data',async()=>{
 const b=backend();await b.send({action:'load'});const r=await b.send({action:'save',operations:[put('bad')]});assert.equal(r.ok,false)
 b.sheets.get('Items').cells[0][0]='unexpected';const failed=await b.send({action:'load'});assert.equal(failed.ok,false);assert.equal(b.sheets.get('Items').cells[0][0],'unexpected')
})
test('client and backend use the identical operation application rules',()=>{
 const source=fs.readFileSync('src/operations.js','utf8').replace('export function','function').trim()
 assert.ok(fs.readFileSync('GOOGLE_APPS_SCRIPT_Code.gs','utf8').includes(source))
 const result=applyOperations({items:[item('Milk')],lists:[home]},[patch('Milk',{note:'2%',qty:'4'})]);assert.equal(result.items[0].note,'2%')
})

test('historical store columns migrate with a complete backup, quantities and notes preserved',async()=>{
 const b=backend();await b.send({action:'load'});const cells=b.sheets.get('Items').cells
 cells.length=0;cells.push(['id','name','qty','note','store','checked','updated_at','deleted','updated_at'],['legacy','Eggs','2 dozen','Large','Costco',true,'2026-11-14',false,''],['gone','Old','1','','',false,'2026-11-14',true,''])
 const r=await b.send({action:'load'});assert.equal(r.ok,true);assert.equal(r.items.length,1);assert.equal(r.items[0].category,'Costco');assert.equal(r.items[0].qty,'2 dozen');assert.equal(r.items[0].note,'Large');assert.equal(r.items[0].checked,true)
 assert.ok([...b.sheets.keys()].some(k=>k.startsWith('_Items before autosync')))
})
