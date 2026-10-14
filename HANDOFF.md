# 交接说明（给下一位 Agent）

- 交接时间：**2026-10-12**（上一轮 2026-10-07）
- 项目：暴打土豆 / Beat Potato（`A:\ai\Beat Potato`）
- **需求与阶段状态的唯一真源是 `Plan.md`，请先读它**（Phase 0~9 的完整历史、每阶段实测数据都在里面）
- 本文只讲：现在做到哪了、这一轮改了什么、怎么构建运行、有哪些坑、怎么验证

---

## 1. 项目是什么

极简解压桌宠：**看见土豆 → 点一下 → 3 帧打击动画 + 音效 + 计数 +1 → 回到静默待机**。

- PC 端：C# + WPF + .NET 10，`pc/BeatPotato/`
- Android 端：Kotlin + 原生 View + SoundPool，零第三方依赖，`android/app/`
- **Web 端（Phase 9，2026-10-12 新增）**：纯静态 HTML/CSS/JS，零构建零第三方依赖，`web/`，已上线 https://alwayslikehaimeng.github.io/beat-potato/

**项目铁律**（详见 `Plan.md` §3/§5/§8/§11）：

1. 性能优先：待机不许有游戏循环、定时器、轮询、持续渲染（实测待机 CPU 0%）
2. **零第三方依赖**：不引 NuGet 包、不用 Electron/Unity/WebView
3. 不过度设计：全部逻辑就在一个 `MainWindow.xaml.cs` 里，不要为了"以后可能用到"加抽象层
4. 素材单一真源在根 `assets/`，PC 侧用 csproj 的 `<Content Link>` 映射
5. 不加入自由走动、聊天、AI、喂养、天气、番茄钟等非必要桌宠功能

---

## 2. 当前进度

`Plan.md` 的 Phase 0~9 **全部标记完成**，项目停在 Phase 9。

### 本轮（2026-10-12）新增 Web 端（Phase 9）—— iPhone/iPad 走 Safari 直接玩

用户没有 iOS 设备，需要让 iPhone/iPad 用户也能体验。**决策：不做原生 iOS App**（要 Mac + Xcode + 开发者账号），改做纯静态网页版。**这推翻了 `Plan.md` 里"明确不做 iOS"那条旧决定**，但**没有推翻"零第三方依赖/不过度设计"**：网页版依然单文件逻辑、零构建、零依赖。

**产物（全部在 `web/`，已发布到 GitHub Pages）**

| 文件 | 作用 |
|---|---|
| `web/index.html` | 游戏主体，含 iOS 全套 meta（`user-scalable=no`/`viewport-fit=cover`/`apple-mobile-web-app-capable`/`apple-touch-icon`）；13 个土豆帧 `<img>` 全部预先摆好 |
| `web/style.css` | 全部样式，`env(safe-area-inset-bottom)` 处理刘海屏 |
| `web/game.js` | **全部逻辑，约 800 行单文件 IIFE**，15 个小节 |
| `web/devtools.html` | 自检页：素材核对 + 14 个音效试听 + 存档查看 + 玩法快捷 |
| `web/serve.js` / `serve.ps1` | 零依赖 Node 静态服务器（默认 8765，绑 0.0.0.0，**实现了 Range 请求**——iOS 播音频会发 Range） |
| `web/sync-assets.ps1` | 从根 `assets/` 同步素材到 `web/assets/`，并把三个中文名改成 ASCII（`水枪.png`→`prop_squirt.png`、`中指.png`→`prop_finger.png`、`土豆本豆.jpg`→`flash_potato.jpg`） |
| `web/icon-180.png` | 添加到主屏幕用的图标（由 `idle.png` 生成） |
| `tools/headless-check.js` | **无头自检工具**（放在 `tools/` 而非 `web/`，避免发布上线） |

**关键实现决策**（理由都别丢）：

- **玩法/动画/音效时长/六形态阈值区间/徽章排版一律以 Android `MainActivity.kt` 为基准**逐条对齐（用户明确要求），不再以 PC 为基准。常量同名同值：`FRAME_MS=60`、`POTATO_REF=280`、`HOLD_MS=120`、`STREAK_RESET_MS=6000`、`STREAK_DIGIT_REF=36`、`TODAY_DIGIT_REF=15`、`DIGIT_OVERLAP_RATIO=0.16`、`BURST_HEIGHT_RATIO=2.0`（注意 PC 是 1.55）、`BADGE_PAD_RATIO=0.14`、`STREAK_RIGHT_OVERHANG_REF=25`、`BADGE_POP_PEAK=1.45`、`SQUIRT_HITS_TO_WET=5`、`WET_HOLD_MS=4000`、`RANDOM_LINE_PERCENT=10`、`NODE_LINE_BLOCK_CLICKS=10`、`SQUIRT_LINE_BLOCK_CLICKS=10`、`RANDOM_LINE_COOLDOWN_CLICKS_HIT=30`、`RANDOM_LINE_COOLDOWN_CLICKS_PROP=20`、`STATE_THRESHOLD_RANGES=[[8,15],[20,35],[40,65],[70,100],[110,130]]`
- **DOM + CSS 而非 canvas**：道具按钮和音量菜单本来就得是 DOM；CSS 过渡做徽章弹跳比逐帧更顺；devtools 可调试；**待机零动画零定时器**（守住 `Plan.md` §3）
- **土豆切帧用 13 个预先摆好的 `<img>` 翻 `visibility`，不是换 `src`** —— 换 `src` 会触发重新解码，iOS 连点会闪
- **`pointerdown` 而非 `click`** —— 消灭 iOS 300ms 延迟，做到"触摸一次 = 击打一次"；配 `touch-action:none` + `-webkit-touch-callout:none` + `user-select:none` 防长按弹菜单/放大镜
- **首次进入有一层「轻触屏幕开始」**：iOS 规定音频必须用户手势解锁，这一层就是干这个的；**这一下不计入击打**（`pointerdown` 里先判 `!S.started` 就 `startGame()` 并 `return`）
- **音频用 Web Audio**（不是 `<audio>`）：可叠加、延迟低、能取精确 `buffer.duration` 来算台词时长（替代 Android 硬编码的 ms 值）。页面加载时就 `new AudioContext()`（suspended 状态也能 `decodeAudioData`）并并行解码，用户点开场页时只 `resume()`。`file://` 下 `fetch` 被 CORS 拦 → 自动降级成 `<audio>` 元素
- **存档每打一下都落盘**（不是照抄 Android 的每 50 下）—— `localStorage` 写几十字节是微秒级，换来"iOS 直接杀标签页也不丢进度"
- 布局：`side = clamp(min(W*0.80, H*0.52), 120, 760)`，`f = side/280`；**参照素材取 idle（1024×1024 正方形）**，所以状态变化时锚点不跳。手机竖屏恒由 `W*0.80` 决定（iPhone14=312、SE=300），只有 iPad 吃到高度那项（=710）

**iOS 三个坑（已处理）**：① 音频必须手势解锁 → 开场层；② `localStorage` 在 Safari 无痕模式可能不可用 → 全部读写 try-catch，失败静默降级、游戏照常能玩；③ 长按弹系统菜单/放大镜 → `touch-action:manipulation` + `-webkit-touch-callout:none`，且用 `pointerdown` 绕开 300ms 延迟。另外还加了 `gesturestart` 阻止、`contextmenu` 阻止、以及**一个空的 `touchstart` 监听让 iOS 的 `:active` 生效**。

**验证结论（全部无头，没弹过窗口、没碰用户鼠标）**：`tools/headless-check.js` 用独立 `user-data-dir` 起 headless Edge，手写迷你 CDP 客户端（零第三方依赖）。
- iPhone 14（390×844）/ iPhone SE（375×667）/ iPad（1024×1366）三档视口 **各 64/64 断言通过**
- `devtools.html` **21/21 通过**
- **线上 HTTPS 网址复验同样全过**，`audio` 走的是 Web Audio 而非降级路径
- 全程无 JS 异常、无 `console.error`、无 404

**发布方式**：仓库 `Alwayslikehaimeng/beat-potato`（公开，免费版 GitHub Pages 要求公开）。**git 仓库根就是 `web/` 目录本身**，所以 PC/Android 源码完全不进这个仓库。站点从 `main` 分支根目录发布。以后更新网页只需：

```powershell
cd 'A:\ai\Beat Potato\web'; git add -A; git commit -m '说明'; git push
```

注意：根目录 `A:\ai\Beat Potato` **仍然不是 git 仓库**（只有 `web/` 是，它里面有自己的 `.git`）。

### 后续同步（2026-10-13）—— Web 版补齐到 Android 最新玩法

起因：用户报「一段时间不打重置状态右上角计数不会消失」，并要求跟进 PC/Android 在 10-11 ~ 10-13 的一批更新（`Plan.md` 的 1301 / 1327 / 1394 段）。Web 的基准**始终是 Android**，逐条比对后改了九处，全部写进了 `Plan.md` 的 Phase 9「2026-10-13 追加」段落：

