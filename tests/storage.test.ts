import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyState, hasQuota, parseBackup } from '../src/model.ts'
import type { RuleInput } from '../src/model.ts'
import { addRule, BackupConflict, loadTree, pruneRule, replaceTree, subscribeTree } from '../src/storage.ts'

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
