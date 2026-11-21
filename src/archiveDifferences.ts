import type { Category, Rule, TreeState } from './model.ts'

interface FieldDifference { label: string; local: string; remote: string }
export interface ArchiveDifference {
  key: string
  kind: '国策' | '类别'
  title: string
  presence: '仅手机有' | '仅云端有' | '内容不同'
  fields: FieldDifference[]
}

const badges: Record<Rule['badge'], string> = { standard: '旗帜', sun: '旭日', moon: '新月', book: '书卷', leaf: '新叶', shield: '盾牌' }
const causes = { breach: '主动失守', ancestor: '随上级撤回' }

const ruleFields = {
  title: '名称', trigger: '触发时机', action: '具体行动', badge: '徽章', categoryId: '类别', parentId: '上级国策',
  createdAt: '建立时间', day: '占用名额日期', archivedAt: '归档时间', cause: '归档原因',
  incidentId: '关联失守国策', retryOf: '重试来源', reason: '失败原因', improvement: '改进计划',
} as const

type RuleField = keyof typeof ruleFields
function value(rule: Rule, field: RuleField) {
  return field === 'reason' || field === 'improvement' ? rule.review?.[field] : rule[field]
}

function namedIds(state: TreeState) {
  return {
    rules: new Map(state.rules.map(r => [r.id, r.title])),
    categories: new Map(state.categories.map(c => [c.id, c.name])),
  }
}

function display(field: RuleField, raw: string | undefined | null, names: ReturnType<typeof namedIds>) {
  if (raw == null || raw === '') return '（无）'
  if (field === 'badge') return badges[raw as Rule['badge']]
  if (field === 'cause') return causes[raw as keyof typeof causes]
  if (['categoryId', 'parentId', 'incidentId', 'retryOf'].includes(field)) {
    const name = (field === 'categoryId' ? names.categories : names.rules).get(raw)
    return name ? `${name}（${raw}）` : raw
  }
  return raw
}

function compareGroup<T extends Rule | Category>(
  kind: ArchiveDifference['kind'], local: T[], remote: T[], name: (record: T) => string,
  compare: (a: T, b: T) => FieldDifference[],
): ArchiveDifference[] {
  const localById = new Map(local.map(item => [item.id, item]))
  const remoteById = new Map(remote.map(item => [item.id, item]))
  const result: ArchiveDifference[] = []
  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const a = localById.get(id), b = remoteById.get(id)
    const fields = a && b ? compare(a, b) : []
    if (a && b && !fields.length) continue
    result.push({ key: kind + id, kind, title: name(a ?? b!), fields, presence: a && b ? '内容不同' : a ? '仅手机有' : '仅云端有' })
  }
  // Changes in membership alone do not reorder the records common to both snapshots.
  const localOrder = local.filter(item => remoteById.has(item.id))
  const remoteOrder = remote.filter(item => localById.has(item.id))
  if (localOrder.some((item, i) => item.id !== remoteOrder[i].id)) {
    result.push({ key: 'order:' + kind, kind, title: '排列顺序', presence: '内容不同', fields: [{
      label: '排列顺序', local: localOrder.map(name).join(' → '), remote: remoteOrder.map(name).join(' → '),
    }] })
  }
  return result
}

export function archiveDifferences(local: TreeState, remote: TreeState): ArchiveDifference[] {
  const localNames = namedIds(local), remoteNames = namedIds(remote)
  return [
    ...compareGroup('类别', local.categories, remote.categories, c => c.name, (a, b) =>
      a.name === b.name ? [] : [{ label: '名称', local: a.name, remote: b.name }]),
    ...compareGroup('国策', local.rules, remote.rules, r => r.title, (a, b) => {
      const changes: FieldDifference[] = []
      for (const field of Object.keys(ruleFields) as RuleField[]) {
        const left = value(a, field), right = value(b, field)
        if ((left ?? '') !== (right ?? '')) changes.push({ label: ruleFields[field],
          local: display(field, left, localNames), remote: display(field, right, remoteNames) })
      }
      return changes
    }),
  ]
}