1. 连击断档时重随机形态阈值（`resetStreak()` 补 `rerollThresholds()`）
2. 随机阈值补上严格递增修正（原来是真 bug，会与 `isValidThresholds()` 打架）
3. 随机台词的两道闸（`stateIndex <= 0`、`nearUpgradeNode()`）**只作用于左键**，水枪/中指传 `false` 绕开
4. 冷却常量拆成 `RANDOM_LINE_COOLDOWN_CLICKS_HIT = 30` / `RANDOM_LINE_COOLDOWN_CLICKS_PROP = 20`，**初值 = 各自上限**
5. 中指补上随机台词机会（此前完全缺失）
6. 水枪新增跨轮不清零的 `squirtTotal`，前 10 下屏蔽随机台词；**湿身时不播水声**（对齐 Android；PC 在此有意不一致）
7. 道具按钮按下改为「本体不动、阴影上浮 1.35px、图标下移 2px」（Android `PROP_PRESS_PUSH_DP = 2f`）
8. **连击超时改用绝对时刻 `S.streakEndsAtMs` + `checkStreakTimeout()` 补判**（修 iOS 后台冻结 `setTimeout` 导致的计数不消失）
9. 素材 `state_5.png` / `state_5_hit.png` 同步；自检页增加新计数器显示

提交 `63dd60b`。断言从 64 条扩到 **87 条**，线上复验 **主页 87/87 + 自检页 21/21** 全过。

### 再一轮（2026-10-13）—— 把上面第 8 条的修复做成「可证伪的测试」

第 8 条当时只在无头环境「跑通」，但**没有任何测试能证明它真的有用**：相关断言在修复前后都 PASS。本轮补上，并做了反向验证。

| 测试 | 做法 | 能否区分修复前后 |
|---|---|---|
| **[A] 定时器被节流** | 拦截 `setTimeout`，让 `ms === 6000`（连击归零定时器）永不执行，模拟 iOS 后台「时间过了、回调没轮到」；再把 `streakEndsAtMs` 拨到 1 秒前，派发 `visibilitychange` | **能**。只靠定时器的实现徽章会一直挂着 → FAIL |
| **[B] CDP 真冻结 7 秒** | `Page.setWebLifecycleState` 冻 7 秒再解冻 | **不能**。解冻时浏览器会补跑积压的定时器，两种实现都归零。保留它只作「真冻结下页面不崩、恢复后能归零」的健康检查 |

**反向验证已做**：临时把 `checkStreakTimeout()` 的条件改成恒假，[A] 如期 FAIL（`streakHits=10 徽章=visible`）；恢复后 PASS。**没有这一步，"测试通过"是没意义的。**

新踩的坑（已写进 §5 坑位）：
- CDP 解冻**不保证派发 `visibilitychange`**，真实 Safari 回前台一定会。不补这次手动派发，[B] 会**随机假失败**。
- `tools/headless-check.js` 对 `devtools.html` 的断言原先只等 `window.BeatPotato` 存在，而尺寸表/音效时长是预载中逐个填入的 → **线上首次加载（无缓存）会读到残缺状态**，偶发 `0/14 音效时长`、`5/14 缩略图`、`21 格子/35 尺寸`。已改成必须等 `bp.state.ready === true`，并给 44 张缩略图加轮询。

跑法（在 §4b 的服务器跑着的前提下）：
```powershell
node 'A:\ai\Beat Potato\tools\headless-check.js' 'http://127.0.0.1:8765/' --viewport=iphone14 --freeze   # 含冻结复现
```

### 第三轮（2026-10-13）—— 用户实机反馈：上面那个修复根本没击中真实场景

用户原话：「问题还没有修复，在一段时间不打土豆了右上角数字还没有消失，2水枪五次触发语音后按水枪音效消失，随机音频不清楚」。

**① 连击数字不消失的真因，是 CSS `visibility` 的继承陷阱**（不是后台冻结）：

`renderStreak()` 隐藏时只设**父容器** `streakBadge.style.visibility = 'hidden'`，但 `renderStrip()` 会给**每个复用的 `<img>`** 写内联 `img.style.visibility = 'visible'`。`visibility` 虽是继承属性，**子元素一旦自己声明 `visible` 就会盖掉父级的 `hidden`** → 父容器 hidden、数字照旧画在屏幕上。

修法：新增 `hideBadge(host)`，连子元素一起隐藏。

**为什么此前 44 条断言全绿却漏了它**（最重要的教训）：断言查的全是 `sb.style.visibility` —— **容器自己的 style 属性不是实际渲染结果**。已新增 `badgeSeen(id)` 辅助函数逐个查子元素的 computed style，并改写三条相关断言。**反向验证**：临时禁用 `hideBadge` 的子元素循环 → 如期 FAIL（`seen=true 容器=hidden`，正是用户看到的现象）。
→ **凡是「元素有没有真的隐藏/显示」的断言，必须查 `getComputedStyle` 与子元素。**

**② 水枪从第 6 下起完全静音**：原判断 `if (!S.wet && S.squirtCount + 1 < SQUIRT_HITS_TO_WET)` 把**整段水声**包住了；而湿身期间每按一次水枪都会 `armDryUp()` **续命 4 秒**，于是连按水枪从第 6 下起彻底无声，随机台词也永远轮不到。改为只排除「即将变湿」那一下（`willWet`）。**反向验证**：临时改回旧写法 → 92 通过 / 3 失败，枚举输出精确复现用户现象（`6·湿=无声 … 20=无声`）。
第 5 下不播水声是 Android 既有行为（那一下由 `line_wet` 语音接棒），保持不变。

顺带把**湿身超时**也补了绝对时刻判定（`S.wetEndsAtMs` + `checkWetTimeout()`），与连击超时同源、同做法。

**③「随机音频不清楚」不是独立 bug**，是②的衍生疑问（用户澄清：「不是这个意思，我是说水枪没声音所以不知道水枪状态下是否有随机音频」）。**用实测枚举回答**：让随机数必定命中、连按水枪 20 下逐下记录 —— 第 1~10 下只播水声（铺垫期），第 5 下进湿身播 `line_wet`，**第 16 下首次出现 `line_rand1`**（`enterWet()` 里的 `playNodeLine` 把 `randomLineBlockedUntil` 推到 `clickSeq + 10 = 15`）。**结论：水枪状态下确实有随机音频，此前只是被静音掩盖了。**

**★ 新事实：线上首次加载约 50 秒**（GitHub Pages 冷启动拉 10MB 素材，实测 `state.ready` 约 49.8 秒才为真）。这推翻了「本地几十毫秒就绪」的假设，是本轮三个**测试环境 bug** 的共同根因：
- `tools/headless-check.js` 的 CDP 超时 30s → **180s**；主页 boot 等待 30s → **90s**。
- `web/devtools.html` 的 `waitForGame()` 原先 `if (ready || tries > 150)` —— **15 秒兜底在线上提前触发**，用残缺 `bp.dims` 渲染，素材总览只出十几个格子、`state_5` 显示旧尺寸。已改为**只在真正 `ready` 时才渲染**，兜底放宽到 90 秒。
- 线上徽章断言 `querySelectorAll('img')[0].getAttribute(...)` 首屏慢时会读到 undefined，已加空值防护。
- `DEVTOOLS_SCRIPT` 读的 `bp` 是 devtools 页面全局变量，冷启动超时后恒为 null → 断言脚本自己抛 `Cannot read properties of null` 崩掉（**崩掉会掩盖真正原因**）。已改为从 iframe 兜底取实例，彻底拿不到时**返回一条明确失败而不是崩溃**。

**素材同步**：用户换了 `state_2_hit.png`（443061 字节，仍是 637×755，宽高比不变故布局不受影响），要求三端一起换。PC 无独立素材目录（csproj 从根 `assets/` 映射）只需重新构建；web 走 `sync-assets.ps1`；Android 直接拷 `app/src/main/assets/potato/`。三端 + PC 输出目录均已核对为 443061，PC 与 Android 各自重新构建通过。

验证（全部线上实测）：主页 iphone14 / se / ipad 各 **95 通过 / 0 失败 + 冻结测试 [A][B] 双 PASS**（土豆边长 312 / 300 / 710.32，`audio` 走 webaudio），线上自检页**连跑三次 21/21**，本地同样 95/95 + [A][B] 双 PASS、自检页 21/21，全程无 JS 异常、无 console.error、无 404。提交 `d32d4b3`（三问题修复 + 素材）与 `580ef50`（devtools 兜底等待）已推送上线。

### 本轮（2026-10-06）在 PC 端做的事（共 7 项）

