import type { Badge, Category, Rule } from './model'

// Kept outside the user's tree and the persistence layer.
export const demoCategories: Category[] = [
  { id: 'life', name: '生活' },
  { id: 'study', name: '学习' },
  { id: 'work', name: '工作' },
]

const examples: [string, string | null, string, string, Badge, string, string][] = [
  ['base', null, 'life', '晨间整备', 'standard', '早晨起床、双脚落地时', '把被子叠好，打开窗帘。'],
  ['sun', 'base', 'life', '无屏早餐', 'sun', '坐下来吃早餐前', '把手机放在餐桌以外，直到吃完。'],
  ['book', null, 'study', '书桌就绪', 'book', '第一次坐到书桌前', '收起杂物，只留下今天要用的书和笔。'],
  ['read', 'book', 'study', '晨读一页', 'leaf', '早晨整理完书桌后', '翻开正在读的书，至少读完一页。'],
  ['plan', null, 'work', '上班先定一事', 'shield', '到工位打开电脑后', '在便签上写下今天最重要的一件事。'],
  ['close', 'plan', 'work', '收工留个起点', 'moon', '下班合上电脑之前', '在便签背面写好明早能接着做的第一个动作。'],
]

export const demoRules: Rule[] = examples.map(([id, parentId, categoryId, title, badge, trigger, action], index) => {
  const day = '2026-01-0' + (index + 1)
  return {
    id,
    parentId,
    categoryId,
    title,
    badge,
    trigger,
    action,
    day,
    createdAt: day + 'T00:00:00.000Z',
    archivedAt: null,
    incidentId: null,
    cause: null,
    retryOf: null,
  }
})
