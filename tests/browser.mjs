import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { preview } from 'vite'

// The nested base also catches absolute asset, manifest and service worker URLs.
const base = '/daily_rule/'
const server = process.env.TEST_URL ? null : await preview({
  base, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 },
})
const url = process.env.TEST_URL ?? `http://127.0.0.1:${server.httpServer.address().port}${base}`
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browserPath = process.env.BROWSER_PATH || [chrome, edge].find(existsSync)
const otherBrowserPath = [edge, chrome].find(path => path !== browserPath && existsSync(path)) ?? browserPath
const browsers = []
const firstDay = new Date('2030-06-07T13:00:00+08:00')
const nextDay = new Date('2030-06-08T09:00:00+08:00')
const defaultCategories = [
  { id: 'life', name: '生活国策' }, { id: 'study', name: '学习国策' }, { id: 'work', name: '工作国策' },
]

async function launch(executablePath) {
  const browser = await chromium.launch({ executablePath, headless: true })
  browsers.push(browser)
  return browser
}

const button = (page, name) => page.getByRole('button', { name, exact: true })
const node = (page, title) => page.locator('.react-flow__node').filter({ hasText: title })

async function openPage(context) {
  const page = await context.newPage()
  await page.clock.setFixedTime(firstDay)
  await page.goto(url)
  await page.getByRole('heading', { name: '国策指挥台' }).waitFor()
  return page
}

async function fillDraftFields(page, title) {
  await page.getByLabel('国策名称').fill(title)
  await page.getByLabel('触发时机').fill('准备出门时')
  await page.getByLabel('具体行动').fill('把书放进包里')
}

async function fillDraft(page, title) {
  await button(page, '新建分支').first().click()
  await fillDraftFields(page, title)
}

async function navigate(page, name) {
  const menu = button(page, '打开导航')
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('link', { name, exact: true }).click()
}

async function exportBackup(page) {
  await navigate(page, '数据备份')
  const downloading = page.waitForEvent('download')
  await button(page, '导出备份').click()
  const stream = await (await downloading).createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function importBackup(page, state) {
  await navigate(page, '数据备份')
  await page.locator('input[type=file]').setInputFiles({
    name: 'daily-rule-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)),
  })
  await button(page, '确认导入').click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
}

async function reportBreach(page, title, affected = [title], review) {
  await node(page, title).click()
  await button(page, '记录失守').click()
  const dialog = page.getByRole('dialog')
  for (const name of affected) await dialog.getByText(name, { exact: true }).waitFor()
  if (review) {
    await dialog.locator('textarea[name=reason]').fill(review.reason)
    await dialog.locator('textarea[name=improvement]').fill(review.improvement)
  }
  await button(page, '确认撤回').click()
  await node(page, title).waitFor({ state: 'detached' })
}

async function expectDefaultMapToFit(page) {
  // No manual pan or fit command: the first visit must frame the empty tree automatically.
  await page.waitForFunction(names => {
    const frame = document.querySelector('.map-frame')?.getBoundingClientRect()
    const cards = Array.from(document.querySelectorAll('.map-frame .atlas-category'))
    if (!frame || !frame.width || !frame.height || cards.length !== names.length) return false
    return names.every(name => {
      const rect = cards.find(card => card.textContent.trim() === name)?.getBoundingClientRect()
      return rect && rect.width > 0 && rect.height > 0
        && rect.left >= frame.left - 1 && rect.right <= frame.right + 1
        && rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1
    })
  }, defaultCategories.map(category => category.name), { polling: 100, timeout: 5000 })
}

async function ensureInstalled(page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { polling: 100, timeout: 20000 })
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    const data = await (await fetch(link.href)).json()
    const installation = await navigator.serviceWorker.ready
    return {
      scope: installation.scope, start: new URL(data.start_url, link.href).href,
      icons: await Promise.all(data.icons.map(async icon => (await fetch(new URL(icon.src, link.href))).ok)),
    }
  })
  assert.equal(manifest.scope, new URL('.', url).href)
  assert.equal(manifest.start, manifest.scope)
  assert.ok(manifest.icons.length && manifest.icons.every(Boolean))
}

