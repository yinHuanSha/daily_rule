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

async function fillDraft(page, title) {
  await button(page, '新建分支').first().click()
  await page.getByLabel('国策名称').fill(title)
  await page.getByLabel('触发时机').fill('准备出门时')
  await page.getByLabel('具体行动').fill('把书放进包里')
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

async function reportBreach(page, title, affected = [title]) {
  await node(page, title).click()
  await button(page, '记录失守').click()
  const dialog = page.getByRole('dialog')
  for (const name of affected) await dialog.getByText(name, { exact: true }).waitFor()
  await button(page, '确认撤回').click()
  await node(page, title).waitFor({ state: 'detached' })
}

async function ensureInstalled(page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 20000 })
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

try {
  const desktopBrowser = await launch(browserPath)
  const desktop = await desktopBrowser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Shanghai' })
  desktop.setDefaultTimeout(10000)
  const pages = await Promise.all([openPage(desktop), openPage(desktop)])
  await ensureInstalled(pages[0])
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
  assert.ok(await button(monitor.locator('.map-frame'), '今日名额已用完').isDisabled())
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
  await importBackup(example, exampleTree())
  await example.goto(url)
  const draft = await openPage(desktop)
  await node(draft, '示例国策 C').click()
  await button(draft, '添加子国策').click()
  await draft.getByLabel('国策名称').fill('保持所选上级')
  await draft.getByLabel('触发时机').fill('坐下时')
  await draft.getByLabel('具体行动').fill('翻开书')
  await reportBreach(example, '示例国策 C', ['示例国策 C', '示例国策 F', '示例国策 H'])
  await draft.waitForFunction(() => document.querySelector('select[name=parent] option:checked')?.disabled)
  assert.equal(await draft.getByLabel('上级国策').inputValue(), 'C', '撤回上级时不能静默切换为根节点')
  assert.ok(await button(draft, '建立国策').isDisabled())
  await draft.close()
  const result = await exportBackup(example)
  const activeIds = result.rules.filter(rule => !rule.archivedAt).map(rule => rule.id).sort()
  assert.deepEqual(activeIds, ['B', 'D', 'E', 'G'])
  assert.deepEqual(result.rules.filter(rule => rule.cause === 'ancestor').map(rule => rule.id).sort(), ['F', 'H'])
  assert.deepEqual(result.rules.filter(rule => rule.cause === 'breach').map(rule => rule.id), ['C'])
  await navigate(example, '历史档案')
  const archive = example.getByRole('listitem').filter({ has: example.getByRole('heading', { name: '示例国策 C' }) })
  await button(archive, '重试').click()
  await example.getByLabel('上级国策').selectOption('E')
  await button(example, '建立国策').click()
  await example.getByRole('dialog').waitFor({ state: 'detached' })
  const retried = await exportBackup(example)
  assert.equal(retried.rules.length, result.rules.length + 1)
  const replacement = retried.rules.find(rule => rule.retryOf === 'C')
  assert.equal(replacement.parentId, 'E')
  assert.equal(replacement.archivedAt, null)
  assert.deepEqual(retried.rules.filter(rule => rule.retryOf && rule.id !== replacement.id), [])
  console.log('通过 · 原文剪枝图例、两种历史归档原因、换分支单项重试')

  const mobileBrowser = await launch(otherBrowserPath)
  const mobile = await mobileBrowser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai',
  })
  mobile.setDefaultTimeout(10000)
  const phone = await openPage(mobile)
  await importBackup(phone, retried)
  assert.deepEqual(await exportBackup(phone), retried, '独立浏览器导入后再次导出应与原备份一致')
  await phone.goto(url)
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  assert.ok(await button(phone, '今日名额已用完').isDisabled(), '备份须恢复当天受限的名额')
  await phone.clock.setFixedTime(nextDay)
  await phone.reload()
  await fillDraft(phone, '窄屏操作')
  await button(phone, '建立国策').click()
  await reportBreach(phone, '窄屏操作')
  assert.ok(await button(phone, '今日名额已用完').isDisabled())
  console.log('通过 · 跨浏览器备份往返和移动窄屏新增、查看、剪枝')
} finally {
  await Promise.all(browsers.map(browser => browser.close()))
  if (server) await server.close()
}
