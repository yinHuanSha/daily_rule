import assert from 'node:assert/strict'
import test from 'node:test'
import { addToTree, addTreeCategory, emptyState, hasQuota, localDay, moveTreeBranchCategory, parseBackup, pruneBranch, removeTreeCategory, renameTreeCategory, subtreeIds, updateReview } from '../src/model.ts'
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
  assert.throws(() => parseBackup('{"version":4,"rules":[]}'), /版本/)
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

test('children inherit a category, explicit mismatches and missing categories are rejected', () => {
  const start = emptyState()
  const root = addToTree(start, { ...input('根'), categoryId: 'study' }, new Date(2026, 0, 1), 'a')
  const tomorrow = new Date(2026, 0, 2)
  const child = input('子国策', 'a')
  assert.equal(addToTree(root, child, tomorrow, 'b').rules[1].categoryId, 'study')
  assert.equal(addToTree(root, { ...child, categoryId: 'study' }, tomorrow, 'b').rules[1].categoryId, 'study')
  assert.throws(() => addToTree(root, { ...child, categoryId: null }, tomorrow, 'b'), /须沿用/)
  assert.throws(() => addToTree(root, { ...child, categoryId: 'life' }, tomorrow, 'b'), /须沿用/)
  assert.throws(() => addToTree(root, { ...input('根'), categoryId: 'missing' }, tomorrow, 'z'), /类别/)
  assert.equal(addToTree(root, input('根'), tomorrow, 'z').rules[1].categoryId, null)
  assert.throws(() => addToTree(root, { ...input('另一分类'), categoryId: 'work' }, new Date(2026, 0, 1), 'x'), /今天已新增/)
})

test('moving a root includes archived descendants and preserves a separate retry branch', () => {
  const first = pruneBranch(tree(), 'C', new Date(2026, 5, 8))
  const next = addToTree(first, { ...input('C'), categoryId: 'life', retryOf: 'C' }, new Date(2026, 5, 9), 'retry')
  const moved = moveTreeBranchCategory(next, 'B', 'work')
  assert.ok(moved.rules.filter(rule => rule.id !== 'retry').every(rule => rule.categoryId === 'work'))
  assert.equal(moved.rules.find(rule => rule.id === 'retry')?.categoryId, 'life')
  assert.throws(() => moveTreeBranchCategory(next, 'D', 'work'), /顶层/)
  assert.throws(() => moveTreeBranchCategory(next, 'C', 'life'), /顶层/)
  assert.throws(() => moveTreeBranchCategory(moved, 'B', 'unknown'), /类别/)
  const removed = removeTreeCategory(moved, 'work')
  assert.ok(removed.rules.filter(rule => rule.id !== 'retry').every(rule => rule.categoryId === null))
  assert.deepEqual(removed.rules.map(({categoryId, ...rule}) => rule), next.rules.map(({categoryId, ...rule}) => rule))
  assert.equal(removed.categories.some(category => category.id === 'work'), false)
  assert.deepEqual(parseBackup(JSON.stringify(removed)), removed)
})

test('names are trimmed, unique, and reserve the display name for uncategorized rules', () => {
  const added = addTreeCategory(emptyState(), 'x', '  Project  ')
  assert.equal(added.categories.at(-1)?.name, 'Project')
  assert.throws(() => addTreeCategory(added, 'y', 'ＰＲＯＪＥＣＴ'), /同名/)
  assert.throws(() => renameTreeCategory(added, 'x', '生活国策 '), /同名/)
  assert.throws(() => renameTreeCategory(added, 'x', '　'), /名称/)
  assert.throws(() => renameTreeCategory(added, 'x', '未分类'), /保留/)
  assert.throws(() => renameTreeCategory(added, 'missing', '新名'), /不存在/)
  assert.equal(renameTreeCategory(added, 'x', '新名').categories.at(-1)?.id, 'x')
})

