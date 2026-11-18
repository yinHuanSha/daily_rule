import { useState } from 'react'
import { Folder, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog } from './RuleDialogs'
import type { Category, Rule, TreeState } from './model'
import { createCategory, moveBranchCategory, removeCategory, renameCategory } from './storage'

type CategoryEdit = { kind: 'rename' | 'delete'; id: string } | null

export function CategoryManager({
  tree,
  onClose,
  onChange,
}: {
  tree: TreeState
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [newName, setNewName] = useState('')
  const [edit, setEdit] = useState<CategoryEdit>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const totals = new Map<string, number>()
  for (const rule of tree.rules) {
    if (rule.categoryId !== null) totals.set(rule.categoryId, (totals.get(rule.categoryId) ?? 0) + 1)
  }
  async function update(operation: () => Promise<unknown>, onSuccess: () => void) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
      await onChange()
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '类别未保存，请重试。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="类别管理" onClose={onClose} busy={busy}>
      <div className="dialog-section categories-panel">
        <p className="muted">类别用于整理分支，可以随时增改，不占每日国策名额。</p>
        <form
          className="category-create"
          onSubmit={(event) => {
            event.preventDefault()
            void update(
              () => createCategory(name),
              () => setName(''),
            )
          }}
        >
          <label>
            类别名称
            <input
              required
              placeholder="例如：健康国策"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            <Plus size={15} />
            新增类别
          </button>
        </form>
        <ul className="category-list">
          {tree.categories.map((category) => (
            <li key={category.id}>
              <div className="category-row">
                <Folder size={17} />
                <strong>{category.name}</strong>
                <small>{totals.get(category.id) ?? 0} 项</small>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={'重命名' + category.name}
                  title="重命名"
                  disabled={busy}
                  onClick={() => {
                    setEdit({ kind: 'rename', id: category.id })
                    setNewName(category.name)
                    setError('')
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={'删除' + category.name}
                  title="删除类别"
                  disabled={busy}
                  onClick={() => {
                    setEdit({ kind: 'delete', id: category.id })
                    setError('')
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {edit?.id === category.id &&
                (edit.kind === 'rename' ? (
                  <form
                    className="category-edit"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void update(
                        () => renameCategory(category.id, newName),
                        () => setEdit(null),
                      )
                    }}
                  >
                    <input
                      aria-label="新类别名称"
                      value={newName}
                      required
                      autoFocus
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <button className="button primary" disabled={busy || !newName.trim()}>
                      保存名称
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setEdit(null)}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <div className="category-remove">
                    <p>
                      删除「{category.name}」？
                      {totals.get(category.id)
                        ? '其中的国策和历史记录将转为未分类，分支关系会保留。'
                        : '这个类别中还没有国策。'}
                    </p>
                    <button
                      type="button"
                      className="button danger"
                      disabled={busy}
                      onClick={() =>
                        void update(
                          () => removeCategory(category.id),
                          () => setEdit(null),
                        )
                      }
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setEdit(null)}
                    >
                      取消
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
        {tree.categories.length === 0 && (
          <p className="muted">还没有类别。可以添加第一类，也可以先建立未分类的国策。</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

export function CategoryDetail({
  category,
  rules,
  available,
  demo,
  onClose,
  onAdd,
  onManage,
  onSelect,
}: {
  category: Category
  rules: Rule[]
  available: boolean
  demo: boolean
  onClose: () => void
  onAdd: () => void
  onManage: () => void
  onSelect: (id: string) => void
}) {
  const entries = rules.filter((rule) => !rule.archivedAt && rule.categoryId === category.id)
  const branches = entries.filter((rule) => rule.parentId === null)
  return (
    <Dialog title={demo ? '示例类别' : '国策类别'} onClose={onClose} variant="drawer">
      <div className="detail-body category-detail">
        <div className="category-symbol">
          <FolderOpen size={28} />
        </div>
        <h3>{category.name}</h3>
        <p className="muted">
          {entries.length} 项生效国策 · {branches.length} 条分支
        </p>
        {branches.length > 0 && (
          <ul className="category-branches">
            {branches.map((rule) => (
              <li key={rule.id}>
                <button className="button secondary wide" onClick={() => onSelect(rule.id)}>
                  {rule.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!demo && (
          <div className="detail-actions">
            <button className="button primary" disabled={!available} onClick={onAdd}>
              <Plus size={16} />
              在此类别新建国策
            </button>
            {!available && <small>今日新增名额已用完</small>}
            <button className="button secondary" onClick={onManage}>
              类别管理
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

export function MoveCategoryDialog({
  rule,
  categories,
  onClose,
  onSaved,
}: {
  rule: Rule
  categories: Category[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [target, setTarget] = useState(rule.categoryId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const missing = target !== '' && !categories.some((category) => category.id === target)
  return (
    <Dialog title="调整分支类别" onClose={onClose} busy={busy}>
      <form
        className="rule-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (busy || missing) return
          setBusy(true)
          setError('')
          try {
            await moveBranchCategory(rule.id, target || null)
            await onSaved()
          } catch (err) {
            setError(err instanceof Error ? err.message : '调整失败，请重试。')
            setBusy(false)
          }
        }}
      >
        <p className="muted">「{rule.title}」及其下级国策（含历史记录）将一起归入所选类别。</p>
        <label>
          目标类别
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">未分类</option>
            {missing && (
              <option value={target} disabled>
                类别已被删除
              </option>
            )}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" disabled={busy || missing || target === (rule.categoryId ?? '')}>
            确认调整
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
