# 每日国策 · Daily Rule

用一棵可以生长、也可以回撤的国策树，管理自己的日常行动。应用面向手机和桌面浏览器，数据存储在本地。

## 规则

规则来源为 edmond《如何提高自制力？》第 23–27 页的递归稳态迭代协议（RSIP）。

1. 从重复出现的困境向前回溯，在仍能干预的时刻制定具体行动。例如，进卧室前把手机留在客厅。
2. 每个本地自然日整棵树最多引入一项国策。可以建立新分支，也可以挂在现役国策之下。
3. 国策持续生效。主动报告失守时，撤回这项国策和全部后代，保留祖先及旁支。
4. 历史中的国策可以作为一个新节点再次尝试，计入当天名额，只带回这一项。没有操作的日子不产生失守记录。

## 开发与验证

在已安装 Node.js 24 和 npm 的环境中执行：

```sh
npm ci
npm run dev
```

运行 `npm test` 检查规则与存储，运行 `npm run build` 生成可部署的 `dist/`。通过 `npm run preview` 打开生产版本并体验离线功能。手机安装需从可信的 HTTPS 地址访问构建产物，同一设备上的 localhost 可用于开发验证。

原始 PDF、构建产物和个人备份在 Git 的忽略列表中。

## 首次使用

打开首页可从「新建分支」建立第一项国策，也可先切换到「示例图」查看六个示例节点。示例独立于个人档案。点选自己的节点可添加子国策、预览失守影响并确认剪枝。手机上的导航入口在左上角。

「数据备份」可导出带版本号的 JSON。换浏览器或换设备时，先导出，再在目标设备选择同一文件、核对数量并确认导入。导入将替换目标设备当前的整份档案。使用固定地址访问应用，浏览器会按网站来源保存数据，清除网站数据前请先导出。

## 浏览器验收与安装

```sh
npm run build
npm run test:browser
```

浏览器验收会启动临时生产预览，检查多标签页新增竞争、原文剪枝图例、单节点重试、断网重开和窄屏备份迁移。Windows 自动寻找 Chrome 和 Edge；其他环境可用 `BROWSER_PATH` 指向 Chromium 浏览器，或先运行 `npx playwright install chromium`。

生产预览默认地址是 `http://127.0.0.1:4173/`。手机使用时将 `dist/` 的内容放在固定的 HTTPS 静态站点，首次联网打开并等待资源加载后，可以通过浏览器的安装菜单或「添加到主屏幕」使用。各浏览器和设备独立保存档案。

<details>
<summary>页首插画的生成记录</summary>

使用内置 ImageGen 生成，应用内资源为 `public/expedition.jpg`。最终提示词如下。

Wide panoramic header illustration for a personal strategy atlas, 3:1 landscape. Original intricate vintage alpine topographic survey engraving, distant jagged ranges, one elegant small gold expedition pennant on the highest peak in the right half, rolling pine-studded ridgelines across the bottom, faint engraved contour hachures. Copperplate pale sage and restrained antique brass lines on a deep smoky forest-green ink ground #233a33. Main summit and lush detail strongly clustered on the right half; left third mostly calm uninterrupted deep dark green as copy space. Cunning chiaroscuro line engraving with olive ochre engraved highlights, atmospheric layer separation, sophisticated antique expedition field manual print. Full bleed edge-to-edge, no white border, no text letters or numbers, no logos, no icons or fake UI. Graphic monochrome etching, not a photograph.

</details>
