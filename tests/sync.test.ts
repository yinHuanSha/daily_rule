import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { addTreeCategory, emptyState } from '../src/model.ts'
import { archiveDigest, compareArchives, applySync } from '../src/syncDecision.ts'
import { loadTree, loadSyncRecovery, replaceTree, replaceFromSync } from '../src/storage.ts'
import type { SyncSnapshot } from '../src/syncDecision.ts'
import type { TreeState } from '../src/model.ts'

const a = emptyState()
const b = addTreeCategory(a, 'b', '阅读')
const c = addTreeCategory(a, 'c', '运动')
const first = { revision: '1', state: a }

test('mobile sync compares full normalized archives, detects independent edits and deletion', async () => {
  const base = { digest: await archiveDigest(a), revision: '1', at: '' }
  assert.equal((await compareArchives(a, first, null)).action, 'same')
  assert.equal((await compareArchives(b, null, null)).action, 'create')
  assert.equal((await compareArchives(b, null, base)).action, 'create')
  assert.equal((await compareArchives(b, first, null)).action, 'choose')
  assert.equal((await compareArchives(b, first, base)).action, 'upload')
  assert.equal((await compareArchives(a, { revision: '2', state: b }, base)).action, 'download')
  assert.equal((await compareArchives(c, { revision: '2', state: b }, base)).action, 'choose')
  const ordered = { rules: [], categories: a.categories.map(cat => ({ name: cat.name, id: cat.id })), version: 3 as const }
  assert.equal((await compareArchives(ordered, first, base)).action, 'same')
})

test('sync pull atomically saves the previous device archive and guards both snapshots', async () => {
  await replaceTree(a)
  let remote: SyncSnapshot = { revision: '2', state: b }
  const preview = await compareArchives(a, remote, null)
  const ports = {
    getLocal: loadTree, getRemote: async () => remote, replaceLocal: replaceFromSync,
    putRemote: async (): Promise<string> => { throw new Error('unexpected upload') },
  }
  remote = { revision: '3', state: c }
  await assert.rejects(applySync(preview, 'download', ports, true), /云端.*变化/)
  assert.equal(await loadSyncRecovery(), undefined)
  remote = preview.remote!
  await replaceTree(c)
  await assert.rejects(applySync(preview, 'download', ports, true), /本机档案已更新/)
  assert.equal(await loadSyncRecovery(), undefined)
  await replaceTree(a)
  const base = await applySync(preview, 'download', ports, true)
  assert.deepEqual(await loadTree(), b)
  assert.deepEqual((await loadSyncRecovery())?.state, a)
  assert.equal(base.digest, await archiveDigest(b))
  assert.equal(base.revision, '2')
  await replaceFromSync(a, b)
  assert.deepEqual(await loadTree(), a)
  assert.deepEqual((await loadSyncRecovery())?.state, b)
})

test('sync upload sends the reviewed revision and preserves edits made while upload is running', async () => {
  let local = b
  const preview = await compareArchives(b, first, null)
  let calls = 0
  const ports = {
    getLocal: async () => local,
    getRemote: async () => first,
    putRemote: async (value: TreeState, expected: string | null) => {
      assert.equal(expected, '1')
      assert.deepEqual(value, b)
      calls++
      local = c
      return '2'
    },
    replaceLocal: async () => { throw new Error('unexpected overwrite') },
  }
  local = c
  await assert.rejects(applySync(preview, 'upload', ports, true), /手机档案已变化/)
  assert.equal(calls, 0)
  local = b
  const base = await applySync(preview, 'upload', ports, true)
  assert.equal(calls, 1)
  assert.deepEqual(local, c)
  assert.equal((await compareArchives(local, { revision: '2', state: b }, base)).action, 'upload')
  await assert.rejects(applySync(await compareArchives(c, null, null), 'upload', {
    ...ports, putRemote: async (_, expected) => { assert.equal(expected, null); throw new Error('conflict') },
  }, true), /conflict/)
})