| # | 事项 | 性质 |
|---|---|---|
| 1 | 修漫画计数徽章：爆点图没设尺寸/位置导致被窗口裁成一条碎片；「今日暴打」父 Canvas 一直是 Hidden；连击 6 秒归零从未生效（计时器没有 `Start()`） | 修 bug |
| 2 | 窗口尺寸恒定（未击打时也按 1 位数字预留徽章空间，点击时土豆不再跳动）；鼠标命中收敛到土豆本体，透明区域不再误触发打击 | 修 bug |
| 3 | 徽章视觉迭代：数字 22 → 30 → **36 DIP**（×1.2）、画布留白比例 0.32 → 0.14、**窗口宽度 = 内容宽 + 右侧预留 25 DIP**、与土豆间距 0 | 用户审美调整 |
| 4 | 修托盘菜单丢失「显示层级」「大小」两个子菜单（`CreateRadioItem` 没挂到父菜单、两个子菜单对象没加进 `menu.Items`） | 修 bug |
| 5 | 修切换大小档位时连击徽章不跟随缩放（`ApplyScale` 少调了 `UpdateStreakBadge`） | 修 bug |
| 6 | **新增音量调节**：托盘「音量 > 静音 / 25% / 50% / 75% / 100%」，默认 100% | 新功能 |
| 7 | 修菜单交互：① 点菜单外部不收起（桌宠窗口非前台 → 拿不到鼠标捕获）② 菜单项/子项点击丢失 | 修 bug（回归自 ①） |

### 真机当前状态（交接时）

- **程序已被用户关闭**（`BeatPotato.exe` 不在运行；构建前不需要再关进程，直接 build 即可）
- 存档：`%APPDATA%\BeatPotato\stats.json` → `total 2242 / today 759`
- 设置：`%APPDATA%\BeatPotato\settings.json` → `Level=desktop, ScalePercent=100, VolumePercent=75, X≈921, Y≈377`
- **`VolumePercent=75` 是用户自己点出来的** → 说明托盘菜单「音量」子项点击已正常工作（本轮最后修的子菜单 bug 已获实机确认）
- 关闭前窗口为 **125×185 物理像素**，位置 (921,377)

### 本轮（2026-10-07）做的事：Android 端同步 PC 改动 + PC 爆点调大

| # | 事项 | 端 |
|---|---|---|
| 1 | **音量可调**：右上角自绘喇叭图标（`VolumeButtonView`，Path+Canvas 奶油色线条，非 emoji）→ AlertDialog 5 档（静音/25/50/75/100%），标量 = 档位×0.1/75（0.1 听感=75% 档），默认 75%，持久化 settings.xml | Android |
| 2 | **漫画计数徽章移植**：连击徽章（36dp 数字+随机爆点垫底，贴土豆右上，6 秒归零隐藏）+ 今日暴打徽章（15dp，土豆正下方），构图公式与 PC 一致；26 张 counter 素材已拷入 android assets；移除原"总暴打 N 次"文字条（总数仍持久化） | Android |
| 3 | **修 edge-to-edge 遮挡**：targetSdk 36 强制窗口延伸到状态栏后面，音量按钮被状态栏图标盖住；顶边距改为状态栏高度+4dp | Android |
| 4 | **爆点调大**：BurstHeightRatio 1.55 → 2.0 | Android + PC |
| 5 | **数字弹跳**：打击瞬间连击/今日徽章放大 1.45 倍，随打击动画三帧收回（PC 用现有 _animTimer 接通 XAML 遗留的 TotalBounce/TodayBounce；Android 用 animHandler 一次性链 badgePop），零新增计时器 | Android（实测✓）+ PC（仅代码） |
| 6 | **背景改浅**：原深棕 0xFF221C15 上"今日暴打"纯黑素材不可读（用户反馈）；改漫画纸感浅米色 0xFFF1E7CF，音量图标墨色改深棕，主题改 Theme.Material.Light | Android（实测✓） |
| 7 | **修 today_9 灰色杂条**：素材尾杆 29 个 #999 灰像素（唯一异常，其余数字 ≤3）改纯黑（共 38 像素），根 assets 已改并同步 android；PC 走 Content Link 构建时自动更新 | 素材（双端共用） |
| 8 | **今日徽章去弹跳**：数字弹跳仅连击徽章（Android badgePop、PC OnAnimTick 均不再触碰 TodayBounce） | Android（实测✓）+ PC（harness✓） |
| 9 | **总暴打恢复常显**：Android 左上角"总暴打 N"小字（14sp 深棕，避开状态栏，击打即时刷新） | Android（实测✓） |
| 10 | **土豆本体受击动画实验（已终结）**：变换式、Gemini 5 格 4 帧、12 格 11 帧、4 格弹跳（bwnnsv，含"按 idle 占比切帧"修正）共四轮方案均被用户否决并全部回退——实验素材（hit_f* 切帧、第一轮源图）已删除，PC/Android 恢复最初 3 帧方案（hit_1/2/3）；今天的徽章弹跳/总暴打常显/浅色背景/音量调节等改动保留 | 双端已回退（PC 已重启） |

### PC 端 2026-10-07 构建与回归（已完成）

- Release 构建通过（0 错误），bin 内 today_9.png 与根 assets md5 一致
- 隔离 harness 18 项全部通过：弹跳序列（1.45→1.2→1.1→1，TodayBounce 恒 1）、爆点 2.0 画布高 82.08 DIP 且五档严格 ×f、今日数字 9 灰色像素 0、连击 6 秒归零、五档窗口内容宽 62.5/93.8/125/156.2/187.5 与历史值一致、连击「12」渲染存证 ✓
- 测后已恢复用户存档（stats 2242/759、settings ScalePercent=100/VolumePercent=75），临时目录已清理
- 新坑：未 Show 的 WPF 窗口用 VisualBrush 渲染前必须手动 Measure/Arrange/UpdateLayout；ApplyScale 会写 settings.json，harness 跨轮次运行前必须还原备份

- Android 实测（真机 adb 注入）：启动无崩溃 ✓；连击累加（2 击→「2」）✓；6 秒归零隐藏 ✓；今日徽章持续 ✓；**音量对话框实机点选未验证**（用户当时正在用手机，注入点击会误触其前台应用，主动中止）
- **PC 端 BurstHeightRatio=2.0 只改了代码，未构建未测试**（用户："电脑待会再测试"）；改完徽章记得跑 HANDOFF §6 快速回归
- 用户还有排队中的视觉反馈（数字"9"下边发黄要整黑、手机端背景等），下一轮处理完一起做完整回归

### 本轮（2026-10-10）做的事：PC 端新增「右键喷水 + 中键竖中指」

| # | 事项 | 性质 |
|---|---|---|
| 1 | **删掉土豆的右键 WPF 菜单**（暂停/统计/隐藏/退出），右键专职喷水；这些功能托盘里全有。连带删除 `OnMenuOpened/OnMenuClosed`、`OnPauseClick/OnHideClick/OnExitClick`、菜单钩子里的 WPF 分支 | 改交互 |
| 2 | **右键喷水**：水枪出现在土豆右侧、枪口朝左对着土豆，300ms 后收回；累计**第 5 下**土豆变「被滋湿」，**4s** 后自动恢复（湿着时继续滋会刷新这个时间——只要还在滋就一直是湿的，停手 4 秒才干） | 新功能 |
| 3 | **中键竖中指**：中指出现在土豆正中间偏下、挡住一小部分土豆，400ms 后收回 | 新功能 |
| 4 | **两者都不计数**：不碰 `_totalHits`/`_todayHits`/`_streakHits`、不启动连击计时器、不影响六状态、不写存档 | 设计约束 |
| 5 | **音效**：`assets/音效/水枪.mp3` 切成 4 段随机播（`squirt_1~4.wav`），`鄙视.mp3` → `despise.wav`；沿用现有 wav + `SoundPlayer` + 音量档 PCM 缩放，**零第三方依赖**（ffmpeg 只在做素材时用一次） | 素材 + 新功能 |
| 6 | **湿身素材归一化**：`被滋湿.png` → `state/wet.png`（内容按六状态同规矩对齐：脚底基线、体量、水平站位一致，切换不跳） | 素材 |
| 7 | **窗口宽度常驻多留 0.95×土豆宽**给水枪（右侧透明留白），点击时窗口尺寸不变、不抖 | 布局 |

