import { addToTree, addTreeCategory, decodeTree, emptyState, moveTreeBranchCategory, pruneBranch, removeTreeCategory, renameTreeCategory, updateReview } from './model.ts'
import type { Category, Review, Rule, RuleInput, TreeState } from './model.ts'

const dbName = 'daily-rule'
const storeName = 'tree'
const treeKey = 'current'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('此浏览器无法使用本地数据库，请换用支持 IndexedDB 的浏览器。'))
      return
    }
    // Earlier clients open explicit versions and must not overwrite reviews with a legacy decoder.
    const request = indexedDB.open(dbName, 3)
    let migrationError: unknown
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) {
        request.result.createObjectStore(storeName)
        return
      }
      const upgrade = request.transaction!
      const store = upgrade.objectStore(storeName)
      const read = store.get(treeKey)
      read.onsuccess = () => {
        try {
          if (read.result !== undefined) store.put(decodeTree(read.result), treeKey)
        } catch (error) {
          migrationError = error
          upgrade.abort()
        }
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(migrationError ?? request.error)
  })
}

interface Operation<T> {
  result: T
  next?: TreeState
  saveBeforeSync?: boolean
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
          if (update.saveBeforeSync) store.put({
            state: request.result ?? emptyState(), at: new Date().toISOString(),
          }, 'last-sync-recovery')
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

async function updateTree(operation: (state: TreeState) => TreeState): Promise<TreeState> {
  const updated = await transact('readwrite', state => {
    const next = operation(state)
    return { next, result: next }
  })
  changed()
  return updated
}

export async function addRule(input: RuleInput): Promise<Rule> {
  const next = await updateTree(state => addToTree(state, input, new Date(), newId()))
  return next.rules[next.rules.length - 1]
}

export async function pruneRule(id: string, expectedIds?: readonly string[], review?: Review): Promise<void> {
  await updateTree(state => pruneBranch(state, id, new Date(), expectedIds, review))
}

export async function saveReview(ruleId: string, review: Review, expectedReview?: Review | null): Promise<void> {
  await updateTree(state => updateReview(state, ruleId, review, expectedReview))
}

export async function createCategory(name: string): Promise<Category> {
  const next = await updateTree(state => addTreeCategory(state, newId(), name))
  return next.categories[next.categories.length - 1]
}

export async function renameCategory(id: string, name: string): Promise<void> {
  await updateTree(state => renameTreeCategory(state, id, name))
}

export async function removeCategory(id: string): Promise<void> {
  await updateTree(state => removeTreeCategory(state, id))
}

export async function moveBranchCategory(rootRuleId: string, categoryId: string | null): Promise<void> {
  await updateTree(state => moveTreeBranchCategory(state, rootRuleId, categoryId))
}

export class BackupConflict extends Error {
  current: TreeState

  constructor(current: TreeState) {
    super('预览期间本机档案已更新。请重新核对当前档案，再决定是否替换。')
    this.current = current
  }
}

export async function replaceTree(state: TreeState, expected?: TreeState): Promise<void> {
  const next = decodeTree(state)
  await updateTree(current => {
    if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new BackupConflict(current)
    return next
  })
}

export interface SyncRecovery { state: TreeState; at: string }

export async function loadSyncRecovery(): Promise<SyncRecovery | undefined> {
  const db = await openDatabase()
  try {
    return await new Promise<SyncRecovery | undefined>((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get('last-sync-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function replaceFromSync(incoming: TreeState, expected: TreeState): Promise<void> {
  const next = decodeTree(incoming)
  await transact('readwrite', current => {
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new BackupConflict(current)
    return { result: undefined, next, saveBeforeSync: true }
  })
  changed()
}