function exampleTree() {
  const families = [['B', null], ['C', 'B'], ['D', 'B'], ['E', 'B'], ['F', 'C'], ['G', 'D'], ['H', 'F']]
  return {
    version: 1,
    rules: families.map(([id, parentId], index) => {
      const day = `2020-01-0${index + 1}`
      return {
        id, parentId, title: `示例国策 ${id}`, trigger: '出门时', action: '带上笔记本', badge: 'book',
        createdAt: `${day}T04:00:00.000Z`, day, archivedAt: null, cause: null, incidentId: null, retryOf: null,
      }
    }),
  }
}

async function installLegacyDatabase(context, state) {
  // Open a same-origin blank page before the app, as if upgrading a real v1 installation.
  const page = await context.newPage()
  const bootstrapUrl = new URL('./legacy-setup.html', url).href
  await page.route(bootstrapUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  await page.goto(bootstrapUrl)
  await page.evaluate(legacy => new Promise((resolve, reject) => {
    const request = indexedDB.open('daily-rule', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('tree')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('tree', 'readwrite')
      tx.objectStore('tree').put(legacy, 'current')
      tx.onabort = () => reject(tx.error)
      tx.oncomplete = () => { db.close(); resolve() }
    }
  }), state)
  await page.close()
}

function assertUpgrade(state, legacy) {
  assert.equal(state.version, 3)
  assert.deepEqual(state.categories, defaultCategories)
  assert.deepEqual(state.rules, legacy.rules.map(rule => ({ ...rule, categoryId: null })))
}

async function moveBranch(page, ruleTitle, categoryName) {
  await node(page, ruleTitle).click()
  await button(page, '调整分支类别').click()
  await page.getByLabel('目标类别').selectOption({ label: categoryName })
  await button(page, '确认调整').click()
  const detail = page.getByRole('dialog', { name: '国策详情' })
  await button(detail, '关闭').click()
}

async function checkCategoryWorkflow(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Shanghai' })
  context.setDefaultTimeout(10000)
  const legacy = exampleTree()
  legacy.rules.push({
    ...legacy.rules[0], id: 'J', title: '读书笔记', day: '2020-01-08', createdAt: '2020-01-08T04:00:00.000Z',
  })
  for (const rule of legacy.rules.filter(rule => ['F', 'H'].includes(rule.id))) {
    rule.archivedAt = '2025-01-01T06:00:00.000Z'
    rule.cause = rule.id === 'F' ? 'breach' : 'ancestor'
    rule.incidentId = 'F'
  }
  await installLegacyDatabase(context, legacy)
  const page = await openPage(context)
  await ensureInstalled(page)
  assertUpgrade(await exportBackup(page), legacy)
  assert.equal(await page.evaluate(async () =>
    (await indexedDB.databases()).find(db => db.name === 'daily-rule').version), 3)
  await navigate(page, '国策树')
  await page.getByLabel('空根节点', { exact: true }).waitFor()
  for (const category of defaultCategories) await page.getByLabel('类别：' + category.name, { exact: true }).waitFor()
  await page.getByLabel('类别：生活国策', { exact: true }).click()
  const emptyDetail = page.getByRole('dialog', { name: '国策类别' })
  assert.ok(await button(emptyDetail, '在此类别新建国策').isEnabled())
  await button(emptyDetail, '关闭').click()

  await button(page, '类别管理').click()
  await page.getByLabel('类别名称', { exact: true }).fill('户外计划')
  await button(page, '新增类别').click()
  await button(page, '重命名户外计划').click()
  await page.getByLabel('新类别名称').fill('户外行动')
  await button(page, '保存名称').click()
  await button(page, '重命名户外行动').waitFor()
  await button(page.getByRole('dialog'), '关闭').click()
  await moveBranch(page, '读书笔记', '学习国策')
  await moveBranch(page, '示例国策 B', '户外行动')
  const moved = await exportBackup(page)
  const assigned = moved.categories.find(category => category.name === '户外行动')
  assert.ok(assigned)
  assert.deepEqual(moved.rules, legacy.rules.map(rule => ({
    ...rule, categoryId: rule.id === 'J' ? 'study' : assigned.id,
  })))

  await navigate(page, '国策树')
  const filter = page.getByLabel('筛选沙盘类别')
  await filter.selectOption({ label: '户外行动' })
  await node(page, '示例国策 B').waitFor()
  await node(page, '示例国策 C').waitFor()
  await node(page, '读书笔记').waitFor({ state: 'detached' })
  await page.getByLabel('类别：学习国策', { exact: true }).waitFor({ state: 'detached' })
  await filter.selectOption({ label: '全部类别' })
  await node(page, '读书笔记').waitFor()
  await page.getByLabel('类别：学习国策', { exact: true }).waitFor()
  const outdoor = page.getByLabel('类别：户外行动', { exact: true })
  const branch = moved.rules.filter(rule => rule.categoryId === assigned.id && !rule.archivedAt)
  const edgeCount = moved.categories.length + moved.rules.filter(rule => !rule.archivedAt).length
  const expectEdges = count => page.waitForFunction(expected =>
    document.querySelectorAll('.react-flow__edge').length === expected, count)
  await expectEdges(edgeCount)
  assert.equal(await outdoor.getAttribute('aria-expanded'), 'true')
  await outdoor.click()
  for (const rule of branch) await node(page, rule.title).waitFor({ state: 'detached' })
  assert.equal(await outdoor.getAttribute('aria-expanded'), 'false')
  await expectEdges(edgeCount - branch.length)
  assert.ok(await node(page, '读书笔记').isVisible())
  assert.ok(await button(page.locator('.hero'), '新建分支').isEnabled())
  const viewObserver = await openPage(context)
  assert.deepEqual(await exportBackup(viewObserver), moved, '收起类别应保留国策、失守历史和名额')
  await viewObserver.close()
  await filter.selectOption({ label: '户外行动' })
  await outdoor.press('Enter')
  for (const rule of branch) await node(page, rule.title).waitFor()
  assert.equal(await outdoor.getAttribute('aria-expanded'), 'true')
  await expectEdges(1 + branch.length)
  await filter.selectOption({ label: '全部类别' })
  await expectEdges(edgeCount)
  await page.getByLabel('类别：学习国策', { exact: true }).click()
  await node(page, '读书笔记').waitFor({ state: 'detached' })
  await button(page, '示例图').click()
  await node(page, '书桌就绪').waitFor()
  await button(page, '我的国策树').click()
  assert.equal(await page.getByLabel('类别：学习国策', { exact: true }).getAttribute('aria-expanded'), 'false')
  await button(page, '户外行动的类别详情').click()
  await button(page, '在此类别新建国策').click()
  assert.equal(await page.getByLabel('国策类别').inputValue(), assigned.id)
  await fillDraftFields(page, '跑步准备')
  await button(page, '建立国策').click()
  await node(page, '跑步准备').waitFor()
  await page.clock.setFixedTime(nextDay)
  await page.reload()
  await node(page, '跑步准备').click()
  await button(page, '添加子国策').click()
  assert.ok(await page.getByLabel('国策类别').isDisabled())
  assert.equal(await page.getByLabel('国策类别').inputValue(), assigned.id)
  await fillDraftFields(page, '跑前热身')
  await button(page, '建立国策').click()
  await node(page, '跑前热身').waitFor()
  await context.setOffline(true)
  await page.reload()
  const beforeDeletion = await exportBackup(page)
  const parent = beforeDeletion.rules.find(rule => rule.title === '跑步准备')
  const child = beforeDeletion.rules.find(rule => rule.title === '跑前热身')
  assert.equal(parent.parentId, null)
  assert.equal(child.parentId, parent.id)
  assert.equal(parent.categoryId, assigned.id)
  assert.equal(child.categoryId, assigned.id)
  assert.notEqual(parent.day, child.day)
  await navigate(page, '国策树')
  await button(page, '类别管理').click()
  await button(page, '删除户外行动').click()
  await button(page, '确认删除').waitFor()
  // Confirmation is still pending; a separate tab sees the current category and assignments.
  const observer = await openPage(context)
  assert.deepEqual(await exportBackup(observer), beforeDeletion)
  await observer.close()
  await button(page, '确认删除').click()
  await button(page, '删除户外行动').waitFor({ state: 'detached' })
  await button(page.getByRole('dialog'), '关闭').click()
  const removed = await exportBackup(page)
  assert.deepEqual(removed.categories, defaultCategories)
  assert.deepEqual(removed.rules, beforeDeletion.rules.map(rule => ({
    ...rule, categoryId: rule.categoryId === assigned.id ? null : rule.categoryId,
  })))
  await navigate(page, '国策树')
  assert.ok(await button(page.locator('.hero'), '今日名额已用完').isDisabled())
  assert.equal(await page.getByLabel('类别：户外行动', { exact: true }).count(), 0)
  await filter.selectOption({ label: '未分类' })
  await node(page, '跑步准备').waitFor()
  await node(page, '跑前热身').waitFor()
  await node(page, '读书笔记').waitFor({ state: 'detached' })
  await importBackup(page, beforeDeletion)
  assert.deepEqual(await exportBackup(page), beforeDeletion)
  await context.close()
  console.log('通过 · v1 本地数据库升级、类别增改删与筛选、类别折叠及示例隔离、整支归类和子项继承、断网备份恢复')
}

try {
  const desktopBrowser = await launch(browserPath)
  const desktop = await desktopBrowser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Shanghai' })
  desktop.setDefaultTimeout(10000)
  const pages = await Promise.all([openPage(desktop), openPage(desktop)])
  await ensureInstalled(pages[0])
  await pages[0].getByLabel('空根节点', { exact: true }).waitFor()
  for (const category of defaultCategories) await pages[0].getByLabel('类别：' + category.name, { exact: true }).waitFor()
  assert.equal(await pages[0].locator('.react-flow__node').count(), defaultCategories.length + 1)
  await expectDefaultMapToFit(pages[0])
  assert.ok(await button(pages[0].locator('.hero'), '新建分支').isEnabled())
  await Promise.all(pages.map((page, i) => fillDraft(page, `并发建树 ${i + 1}`)))
  // Dispatch both already-open forms together, before either tab receives the other's UI update.
  await Promise.all(pages.map(page => button(page, '建立国策').evaluate(el => el.click())))
  const monitor = await openPage(desktop)
  await node(monitor, '并发建树').waitFor()
  const start = await exportBackup(monitor)
  assert.equal(start.rules.length, 1, '同一天两次提交只能建立一项国策')
  console.log('通过 · 双标签页同日新增')

  await monitor.goto(url)
  await reportBreach(monitor, start.rules[0].title)
  assert.ok(await button(monitor.locator('.hero'), '今日名额已用完').isDisabled(), '剪枝后当日名额仍已用完')
  await monitor.getByLabel('空根节点', { exact: true }).waitFor()
  await Promise.all(desktop.pages().map(page => page.close()))
  await desktop.setOffline(true)
  const offline = await desktop.newPage()
  await offline.clock.setFixedTime(nextDay)
  await offline.goto(url)
  await fillDraft(offline, '离线创建')
  await button(offline, '建立国策').click()
  await node(offline, '离线创建').waitFor()
  await offline.reload()
  await reportBreach(offline, '离线创建')
  const offlineData = await exportBackup(offline)
  assert.equal(offlineData.rules.length, 2)
  assert.ok(offlineData.rules.every(rule => rule.cause === 'breach'))
  assert.notEqual(offlineData.rules[0].day, offlineData.rules[1].day)
  console.log('通过 · 剪枝保留名额、跨日解锁、断网重开与新增剪枝')

  await desktop.setOffline(false)
  const example = await openPage(desktop)
  const legacyBackup = exampleTree()
  await importBackup(example, legacyBackup)
  assertUpgrade(await exportBackup(example), legacyBackup)
  await example.goto(url)
  const draft = await openPage(desktop)
  await node(draft, '示例国策 C').click()
  await button(draft, '添加子国策').click()
  await draft.getByLabel('国策名称').fill('保持所选上级')
  await draft.getByLabel('触发时机').fill('坐下时')
  await draft.getByLabel('具体行动').fill('翻开书')
  const review = { reason: '书留在家里了', improvement: '前一晚把书放进包里' }
  await reportBreach(example, '示例国策 C', ['示例国策 C', '示例国策 F', '示例国策 H'], review)
  await draft.waitForFunction(() => document.querySelector('select[name=parent] option:checked')?.disabled)
  assert.equal(await draft.getByLabel('上级国策').inputValue(), 'C', '撤回上级时不能静默切换为根节点')
  assert.ok(await button(draft, '建立国策').isDisabled())
  await draft.close()
  const result = await exportBackup(example)
  const activeIds = result.rules.filter(rule => !rule.archivedAt).map(rule => rule.id).sort()
  assert.deepEqual(activeIds, ['B', 'D', 'E', 'G'])
  assert.deepEqual(result.rules.filter(rule => rule.cause === 'ancestor').map(rule => rule.id).sort(), ['F', 'H'])
  assert.deepEqual(result.rules.filter(rule => rule.cause === 'breach').map(rule => rule.id), ['C'])
  assert.deepEqual(result.rules.find(rule => rule.id === 'C').review, review)
  assert.ok(result.rules.filter(rule => rule.id !== 'C').every(rule => !rule.review))
  await navigate(example, '历史档案')
  const archive = example.getByRole('listitem').filter({ has: example.getByRole('heading', { name: '示例国策 C' }) })
  await archive.getByText(review.reason, { exact: true }).waitFor()
  await archive.getByText(review.improvement, { exact: true }).waitFor()
  const revisedReview = { ...review, improvement: '睡前把书装进明天的背包' }
  await button(archive, '编辑复盘').click()
  const editDialog = example.getByRole('dialog')
  assert.equal(await editDialog.locator('textarea[name=reason]').inputValue(), review.reason)
  await editDialog.locator('textarea[name=improvement]').fill(revisedReview.improvement)
  await button(editDialog, '保存复盘').click()
  await editDialog.waitFor({ state: 'detached' })
  await button(archive, '重试').click()
  const retryDialog = example.getByRole('dialog')
  await retryDialog.getByText(review.reason, { exact: true }).waitFor()
  await retryDialog.getByText(revisedReview.improvement, { exact: true }).waitFor()
  await example.getByLabel('上级国策').selectOption('E')
  await button(example, '建立国策').click()
  await example.getByRole('dialog').waitFor({ state: 'detached' })
  const retried = await exportBackup(example)
  assert.equal(retried.rules.length, result.rules.length + 1)
  assert.deepEqual(retried.rules.find(rule => rule.id === 'C').review, revisedReview)
  const replacement = retried.rules.find(rule => rule.retryOf === 'C')
  assert.equal(replacement.parentId, 'E')
  assert.equal(replacement.archivedAt, null)
  assert.equal(replacement.review, undefined)
  assert.deepEqual(retried.rules.filter(rule => rule.retryOf && rule.id !== replacement.id), [])
  console.log('通过 · 原文剪枝图例、两种历史归档原因、换分支单项重试')

  const mobileBrowser = await launch(otherBrowserPath)
  const mobile = await mobileBrowser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai',
  })
  mobile.setDefaultTimeout(10000)
  const phone = await openPage(mobile)
  await expectDefaultMapToFit(phone)
  await importBackup(phone, retried)
  assert.deepEqual(await exportBackup(phone), retried, '独立浏览器导入后再次导出应与原备份一致')
  await phone.goto(url)
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  assert.ok(await button(phone.locator('.hero'), '今日名额已用完').isDisabled(), '备份须恢复当天受限的名额')
  await button(phone, '示例图').tap()
  const demoLife = phone.getByLabel('类别：生活', { exact: true })
  await node(phone, '无屏早餐').waitFor()
  await demoLife.tap()
  await node(phone, '无屏早餐').waitFor({ state: 'detached' })
  await node(phone, '晨读一页').waitFor()
  await demoLife.tap()
  await node(phone, '无屏早餐').waitFor()
  await button(phone, '我的国策树').tap()
  assert.ok(await button(phone.locator('.hero'), '今日名额已用完').isDisabled())
  await phone.clock.setFixedTime(nextDay)
  await phone.reload()
  await fillDraft(phone, '窄屏操作')
  await button(phone, '建立国策').click()
  await reportBreach(phone, '窄屏操作')
  assert.ok(await button(phone.locator('.hero'), '今日名额已用完').isDisabled())
  console.log('通过 · 跨浏览器备份往返和移动窄屏新增、查看、剪枝')
  await checkCategoryWorkflow(desktopBrowser)
} finally {
  await Promise.all(browsers.map(browser => browser.close()))
  if (server) await server.close()
}