- 构建：Release **0 错误**（2 个既有 CS8602 警告，2026-10-11 起位于 `MainWindow.xaml.cs(1153,13)` 与 `(1164,13)`）
- **2026-10-11 真机试玩后的微调**（用户实测反馈）：① 水枪放大并往土豆那边压——内容高 0.45→0.62×土豆高、从贴右缘改成往左叠进 0.26×土豆高、垂直中心 50%→57%（三次迭代见 Plan.md 实现记录）；② 湿身规则由“固定 2s”改成“**4s，且湿着时继续右键刷新**”，因为用户实测时“右键点慢了或停一下，湿身突然就变回正常”，其实那是旧规则到点自动干；③ 湿身期间右键只刷新时间、**不累计**下一次（当次之后仍要重新连点 5 下才会再湿）
- **2026-10-11 缩放基准调整**（用户：“把 125 的大小变成百分之百的，其他的也同步缩小放大”）：`BaseSide` 100 → **125**（= 100% 档的土豆边长 DIP），即**原 125% 档的像素大小成为现在的 100% 档**，五档标签 `{50,75,100,125,150}` 一字未改、其余档位同步 ×1.25。配套：新增 `LayoutRefSide = 100` 与 `PotatoSide()`（= 土豆当前绝对高度），`UpdateStreakBadge`/`UpdateTodayBadge`/`UpdateRootWidth` 的 `f` 由 `_settings.ScalePercent / 100.0` 改成 `PotatoSide() / LayoutRefSide`（徽章、爆点、右侧预留这些常量当初按 100 DIP 土豆调过，必须跟着土豆绝对高度走，否则土豆放大而徽章不动），`propReserve` 改成 `PotatoSide() * PropReserveRatio`（原式会双重计入 BaseSide）。用户存档 `ScalePercent` 125 → 100，**画面逐像素不变**（窗口尺寸未变，X/Y 无需重算）。harness 复跑：init `Root.Width=301.8 实际=301.8×237.3`、`Potato 125×125 MarginL=1.2`、`SquirtProp W=190.0`、`FingerProp W=170.5 H=106.9`；50% 档 `150.9`、150% 档 `452.7` —— **全部恰为改动前 100% 档记录的 1.25 倍**（旧 241.4 / 100×100 / 152.0 / 136.4；旧 50% 120.7、150% 362.1）
- 隔离 harness 逐项通过（清单见 §6 第 6 条），10 张离屏截图存 `%TEMP%\bp_harness\shots\`，其中 5 张已拷到 `preview/prop-squirt.png` / `prop-wet.png` / `prop-finger.png` / `prop-wet-finger.png` / `prop-hit-badge.png`（最后一张校验“土豆放大后连击徽章同步放大”）；湿身刷新规则已加进 harness（第 5 下→+3.5s 还湿→再滋一下→+3.5s 还湿→再等 1s 才干）
- **真机鼠标实测未做**：用户当时在玩游戏，等他说开工后再点真实右键/中键
- 用户存档测后已还原（`stats.json` total 4230 / today 37；`settings.json` VolumePercent=75、ScalePercent=100），App 已按新档位重启供用户继续试玩
- **2026-10-11 台词 + 「土豆本豆」展开图**（用户追加需求，详见 Plan.md 对应记录）：① 8 个台词 mp3 转 wav 进 `assets/audio/`（`line_wet` / `line_stage2` / `line_final` / `line_rand1~5`），音量照旧跟托盘档；② 变湿那一下**不播水声**，改播「我后背湿着呢」并把 `assets/potato/土豆本豆.jpg` 由小到大甩出来再消失；③ 左键升级到**「有点烦」**播「你看有人理你吗」、升级到**「摆烂」**播「要死了」（都顶掉暴打音）；④ 剩下 5 句在左键/右键/中键时按 **10%** 概率随机播，且**两次之间至少隔 30 次点击**（`RandomLineCooldownClicks=30`），**并且在两个重要升级节点（升到「有点烦」/ 升到「摆烂」）的前、后各 10 次点击内一律不出**（`NodeLineBlockClicks=10` + `_clickSeq`/`_randomLineBlockedUntil` 管后置、`NearUpgradeNode()`/`NearThreshold()` 管前置；那两句专属台词本身不受任何限制。变湿节点只做后置、不做前置）；⑤ **台词播放期间一点打击音都没有**（用户明确要互斥，不是叠加）：`PlayLine()` 记下结束时刻、`LineIsPlaying` 期间 `Squirt`/`ShowFinger`/`HitPotato` 都不播基础音效，台词不被打断；⑥ 展开图靠 Storyboard 三段（**150ms 放大 / 500ms 停留 / 160ms 淡出 = 810ms**，零新增定时器），位置 `FlashLeftRatio=0.22`（靠左），因为图是竖图，动画期间**临时把窗口做大**（只改 Width/Height、左上角不动，所以土豆不移位），结束后尺寸自动还原。csproj 为此新增 `assets\potato\*.jpg` 通配。另：9 个台词/鄙视 wav 都做过**首尾静音裁剪**（`silenceremove` 双 reverse，共省约 12s；如 line_stage2 4.33s→2.15s、line_final 2.54s→0.94s），缩短"台词占住声道"的时间。harness 实测：台词音效全 ok、`PlayStateLine` 只在 (0→1) 与 (4→5) 返回 True、`WavDurationMs` 解析与实际一致、冷却=0 时 1000 次调用命中 0 次、每次补满冷却后命中率 12.1%、展开瞬间 L=12.7 窗口 237.3→357.0、1.1s 后自动收起并交回 Auto 高度
- **2026-10-11 两处修复**（用户实机反馈，详见 Plan.md 对应记录）：① **连击徽章被水枪预留区推远** —— `UpdateRootWidth()` 常驻的右侧透明预留区（`PropReserve()` ≈ 119 DIP）把**窗口**加宽，而徽章是右对齐到窗口右缘的，于是被一起带远；修法是把它从徽章右边距里扣掉（`UpdateStreakBadge()` 的 `marginRight` 减去 `PropReserve()`），实测徽章左缘由"土豆右缘右侧约 119 DIP"回到"土豆右缘左侧 66.2 DIP"。② **展开图改为以土豆为中心** —— 原先图偏右下（中心偏右 70.9、偏下 27.4），根因是窗口左边贴着土豆、比土豆宽一倍的图以土豆为中心必然被裁；改法是闪现期间**把窗口向左上扩**（`Left` −58.2、`Top` −11.4）同时用 `Root.Margin` 往右下补偿同样距离，两者抵消 → 土豆屏幕位置不动而图能完整居中；实测图中心 (63.7, 151.1) 与土豆中心**完全重合**，1.1s 后 `Root.Margin` 归零、窗口 `Left/Top` 精确还原为 300.0/300.0。`FlashLeftRatio` 常量删除。配套堵坑：`OnClosed` 在 `_flashRunning` 时用原始 `Left/Top` 存档（免得闪现那 810ms 内退出把偏移坐标写进 `settings.json`）。截图 `preview/flash-centered.png`

---

## 3. 代码地图

| 文件 | 作用 |
|---|---|
| `Plan.md` | **需求 + 阶段状态真源**，每次改动后必须更新 |
| `HANDOFF.md` | 本文 |
| `docs/tech-decisions.md` | Phase 0 技术选型结论与排除项 |
| `assets/potato/` | 土豆 4 帧 512×512、`icon.ico`（7 帧 16~256，32bpp alpha） |
| `assets/potato/counter/` | 计数徽章素材：`total_0~9`（150px 归一化）、`today_0~9`、`burst_1~4`（爆点）、`label_jin/bao` |
| `assets/audio/hit.wav` | 44.1kHz 单声道 16-bit，两端共用 |
| `assets/audio/squirt_1~4.wav` | 右键喷水随机音（44.1kHz 双声道，2026-10-10 从 `assets/音效/水枪.mp3` 的有声段切出） |
| `assets/audio/despise.wav` | 中键竖中指音（48kHz 双声道，从 `assets/音效/鄙视.mp3` 转出） |
| `assets/potato/state/wet.png` | 「被滋湿」归一化素材（1046×1199，内容按六状态规矩对齐） |
| `assets/potato/土豆本豆.jpg` | 变湿时甩出来的展开图（1279×1706 实拍竖图、无透明通道；csproj 用 `*.jpg` 通配带进构建） |
| `assets/audio/line_wet.wav` | 变湿台词「我后背湿着呢」（3.29s） |
| `assets/audio/line_stage2.wav` | 左键升到「有点烦」时播「你看有人理你吗」（4.33s） |
| `assets/audio/line_final.wav` | 左键升到「摆烂」时播「要死了」（2.54s） |
| `assets/audio/line_rand1~5.wav` | 随时 10% 随机冒的 5 句台词：你有病吧 / 你是臭傻子吧 / 你是臭傻逼不 / 略略略 / 我真不中 |
| `pc/BeatPotato/MainWindow.xaml` | 窗口/徽章 Canvas/道具层/展开图层（约 66 行；**右键菜单 2026-10-10 已删除**） |
| `pc/BeatPotato/MainWindow.xaml.cs` | **全部逻辑，约 1360 行单文件** |
| `pc/BeatPotato/BeatPotato.csproj` | 素材 Link 拷贝、图标、net10.0-windows + WPF + WinForms |
| `android/app/.../MainActivity.kt` | Android 端全部逻辑（约 500 行，2026-10-07 加音量+徽章；含 StreakBadgeView/TodayBadgeView/VolumeButtonView 三个自绘 View） |
| `web/game.js` | **Web 端全部逻辑，约 800 行单文件**（Phase 9；网页版一切常量与语义的基准是 Android 的 `MainActivity.kt`，不是 PC） |
| `web/index.html` / `web/style.css` | Web 端 DOM 结构与样式（13 个堆叠 `<img>` 切帧、`.gated` 开场层、CSS 硬阴影按钮） |
| `web/devtools.html` | Web 端自检页（同源 iframe 加载真实 `index.html`，通过 `iframe.contentWindow.BeatPotato` 驱动） |
| `web/serve.js` / `web/serve.ps1` / `web/sync-assets.ps1` | 本地静态服务器（实现 Range）/ 启动脚本 / 素材同步脚本 |
| `tools/headless-check.js` | **无头自检工具**（`node tools/headless-check.js [url] [--viewport=iphone14\|se\|plus\|ipad\|ipadmini\|宽x高]`；独立 user-data-dir 起 headless Edge + 手写迷你 CDP 客户端，零第三方依赖。带 `devtools.html` 的 URL 会自动换用另一套断言） |
| `pc/publish/` | 三种发布产物（framework-dependent / self-contained / self-contained-compressed ≈66MB 可直接双击） |

### `MainWindow.xaml.cs` 区域索引

- **常量区**：`StreakDigitHeight=36`、`TodayDigitHeight=15`、`DigitOverlapRatio`、`BurstHeightRatio=1.55`、`BadgePadRatio=0.14`、`StreakRightOverhang=25`、`StreakGapAbove=0`、`StreakSideMargin=1`、`TodayGapAbove`、`VolumeOptions`
- **音效/音量**：`HitWav`/`SquirtWavs`/`DespiseWav`/`LineWetWav`/`LineStage2Wav`/`LineFinalWav`/`LineRandomWavs`、`LoadWav()`、`ScaleWav()`（PCM 缩放）、`CreateSound()`、`RebuildSounds()`（一次重建 15 个 SoundPlayer：暴打 + 4 段水声 + 鄙视 + 3 句专属台词 + 5 句随机台词）、`ApplyVolume()`
- **窗口层级**：`ApplyLevel()`（仅桌面 = owner 挂 Progman；始终置顶 = Topmost）、`SetOwnerWindow()`
- **素材与徽章**：`LoadSprite`、`LoadCounterAssets`、`BuildCounterBadges`、`UpdateStreakBadge`、`UpdateTodayBadge`、`UpdateRootWidth`
- **尺寸与位置**：`ApplyScale`、`ApplyRestoredPosition`、`BaseSide=125`（100% 档的土豆边长 DIP，2026-10-11 由 100 调上来）、`LayoutRefSide=100` + `PotatoSide()`（土豆当前绝对高度；徽章、爆点、右侧预留这些按 100 DIP 土豆调过的常量统一除 `LayoutRefSide` 换算）
- **交互**：`OnMouseLeftButtonDown/Move/Up`（**事件绑在 `Potato` 上，不是 Window**）、`HitPotato`、动画 `OnAnimTick`
- **新交互（2026-10-10）**：`OnMouseRightButtonDown`、`OnMousePropDown`（只认 `MouseButton.Middle`）、`Squirt`、`ShowFinger`、`EnterWet/ExitWet`、`ApplyPropLayout`、`PlaySound`；道具画在三行 Grid 的行 1 上的 `PropLayer`（`IsHitTestVisible=False`，**不参与测量**，所以不影响土豆位置与今日徽章）
- **台词与展开图（2026-10-11）**：`PlayRandomLineIfLucky()`（10% 随机台词，左键/右键/中键共用）、`PlayStateLine(prev,next)`（升到「有点烦」/「摆烂」时播专属台词）、`ShowFlash()/EndFlash()`（Storyboard 放大→停留→淡出，期间临时扩窗口，`FlashImage`/`FlashScale` 在 XAML 的最上层 `FlashLayer` 里）、`PlaySquirtSound()`；常量 `RandomLinePercent=10`、`FlashHeightRatio=2.6`、`FlashPadding=16`、`FlashScaleFrom=0.12`、`FlashGrowMs=150`/`FlashHoldMs=500`/`FlashFadeMs=160`（合计 810ms）；**位置不再用比例常量**（`FlashLeftRatio` 已删除），改为**以土豆为中心**：闪现期间把窗口向左上扩 `padX/padY`、同时用 `Root.Margin` 把内容往右下补偿同样距离（两者抵消 → 土豆屏幕位置不动），`EndFlash()` 全部还原；配套字段 `_flashSavedMargin`/`_flashSavedLeft`/`_flashSavedTop`/`_flashNeedWidth`，`OnClosed` 在 `_flashRunning` 时用原始 `Left/Top` 存档
- **窗口宽度与右侧预留（2026-10-10 起）**：`PropReserve()`（= `PotatoSide() * PropReserveRatio`，0.95 × 土豆高）把右侧透明预留区抽成一处；`UpdateRootWidth()` 的窗口宽 = 内容宽 + 预留 + 徽章右伸；**`UpdateStreakBadge()` 的右边距必须把 `PropReserve()` 扣掉**，否则徽章（右对齐到窗口右缘）会被预留区推远——2026-10-11 出过这个回归，用户反馈后修复
- **台词互斥 + 随机台词冷却（2026-10-11 追加）**：`PlayLine(player, ms)` + `LineIsPlaying`（依据 `_lineEndsAt` 判断，因为 `SoundPlayer` 查不到播放进度）、`WavDurationMs(byte[])` 解析 wav 头算时长（预计算成 `LineWetMs=2036`/`LineStage2Ms=2146`/`LineFinalMs=936`/`LineRandomMs=[1407,2989,1547,1409,2444]`）；`Squirt`/`ShowFinger`/`HitPotato` 三处在台词播放期间**不播任何基础音效**（台词不被打断，计数/受击帧/徽章照常）；`RandomLineCooldownClicks=30` + `_clicksSinceRandomLine`（每次点击 +1、随机台词命中后清零，专属两句不受限制）；**节点保护窗口（前、后各 `NodeLineBlockClicks` 次，常量 2026-10-11 深夜由 20 收窄为 10）**：`OnClickTick()`（三个入口共用的点击推进）、`PlayNodeLine()`（播专属台词并把 `_randomLineBlockedUntil = _clickSeq + NodeLineBlockClicks`）管**节点之后**，`PlayRandomLineIfLucky()` 里 `_clickSeq <= _randomLineBlockedUntil` 直接返回 false；**节点之前**则由 `NearUpgradeNode()`（`NearThreshold(_stateThresholds[0]) || NearThreshold(_stateThresholds[4])`，只护第 2/第 6 形态）+ `NearThreshold(int threshold)`（`var remain = threshold - _streakHits; return remain >= 0 && remain <= NodeLineBlockClicks;`）拦住。上一轮只做了后置窗口，"附近"的前半段漏掉了，用户 2026-10-11 反馈后才补上。**没有**改用 WPF `MediaPlayer`（实测它可与 `SoundPlayer` 并存，但用户明确要"有台词就没打击音"的互斥）
- **统计**：`LoadStats`、`SaveStats`（退出 + 每满 50 次）、`RollTodayIfNeeded`
- **设置**：`LoadSettings`、`SaveSettings`
- **托盘**：`InitTray`、`CreateRadioItem`（**会挂到父菜单 DropDownItems**）、`RefreshTrayMenu`、`ToggleHidden`、`TogglePause`
- **开机启动**：`IsAutostartEnabled`、`SetAutostart`（HKCU Run）
- **菜单收起钩子**：`OnAnyMenuOpened/Closed`、`Install/UninstallMenuDismissHook`、`OnLowLevelMouse`、`IsOverAnyMenu`、`IsOverDropDown`、`HitTestWindow`（**只剩托盘菜单**；WPF 菜单分支 2026-10-10 删除）
- **Win32 导入**：文件末尾

---

## 4. 环境与命令（务必照做）

.NET 10 **只装在用户级**（机器级只有 6.0/8.0）：

```
dotnet.exe : %LOCALAPPDATA%\Microsoft\dotnet\dotnet.exe
SDK        : 10.0.302
运行时     : Microsoft.WindowsDesktop.App 10.0.10
```

**构建**：

```powershell
& "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe" build `
  'A:\ai\Beat Potato\pc\BeatPotato\BeatPotato.csproj' -c Release
```

