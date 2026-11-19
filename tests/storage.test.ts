import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { addToTree, emptyState, hasQuota, parseBackup, pruneBranch } from '../src/model.ts'
import type { RuleInput } from '../src/model.ts'
import { addRule, BackupConflict, createCategory, loadTree, moveBranchCategory, pruneRule, removeCategory, renameCategory, replaceTree, saveReview, subscribeTree } from '../src/storage.ts'

const input: RuleInput = { title: '放下手机', trigger: '回家时', action: '把手机放在鞋柜上', parentId: null, badge: 'standard' }

test('two independent IndexedDB connections competing for today commit exactly one rule', async () => {
  await replaceTree(emptyState())
  let signals = 0
  const unsubscribe = subscribeTree(() => { signals++ })
  try {
    const attempts = await Promise.allSettled([addRule(input), addRule(input)])
    assert.deepEqual(attempts.map(result => result.status).sort(), ['fulfilled', 'rejected'])
    assert.match(String(attempts.find(result => result.status === 'rejected')?.reason), /今天已新增/)
    const saved = await loadTree()
    assert.equal(saved.rules.length, 1)
    assert.equal(signals, 1)
    await pruneRule(saved.rules[0].id)
    await assert.rejects(addRule(input), /今天已新增/)
    assert.equal(hasQuota(await loadTree()), false)
    assert.equal(signals, 2)
  } finally {
    unsubscribe()
  }
})

test('restoring a backup is atomic and preserves quota and history', async () => {
  await replaceTree(emptyState())
  const rule = await addRule(input)
  await pruneRule(rule.id)
  const snapshot = await loadTree()
  await replaceTree(emptyState())
  assert.equal((await loadTree()).rules.length, 0)
  await replaceTree(parseBackup(JSON.stringify(snapshot)))
  assert.deepEqual(await loadTree(), snapshot)
  assert.equal(hasQuota(await loadTree()), false)
  await assert.rejects(replaceTree({ ...snapshot, rules: [...snapshot.rules, rule] }))
  assert.deepEqual(await loadTree(), snapshot)
})

test('a backup preview cannot replace changes committed by another connection', async () => {
  await replaceTree(emptyState())
  const rule = await addRule(input)
  const preview = await loadTree()
  // The same total number of records now has a different history and activation state.
  await pruneRule(rule.id)
  const updated = await loadTree()
  await assert.rejects(replaceTree(emptyState(), preview), (error: unknown) => {
    assert.ok(error instanceof BackupConflict)
    assert.deepEqual(error.current, updated)
    return true
  })
  assert.deepEqual(await loadTree(), updated)
  await replaceTree(emptyState(), updated)
  assert.deepEqual(await loadTree(), emptyState())
})

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function installV1(snapshot: unknown): Promise<void> {
  await resultOf(indexedDB.deleteDatabase('daily-rule'))
  const old = indexedDB.open('daily-rule', 1)
  old.onupgradeneeded = () => old.result.createObjectStore('tree').put(snapshot, 'current')
  const db = await resultOf(old)
  db.close()
}

test('first open migrates and persists v1 data and prevents old clients overwriting v3', async () => {
  const date = new Date(2026, 10, 18)
  const original = pruneBranch(addToTree(emptyState(), input, date, 'a'), 'a', date)
  const legacy = { version: 1, rules: original.rules.map(({categoryId, ...rule}) => rule) }
  await installV1(legacy)
  assert.deepEqual(await Promise.all([loadTree(), loadTree()]), [original, original])
  assert.equal(hasQuota(await loadTree(), date), false)
  const upgraded = await resultOf(indexedDB.open('daily-rule', 3))
  try {
    assert.deepEqual(await resultOf(upgraded.transaction('tree').objectStore('tree').get('current')), original)
  } finally { upgraded.close() }
  await assert.rejects(resultOf(indexedDB.open('daily-rule', 1)), { name: 'VersionError' })
  await assert.rejects(resultOf(indexedDB.open('daily-rule', 2)), { name: 'VersionError' })
})

test('a failed legacy migration aborts the upgrade and leaves the original snapshot intact', async () => {
  const malformed = { version: 1, rules: [{id:'incomplete'}] }
  await installV1(malformed)
  await assert.rejects(loadTree(), /字段/)
  const old = await resultOf(indexedDB.open('daily-rule', 1))
  try {
    assert.deepEqual(await resultOf(old.transaction('tree').objectStore('tree').get('current')), malformed)
  } finally { old.close() }
  // Reset this test database before independent scenarios.
  await resultOf(indexedDB.deleteDatabase('daily-rule'))
})

test('category operations preserve daily quota and serialize uniqueness across connections', async () => {
  await replaceTree(emptyState())
  const attempts = await Promise.allSettled([createCategory('运动'), createCategory(' 运动 ')])
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  const category = (await loadTree()).categories.find(entry => entry.name === '运动')!
  await renameCategory(category.id, '运动习惯')
  assert.equal(hasQuota(await loadTree()), true)
  const rule = await addRule({...input, categoryId:category.id})
  await moveBranchCategory(rule.id, 'life')
  await moveBranchCategory(rule.id, category.id)
  const snapshot = await loadTree()
  assert.deepEqual(parseBackup(JSON.stringify(snapshot)), snapshot)
  await pruneRule(rule.id)
  await removeCategory(category.id)
  const final = await loadTree()
  assert.equal(final.rules[0].categoryId, null)
  assert.equal(final.rules[0].cause, 'breach')
  assert.equal(hasQuota(final), false)
  assert.deepEqual(final.categories, emptyState().categories)
})


test('concurrent review editors preserve the winner, allow explicit clearing, and retain quota', async () => {
  await replaceTree(emptyState())
  const rule = await addRule(input)
  const initial = {reason: '太累', improvement: ''}
  await pruneRule(rule.id, undefined, initial)
  const updates = [{reason:'修改 A', improvement:''}, {reason:'修改 B', improvement:''}]
  const results = await Promise.allSettled(updates.map(note => saveReview(rule.id, note, initial)))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(String(results.find(result => result.status === 'rejected')?.reason), /别处更新/)
  const winner = (await loadTree()).rules[0].review!
  await assert.rejects(saveReview(rule.id, {reason:'', improvement:''}), /别处更新/)
  await saveReview(rule.id, {reason:' ', improvement:''}, winner)
  const cleared = await loadTree()
  assert.equal('review' in cleared.rules[0], false)
  assert.equal(hasQuota(cleared), false)
})

test('database v2 snapshots migrate to v3 without losing historical records or compatible reviews', async () => {
  const day = new Date(2026, 10, 18)
  const state = pruneBranch(addToTree(emptyState(), input, day, 'breach'), 'breach', day, undefined, {reason:'', improvement:'预先准备'})
  await resultOf(indexedDB.deleteDatabase('daily-rule'))
  const old = indexedDB.open('daily-rule', 2)
  old.onupgradeneeded = () => old.result.createObjectStore('tree').put({...state, version: 2}, 'current')
  const db = await resultOf(old)
  db.close()
  assert.deepEqual(await loadTree(), state)
  await assert.rejects(resultOf(indexedDB.open('daily-rule', 2)), {name:'VersionError'})
})
