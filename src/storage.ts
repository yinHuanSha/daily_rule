import { addToTree, emptyState, parseBackup, pruneBranch } from './model.ts'
import type { Rule, RuleInput, TreeState } from './model.ts'

const dbName = 'daily-rule'
const storeName = 'tree'
const treeKey = 'current'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('此浏览器无法使用本地数据库，请换用支持 IndexedDB 的浏览器。'))
      return
    }
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface Operation<T> {
  result: T
  next?: TreeState
}

// A read/write transaction serializes the quota check and its update across connections.
async function transact<T>(mode: IDBTransactionMode, operation: (state: TreeState) => Operation<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const store = tx.objectStore(storeName)
      const request = store.get(treeKey)
      let result: T
      let failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('本地数据保存失败，请重试。'))
      request.onsuccess = () => {
        try {
          const update = operation(request.result ?? emptyState())
          result = update.result
          if (update.next) store.put(update.next, treeKey)
        } catch (error) {
          failure = error
          tx.abort()
        }
      }
    })
  } finally {
    db.close()
  }
}

const topic = 'daily-rule-tree-changed'
const events = new EventTarget()
let channel: BroadcastChannel | undefined
let listening = false

function signalLocal(): void {
  events.dispatchEvent(new Event('change'))
}

function connectNotifications(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pageshow', signalLocal)
  window.addEventListener('focus', signalLocal)
  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(topic)
      channel.onmessage = signalLocal
    } catch { /* Browser storage events can still carry notifications. */ }
  }
  if (!channel) {
    window.addEventListener('storage', event => {
      if (event.key === topic) signalLocal()
    })
  }
}

function changed(): void {
  signalLocal()
  if (typeof window === 'undefined') return
  // Persistence already succeeded even if a browser policy blocks inter-tab notifications.
  try {
    connectNotifications()
    if (channel) channel.postMessage(null)
    else window.localStorage.setItem(topic, newId())
  } catch { /* Other tabs also reload on focus. */ }
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function subscribeTree(fn: () => void): () => void {
  connectNotifications()
  events.addEventListener('change', fn)
  return () => events.removeEventListener('change', fn)
}

export function loadTree(): Promise<TreeState> {
  return transact('readonly', state => ({ result: state }))
}

export async function addRule(input: RuleInput): Promise<Rule> {
  const rule = await transact('readwrite', state => {
    const next = addToTree(state, input, new Date(), newId())
    return { next, result: next.rules[next.rules.length - 1] }
  })
  changed()
  return rule
}

export async function pruneRule(id: string, expectedIds?: readonly string[]): Promise<void> {
  await transact('readwrite', state => ({ next: pruneBranch(state, id, new Date(), expectedIds), result: undefined }))
  changed()
}

export async function replaceTree(state: TreeState): Promise<void> {
  const next = parseBackup(JSON.stringify(state))
  await transact('readwrite', () => ({ next, result: undefined }))
  changed()
}