test('v1 migrates every rule without guessing its category; v2 migrates with empty categories', () => {
  const first = pruneBranch(tree(), 'C', new Date(2026, 5, 8))
  const next = addToTree(first, { ...input('C', 'E'), retryOf: 'C' }, new Date(2026, 5, 9), 'retry')
  const legacy = { version: 1, rules: next.rules.map(({categoryId, ...rule}) => rule) }
  const migrated = parseBackup(JSON.stringify(legacy))
  assert.deepEqual(migrated, next)
  const noCategories = { ...migrated, categories: [] }
  assert.deepEqual(parseBackup(JSON.stringify({...noCategories, version: 2})), noCategories)
})

test('v2 rejects malformed category definitions and category assignments, including history', () => {
  const records = pruneBranch(tree(), 'C', new Date(2026, 5, 8))
  const serialize = (categories: unknown, rules: unknown = records.rules) => JSON.stringify({ version: 2, categories, rules })
  for (const categories of [
    undefined, {}, [{id: '', name: '数据'}], [{id:'x', name:' '}], [{id:'y', name:'未分类'}],
    [{id:'x', name:'A'}, {id:'x', name:'B'}], [{id:'x', name:'B'}, {id:'y', name:' b '}],
  ]) assert.throws(() => parseBackup(serialize(categories)), /类别|名称/)
  for (const categoryId of ['missing', undefined]) {
    const rules = records.rules.map(rule => ({...rule, categoryId}))
    assert.throws(() => parseBackup(serialize(records.categories, rules)), /类别/)
  }
  const detached = records.rules.map(rule => rule.id === 'F' ? {...rule, categoryId:'work'} : rule)
  assert.throws(() => parseBackup(serialize(records.categories, detached)), /类别不一致/)
})


test('a breach stores one trimmed review and keeps it attached to its original incident', () => {
  const day = new Date(2026, 5, 10)
  const note = { reason: ' 太晚了 ', improvement: '  ' }
  const marked = pruneBranch(tree(), 'C', day, undefined, note)
  const root = marked.rules.find(rule => rule.id === 'C')!
  assert.deepEqual(root.review, { reason: '太晚了', improvement: '' })
  assert.equal(marked.rules.find(rule => rule.id === 'H')?.incidentId, 'C')
  assert.equal(marked.rules.filter(rule => rule.review).length, 1)
  assert.throws(() => updateReview(marked, 'H', note), /主动失守/)
  assert.throws(() => updateReview(marked, 'B', note), /主动失守/)
  const edited = updateReview(marked, 'C', { reason: '', improvement: ' 提早开始 ' }, root.review)
  const outer = pruneBranch(edited, 'B', day, undefined, { reason: ' ', improvement: '' })
  const restored = parseBackup(JSON.stringify(outer))
  assert.deepEqual(restored, outer)
  const saved = restored.rules.find(rule => rule.id === 'C')!.review!
  assert.deepEqual(saved, {reason: '', improvement: '提早开始'})
  const cleared = updateReview(restored, 'C', { reason: '', improvement: ' ' }, saved)
  assert.ok(cleared.rules.every(rule => !('review' in rule)))
  const retry = addToTree(edited, {...input('重试'), retryOf:'C'}, day, 'again')
  assert.equal(retry.rules.at(-1)?.review, undefined)
})

test('backups with invalid review fields or a review on an active or inherited node are rejected', () => {
  const state = pruneBranch(tree(), 'C', new Date(2026, 5, 10))
  const withReview = (id: string, review: unknown) => JSON.stringify({ ...state, rules: state.rules.map(rule => rule.id === id ? {...rule, review} : rule) })
  for (const id of ['B', 'F']) assert.throws(() => parseBackup(withReview(id, {reason:'原因', improvement:''})), /仅主动失守/)
  for (const invalid of [null, 'legacy text', {reason: true, improvement:''}, {reason:'原因'}]) {
    assert.throws(() => parseBackup(withReview('C', invalid)), /文本/)
  }
})
