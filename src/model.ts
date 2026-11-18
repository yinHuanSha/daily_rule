export type Badge = 'standard' | 'sun' | 'moon' | 'book' | 'leaf' | 'shield'

export interface Category {
  id: string
  name: string
}

export interface RuleInput {
  parentId: string | null
  categoryId?: string | null
  title: string
  trigger: string
  action: string
  badge: Badge
  retryOf?: string | null
}

export interface Rule extends RuleInput {
  id: string
  categoryId: string | null
  createdAt: string
  day: string
  archivedAt: string | null
  cause: 'breach' | 'ancestor' | null
  incidentId: string | null
  retryOf: string | null
}

export interface TreeState {
  version: 2
  categories: Category[]
  rules: Rule[]
}

export function emptyState(): TreeState {
  return {
    version: 2,
    categories: [
      { id: 'life', name: '生活国策' },
      { id: 'study', name: '学习国策' },
      { id: 'work', name: '工作国策' },
    ],
    rules: [],
  }
}

export function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function hasQuota(state: TreeState, now = new Date()): boolean {
  const today = localDay(now)
  return !state.rules.some(rule => rule.day === today)
}

const badges = new Set<Badge>(['standard', 'sun', 'moon', 'book', 'leaf', 'shield'])

export function addToTree(state: TreeState, input: RuleInput, now: Date, id: string): TreeState {
  if (!hasQuota(state, now)) throw new Error('今天已新增过国策，明天可以再加。')
  const title = input.title.trim()
  const trigger = input.trigger.trim()
  const action = input.action.trim()
  if (!title || !trigger || !action) throw new Error('请填写国策名称、触发时机和具体行动。')
  if (!badges.has(input.badge)) throw new Error('请选择有效的徽章。')
  if (state.rules.some(rule => rule.id === id)) throw new Error('国策编号重复，请重试。')
  const parent = input.parentId === null ? undefined : state.rules.find(rule => rule.id === input.parentId)
  if (input.parentId !== null && (!parent || parent.archivedAt)) {
    throw new Error('选中的上级国策已失效，请重新选择。')
  }
  if (parent && input.categoryId !== undefined && input.categoryId !== parent.categoryId) {
    throw new Error('子国策须沿用上级国策的类别，请重新确认。')
  }
  const categoryId = parent ? parent.categoryId : input.categoryId ?? null
  requireCategory(state, categoryId)
  const retryOf = input.retryOf ?? null
  if (retryOf !== null && !state.rules.some(rule => rule.id === retryOf && rule.archivedAt)) {
    throw new Error('所选的重试记录已失效。')
  }
  const rule: Rule = {
    id, parentId: input.parentId, categoryId, title, trigger, action, badge: input.badge,
    createdAt: now.toISOString(), day: localDay(now), archivedAt: null,
    cause: null, incidentId: null, retryOf,
  }
  return { ...state, rules: [...state.rules, rule] }
}

export function subtreeIds(state: TreeState, rootId: string, includeArchived = false): string[] {
  if (!state.rules.some(rule => rule.id === rootId && (includeArchived || !rule.archivedAt))) return []
  const children = new Map<string, string[]>()
  for (const rule of state.rules) {
    if ((!includeArchived && rule.archivedAt) || rule.parentId === null) continue
    const siblings = children.get(rule.parentId)
    if (siblings) siblings.push(rule.id)
    else children.set(rule.parentId, [rule.id])
  }
  const ids = [rootId]
  for (let index = 0; index < ids.length; index++) {
    for (const child of children.get(ids[index]) ?? []) ids.push(child)
  }
  return ids
}

export function pruneBranch(state: TreeState, rootId: string, now: Date, expectedIds?: readonly string[]): TreeState {
  const affected = new Set(subtreeIds(state, rootId))
  if (!affected.size) throw new Error('这项国策已退出当前树。')
  if (expectedIds && (affected.size !== expectedIds.length || expectedIds.some(id => !affected.has(id)))) {
    throw new Error('这条分支已有变化，请重新查看受影响的国策后再确认。')
  }
  const archivedAt = now.toISOString()
  return {
    ...state,
    rules: state.rules.map(rule => affected.has(rule.id)
      ? { ...rule, archivedAt, incidentId: rootId, cause: rule.id === rootId ? 'breach' : 'ancestor' }
      : rule),
  }
}

function requireCategory(state: TreeState, categoryId: string | null): void {
  if (categoryId !== null && !state.categories.some(category => category.id === categoryId)) {
    throw new Error('所选类别已不存在，请重新选择。')
  }
}

function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase()
}

function categoryName(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请填写类别名称。')
  const name = input.trim()
  if (nameKey(name) === '未分类') throw new Error('“未分类”是系统保留的名称。')
  return name
}

function uniqueName(categories: Category[], input: string, exceptId?: string): string {
  const name = categoryName(input)
  const key = nameKey(name)
  if (categories.some(category => category.id !== exceptId && nameKey(category.name) === key)) {
    throw new Error('已存在同名类别。')
  }
  return name
}

export function addTreeCategory(state: TreeState, id: string, name: string): TreeState {
  if (state.categories.some(category => category.id === id)) throw new Error('类别编号重复，请重试。')
  const category = { id, name: uniqueName(state.categories, name) }
  return { ...state, categories: [...state.categories, category] }
}

export function renameTreeCategory(state: TreeState, id: string, name: string): TreeState {
  requireCategory(state, id)
  const validName = uniqueName(state.categories, name, id)
  return { ...state, categories: state.categories.map(category => category.id === id ? {id, name:validName} : category) }
}