**运行**（直接双击 exe 会提示缺运行时）：

```powershell
$env:DOTNET_ROOT = "$env:LOCALAPPDATA\Microsoft\dotnet"
Start-Process 'A:\ai\Beat Potato\pc\BeatPotato\bin\Release\net10.0-windows\BeatPotato.exe'
```

**改代码前必须先关掉正在运行的实例**（否则 `BeatPotato.exe` 被锁，构建失败）：

```powershell
# Process.CloseMainWindow() 对这个桌宠无效（MainWindowHandle 为 0），要用 WM_CLOSE：
#   EnumWindows 找到标题以 "Beat Potato|" 开头的窗口 → PostMessage(0x0010)
# 这样才会走 OnClosed，把计数和窗口位置落盘
```

**关机式退出会丢数据**：`Stop-Process` 跳过 `OnClosed`，内存里的计数不会落盘。

---

## 4b. Web 端（Phase 9）—— 零构建，直接就是成品

网页版**没有构建步骤**，`web/` 里的文件就是最终发布物。素材改过之后先同步：

```powershell
pwsh -File 'A:\ai\Beat Potato\web\sync-assets.ps1'    # 根 assets/ → web/assets/，中文名转 ASCII
```

**本地试玩**（会打印本机 + 局域网地址）：

```powershell
pwsh -File 'A:\ai\Beat Potato\web\serve.ps1'          # 默认 http://localhost:8765/
```

手机连同一个 WiFi 用 Safari 打开打印出的 `http://192.168.x.x:8765/` 即可（**必须走 http，不能双击 `index.html`**：`file://` 下 `fetch` 被 CORS 拦，音效会降级成 `<audio>` 且部分浏览器不出声）。

**无头自检**（不弹窗、不碰用户浏览器和鼠标）：

