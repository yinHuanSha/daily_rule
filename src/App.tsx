import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Compass,
  DatabaseBackup,
  Flag,
  GitBranch,
  HardDrive,
  Layers3,
  Map as MapIcon,
  Menu,
  Network,
  Plus,
  Route,
  X,
} from 'lucide-react'
import { Backups, Guide, History } from './Pages'
import { Detail, PruneDialog, RuleForm } from './RuleDialogs'
import { demoRules } from './demo'
import { emptyState, hasQuota, localDay, subtreeIds } from './model'
import type { Rule } from './model'
import { addRule, loadTree, pruneRule, subscribeTree } from './storage'

const TreeMap = lazy(() => import('./TreeMap'))

const nav = [
  { id: 'tree', label: '国策树', icon: Network },
  { id: 'history', label: '历史档案', icon: Archive },
  { id: 'backup', label: '数据备份', icon: DatabaseBackup },
  { id: 'guide', label: '国策手册', icon: BookOpen },
] as const
type Page = (typeof nav)[number]['id']
type Overlay =
  | { kind: 'add'; parentId: string | null; retry?: Rule }
  | { kind: 'detail'; id: string }
  | { kind: 'prune'; rules: Rule[] }
  | null
const descriptions: Record<Exclude<Page, 'tree'>, string> = {
  history: '回顾撤回的国策，在合适的时机单独重试。',
  backup: '在设备之间迁移国策树，或留存一份可恢复的档案。',
  guide: '了解国策如何建立、生效，以及何时撤回。',
}

function useCalendar() {
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const update = () => {
      const now = new Date()
      setToday(now)
      const next = new Date(now)
      next.setHours(24, 0, 0, 0)
      clearTimeout(timer)
      timer = window.setTimeout(update, next.getTime() - now.getTime() + 50)
    }
    update()
    window.addEventListener('focus', update)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', update)
    }
  }, [])
  return today
}

