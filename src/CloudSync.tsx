import { useEffect, useMemo, useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'
import { Dialog } from './RuleDialogs'
import { archiveDifferences } from './archiveDifferences'
import { readRemote, writeRemote } from './cloudRemote'
import type { CloudConfig } from './cloudRemote'
import type { TreeState } from './model'
import { loadTree, loadSyncRecovery, replaceFromSync } from './storage'
import type { SyncRecovery } from './storage'
import { compareArchives, applySync } from './syncDecision'
import type { SyncCheckpoint, SyncPreview } from './syncDecision'

interface Bridge { getSecret(): string; setSecret(value: string): boolean }
interface Credentials { location: string; token: string }

function androidBridge(): Bridge | undefined {
  const bridge = (window as Window & { DailyRuleAndroid?: Partial<Bridge> }).DailyRuleAndroid
  return typeof bridge?.getSecret === 'function' && typeof bridge?.setSecret === 'function' ? bridge as Bridge : undefined
}

const defaultRepo = 'yinHuanSha/daily_rule_sync'
const checkpointKey = (location: string) => 'daily-rule-cloud-v1:' + location.toLowerCase()

function getCheckpoint(location: string): SyncCheckpoint | null {
  try {
    const saved = JSON.parse(localStorage.getItem(checkpointKey(location)) ?? 'null')
    if (typeof saved?.digest === 'string' && typeof saved.revision === 'string' && typeof saved.at === 'string') return saved
  } catch { /* A missing baseline requires comparing both copies before replacement. */ }
  return null
}

function counts(state: TreeState): string {
  const active = state.rules.filter(rule => !rule.archivedAt).length
  const reviews = state.rules.filter(rule => rule.review).length
  return `${state.categories.length} 个类别 · ${active} 项生效 · ${state.rules.length - active} 项归档 · ${reviews} 份复盘`
}

function ArchiveSummary({ label, state }: { label: string; state: TreeState | undefined }) {
  return <div className="cloud-summary">
    <strong>{label}</strong>
    <p>{state ? counts(state) : '尚无档案'}</p>
    {state && state.rules.length > 0 && <details>
      <summary>查看国策清单</summary>
      <ul>{state.rules.map(rule => <li key={rule.id}>{rule.title} · {rule.archivedAt ? '已归档' : '生效中'}</li>)}</ul>
    </details>}
  </div>
}

function ArchiveDiff({ mobile, cloud }: { mobile: TreeState; cloud: TreeState }) {
  const rows = useMemo(() => archiveDifferences(mobile, cloud), [mobile, cloud])
  const [open, setOpen] = useState(false)
  return <details className="cloud-differences" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>查看两端差异（{rows.length} 项）</summary>
    {open && <ul>{rows.map(row => <li key={row.key}>
      <strong>{row.kind} · {row.title}</strong>　{row.presence}
      {row.fields.map(field => <div className="cloud-field" key={field.label}>
        <b>{field.label}</b>
        <dl><dt>手机</dt><dd>{field.local}</dd><dt>云端</dt><dd>{field.remote}</dd></dl>
      </div>)}
    </li>)}</ul>}
  </details>
}

export function CloudSync({ afterImport }: { afterImport: () => Promise<void> }) {
  const bridge = androidBridge()
  return bridge ? <AndroidSync bridge={bridge} afterImport={afterImport} /> : null
}

function AndroidSync({ bridge, afterImport }: { bridge: Bridge; afterImport: () => Promise<void> }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [checkpoint, setCheckpoint] = useState<SyncCheckpoint | null>(null)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [recovery, setRecovery] = useState<SyncRecovery | undefined>(undefined)
  const [restore, setRestore] = useState<{ backup: SyncRecovery; current: TreeState } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const stored = bridge.getSecret()
      if (stored) {
        const parsed = JSON.parse(stored)
        if (typeof parsed.location !== 'string' || typeof parsed.token !== 'string') throw new Error()
        setCredentials(parsed)
        setCheckpoint(getCheckpoint(parsed.location))
      }
    } catch { setError('读取已保存的同步凭据失败，请重新设置。') }
    void loadSyncRecovery().then(setRecovery).catch(() => setError('无法读取同步恢复副本，请稍后重试。'))
  }, [bridge])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setStatus('')
    try { await action() }
    catch (err) { setError(err instanceof Error ? err.message : '同步失败，请检查网络后重试。') }
    finally { setBusy(false) }
  }

  function ports(creds: Credentials) {
    const config: CloudConfig = { location: creds.location }
    return {
      getLocal: loadTree,
      getRemote: () => readRemote(config, creds.token),
      putRemote: (archive: TreeState, revision: string | null) => writeRemote(config, creds.token, archive, revision),
      replaceLocal: replaceFromSync,
    }
  }

  function remember(creds: Credentials, next: SyncCheckpoint) {
    setCheckpoint(next)
    localStorage.setItem(checkpointKey(creds.location), JSON.stringify(next))
  }

  async function synchronize(creds: Credentials, checked: SyncPreview, direction: 'upload' | 'download', recheck: boolean) {
    const next = await applySync(checked, direction, ports(creds), recheck)
    remember(creds, next)
    if (direction === 'download') {
      setRecovery(await loadSyncRecovery())
      await afterImport()
    }
    setStatus(direction === 'download' ? '已将云端档案同步到手机。' : '手机档案已同步到云端。')
  }

  async function startSync() {
    if (!credentials) return
    const client = ports(credentials)
    const [local, remote] = await Promise.all([client.getLocal(), client.getRemote()])
    const checked = await compareArchives(local, remote, getCheckpoint(credentials.location))
    if (checked.action === 'same' && remote) {
      remember(credentials, { digest: checked.digest, revision: remote.revision, at: new Date().toISOString() })
      setStatus('手机与云端档案一致。')
    } else if (checked.action === 'upload' || checked.action === 'download') {
      await synchronize(credentials, checked, checked.action, false)
    } else setPreview(checked)
  }

  function confirm(direction: 'upload' | 'download') {
    if (!credentials || !preview) return
    const checked = preview
    setPreview(null)
    void run(() => synchronize(credentials, checked, direction, true))
  }

  return <section className="action-card cloud-sync">
    <div className="action-icon"><Cloud size={22} /></div>
    <h2>跨设备同步</h2>
    <p>{credentials ? `私有仓库 · ${credentials.location}` : '手机和电脑连接同一个 GitHub 私有仓库，可在不同网络间同步。'}</p>
    {credentials && checkpoint && <p>上次同步 · {new Date(checkpoint.at).toLocaleString('zh-CN')}</p>}
    <div className="cloud-actions">
      {credentials && <button className="button primary" disabled={busy} onClick={() => void run(startSync)}>
        <RefreshCw size={16} />{busy ? '处理中…' : '立即同步'}
      </button>}
      <button className={credentials ? 'button secondary' : 'button primary'} disabled={busy}
        onClick={() => { setConfiguring(true); setError('') }}>{credentials ? '同步设置' : '设置同步'}</button>
      {recovery && <button className="button secondary" disabled={busy} onClick={() => void run(async () => {
        const [backup, current] = await Promise.all([loadSyncRecovery(), loadTree()])
        if (backup) setRestore({ backup, current })
      })}>同步恢复副本</button>}
    </div>
    {status && <p role="status">{status}</p>}
    {error && !configuring && <p role="alert" className="error">{error}</p>}
    {configuring && <Dialog title="同步设置" onClose={() => { setConfiguring(false); setError('') }}>
      <form className="rule-form" onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const location = String(form.get('location') ?? '').trim()
        const entered = String(form.get('token') ?? '').trim()
        const token = entered || (credentials?.location.toLowerCase() === location.toLowerCase() ? credentials.token : '')
        if (!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(location) || ['.', '..'].includes(location.split('/')[1])) {
          setError('仓库名格式应为「用户名/仓库名」。'); return
        }
        if (!token) { setError('请填写该私有仓库的访问令牌。'); return }
        try {
          const next = { location, token }
          if (!bridge.setSecret(JSON.stringify(next))) throw new Error()
          setCredentials(next)
          setCheckpoint(getCheckpoint(location))
          setError('')
          setStatus('设置已保存，点击「立即同步」连接云端。')
          setConfiguring(false)
        } catch { setError('手机未能保存同步凭据。') }
      }}>
        <label>GitHub 私有仓库<input name="location" defaultValue={credentials?.location ?? defaultRepo} required
          autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <label>访问令牌<input name="token" type="password" placeholder={credentials ? '沿用当前仓库的令牌可留空' : '填写此仓库的令牌'}
          autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <p>使用仅能访问这个私有仓库的细粒度令牌，仓库内容权限选择「读和写」。首次连接需要核对档案。</p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="cloud-actions">
          <button type="submit" className="button primary">保存设置</button>
          {credentials && <button type="button" className="button secondary" onClick={() => {
            try {
              if (!bridge.setSecret('')) throw new Error()
              setCredentials(null); setCheckpoint(null); setConfiguring(false); setError('')
              setStatus('本机已断开同步。')
            } catch { setError('无法清除本机的同步凭据。') }
          }}>断开本机连接</button>}
        </div>
      </form>
    </Dialog>}
    {preview && <Dialog title="选择同步方向" onClose={() => setPreview(null)}>
      <div className="dialog-section">
        <p>{preview.remote ? '手机与云端的档案不同。请选择要保留的整份档案。' : '云端尚无档案，确认后将把手机档案上传至私有仓库。'}</p>
        <ArchiveSummary label="手机" state={preview.local} />
        <ArchiveSummary label="云端" state={preview.remote?.state} />
        {preview.remote && <ArchiveDiff mobile={preview.local} cloud={preview.remote.state} />}
        {preview.remote && <p>使用云端档案时，手机会先保存最近一次替换前的恢复副本。</p>}
        <div className="cloud-actions">
          {preview.remote && <button className="button primary" onClick={() => confirm('download')}>用云端档案替换手机</button>}
          <button className="button secondary" onClick={() => confirm('upload')}>{preview.remote ? '用手机档案替换云端' : '上传到私有仓库'}</button>
          <button className="button secondary" onClick={() => setPreview(null)}>取消</button>
        </div>
      </div>
    </Dialog>}
    {restore && <Dialog title="恢复同步前的手机档案" onClose={() => setRestore(null)}>
      <div className="dialog-section">
        <ArchiveSummary label="当前手机档案" state={restore.current} />
        <ArchiveSummary label={'恢复副本 · ' + new Date(restore.backup.at).toLocaleString('zh-CN')} state={restore.backup.state} />
        <button className="button primary" onClick={() => {
          const choice = restore
          setRestore(null)
          void run(async () => {
            await replaceFromSync(choice.backup.state, choice.current)
            if (credentials) localStorage.removeItem(checkpointKey(credentials.location))
            setCheckpoint(null)
            setRecovery(await loadSyncRecovery())
            await afterImport()
            setStatus('已在手机恢复副本，下次同步时会重新核对档案。')
          })
        }}>确认恢复到手机</button>
      </div>
    </Dialog>}
  </section>
}
