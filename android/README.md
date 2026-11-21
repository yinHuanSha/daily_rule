# 安卓安装与构建

在安卓 8.0 或更新版本的手机上打开 `DailyRule-Android.apk` 并完成安装。使用保持更新的 Android System WebView 或 Chrome。应用的国策树和存储都可离线使用。

安卓和网页分别保存本机档案。原先用手机版网页的用户可以在原浏览器导出备份，再到 APK 的「数据备份」中导入。连接同一个私有同步仓库后，手机也可直接从云端取回电脑档案。后续升级直接安装同一签名的新版 APK，系统会保留原来的应用数据。

## 从源码生成 APK

准备 JDK 17 或 21、Android SDK Platform 35、Android SDK Build Tools 35.0.0，以及项目网页端的 Node.js 依赖。在仓库根目录的 PowerShell 中运行：

```powershell
npm ci
./android/build-windows.ps1 -SdkRoot 'C:\Android\Sdk' -Jdk 'C:\Java\jdk-21'
```

脚本使用 Vite 构建移动界面，调用 Android SDK 的 aapt2、d8、zipalign 和 apksigner 生成并验证 `release/DailyRule-Android.apk`。APK 自带网页资源，程序启动时从包内加载。

正式应用 ID 为 `io.github.yinhuansha.dailyrule`。发布更新时在 `AndroidManifest.xml` 中递增 `android:versionCode`。首次打包会在当前 Windows 用户的 `%LOCALAPPDATA%\DailyRuleSigning` 下新建签名身份，后续构建继续使用该密钥。密码由当前账户的 Windows DPAPI 加密。发布者应离线备份密钥及可在迁移机器时使用的恢复密码。安装在同一手机上的更新包需要相同的签名。