function currentPage(): Page {
  return nav.find((item) => item.id === location.hash.slice(1))?.id ?? 'tree'
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage)
  const [tree, setTree] = useState(emptyState)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [demo, setDemo] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [menu, setMenu] = useState(false)
  const [message, setMessage] = useState('')
  const today = useCalendar()
  const request = useRef(0)
  const toastTimer = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++request.current
    try {
      const stored = await loadTree()
      if (ticket === request.current) {
        setTree(stored)
        setReady(true)
        setLoadError('')
      }
    } catch (err) {
      if (ticket === request.current) {
        setReady(false)
        setLoadError(err instanceof Error ? err.message : '无法读取本地档案')
      }
    }
  }, [])
  useEffect(() => {
    const stop = subscribeTree(() => void refresh())
    void refresh()
    return () => {
      stop()
      request.current++
    }
  }, [refresh])
  useEffect(() => {
    const sync = () => {
      setPage(currentPage())
      setOverlay(null)
      setMenu(false)
    }
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      clearTimeout(toastTimer.current)
    }
  }, [])
  useEffect(() => {
    if (!menu) return
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menu])
  function notify(text: string) {
    clearTimeout(toastTimer.current)
    setMessage(text)
    toastTimer.current = window.setTimeout(() => setMessage(''), 3600)
  }
  function navigate(next: Page) {
    setPage(next)
    setOverlay(null)
    setMenu(false)
    if (location.hash !== '#' + next) location.hash = next
    window.scrollTo(0, 0)
  }
  const active = tree.rules.filter((rule) => !rule.archivedAt)
  const available = ready && hasQuota(tree, today)
  const shown = demo ? demoRules : active
  const selected = overlay?.kind === 'detail' ? shown.find((rule) => rule.id === overlay.id) : undefined
  const current = nav.find((item) => item.id === page)!
  function beginAdd(parentId: string | null, retry?: Rule) {
    if (!ready || !available) {
      notify(ready ? '今日新增名额已用完，明天可以再加。' : '请先读取本地档案。')
      return
    }
    setOverlay({ kind: 'add', parentId, retry })
  }
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        跳至主要内容
      </a>
      {menu && <button className="nav-scrim" aria-label="收起导航" onClick={() => setMenu(false)} />}
      <aside className={'sidebar' + (menu ? ' open' : '')} aria-label="工作台导航">
        <div className="brand">
          <img src={import.meta.env.BASE_URL + 'app-icon.svg'} alt="" width="48" height="48" />
          <div>
            <strong>每日国策</strong>
            <span>DAILY RULE</span>
          </div>
          <button onClick={() => setMenu(false)} className="mobile-close icon-button" aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>
        <nav>
          <div className="nav-group-label">工作台</div>
          {nav.slice(0, 3).map(({ id, label, icon: Icon }) => (
            <a
              href={'#' + id}
              key={id}
              aria-current={page === id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                navigate(id)
              }}
            >
              <Icon />
              {label}
              {page === id && <ChevronRight size={14} />}
            </a>
          ))}
          <div className="nav-divider" />
          <a
            href="#guide"
            aria-current={page === 'guide' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              navigate('guide')
            }}
          >
            <BookOpen />
            国策手册{page === 'guide' && <ChevronRight size={14} />}
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-icon">
            <HardDrive size={18} />
          </div>
          <div>
            <strong>本地工作区</strong>
            <small>
              <i />
              数据保存在此设备
            </small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMenu(true)}>
              <Menu size={21} />
            </button>
            <Compass size={16} />
            <span>工作台</span>
            <ChevronRight size={12} />
            <b>{current.label}</b>
          </div>
          <time dateTime={localDay(today)}>
            <CalendarDays size={15} />
            {today.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}
          </time>
        </header>
        <main id="main-content" tabIndex={-1}>
          {loadError && (
            <p className="error" role="alert">
              {loadError} <button onClick={() => void refresh()}>重新读取</button>
            </p>
          )}
          {page === 'tree' ? (
            <>
              <section className="hero">
                <div className="hero-text">
                  <div className="hero-kicker">
                    <span />
                    递归稳态迭代协议 · RSIP
                  </div>
                  <h1>国策指挥台</h1>
                  <p>每天最多建立一项国策，从一个具体行动开始。</p>
                  <button className="button gold" onClick={() => beginAdd(null)} disabled={!available}>
                    <Plus size={17} />
                    {ready && !available ? '今日名额已用完' : '新建分支'}
                  </button>
                </div>
              </section>
              <section className="stats" aria-label="国策概况">
                {[
                  { icon: Flag, label: '生效国策', value: active.length, unit: '项', tone: 'green' },
                  {
                    icon: GitBranch,
                    label: '独立分支',
                    value: active.filter((r) => r.parentId === null).length,
                    unit: '条',
                    tone: 'ochre',
                  },
                  {
                    icon: CircleDot,
                    label: '今日新增名额',
                    value: available ? 1 : 0,
                    unit: '/ 1',
                    tone: 'blue',
                  },
                ].map(({ icon: Icon, label, value, unit, tone }) => (
                  <div className="stat" key={label}>
                    <div className={'stat-icon ' + tone}>
                      <Icon size={21} strokeWidth={1.65} />
                    </div>
                    <div>
                      <h2>{label}</h2>
                      <div className="stat-value">
                        {ready ? value : '—'} <small>{unit}</small>
                      </div>
                    </div>
                  </div>
                ))}
              </section>
              <section className="map-panel">
                <header className="map-header">
                  <h2>
                    <MapIcon size={19} />
                    国策沙盘
                  </h2>
                  <div className="segmented" aria-label="沙盘视图">
                    <button
                      aria-pressed={!demo}
                      onClick={() => {
                        setDemo(false)
                        setOverlay(null)
                      }}
                    >
                      <Network size={14} />
                      我的国策树
                    </button>
                    <button
                      aria-pressed={demo}
                      onClick={() => {
                        setDemo(true)
                        setOverlay(null)
                      }}
                    >
                      <Route size={14} />
                      示例图
                    </button>
                  </div>
                </header>
                <div className="map-frame">
                  <Suspense
                    fallback={
                      <div className="map-loading" role="status">
                        正在装载沙盘…
                      </div>
                    }
                  >
                    <TreeMap
                      rules={shown}
                      canCreate={available}
                      hadHistory={tree.rules.length > 0}
                      selectedId={selected?.id ?? null}
                      highlightedIds={overlay?.kind === 'prune' ? overlay.rules.map((r) => r.id) : []}
                      onSelect={(id) => setOverlay({ kind: 'detail', id })}
                      onCreate={() => beginAdd(null)}
                      demo={demo}
                    />
                  </Suspense>
                </div>
                <footer className="map-footer">
                  <span>
                    <span className="legend-dot" />
                    生效国策
                  </span>
                  <span>
                    <i className="legend-line" />
                    父子关系
                  </span>
                  <span className="map-foot-note">
                    <Layers3 size={13} />
                    {demo ? '示例图独立于个人档案' : '点击国策查看详情'}
                  </span>
                </footer>
              </section>
            </>
          ) : (
            <>
              <header className="page-heading">
                <h1>{current.label}</h1>
                <p>{descriptions[page]}</p>
              </header>
              {page === 'history' && (
                <History rules={tree.rules} available={available} onRetry={(r) => beginAdd(null, r)} />
              )}
              {page === 'backup' && <Backups state={tree} notify={notify} afterImport={refresh} />}
              {page === 'guide' && <Guide />}
            </>
          )}
        </main>
      </div>
      {overlay?.kind === 'add' && (
        <RuleForm
          active={active}
          parentId={overlay.parentId}
          retry={overlay.retry}
          onClose={() => setOverlay(null)}
          onSave={async (input) => {
            await addRule(input)
            await refresh()
            setDemo(false)
            navigate('tree')
            notify('国策已建立')
          }}
        />
      )}
      {selected && (
        <Detail
          rule={selected}
          parent={shown.find((r) => r.id === selected.parentId)}
          childrenCount={shown.filter((r) => r.parentId === selected.id).length}
          available={available}
          demo={demo}
          onClose={() => setOverlay(null)}
          onAdd={() => beginAdd(selected.id)}
          onBreach={() => {
            const byId = new Map(active.map((r) => [r.id, r]))
            setOverlay({ kind: 'prune', rules: subtreeIds(tree, selected.id).map((id) => byId.get(id)!) })
          }}
        />
      )}
      {overlay?.kind === 'prune' && (
        <PruneDialog
          rules={overlay.rules}
          onClose={() => setOverlay(null)}
          onConfirm={async () => {
            await pruneRule(
              overlay.rules[0].id,
              overlay.rules.map((r) => r.id),
            )
            await refresh()
            setOverlay(null)
            notify('分支已撤回，记录已归档')
          }}
        />
      )}
      <div className={'toast' + (message ? ' visible' : '')} role="status">
        {message && (
          <>
            <Check size={16} />
            {message}
          </>
        )}
      </div>
    </div>
  )
}
