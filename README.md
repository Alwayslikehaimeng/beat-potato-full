# 🥔 暴打土豆 / Beat Potato

> 一个极简解压桌宠。看见土豆 → 点一下 → 打击动画 + 音效 + 计数 +1 → 安静等待下一次。

**点一下就爽，不点就闭嘴。** 没有签到、没有任务、没有体力、没有广告。

---

## 三端全家桶

同一个玩法，三种形态，各自做到零第三方依赖。

| 端 | 技术 | 适合 | 在线体验 |
|---|---|---|---|
| **Web** | 原生 HTML/CSS/JS，纯静态 | iPhone / iPad / 任意浏览器 | **[alwayslikehaimeng.github.io/beat-potato](https://alwayslikehaimeng.github.io/beat-potato/)** |
| **PC** | C# + WPF + .NET 10 | Windows 桌面常驻 | 见下方下载 |
| **Android** | Kotlin + 原生 View + SoundPool | Android 6.0+ (API 26) | 见下方下载 |

---

## 玩法

| 操作 | 效果 |
| --- | --- |
| 轻触屏幕 / 左键点击 | 暴打一下（触摸一次 = 击打一次，零延迟） |
| 水枪 🔫 | 滋水；连续滋 5 次把土豆滋湿，4 秒后自己干 |
| 中指 ✊ | 竖中指，土豆鄙视你 |
| 左上「总暴打」 | 累计击打次数（永久保存） |
| 右上 🔊 | 音量：静音 / 25% / 50% / 75% / 100% |

**连击系统**：6 秒不揍，连击清零、土豆变回「正常」。
**六种形态**：连击数跨过 5 个阈值时，土豆依次进化到越来越摆烂的形态。阈值在首次打开时随机生成后永久固定，每台设备都不一样；**连击断掉后重新随机**，每次重置都是新的一轮。
**台词**：升级到特定形态、被滋湿、以及 10% 随机概率会触发土豆的语音吐槽。

### 三端一致性与有意的差异

核心玩法逐条对齐 **Android 端 `MainActivity.kt`** 为基准（PC 与 Web 向它看齐）。

**展开图的实现两端不同，但视觉效果一致（都是居中）**：

- **Android**：`MainActivity.kt` 用固定比例 `FLASH_LEFT_RATIO = 0.5f`（真正居中）水平定位，屏幕能装下整图，不需要动窗口。
- **PC**：`MainWindow.xaml.cs` 不用比例，而是先算土豆中心的实际画布坐标，再用 `Canvas.SetLeft(FlashImage, centerX - w / 2)` 居中；因为窗口只有 302×238 装不下整图，所以**临时扩大窗口**（`Root.Width` / `Root.Height` 按 `FlashPadding = 16` 撑开），并把 `Left` / `Top` 同步往左上挪以抵消内容位移，动画结束后还原。

**另一处刻意的行为差异**：湿身期间再按水枪，**Android 不播水声，PC 与 Web 播**。原因在 Android 的分支顺序——`MainActivity.kt:561` 先判 `if (wet)` 就 `return`（只续命 4 秒），根本走不到下面的 `playSquirtSound()`；PC 与 Web 都是先播声、后判湿身。Web 端早期版本曾按「以 Android 为准」做成不播，实测后与 PC 统一为播。

---

## 下载

到 [**Releases**](https://github.com/Alwayslikehaimeng/beat-potato-full/releases) 页面下载：

| 文件 | 大小 | 说明 |
|---|---|---|
| `BeatPotato-PC-win-x64.zip` | ~81 MB | **解压后双击 `BeatPotato.exe` 即用**，无需安装 .NET |
| `BeatPotato-Android.apk` | ~12 MB | 直接安装（需允许「未知来源」） |
| `BeatPotato-Web.zip` | ~9.8 MB | 纯静态站点，解压后跑 `serve.ps1` 或丢到任意静态托管 |

**PC 端**：自包含发布，内置 .NET 10 运行时，目标机器不需要装任何东西。

> ⚠️ 请勿使用「单文件发布」（`PublishSingleFile=true`）。WPF 的 `HwndSubclass` 会因原生 DLL 加载失败而崩溃：
> `System.DllNotFoundException: Dll was not found. at MS.Internal.WindowsBase...SetWindowLongPtrWndProc`。
> 这是 [dotnet/runtime#61279](https://github.com/dotnet/runtime/issues/61279) 的已知问题。本项目改用**多文件自包含**发布，内存占用更小（实测工作集 140 MB vs 单文件 270 MB）。

---

## 从源码构建

### PC

```powershell
# 需要 .NET 10 SDK
dotnet publish pc/BeatPotato/BeatPotato.csproj -c Release -r win-x64 `
  --self-contained true -o dist/pc
```

### Android

```powershell
# 需要 JDK 17 + Android SDK (compileSdk 36)
cd android
gradle assembleDebug          # 产物: app/build/outputs/apk/debug/app-debug.apk
```

### Web

```powershell
cd web
.\serve.ps1                   # 起本地服务，打印本机与局域网地址
```

手机会用同一 WiFi 打开 `http://192.168.x.x:8765/` 即可玩（这样音频才正常——直接双击 `index.html` 用 `file://` 打开时浏览器会拦 `fetch`，音效自动降级为 `<audio>`，部分浏览器不出声）。

自检页在 `/devtools.html`：核对 62 个素材是否加载、14 个音效逐个试听、查看存档。

### 无头自动化测试

```powershell
node tools/headless-check.js
```

用独立 `user-data-dir` 起 headless Edge（不碰你的浏览器），跑完 **iPhone 14 / iPhone SE / iPad 三档视口各 95 条断言 + 冻结恢复测试**，以及自检页 21 条断言。

---

## 项目结构

```
.
├── assets/                 ★ 素材唯一真源（73 个文件）
│   ├── potato/             土豆本体、六形态、受击帧、湿身帧
│   │   ├── state/          六形态静息帧 + 受击帧 + 湿身帧
│   │   ├── counter/        漫画连击徽章数字 + 爆点 + 「今日」标签
│   │   └── ui/             道具按钮图标
│   ├── audio/              14 个音效 wav
│   └── 音效/               10 个原始人声 mp3（素材源文件）
├── pc/BeatPotato/          C# + WPF 桌面端
├── android/app/            Kotlin Android 端
├── web/                    Web 静态端（也是 GitHub Pages 站点源）
├── tools/headless-check.js 无头自检工具
├── Plan.md                 项目计划书（Phase 0~9 完整历程与实测数据）
└── HANDOFF.md              交接说明
```

**素材单一真源**：根 `assets/` 是唯一真源，PC 靠 csproj 的 `<Content Link>` 映射、Web 靠 `sync-assets.ps1` 同步、Android 直接拷贝。改素材只需改根目录，再各自同步。

---

## 项目铁律

1. **性能优先**：待机不许有游戏循环、定时器、轮询、持续渲染。实测待机 CPU **0%**、GPU 0%。
2. **零第三方依赖**：不引 NuGet 包、不用 Electron / Unity / WebView。Android 端只有一个空 `dependencies {}` 块。
3. **不过度设计**：全部逻辑就在单个文件里（PC 是 `MainWindow.xaml.cs`，Web 是 `game.js`），不为「以后可能用到」加抽象层。
4. **不做**：登录、注册、联网、云同步、排行、广告、商店、内购、账号、社交、AI、复杂成就/养成、多人、后台联网、数据上传。

---

## 已知问题与踩坑记录

- **PC 单文件发布崩溃**（见上文，改用多文件）。
- **iOS Safari 后台会冻结 `setTimeout`**：连击超时清零因此不触发，回到前台时早该消失的徽章还挂着。修法是记录绝对时刻 `streakEndsAtMs`，在击打前与 `visibilitychange` / `pageshow` 时补判，定时器保留但不再作为唯一依据。**这是 Web 端独有的问题**，PC 的 `DispatcherTimer` 与 Android 的 `Handler.postDelayed` 实测正常。
- **Android 华为/HarmonyOS 机型日志默认静音**：`persist.log.tag = [S]` 会让所有 `Log.d` / `Log.i` 不进 logcat。调试前先 `adb shell setprop log.tag.<TAG> V`。
- **`screenrecord` 与 `adb` 命令不能并行**：`adb shell screenrecord` 会占住 shell 通道，另一条命令里的 `am start` / `input tap` 全部排队等待。要串成一条设备端命令。
- **PC 构建会因 exe 被占用而失败**（`MSB3027` / `MSB3021`）：先 `Get-Process -Name BeatPotato | Stop-Process -Force`。
- **`webserve` 的 Range 支持**：`serve.js` 实现了 Range 请求，因为 iOS 播音频会发 Range。

---

## License

个人项目，随意取用。素材（土豆形象与音效）请勿商用。
