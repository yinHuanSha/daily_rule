import { useRef, useState } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Check,
  Database,
  Flag,
  GitBranch,
  RotateCcw,
  Scissors,
  Sprout,
} from 'lucide-react'
import { Emblem } from './Emblem'
import { Dialog } from './RuleDialogs'
import { localDay, parseBackup } from './model'
import type { Rule, TreeState } from './model'
import { BackupConflict, loadTree, replaceTree } from './storage'

export function History({
  rules,
  available,
  onRetry,
}: {
  rules: Rule[]
  available: boolean
  onRetry: (rule: Rule) => void
}) {
  const archived = rules
    .filter((rule) => rule.archivedAt)
    .sort((a, b) => b.archivedAt!.localeCompare(a.archivedAt!))
  return (
    <section className="section-card">
      <header className="section-header">
        <h2>
          <Archive />
          撤回记录
        </h2>
        <span className="section-count">{archived.length} 项</span>
      </header>
      {archived.length === 0 ? (
        <div className="page-empty">
          <Archive />
          <h3>暂无撤回记录</h3>
          <p>报告失守后，可在这里查看受影响的国策并重新尝试。</p>
        </div>
      ) : (
        <ul className="history-list">
          {archived.map((rule) => (
            <li key={rule.id}>
              <Emblem badge={rule.badge} size={49} />
              <div className="history-text">
                <h3>{rule.title}</h3>
                <p>
                  {rule.trigger} · {rule.action}
                </p>
                <div className="archive-meta">
                  <span className={rule.cause === 'breach' ? 'breach-type' : ''}>
                    {rule.cause === 'breach' ? '主动报告失守' : '随父节点撤回'}
                  </span>
                  <time>{new Date(rule.archivedAt!).toLocaleDateString('zh-CN')}</time>
                </div>
              </div>
              <button
                className="button secondary"
                disabled={!available}
                title={available ? '重试这一项国策' : '今日名额已用完'}
                onClick={() => onRetry(rule)}
              >
                <RotateCcw size={14} />
                重试
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Backups({
  state,
  notify,
  afterImport,
}: {
  state: TreeState
  notify: (msg: string) => void
  afterImport: () => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ incoming: TreeState; current: TreeState } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function exportFile() {
    try {
      const tree = await loadTree()
      const url = URL.createObjectURL(new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'daily-rule-backup-' + localDay() + '.json'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setError('')
      notify('已生成 JSON 备份')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    }
  }
  return (
    <>
      <div className="local-summary">
        <Database size={22} />
        <div>
          <h3>此设备的国策档案</h3>
          <p>
            {state.rules.filter((r) => !r.archivedAt).length} 项生效 ·{' '}
            {state.rules.filter((r) => r.archivedAt).length} 项归档
          </p>
        </div>
      </div>
      <div className="backup-grid">
        <section className="action-card">
          <div className="action-icon">
            <ArrowDownToLine />
          </div>
          <h2>导出备份</h2>
          <p>把整棵树、撤回历史和每日名额记录保存为 JSON 文件。</p>
          <button className="button primary" onClick={exportFile}>
            <ArrowDownToLine size={16} />
            导出备份
          </button>
        </section>
        <section className="action-card">
          <div className="action-icon">
            <ArrowUpFromLine />
          </div>
          <h2>导入备份</h2>
          <p>从备份恢复或迁移到此设备。先检查文件，再确认替换本机档案。</p>
          <button className="button secondary" disabled={busy} onClick={() => input.current?.click()}>
            <ArrowUpFromLine size={16} />
            选择备份文件
          </button>
          <input
            ref={input}
            type="file"
            aria-label="备份文件"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (!file) return
              setBusy(true)
              try {
                const incoming = parseBackup(await file.text())
                setPreview({ incoming, current: await loadTree() })
                setError('')
              } catch (err) {
                setError(err instanceof Error ? err.message : '读取文件失败')
              } finally {
                setBusy(false)
              }
            }}
          />
        </section>
      </div>
      {error && !preview && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <Dialog
          title="导入备份到此设备"
          busy={busy}
          onClose={() => {
            setPreview(null)
            setError('')
          }}
        >
          <div className="dialog-section">
            <p>
              本机现有 <b>{preview.current.rules.filter((r) => !r.archivedAt).length}</b> 项生效国策和{' '}
              <b>{preview.current.rules.filter((r) => r.archivedAt).length}</b> 项归档记录。
            </p>
            <p>
              备份包含 <b>{preview.incoming.rules.filter((r) => !r.archivedAt).length}</b> 项生效国策和{' '}
              <b>{preview.incoming.rules.filter((r) => r.archivedAt).length}</b>{' '}
              项归档记录。确认后将替换此设备的全部国策数据与名额记录。
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="dialog-footer">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null)
                  setError('')
                }}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await replaceTree(preview.incoming, preview.current)
                    await afterImport()
                    setPreview(null)
                    notify('国策档案已恢复')
                  } catch (err) {
                    if (err instanceof BackupConflict) setPreview({ ...preview, current: err.current })
                    setError(err instanceof Error ? err.message : '导入失败')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Check size={16} />
                确认导入
              </button>
            </footer>
          </div>
        </Dialog>
      )}
    </>
  )
}

const chapters = [
  {
    icon: Sprout,
    title: '把干预放在更早的时刻',
    text: '找出容易重复出现的困境，向前找到自己还能改变的动作。写下触发时机，再写具体行动。例如，晚上进卧室前，把手机留在客厅。',
  },
  {
    icon: Flag,
    title: '每天最多建立一项',
    text: '可以从空白处开辟独立分支，也可以把新国策挂在相关节点下。按设备本地自然日计算名额，当天只看树也可以。',
  },
  {
    icon: Scissors,
    title: '失守时撤回整条分支',
    text: '国策加入后持续生效。自己确认违反时，在详情里记录失守。该节点及其全部后代一起撤回，祖先和旁支继续生效。',
  },
  {
    icon: GitBranch,
    title: '允许从另一条路径重试',
    text: '在历史档案中选中一项国策，让它以新节点的身份重新加入。每次重试只带回这一项，占用当天的新增名额。',
  },
]

export function Guide() {
  return (
    <section className="section-card">
      <header className="section-header">
        <h2>
          <BookOpen />
          国策树的四条规则
        </h2>
      </header>
      <div className="guide-list">
        {chapters.map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <div className="action-icon">
              <Icon size={21} />
            </div>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
      <footer className="guide-source">
        规则依据 · edmond《如何提高自制力？》第 23–27 页，递归稳态迭代协议（RSIP）。
      </footer>
    </section>
  )
}
