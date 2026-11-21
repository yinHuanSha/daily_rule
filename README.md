# 每日国策 · Daily Rule

用一棵可以生长、也可以回撤的国策树，管理自己的日常行动。Windows 桌面版使用 C++ 和 Qt Widgets。安卓安装包内置可离线使用的国策树界面，两端可通过专用 GitHub 私有仓库同步。浏览器也可继续使用离线网页 App。

## 安卓安装与跨网络同步

在手机上下载 APK 后安装。支持 Android 8.0 及以上，建议使用已更新的 Android System WebView。国策树、剪枝、复盘、重试和备份都可离线使用。[下载 Android 1.0 APK](https://github.com/yinHuanSha/daily_rule/releases/download/android-v1.0.0/DailyRule-Android.apk)

1. 准备一个专门存放个人档案的 GitHub **私有**仓库。每台设备使用细粒度访问令牌，Repository access 选 Only select repositories，选中自己的同步仓库，Contents 选 Read and write。[创建细粒度令牌](https://github.com/settings/personal-access-tokens/new?name=Daily%20Rule%20Sync&contents=write)
2. 安卓打开「数据备份 → 跨设备同步」，Windows 打开左侧「跨设备同步」。填入同一个「账号/仓库名」和该设备的令牌，保存设置。凭据保存在设备，安卓使用 Android Keystore，Windows 使用当前用户的 DPAPI。
3. 点「立即同步」。第一次连接时，已有电脑档案的用户应先从电脑上传，手机选择「用云端档案替换手机」。后续只有一端修改时按修改方向同步。两端都修改时会显示本机和云端档案，请核对后选择要保留的一整份；如需同时保留两端的修改，先导出 JSON。
4. 手机在联网后手动点「立即同步」。Windows 还可以开启程序运行期间的自动检查。GitHub 保存 `archive.json` 的提交历史，客户端下载前保留本地恢复副本。网页 PWA 可以用 JSON 和这两个客户端互相迁移。

### 从源码构建 APK

在 Windows 安装 JDK 17+、Android SDK Platform 35 和 Build Tools 35.0.0。仓库根目录执行 `npm ci`，再运行以下脚本。脚本会构建网页资源、嵌入 APK、签名并验证，输出 `release/DailyRule-Android.apk`。

```powershell
.\android\build-windows.ps1 -SdkRoot $env:ANDROID_HOME -Jdk $env:JAVA_HOME
```

同一应用 ID 的覆盖更新需要沿用同一签名密钥。自建版本应妥善保管首次打包生成的发布密钥和密码；官方发布包可直接覆盖更新原官方版本。

## Windows 桌面版

双击 `release/DailyRule/DailyRule.exe` 启动。换电脑时复制整个 `DailyRule` 文件夹，或解压 `release/DailyRule-Windows-x64.zip` 后运行其中的程序。运行桌面版无需安装 Qt 或 Node.js。

桌面版提供国策树、类别管理、示例图、失守剪枝、复盘、历史重试和备份。点图上的国策即可查看详情或记录失守。确认剪枝前可以填写失败原因和改进计划，归档后也可在「历史档案」补写。

### 迁移已有档案

1. 在之前使用每日国策的浏览器、配置文件和网址打开「数据备份」，点「导出备份」。使用本仓库默认本地预览的用户可打开 `http://127.0.0.1:4173/#backup`。
2. 在桌面版「数据备份」中选择导出的 JSON，核对双方的生效、归档和复盘数量，再确认导入。桌面版支持网页 v1、v2、v3，保留父子关系、建立日期和已用名额。
3. 桌面版自动保存到 `%LOCALAPPDATA%\DailyRule\archive.json`，升级后继续使用这个位置。再次导入不同的档案时，程序会先在同目录留下带 `.before-import-` 的恢复副本。网页与桌面版可继续通过 JSON 迁移，安卓与桌面版还可使用跨设备同步。

### 从源码构建 Windows x64 版本

在 MSYS2 的 UCRT64 环境安装编译工具和 Qt：

```sh
pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-qt6-base mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja
```

在仓库根目录的 PowerShell 中运行：

```powershell
.\desktop\build-windows.ps1 -Prefix C:\msys64\ucrt64
```

脚本使用 CMake 构建，运行原生存储与界面测试，再生成可运行目录和 ZIP。便携包随附 Qt 和所需 DLL 的许可说明。也可单独用 CMake 构建 `desktop/`。

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

树顶的空根只负责连接分支。初始提供「生活国策」「学习国策」「工作国策」三个类别。点空根或首页的「类别管理」可以自定义类别，空类别也会显示在图上。类别较多时，可用沙盘底部的「全部类别」切换到单个类别查看。

点「生活国策」等类别的名称或箭头可收起全部下级，再点一次展开。点类别右侧的「⋯」可查看详情并选择「在此类别新建国策」。空类别可以直接点开。也可从首页「新建分支」选择类别或保留「未分类」。同一分支的子国策继承上级类别。需要整理已有国策时，从分支最上层的国策详情中选择「调整分支类别」，整个分支一同移动。删除类别会将关联的国策及历史转为未分类。这些整理操作均不使用每日新增名额。

「示例图」展示一棵独立的个人国策树示例。点选自己的国策可添加子国策、预览失守影响并确认剪枝。记录失守时可分别写下失败原因和改进计划，也可以稍后在「历史档案」补写或修改。重新尝试前可以对照上次复盘调整触发时机和具体行动。复盘随 JSON 备份一起迁移。手机上的导航入口在左上角。

「数据备份」可导出带版本号的 JSON。换浏览器或换设备时，先导出，再在目标设备选择同一文件、核对数量并确认导入。导入将替换目标设备当前的整份档案。使用固定地址访问应用，浏览器会按网站来源保存数据，清除网站数据前请先导出。

当前导出第 3 版备份，包含自定义类别与失守复盘。新版可读取第 1、2 版备份，也会自动升级本机旧档案。第 1 版国策归入「未分类」，第 2 版保留已有类别，两者都保留父子关系、历史和每日名额记录。

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

## 开源许可

项目代码采用 [MIT 许可证](LICENSE)。第三方依赖遵循各自的许可证。