```powershell
node 'A:\ai\Beat Potato\tools\headless-check.js' 'http://127.0.0.1:8765/' --viewport=iphone14
node 'A:\ai\Beat Potato\tools\headless-check.js' 'http://127.0.0.1:8765/' --viewport=se
node 'A:\ai\Beat Potato\tools\headless-check.js' 'http://127.0.0.1:8765/' --viewport=ipad
node 'A:\ai\Beat Potato\tools\headless-check.js' 'http://127.0.0.1:8765/devtools.html'   # 自检页
node 'A:\ai\Beat Potato\tools\headless-check.js' 'https://alwayslikehaimeng.github.io/beat-potato/'  # 线上
```

`--viewport` 可选 `iphone14`(390×844) / `se`(375×667) / `plus`(428×926) / `ipad`(1024×1366) / `ipadmini`(744×1133)，也可直接写 `--viewport=400x800`，或用环境变量 `BP_VIEWPORT`。

**发布**（`web/` 自己就是 git 仓库根，PC/Android 源码不在里面）：

```powershell
cd 'A:\ai\Beat Potato\web'
git add -A; git commit -m '说明'; git push
```

推完等 1 分钟左右，https://alwayslikehaimeng.github.io/beat-potato/ 自动更新（站点从 `main` 分支根目录发布）。

---

## 5. 坑（这一轮踩过的，别重踩）

1. **主窗口带 `WS_EX_NOACTIVATE`**（"点击土豆不抢焦点"，Phase 8 的既定设计），连锁后果：
   - 窗口**永远不是前台窗口** → Windows 不允许它获得鼠标捕获（实测菜单打开时 `GetCapture()==0`）→ WPF 菜单无法靠"点外部"自动关闭，必须自己用 `WH_MOUSE_LL` 低级别钩子
   - `Process.MainWindowHandle` 为 0 → `CloseMainWindow()` 无效，要用 `PostMessage(WM_CLOSE)`
2. **`ContextMenu.Parent` 恒为 `null`**（WPF 的 ContextMenu 不以 Popup 作逻辑父级）。取菜单窗口要用：
   `PresentationSource.FromVisual(ContextMenu) as HwndSource` → `.Handle` → `GetWindowRect`
3. **WinForms 子菜单是独立窗口**，位置在主菜单矩形**之外**（实测主菜单 (300,300)-(453,502)，音量子菜单 (452,428)-(612,602)）。判断"鼠标是否在菜单上"必须**递归检查所有 ToolStripDropDown**
4. `ToolStrip.Visible` / `.Bounds` 在未显示状态下不可靠 → 用 `Opened`/`Closed` 事件维护开关
5. 素材路径必须基于 `AppContext.BaseDirectory`（相对 URI 按进程工作目录解析，换目录启动即崩）
6. 托盘菜单项必须 `parent.DropDownItems.Add(item)` 才会出现（只 `new` 出来是悬空的）
7. `System.Text.Json` 序列化 `double.NaN` 会抛异常（窗口 `Left/Top` 理论风险；实测 WPF 会把它规范化成实际值）
8. 徽章素材缺失时代码退化为不显示，不崩
9. **反射读字段必须带 `BindingFlags.Static`**：`SquirtPropSprite`/`FingerPropSprite`/`WetSprite`/`SquirtWavs`/`DespiseWav` 是 `static readonly`，只用 `Instance|NonPublic` 会取到 `null` 并在 `GetValue` 处 NRE（2026-10-10 harness 踩过）
10. pwsh 的 `Add-Type` 走 C# 5 编译器：**不支持 `using var`**（报"语法错误，应输入 ("），要写 `using (...) { }`；编译含 `System.Drawing` 的代码要先 `Add-Type -AssemblyName System.Drawing`，再传 `-ReferencedAssemblies ([System.Drawing.Bitmap].Assembly.Location)`
11. 跑 harness 必须让 .NET 10 生效，否则用系统 dotnet（只有 6/8）会报 “You must install or update .NET to run this application”（先用 exe 直接跑报这个、再用 `dotnet BpHarness.exe` 跑报 `BadImageFormatException: Bad IL format`）。
   - **正确姿势**：`$env:DOTNET_ROOT = "$env:LOCALAPPDATA\Microsoft\dotnet"`，然后 `& "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe" "<harness>\bin\Release\net10.0-windows\BpHarness.dll"`（跑 **.dll**，不是 apphost .exe）。
12. 不要用 `& exe ... | Select-Object -First N` 截断长输出：`Select-Object -First` 会**提前掐断上游进程**，harness 会写到一半被杀（表现为“截图还是旧的/哈希没变”）；改成 `& $dotnet ...dll *> run.log` 全量落盘，再用 `Select-String -Path run.log` 过滤。
13. 把素材同步到 harness 输出目录**必须用 `robocopy /MIR`**：目标 `assets` 目录已存在时 `Copy-Item -Recurse -Force` **不会带新增文件**，表现是"新加的 wav/jpg 在 harness 里全部加载成 null（`_lineWetSound=null`、`FlashSprite=null`）"，而真实 App 的 bin 目录里其实是好的（2026-10-11 踩过）。命令：`robocopy "<PC bin>\assets" "<harness bin>\assets" /MIR /NJH /NJS /NP /NFL /NDL`。
14. **含中文的 `.ps1` 必须先加 UTF-8 BOM 再执行**（`web/sync-assets.ps1`、`web/serve.ps1` 已加好，新增脚本记得照做），否则 pwsh 在中文 Windows 上按 GBK 读文件，会把中文注释里的字节吃成引号，报 `The string is missing the terminator` / `Unexpected token '}'`。加 BOM 的写法：`$txt=[System.IO.File]::ReadAllText($p,[System.Text.UTF8Encoding]::new($false)); [System.IO.File]::WriteAllText($p,$txt,[System.Text.UTF8Encoding]::new($true))`
15. **无头自检报 `CDP timeout: Runtime.evaluate` 时，先去看本地服务是不是挂了**（`Invoke-WebRequest http://127.0.0.1:8765/` 试一下）。页面加载不出来 → 断言脚本里的"等 `state.ready`"循环会拖过 30 秒 CDP 超时，看起来像脚本 bug，其实只是服务没了。2026-10-12 在这一点上白折腾了三轮。
16. **GitHub Pages 的 `.nojekyll` 必须在发布目录根**（`web/.nojekyll`）。放在 `web/assets/.nojekyll` 不起作用——它的作用范围是"所在目录成为 Jekyll 处理的站点根"，而站点根是 `web/`。
17. **`& node ... | Select-String <pattern>` 一条都不匹配时，输出会是一片空白**，看起来像"命令没跑"，实际是过滤太严。长输出一律 `*> $log` 落盘，再用 `Select-String -Path $log` 慢慢过滤（这条和坑 12 是同一个道理）。
18. `tools/headless-check.js` 里的断言脚本是 **Node 的 template literal**，跨视口的期望值必须写成 `${WIDTH}` / `${HEIGHT}` 才会在 Node 侧插值；写成裸标识符会变成页面里的 `undefined`。2026-10-12 就是因为把期望值写死成 `Math.min(390*0.8, 844*0.74, 480)`，SE 和 iPad 视口各报了一条假失败。
19. **Web 端存档每打一下就落盘**，不是照抄 Android 的"每 50 下存一次"。理由：`localStorage` 写一条几十字节的 JSON 是微秒级开销，换来的是「iOS 直接杀掉标签页也不丢进度」。无头测试也验证了这点（照抄 Android 的话 `total` 会一直停在 0）。
20. **iPad 的土豆尺寸别照搬手机的固定上限**。原来夹在 480，在 1024×1366 的 iPad 上只占 47% 宽、看着很空；改成 `clamp(min(W*0.80, H*0.52), 120, 760)` 后手机三档完全不受影响（恒由 `W*0.80` 决定），iPad 涨到 710。上界 760 是算出来的：再大连击徽章顶边就会撞上顶栏的音量按钮。
21. **iOS Safari 会冻结后台标签页的 `setTimeout`** —— 所以任何"过 N 秒自动发生"的玩法逻辑都**不能只靠定时器**。连击归零是中招的那一处，也是用户报「一段时间不打，右上角计数不消失」的真因（无头环境复现不出来，相关断言一直 PASS）。修法：记绝对时刻 `S.streakEndsAtMs`，新增 `checkStreakTimeout()`，在**每次击打前**和 **`visibilitychange` / `pageshow` 回前台时**各补判一次，定时器保留但只作为前台准点归零的手段。以后再加同类逻辑（比如湿身自然干、道具自动收）要照这个模式写。
22. **`RANDOM_LINE_COOLDOWN_CLICKS` 这个常量已经不存在了**，2026-10-13 拆成了 `RANDOM_LINE_COOLDOWN_CLICKS_HIT = 30`（左键）与 `RANDOM_LINE_COOLDOWN_CLICKS_PROP = 20`（水枪/中指）。而且两个计数器**初值都等于各自上限**，语义是"开局即已冷却"——所以第 1 下就可能冒随机台词，这不是 bug。改随机台词逻辑时别再把它俩当一个用。
23. **写"能复现 iOS 后台"的测试时，CDP `Page.setWebLifecycleState` 是假的复现**。它确实冻住了定时器（心跳 `setInterval(100)` 冻 7 秒增长 0 次可证），但**解冻时浏览器会把积压的定时器补跑掉**，所以「只靠定时器」和「有绝对时刻补判」两种实现都会归零 → 测不出差别。真正能区分的是 **hook 掉那个定时器让它永不执行**，再拨到期时刻、派发 `visibilitychange`（`tools/headless-check.js` 的 `[A]` 就是这么写的）。**教训：测试写完要反向验证一次**——把修复打瘸，确认测试 FAIL；不然"跑通"可能只是因为测试根本没测到东西。
24. **CDP 解冻不派发 `visibilitychange`**（真实 Safari 回前台一定会）。所以冻结类测试解冻后要**手动补一次派发**，否则断言会随机假失败——修复本身没问题，只是事件没到。
25. **`tools/headless-check.js` 里凡是"等预载"的地方，都要等 `bp.state.ready === true`，不能只等 `window.BeatPotato` 存在**。`dims` 尺寸表与音效时长是预载过程中**逐个填入**的，而线上首次加载（无缓存）比本地慢得多，只等实例存在会读到残缺状态 → 假失败（实测线上偶发 `0/14 音效时长`、`5/14 缩略图`、`21 个格子 / 35 条尺寸`，本地却稳定通过）。同理，44 张缩略图要轮询等 `complete && naturalWidth > 0`。

