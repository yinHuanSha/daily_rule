import type { Badge, Rule } from './model'

// Kept outside the user's tree and the persistence layer.
const examples: [string, string | null, string, Badge, string, string][] = [
  ['base', null, '晨间整备', 'standard', '早晨起床、双脚落地时', '把被子叠好，打开窗帘。'],
  ['sun', 'base', '无屏早餐', 'sun', '坐下来吃早餐前', '把手机放在餐桌以外，直到吃完。'],
  ['book', 'base', '书桌就绪', 'book', '早晨第一次坐到书桌前', '收起杂物，只留下今天要用的书和笔。'],
  ['leaf', 'sun', '餐后即清', 'leaf', '早餐结束后', '离开厨房之前洗好自己的餐具。'],
  ['walk', 'sun', '清晨散步', 'shield', '早餐后走到门口时', '穿好鞋，到楼下走一圈。'],
  ['read', 'book', '晨读一页', 'moon', '整理完书桌后', '先翻开正在读的书，至少读完一页。'],
]

export const demoRules: Rule[] = examples.map(([id, parentId, title, badge, trigger, action], index) => {
  const day = '2026-01-0' + (index + 1)
  return {
    id,
    parentId,
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
