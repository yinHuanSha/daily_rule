import assert from 'node:assert/strict'
import test from 'node:test'
import { addToTree, emptyState, hasQuota, localDay, parseBackup, pruneBranch, subtreeIds } from '../src/model.ts'
import type { RuleInput, TreeState } from '../src/model.ts'

function input(title: string, parentId: string | null = null): RuleInput {
  return { title, trigger: '进门后', action: '把手机放在玄关', badge: 'standard', parentId }
}

function tree(): TreeState {
  const branches = [
    ['B', null], ['C', 'B'], ['D', 'B'], ['E', 'B'],
    ['F', 'C'], ['G', 'D'], ['H', 'F'],
  ] as const
  return branches.reduce((state, [id, parent], index) =>
    addToTree(state, input(id, parent), new Date(2026, 5, index + 1), id), emptyState())
}

test('quota follows local midnight and remembers archived additions', () => {
  const night = new Date(2026, 10, 18, 23, 59, 59)
  const morning = new Date(2026, 10, 19, 0, 0, 0)
  const initial = addToTree(emptyState(), input('A'), night, 'a')
  const archived = pruneBranch(initial, 'a', night)
  assert.equal(localDay(night), '2026-11-18')
  assert.equal(localDay(morning), '2026-11-19')
  assert.equal(hasQuota(archived, night), false)
  assert.throws(() => addToTree(archived, input('B'), night, 'b'), /今天/)
  assert.equal(hasQuota(archived, morning), true)
  assert.equal(addToTree(archived, input('B'), morning, 'b').rules[1].day, '2026-11-19')
})

test('C breach archives only C/F/H and retry under E creates a single new leaf', () => {
  const original = tree()
  const after = pruneBranch(original, 'C', new Date(2026, 5, 8), ['C', 'F', 'H'])
  assert.deepEqual(subtreeIds(original, 'C'), ['C', 'F', 'H'])
  assert.deepEqual(after.rules.filter(rule => !rule.archivedAt).map(rule => rule.id), ['B', 'D', 'E', 'G'])
  const withdrawn = after.rules.filter(rule => rule.archivedAt)
  assert.deepEqual(withdrawn.map(rule => rule.cause), ['breach', 'ancestor', 'ancestor'])
  assert.equal(new Set(withdrawn.map(rule => rule.incidentId)).size, 1)
  const retryDate = new Date(2026, 5, 9)
  const retried = addToTree(after, { ...input('C', 'E'), retryOf: 'C' }, retryDate, 'C2')
  assert.equal(hasQuota(retried, retryDate), false)
  assert.deepEqual(subtreeIds(retried, 'E'), ['E', 'C2'])
  assert.equal(retried.rules.find(rule => rule.id === 'C2')?.retryOf, 'C')
  assert.deepEqual(parseBackup(JSON.stringify(retried)), retried)
})

test('later pruning an ancestor preserves previous incidents', () => {
  const first = pruneBranch(tree(), 'F', new Date(2026, 5, 8))
  const second = pruneBranch(first, 'C', new Date(2026, 5, 9))
  assert.equal(second.rules.find(rule => rule.id === 'H')?.incidentId, first.rules.find(rule => rule.id === 'F')?.incidentId)
  assert.notEqual(second.rules.find(rule => rule.id === 'H')?.incidentId, second.rules.find(rule => rule.id === 'C')?.incidentId)
  assert.deepEqual(parseBackup(JSON.stringify(second)), second)
})

test('stale previews, stale parent and retry sources cannot create unintended changes', () => {
  const original = tree()
  const when = new Date(2026, 5, 8)
  assert.throws(() => pruneBranch(original, 'C', when, ['C', 'F']), /分支已有变化/)
  const after = pruneBranch(original, 'C', when)
  assert.throws(() => pruneBranch(after, 'C', when), /已退出/)
  assert.throws(() => addToTree(after, input('新国策', 'C'), when, 'q'), /上级/)
  assert.throws(() => addToTree(after, { ...input('重试'), retryOf: 'D' }, when, 'r'), /重试记录/)
  assert.throws(() => addToTree(after, { ...input('新国策'), trigger: ' ' }, when, 'q'), /填写/)
  assert.throws(() => addToTree(after, input('新国策'), when, 'B'), /编号重复/)
})

test('version, structure, local dates, daily quota and graph consistency are checked on import', () => {
  assert.deepEqual(parseBackup(JSON.stringify(emptyState())), emptyState())
  assert.throws(() => parseBackup('{'), /JSON/)
  assert.throws(() => parseBackup('{"version":2,"rules":[]}'), /版本/)
  assert.throws(() => parseBackup('{"version":1,"rules":[{"id":"x"}]}'), /字段/)
  const original = tree()
  const invalid = (change: (state: TreeState) => void) => {
    const copy = structuredClone(original)
    change(copy)
    assert.throws(() => parseBackup(JSON.stringify(copy)))
  }
  invalid(copy => { copy.rules[1].id = 'B' })
  invalid(copy => { copy.rules[1].parentId = 'missing' })
  invalid(copy => { copy.rules[0].parentId = 'F' })
  invalid(copy => { copy.rules[0].day = '2026-02-31' })
  invalid(copy => { copy.rules[1].day = copy.rules[0].day })
  invalid(copy => { copy.rules[0].retryOf = 'unknown' })
  invalid(copy => { copy.rules[1].cause = 'breach' })
  const archived = pruneBranch(original, 'C', new Date(2026, 5, 8))
  const child = archived.rules.find(rule => rule.id === 'F')!
  child.incidentId = 'missing'
  assert.throws(() => parseBackup(JSON.stringify(archived)), /剪枝记录/)
})