26. **★ CSS `visibility` 的继承陷阱：隐藏一个容器，子元素可能照旧显示。** `visibility` 虽是继承属性，**但子元素一旦自己声明了 `visible`，就会盖掉父元素的 `hidden`**。web 的 `renderStrip()` 会给每个复用的 `<img>` 写内联 `img.style.visibility = 'visible'`，所以 `streakBadge.style.visibility = 'hidden'` 看起来生效、**数字却照旧画在屏幕上** —— 这就是用户报的第二轮「一段时间不打，右上角计数不消失」的真因（比坑 21 的后台冻结更根本，两处一起才是完整修复）。修法是 `hideBadge(host)`，连 `host._pool` 里的子元素一起隐藏。**同类风险**：任何"容器 + 动态子元素"的显隐都要这么写。
27. **★ 断言"元素有没有真的隐藏/显示"，必须查 `getComputedStyle` 和子元素，不能只看容器自己的 `style.visibility`。** 坑 26 那个 bug 在 44 条断言全绿的情况下潜伏了两轮 —— 因为断言查的全是 `sb.style.visibility`，而**那不是实际渲染结果**。已加 `badgeSeen(id)`：遍历 `el.querySelectorAll('img')`，任一个 computed `visibility === 'visible'` 就算"实际可见"。**这是本轮最大的测试方法论教训。**
28. **★ 线上首次加载约 50 秒**（GitHub Pages 冷启动要拉 10MB 素材，实测 `state.ready` 约 49.8 秒才为真）。所以：① 所有无头等待都要给足（CDP 超时已提到 180s、主页 boot 等待 90s）；② `web/devtools.html` 的 `waitForGame()` 兜底若按"本地几百毫秒"来写（原来是 15 秒），**线上会提前触发并用残缺的 `bp.dims` 渲染**，表现成"素材总览只出十几个格子""某张图显示换素材前的旧尺寸"——看着像素材没同步，其实是渲染太早。已改为只在真正 `ready` 时才渲染，兜底放宽到 90 秒。
29. **断言脚本自己崩掉会掩盖真正原因。** 线上冷启动超过 devtools 兜底时间时，页面全局变量 `bp` 恒为 null，`bp.sfxNames` 直接抛 `Cannot read properties of null` —— 报错看起来像脚本坏了，实际是"页面还没就绪"。改为先从 iframe 兜底取实例，彻底拿不到时**返回一条明确的失败断言而不是崩溃**。同理，`querySelectorAll('img')[0].getAttribute(...)` 这类写法首屏慢时会读到 undefined，要加空值防护。
30. **`/devtools.html` 的三类"假失败"几乎都是"渲染/预载早于就绪"**，别急着改游戏代码：先确认是不是等待条件写松了（等 `state.ready` 而非只等实例存在）、兜底时间是不是按本地速度设的、缩略图是不是没轮询。

---

**核心思路：隔离 harness + 反射，源码零改动地验证运行时行为。**

```csharp
// 临时控制台项目：net10.0-windows + UseWPF + UseWindowsForms
var asm = Assembly.LoadFrom(@"A:\ai\Beat Potato\pc\BeatPotato\bin\Release\net10.0-windows\BeatPotato.dll");
var T = asm.GetType("BeatPotato.MainWindow", true);
var win = (Window)Activator.CreateInstance(T);          // 不 Show 就不会打扰用户桌面
var hit = T.GetMethod("HitPotato", BindingFlags.NonPublic | BindingFlags.Instance);
```

要点：

