export type Badge = 'standard' | 'sun' | 'moon' | 'book' | 'leaf' | 'shield'

export interface RuleInput {
  parentId: string | null
  title: string
  trigger: string
  action: string
  badge: Badge
  retryOf?: string | null
}

export interface Rule extends RuleInput {
  id: string
  createdAt: string
  day: string
  archivedAt: string | null
  cause: 'breach' | 'ancestor' | null
  incidentId: string | null
  retryOf: string | null
}

export interface TreeState {
  version: 1
  rules: Rule[]
}

export function emptyState(): TreeState {
  return { version: 1, rules: [] }
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
  if (input.parentId !== null && !state.rules.some(rule => rule.id === input.parentId && !rule.archivedAt)) {
    throw new Error('选中的上级国策已失效，请重新选择。')
  }
  const retryOf = input.retryOf ?? null
  if (retryOf !== null && !state.rules.some(rule => rule.id === retryOf && rule.archivedAt)) {
    throw new Error('所选的重试记录已失效。')
  }
  const rule: Rule = {
    id, parentId: input.parentId, title, trigger, action, badge: input.badge,
    createdAt: now.toISOString(), day: localDay(now), archivedAt: null,
    cause: null, incidentId: null, retryOf,
  }
  return { version: 1, rules: [...state.rules, rule] }
}

export function subtreeIds(state: TreeState, rootId: string): string[] {
  if (!state.rules.some(rule => rule.id === rootId && !rule.archivedAt)) return []
  const children = new Map<string, string[]>()
  for (const rule of state.rules) {
    if (rule.archivedAt || rule.parentId === null) continue
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
    version: 1,
    rules: state.rules.map(rule => affected.has(rule.id)
      ? { ...rule, archivedAt, incidentId: rootId, cause: rule.id === rootId ? 'breach' : 'ancestor' }
      : rule),
  }
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

function readRule(value: unknown): Rule {
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
  if ((value.archivedAt === null) !== (value.cause === null)
    || (value.archivedAt === null) !== (value.incidentId === null)) {
    throw new Error('备份中的国策归档信息不一致。')
  }
  return {
    id: value.id, parentId: value.parentId, title: value.title, trigger: value.trigger,
    action: value.action, badge: value.badge as Badge, createdAt: value.createdAt, day: value.day,
    archivedAt: value.archivedAt, cause: value.cause, incidentId: value.incidentId, retryOf: value.retryOf,
  }
}

function validateLinks(rules: Rule[]): void {
  const byId = new Map(rules.map(rule => [rule.id, rule]))
  if (byId.size !== rules.length) throw new Error('备份中有重复的国策编号。')
  if (new Set(rules.map(rule => rule.day)).size !== rules.length) throw new Error('备份中同一天新增了多项国策。')

  const causes = new Set<string>()
  const dependents = new Map<string, string[]>()
  const remaining = new Map<string, number>()
  const ready: string[] = []
  for (const rule of rules) {
    const parent = rule.parentId === null ? undefined : byId.get(rule.parentId)
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

export function parseBackup(raw: string): TreeState {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('无法读取 JSON，请选择从 daily_rule 导出的备份。')
  }
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.rules)) {
    throw new Error('不支持的备份格式或版本。')
  }
  const rules = value.rules.map(readRule)
  validateLinks(rules)
  return { version: 1, rules }
}