export function removeTreeCategory(state: TreeState, id: string): TreeState {
  requireCategory(state, id)
  return {
    ...state,
    categories: state.categories.filter(category => category.id !== id),
    rules: state.rules.map(rule => rule.categoryId === id ? { ...rule, categoryId: null } : rule),
  }
}

export function moveTreeBranchCategory(state: TreeState, rootId: string, categoryId: string | null): TreeState {
  const root = state.rules.find(rule => rule.id === rootId)
  if (!root || root.archivedAt || root.parentId !== null) throw new Error('仅可从生效中的顶层国策移动整个分支。')
  requireCategory(state, categoryId)
  const affected = new Set(subtreeIds(state, rootId, true))
  return { ...state, rules: state.rules.map(rule => affected.has(rule.id) ? { ...rule, categoryId } : rule) }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isTimestamp(value + 'T00:00:00.000Z')
}

function readRule(value: unknown, legacy: boolean): Rule {
  if (!isObject(value)
    || !isText(value.id) || !(value.parentId === null || isText(value.parentId))
    || !isText(value.title) || !isText(value.trigger) || !isText(value.action)
    || !badges.has(value.badge as Badge) || !isTimestamp(value.createdAt) || !isDay(value.day)
    || !(value.retryOf === null || isText(value.retryOf))
    || !(value.archivedAt === null || isTimestamp(value.archivedAt))
    || !(value.cause === null || value.cause === 'breach' || value.cause === 'ancestor')
    || !(value.incidentId === null || isText(value.incidentId))) {
    throw new Error('备份中的国策字段不完整或格式有误。')
  }
  const categoryId = legacy ? null : value.categoryId
  if (!(categoryId === null || isText(categoryId))) throw new Error('备份中的国策缺少有效的类别字段。')
  if ((value.archivedAt === null) !== (value.cause === null)
    || (value.archivedAt === null) !== (value.incidentId === null)) {
    throw new Error('备份中的国策归档信息不一致。')
  }
  return {
    id: value.id, parentId: value.parentId, categoryId, title: value.title, trigger: value.trigger,
    action: value.action, badge: value.badge as Badge, createdAt: value.createdAt, day: value.day,
    archivedAt: value.archivedAt, cause: value.cause, incidentId: value.incidentId, retryOf: value.retryOf,
  }
}

function validateLinks(rules: Rule[], categories: Category[]): void {
  const byId = new Map(rules.map(rule => [rule.id, rule]))
  const categoryIds = new Set(categories.map(category => category.id))
  if (byId.size !== rules.length) throw new Error('备份中有重复的国策编号。')
  if (new Set(rules.map(rule => rule.day)).size !== rules.length) throw new Error('备份中同一天新增了多项国策。')

  const causes = new Set<string>()
  const dependents = new Map<string, string[]>()
  const remaining = new Map<string, number>()
  const ready: string[] = []
  for (const rule of rules) {
    const parent = rule.parentId === null ? undefined : byId.get(rule.parentId)
    if (rule.categoryId !== null && !categoryIds.has(rule.categoryId)) throw new Error('备份中的国策引用了不存在的类别。')
    if (parent && parent.categoryId !== rule.categoryId) throw new Error('备份中有父子国策的类别不一致。')
    if (rule.parentId !== null && (!parent || (!rule.archivedAt && parent.archivedAt))) {
      throw new Error('备份中的上级国策缺失或已失效。')
    }
    if (rule.retryOf !== null && !byId.get(rule.retryOf)?.archivedAt) throw new Error('备份中的重试来源无效。')
    if (rule.cause === 'ancestor' && (!parent || parent.incidentId !== rule.incidentId || parent.archivedAt !== rule.archivedAt)) {
      throw new Error('随上级撤回的国策缺少对应的剪枝记录。')
    }
    if (rule.cause === 'breach' && rule.incidentId !== null) {
      if (causes.has(rule.incidentId)) throw new Error('一次剪枝只能有一项主动失守的国策。')
      causes.add(rule.incidentId)
    }
    const sources = [rule.parentId, rule.retryOf].filter((id): id is string => id !== null)
    remaining.set(rule.id, sources.length)
    if (!sources.length) ready.push(rule.id)
    for (const source of sources) {
      const list = dependents.get(source)
      if (list) list.push(rule.id)
      else dependents.set(source, [rule.id])
    }
  }
  // A source (parent or retry record) must exist before each dependent can be created.
  for (let index = 0; index < ready.length; index++) {
    for (const id of dependents.get(ready[index]) ?? []) {
      const count = remaining.get(id)! - 1
      remaining.set(id, count)
      if (count === 0) ready.push(id)
    }
  }
  if (ready.length !== rules.length) throw new Error('备份中的国策关系形成了循环。')
}

function readCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) throw new Error('备份中缺少类别列表。')
  const ids = new Set<string>()
  const names = new Set<string>()
  return value.map(entry => {
    if (!isObject(entry) || !isText(entry.id) || !isText(entry.name)) throw new Error('备份中的类别格式有误。')
    const name = categoryName(entry.name)
    const key = nameKey(name)
    if (ids.has(entry.id) || names.has(key)) throw new Error('备份中的类别编号或名称重复。')
    ids.add(entry.id)
    names.add(key)
    return { id:entry.id, name }
  })
}

export function decodeTree(value: unknown): TreeState {
  if (!isObject(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.rules)) {
    throw new Error('不支持的备份格式或版本。')
  }
  const legacy = value.version === 1
  const categories = legacy ? emptyState().categories : readCategories(value.categories)
  const rules = value.rules.map(entry => readRule(entry, legacy))
  validateLinks(rules, categories)
  return { version: 2, categories, rules }
}

export function parseBackup(raw: string): TreeState {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('无法读取 JSON，请选择从 daily_rule 导出的备份。')
  }
  return decodeTree(value)
}
