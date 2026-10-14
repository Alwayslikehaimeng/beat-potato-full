# 技术决策记录（Phase 0，2026-10-05 已确认）

## 结论

| 端 | 方案 | 状态 |
|---|---|---|
| PC | C# + WPF + .NET 10 (LTS) | Phase 1 开发中 |
| Android | Kotlin + 原生 View + SoundPool，零第三方依赖 | 保留方案，暂不开发（Phase 6 再搭工具链） |

## 方案要点

### PC：WPF
- 保留模式渲染：无界面失效时不重绘，待机天然零渲染，无需自己写"休眠"逻辑。
- `WindowStyle=None + AllowsTransparency + Topmost` 是桌宠成熟路线，透明/置顶/拖动（`DragMove`）/右键菜单均为框架内建能力。
- 打击动画（Phase 2）：有限时长离散关键帧（~0.2s），播完即停，同一时间最多 1 个动画时钟。
- 音效（Phase 2）：WAV 启动时载入内存一次（`SoundPlayer`），播放时复用，不创建管线对象。
- 素材：启动时解码一次并 `Freeze()`，点击路径不重复解码。
- 发布方式（框架依赖 vs 自包含单文件）推迟到发布前决定，不影响开发。

### 排除项及原因
- C++/Win32：内存最低（~5MB vs WPF ~60MB）但开发维护成本高，PLAN.md 倾向 C#。
- WinForms：逐像素透明需手写 layered window，动画变换代码量大。
- WinUI 3：WindowsAppSDK 依赖重、部署复杂，对本项目规模过度。
- Electron/Unity/WebView/浏览器容器：PLAN.md §5 明确禁止。
- Android 侧排除 Compose/Flutter/游戏引擎：额外运行时开销对"静止画面+偶发动画"无收益。

## 用户确认的两条约束（2026-10-05）

1. **性能数字不是承诺值**。"待机 0% CPU/GPU、~60MB 内存"只是设计目标和参考，
   必须以 Release 版实际运行测试数据为准（Phase 5 全面实测，每阶段也要跑）。
2. **不为性能验证而过度设计**。Phase 1 只做最简 MVP：透明置顶窗口、点击检测、
   拖动、退出、待机占用实测。打击动画/音效/统计等全部留给后续阶段。

## 环境备注

- winget 源损坏（0x80073cfc），.NET 10 SDK 用官方 dotnet-install 脚本装在
  `%LOCALAPPDATA%\Microsoft\dotnet`（用户级，无管理员）。该路径未加入 PATH 时，
  构建命令需使用完整路径或自行加入 PATH。
- Android SDK 组件已存在于 `%LOCALAPPDATA%\Android\Sdk`（platforms 34/36.1），
  但无 JDK / Android Studio，Phase 6 开始前需安装。
- 项目目录结构：单仓库双端独立，素材单一真源在根 `assets/`，PC 侧 csproj
  `<Content Link>` 映射，Android 侧拷贝。两端代码互不引用。
