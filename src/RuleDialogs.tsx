import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, ChevronRight, Flag, GitBranch, Scissors, ShieldAlert, X } from 'lucide-react'
import { Emblem } from './Emblem'
import type { Badge, Rule, RuleInput } from './model'

export function Dialog({
  title,
  children,
  onClose,
  variant = '',
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  variant?: string
  busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current!
    el.showModal()
    return () => el.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={'dialog ' + variant}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy) onClose()
      }}
    >
      <div className="dialog-content">
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose} disabled={busy}>
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}

const badgeNames: Record<Badge, string> = {
  standard: '旗帜',
  sun: '旭日',
  moon: '新月',
  book: '书卷',
  leaf: '新叶',
  shield: '盾牌',
}

export function RuleForm({
  active,
  parentId,
  retry,
  onClose,
  onSave,
}: {
  active: Rule[]
  parentId: string | null
  retry?: Rule
  onClose: () => void
  onSave: (input: RuleInput) => Promise<void>
}) {
  const [badge, setBadge] = useState<Badge>(retry?.badge ?? 'standard')
  const [selectedParent, setSelectedParent] = useState<string | null>(parentId)
  const parentMissing = selectedParent !== null && !active.some((rule) => rule.id === selectedParent)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || parentMissing) return
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      await onSave({
        title: String(data.get('title')),
        trigger: String(data.get('trigger')),
        action: String(data.get('action')),
        parentId: selectedParent,
        retryOf: retry?.id ?? null,
        badge,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '国策未保存，请重试。')
      setPending(false)
    }
  }
  return (
    <Dialog
      title={retry ? '重新尝试国策' : parentId ? '添加子国策' : '新建分支'}
      onClose={onClose}
      busy={pending}
    >
      <form className="rule-form" onSubmit={submit}>
        <label>
          国策名称
          <input
            name="title"
            required
            maxLength={64}
            defaultValue={retry?.title}
            placeholder="例如：无屏就寝"
            autoFocus
          />
        </label>
        <div className="form-pair">
          <label>
            触发时机
            <textarea
              name="trigger"
              required
              rows={2}
              maxLength={600}
              defaultValue={retry?.trigger}
              placeholder="例如：晚上走进卧室前"
            />
          </label>
          <label>
            具体行动
            <textarea
              name="action"
              required
              rows={2}
              maxLength={600}
              defaultValue={retry?.action}
              placeholder="例如：把手机留在客厅充电"
            />
          </label>
        </div>
        <label>
          上级国策
          <select
            name="parent"
            value={selectedParent ?? ''}
            onChange={(e) => setSelectedParent(e.target.value || null)}
          >
            <option value="">独立分支</option>
            {parentMissing && (
              <option value={selectedParent!} disabled>
                原上级已退出当前树
              </option>
            )}
            {active.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.title}
              </option>
            ))}
          </select>
        </label>
        {parentMissing && (
          <p className="error" role="alert">
            原上级国策已退出当前树，请重新选择上级，或选择独立分支。
          </p>
        )}
        <fieldset className="badge-picker">
          <legend>选择徽章</legend>
          {(Object.keys(badgeNames) as Badge[]).map((key) => (
            <label key={key} title={badgeNames[key]}>
              <input
                type="radio"
                name="badge"
                checked={badge === key}
                onChange={() => setBadge(key)}
                aria-label={badgeNames[key]}
              />
              <span>
                <Emblem badge={key} size={33} />
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <small>建立后将使用今日名额</small>
          <button className="button primary" disabled={pending || parentMissing}>
            <Flag size={15} />
            建立国策
          </button>
        </footer>
      </form>
    </Dialog>
  )
}

export function Detail({
  rule,
  parent,
  childrenCount,
  available,
  demo,
  onClose,
  onAdd,
  onBreach,
}: {
  rule: Rule
  parent?: Rule
  childrenCount: number
  available: boolean
  demo: boolean
  onClose: () => void
  onAdd: () => void
  onBreach: () => void
}) {
  return (
    <Dialog title={demo ? '示例国策详情' : '国策详情'} onClose={onClose} variant="drawer">
      <div className="detail-body">
        <div className="detail-emblem">
          <Emblem badge={rule.badge} size={80} />
        </div>
        <div className="detail-status">
          <span className="status-dot" />
          {demo ? '示例推演' : '生效中'}
        </div>
        <h3>{rule.title}</h3>
        <div className="parent-line">
          <GitBranch size={15} />
          {parent ? parent.title : '独立分支'}
          <ChevronRight size={13} />
          {rule.title}
        </div>
        <dl className="details">
          <dt>触发时机</dt>
          <dd>{rule.trigger}</dd>
          <dt>具体行动</dt>
          <dd>{rule.action}</dd>
        </dl>
        <div className="detail-meta">
          <span>直属子国策</span>
          <b>{childrenCount} 项</b>
        </div>
        {!demo && (
          <div className="detail-meta">
            <span>建立日期</span>
            <b>{rule.day}</b>
          </div>
        )}
        {!demo && (
          <div className="detail-actions">
            <button className="button primary" onClick={onAdd} disabled={!available}>
              <GitBranch size={16} />
              添加子国策
            </button>
            {!available && <small>今日新增名额已用完</small>}
            <button className="button danger-light" onClick={onBreach}>
              <Scissors size={16} />
              记录失守
            </button>
          </div>
        )}
        {demo && (
          <button className="button secondary wide" onClick={onClose}>
            返回示例图
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </Dialog>
  )
}

export function PruneDialog({
  rules,
  onClose,
  onConfirm,
}: {
  rules: Rule[]
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog title="确认剪枝范围" onClose={onClose} busy={busy} variant="prune-dialog">
      <div className="dialog-section">
        <p className="warning">
          <ShieldAlert size={20} />
          本次将撤回 {rules.length} 项国策
        </p>
        <ul className="impact-list">
          {rules.map((rule, i) => (
            <li key={rule.id}>
              <span>{rule.title}</span>
              <small>{i ? '随父节点撤回' : '主动报告失守'}</small>
            </li>
          ))}
        </ul>
        <p className="muted">撤回记录会保存在历史档案中。</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button className="button secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onConfirm()
              } catch (err) {
                setError(err instanceof Error ? err.message : '未能保存')
                setBusy(false)
              }
            }}
          >
            <Scissors size={15} />
            确认撤回
          </button>
        </footer>
      </div>
    </Dialog>
  )
}