- **防止真的出声**：更省事的办法是把 `%APPDATA%\BeatPotato\settings.json` 的 `VolumePercent` 改成 0（PCM 缩放后全是 0 采样），这样所有音效都能安全触发；换静音 WAV 的老办法依然有效
- **harness 要有素材**：`MainWindow` 的静态素材基于 `AppContext.BaseDirectory`，所以要把 `pc/BeatPotato/bin/Release/net10.0-windows/assets` 整个拷进 harness 的输出目录，否则素材全为 null
- **截图**：未 `Show()` 的窗口可以直接对 `Root` 用 `RenderTargetBitmap.Render()` 拍出干净的道具/土豆合成图（先手动 `Measure/Arrange/UpdateLayout`；dpi 用 192 得到 2 倍图）
- **让 `DispatcherTimer` 真的跑**（否则道具收回、湿身恢复、受击回弹都不触发）：`main` 里用 `DispatcherFrame` + 一个 `DispatcherTimer` 调 `Dispatcher.PushFrame(frame)` 泵指定毫秒数
- 反射读私有字段/调私有方法：`_streakHits`、`_streakHideTimer`、`IsOverAnyMenu()`、`ScaleWav()`、`ApplyVolume()` 等
- 需要布局数据时对 `win.Content` 手动 `Measure / Arrange / UpdateLayout`（未 `Show()` 的 Window 不会自己测量）
- 截图渲染用 `VisualBrush` + `DrawingVisual` + `RenderTargetBitmap` 按区域裁剪；直接 `RenderTargetBitmap.Render(visual)` 会带上父级布局偏移
- **真机交互测试必须用真实鼠标事件**（`SetCursorPos` + `mouse_event`）：`PostMessage` 合成的右键打不开 WPF 菜单
- 测完把窗口位置/光标还原，并恢复 `%APPDATA%\BeatPotato\` 的存档备份

**快速回归清单**（改完徽章/菜单相关代码至少跑一遍）：

1. `HitPotato()` 后 `_streakHideTimer.IsEnabled == true`；空转 7 秒后 `_streakHits == 0` 且徽章 Hidden
2. 五档缩放：50/75/100/125/150% 下土豆、徽章、窗口尺寸都跟随（**口径**：2026-10-11 起 100% 档 = `BaseSide=125` DIP 土豆；harness 基准值见 §2 —— Root.Width 301.8 / 150.9（50%）/ 452.7（150%），任何一项偏离 1.25 倍关系就说明 `PotatoSide()` 换算漏了某处）
3. 托盘菜单树完整：`隐藏土豆 / 暂停暴打 / 显示层级 / 大小 / 音量 / 开机启动 / 退出`
4. 菜单：点外部收起、点菜单项（含子项）生效
5. 存档：WM_CLOSE 退出 → `stats.json` 与标题计数一致 → 重启恢复一致
6. **右键/中键（2026-10-10 加）**：右键 1 下 → `SquirtProp.Visibility=Visible`、`_squirtCount=1`、`_wet=false`、三个计数全 0；补到第 5 下 → `_wet=true`、`Potato.Source` 换成 wet.png；停手 4s → `_wet=false` 且素材回静息（湿着时继续滋会刷新计时、且不累计下一次：第 5 下后 +3.5s 仍湿 → 再滋一下 → 再 +3.5s 仍湿 → 再 +1s 才干）；中键 → `FingerProp` Visible、400ms 后 Hidden、计数仍 0；五档缩放下两个道具的 `Canvas.Left/Top` 按土豆高度线性跟随；音量五档下 `RebuildSounds()` 后 6 个 `SoundPlayer` 都非 null
7. **台词与展开图（2026-10-11 加）**：把 `_clicksSinceRandomLine` 置 0 → 连续调 `PlayRandomLineIfLucky()` 1000 次应**命中 0 次**（冷却拦截）；置满 `RandomLineCooldownClicks` 后命中率应≈10%（每次命中会清零，测试时要手动补满才看得到真实概率）；`WavDurationMs()` 对 9 个 wav 的结果应与 `ffprobe` 时长一致；`PlayLine()` 之后 `LineIsPlaying=True`，此时调 `HitPotato()` 计数照常 +1 且 `LineIsPlaying` 保持 True（台词不被打断）；等超过句长后回到 False；`ShowFlash()` 后**图中心应等于土豆中心**（`Canvas.GetLeft(FlashImage) + 图宽/2` 与 `Canvas.GetTop(FlashImage) + 图高/2` 分别等于土豆中心，100% 档为 `63.7 / 151.1`；`Root.Margin` 左上 > 0，窗口 `Left/Top` 相应左移上移），且 `FlashGrowMs+FlashHoldMs+FlashFadeMs = 810ms` 之后 `FlashImage.Visibility=Hidden`、`Root.Height` 交回 `NaN`、**`Root.Margin` 归零、窗口 `Left/Top` 精确还原**；**节点保护窗口**：设 `_clickSeq=100` → 调 `PlayStateLine(0,1)` 后 `_randomLineBlockedUntil` 应为 **120**，`_clickSeq=120`（窗口内）调 1000 次应命中 0，`_clickSeq=121`（窗口外、冷却补满）应恢复约 10% 命中
8. 台词/展开图的排查入口：`%TEMP%\bp_harness\run.log` 全量日志 + `shots\11-flash.png`/`12-wet-flash.png`；素材改动后记得 `robocopy /MIR` 同步到 harness 输出目录（见 §5 第 13 条）

---

## 7. 待办 / 待用户确认

- **用户已实机确认**：托盘菜单「音量」子项可点选（settings.json 里已留下 `VolumePercent=75`）
- **仍需用户确认听感/手感**：音量 75% 的实际听感、拖动土豆、隐藏/显示、切换层级与大小
- **PC 端待办（2026-10-07）**：构建 + harness 回归已完成；等用户自行启动 exe 实际体验爆点 2.0 与连击弹跳手感
- **PC 端待办（2026-10-10）**：右键喷水 + 中键竖中指已实现、构建与 harness 均通过；真机第一轮试玩已完成（用户反馈：水枪放大/往左压、湿身改成 4s + 继续滋刷新，均已改完），**还需再看一轮**：水枪新比例的手感、湿身 4s + 刷新的手感、透明预留区不挡桌面点击（用户实测时用的是 125% 档；2026-10-11 缩放基准调整后，同样的视觉大小现在是 **100% 档**，存档已按 100 保存，App 已重启）
- **Android 端待办（2026-10-07）**：无（音量对话框已实测且用户实机确认；today_9、总暴打常显均已装机验证）
- **PC 端待办（2026-10-11）**：台词 + 展开图已实现、构建与 harness 均通过，**等用户真机听/看**：① 展开图现在的时长（150ms 放大 + 500ms 停留 + 160ms 淡出 = 810ms）与**居中的位置**（2026-10-11 已改为以土豆为中心、窗口临时左上扩，用户已确认"没问题"）是否合适；② 「有点烦」和「摆烂」两句专属台词的音量与时机；③ 随机台词冷却 30 下 + 两个升级节点前后各 10 下保护 + 10% 概率的实际频率（觉得还吵就降概率或拉长两个数字；注意真实存档第 2 形态阈值只有 9，前置 10 下已覆盖整个第一形态，即连击开头 0..9 不会出随机台词，用户已确认可以）；④ 展开图期间窗口临时左上扩、结束后还原（理论上土豆屏幕位置不动、`IsHitTestVisible=False` 不吃点击），**这次改完只做过 harness 验证，还没真机试玩**；⑤ 台词播放期间"没有打击音"的手感是否符合预期（这是用户明确要的互斥行为）
- **展开图的一个待定问题（2026-10-11）**：`土豆本豆.jpg` 是**不透明**照片，`FlashHeightRatio=2.6` 意味着展开到最大时**会把土豆整个盖住**（截图 `preview/flash-centered.png` 里只看得到照片）。用户当时说"没问题"，但若他想的是"照片从土豆身上长出来"（能看到土豆轮廓），把 `FlashHeightRatio` 调到 1.2~1.4 即可
- **Web 端待办（2026-10-12）**：网页版已上线 https://alwayslikehaimeng.github.io/beat-potato/ ，**等用户在自己的电脑/家人 iPhone 上真机试玩**。无头自检证明的是"逻辑与布局正确、无报错、素材音效齐全"，**真机上这几件事必须用户亲测**（无头测不出来）：① iOS Safari 里音效到底出不出声、音量档位听感（iOS 的静音开关/音量键行为与桌面不同）；② 连点手感与跟手程度（`pointerdown` 方案在真机上的实际延迟）；③ 添加到主屏幕后全屏运行是否正常（`apple-mobile-web-app-capable`）；④ 刘海屏/灵动岛 `env(safe-area-inset-bottom)` 下底部道具条有没有被遮挡；⑤ **iPad 上的土豆大小**（2026-10-12 从 480 调到 710，只做过无头验证）是否合适。自检页在 https://alwayslikehaimeng.github.io/beat-potato/devtools.html ，可直接在 iPhone 上打开逐个试听音效、核对素材是否都加载了
- **已结案（2026-10-13 第二轮）**：「一段时间不打重置状态，右上角计数不会消失」的第一层修复 —— 用户确认 PC 和 Android 都一点问题没有，是**网页版独有**问题，已加绝对时刻 `S.streakEndsAtMs` + `checkStreakTimeout()` 补判，并做了反向验证。**PC 与 Android 不需要动。**
- **★ 已结案（2026-10-13 第三轮，真因在这里）**：上面那层修复**没击中真实场景** —— 用户实机仍报「数字还没有消失」。真因是 **CSS `visibility` 继承陷阱**（见 §5 坑 26）：容器设了 `hidden`，但 `renderStrip()` 给子 `<img>` 写了内联 `visible`，数字照旧画在屏幕上。已加 `hideBadge(host)` 连子元素一起隐藏。**同时暴露了一个更严重的测试问题**：44 条断言查的全是容器自己的 `style.visibility`，那不是实际渲染结果，所以这个 bug 潜伏了两轮。已加 `badgeSeen(id)` 查子元素 computed style，并反向验证（打瘸 `hideBadge` → 如期 FAIL）。**方法论已写进坑 27。**
- **已结案（2026-10-13 第三轮）**：水枪「五次触发语音后按水枪音效消失」—— 真因是 `!S.wet` 把整段水声包住了，而湿身期间每次按水枪都会续命 4 秒，导致第 6 下起彻底静音。已改为只排除「即将变湿」那一下。**「随机音频不清楚」不是独立 bug**，是它的衍生疑问：水枪状态下确实有随机音频（实测枚举：第 1~10 下铺垫期只出水声，**第 16 下首次出现 `line_rand1`**），此前只是被静音掩盖。
- **真机复测（2026-10-13 第三轮，只剩用户能做）**：① **连击数字**——打几下 → 干等 10 秒不打（不用切后台也行）→ 右上角数字应当消失；这才是用户实际报的场景，无头测不出来。② **水枪连按**——连按 20 下以上，第 6 下起应当每下都有水声，不该静音。③ 顺带确认湿身会自动干、随机台词在水枪状态下能听到。
- **Web 端桌面视口也已验证（2026-10-13）**：`1280x800` 与 `1440x900` 各 87/87 + 冻结测试双 PASS（土豆边长分别 416 / 468）。第三轮扩到 95 条断言后未再复测桌面视口。电脑浏览器打开线上网址同样可用。
- **Web 端说明**：网页版**没有任何服务器端逻辑**，GitHub Pages 只是静态托管；更新网页只需 `cd 'A:\ai\Beat Potato\web'; git add -A; git commit -m '...'; git push`，等 1 分钟左右自动生效
- Android 构建：JDK 17 在 `C:\Users\canhai\.jdks\jbr-17.0.14`，Gradle 8.14 在 `%LOCALAPPDATA%\BeatPotatoToolchain\gradle-8.14`（均不在 PATH）；荣耀真机安装需先唤醒屏幕，否则安装确认被自动拒绝；targetSdk 36 强制 edge-to-edge，UI 控件要避开状态栏
- 未做（用户未要求）：音效开关、开机启动的实机重启验证
- 已知小瑕疵：`MainWindow.xaml` 里的 `TodayBounce` `ScaleTransform` 仍是死代码（用户要求今日徽章不弹跳，`OnAnimTick` 只驱动 `TotalBounce`）；拖动我没法在无头环境实测，需用户确认手感
- 工作区**不是 git 仓库**（有 `.gitignore` 但无 `.git`）；但 **`web/` 子目录自己是独立的 git 仓库**（Phase 9 为发布 GitHub Pages 而建，远程 `Alwayslikehaimeng/beat-potato`）；`pc/bin`、`pc/obj`、`pc/publish`、`android/app/build` 等构建产物都在盘上
- 根目录还有原始素材残料：`0.png`(2048×2048)、`floraphonic-cartoon-slap-2-189831.mp3`、`assets/potato/微信图片_*.jpg`(3072×4096, 7.8MB)、`assets/potato/数字/9.png`(896×1176)

---

## 8. 工作规则（来自 `Plan.md` §9）

每个阶段都必须：**先读 `Plan.md` → 查看项目实际状态 → 判断当前阶段 → 只完成当前阶段 → 实际运行测试 → 汇报修改内容与测试结果 → 更新 `Plan.md` 中的当前状态**。

不要自动跳到下一阶段。当前停在 **Phase 9（Web 版已上线，等用户真机试玩）**。
