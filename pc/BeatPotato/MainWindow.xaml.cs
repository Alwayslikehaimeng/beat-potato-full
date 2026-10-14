using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using WinForms = System.Windows.Forms;
using IOPath = System.IO.Path;
using SD = System.Drawing;
using WpfPoint = System.Windows.Point;
using WpfImage = System.Windows.Controls.Image;

namespace BeatPotato;

public partial class MainWindow : Window
{
    private static readonly BitmapImage IdleSprite = LoadSprite("idle.png");
    private static readonly BitmapImage HitSprite1 = LoadSprite("hit_1.png");
    private static readonly BitmapImage HitSprite2 = LoadSprite("hit_2.png");
    private static readonly BitmapImage HitSprite3 = LoadSprite("hit_3.png");
    // 状态 1~5 的土豆素材（下标 = 状态序号；状态 0「正常」不占素材，直接用 idle.png）。
    // 素材已按 idle 的内容占比补过透明边距，切换状态时土豆本体大小与脚底位置不跳。
    private static readonly BitmapImage?[] StateSprites = LoadStateSprites();
    // 每个状态各自的受击帧（下标 = 状态序号，含状态 0）。与同状态原图共用画布尺寸，
    // 所以受击时显示框不变、只有土豆内容发生形变，不会因为换帧而跳动。
    private static readonly BitmapImage?[] StateHitSprites = LoadStateHitSprites();
    // —— 音效与音量（Phase 8 追加）—— //
    // SoundPlayer 本身没有音量参数，这里按音量缩放 WAV 的 PCM 采样后交给它播放：
    // 仍然是 winmm 异步播放、零第三方依赖，音量变化时重建一次播放器（不是每次点击都算）。
    private static readonly byte[] HitWav = LoadHitWav();
    private static readonly int[] VolumeOptions = { 0, 25, 50, 75, 100 };

    private SoundPlayer? _hitSound;

    // —— 右键喷水 / 中键竖中指（2026-10-10）—— //
    // 这两种交互只做即时反馈：不计入总暴打/今日/连击，不推高受伤状态，不写存档。
    // 素材与音效都在启动时加载一次；两个道具计时器都是"点了才起、到点就停"，待机零开销。
    private const int SquirtHitsToWet = 5;                   // 滋满 5 下才湿（用户要求）
    // 水枪前多少下一律不出随机台词（用户 2026-10-12 要求"前十下"）。
    // 独立于 SquirtHitsToWet：湿润循环是 5 下一轮，但随机台词要压到第 10 下之后
    private const int SquirtLineBlockClicks = 10;
    private const int SquirtPropHoldMs = 300;                // 水枪露脸时长
    private const int FingerPropHoldMs = 400;                // 中指露脸时长
    private const int WetHoldMs = 4000;                      // 湿身持续时长（湿着时继续滋会刷新它）
    private const double SquirtContentHeightRatio = 0.62;    // 水枪可见内容高 / 土豆高
    private const double SquirtOverlapRatio = 0.26;          // 枪口水花从土豆右缘往左叠进去多少 / 土豆高
    private const double SquirtCenterYRatio = 0.57;          // 水枪内容中心落在土豆高的哪个比例处
    private const double SquirtContentXRatio = 0.1578;       // 枪口（内容左缘）在图中的 x 比例（实测 202/1280）
    private const double SquirtContentYRatio = 0.5559;       // 内容中心在图中的 y 比例（实测 711.5/1280）
    private const double SquirtContentHRatio = 0.4078;       // 内容高 / 图高（实测 522/1280）
    private const double FingerContentHeightRatio = 0.80;    // 中指可见内容高 / 土豆高
    private const double FingerContentHRatio = 0.9355;       // 内容高 / 图高（实测 958/1024）
    private const double FingerContentCenterXRatio = 0.5098; // 内容中心 x / 图宽（实测 832/1632）
    private const double FingerContentCenterYRatio = 0.5317; // 内容中心 y / 图高（实测 544.5/1024）
    private const double FingerContentYRatio = 0.60;         // 中指内容中心落在土豆高的哪一处（"正中间偏下"）
    private const double PropReserveRatio = 0.95;            // 窗口右侧常驻给水枪预留的宽度 / 土豆高

    private static readonly BitmapImage? SquirtPropSprite = LoadPropSprite("水枪.png");
    private static readonly BitmapImage? FingerPropSprite = LoadPropSprite("中指.png");
    // 湿身素材已按 idle 的构图归一化（内容对角线、脚底基线对齐），所以直接套 ApplyPotatoSize 也不跳
    private static readonly BitmapImage? WetSprite = LoadPropSprite(IOPath.Combine("state", "wet.png"));
    // 水枪.mp3 一个文件里其实是 4 段独立水声（中间各约 3 秒静音），切开后每次右键随机播一段
    private static readonly byte[][] SquirtWavs =
    {
        LoadWav("squirt_1.wav"), LoadWav("squirt_2.wav"), LoadWav("squirt_3.wav"), LoadWav("squirt_4.wav")
    };
    private static readonly byte[] DespiseWav = LoadWav("despise.wav");

    private SoundPlayer?[] _squirtSounds = Array.Empty<SoundPlayer?>();
    private SoundPlayer? _despiseSound;
    private readonly DispatcherTimer _squirtPropTimer = new() { Interval = TimeSpan.FromMilliseconds(SquirtPropHoldMs) };
    private readonly DispatcherTimer _fingerPropTimer = new() { Interval = TimeSpan.FromMilliseconds(FingerPropHoldMs) };
    private readonly DispatcherTimer _wetTimer = new() { Interval = TimeSpan.FromMilliseconds(WetHoldMs) };
    private int _squirtCount;   // 本轮喷了几次（满 5 次变湿后归零）
    private int _squirtTotal;   // 累计喷了几次，跨轮**不清零** —— "前 N 下不出随机台词"按这个算
    private bool _wet;

    // —— 台词 + 展开图（2026-10-11，用户要求）—— //
    // 三种"升级"各一句专属台词：变湿 →「我后背湿着呢」、左键升到「有点烦」→「你看有人理你吗」、
    // 升到「摆烂」→「要死了」；这三句会顶掉本次的基础音效（进程内一次只能响一个声音）。
    // 其余 5 句没点名的台词，在左键/右键/中键时按 RandomLinePercent 的概率随机冒出来（无条件）。
    private const int RandomLinePercent = 10;                 // 每次点击随机冒一句台词的概率（%）
    private const double FlashHeightRatio = 2.6;              // 展开图高度 / 土豆高
    private const double FlashPadding = 16;                   // 展开图四周留白（DIP）
    private const double FlashScaleFrom = 0.12;               // 展开动画起始缩放
    private const int FlashGrowMs = 150;                      // 由小到大用时
    private const int FlashHoldMs = 500;                      // 停住让用户看清（用户要求"闪现时间再长点"）
    private const int FlashFadeMs = 160;                      // 淡出用时

    private static readonly BitmapImage? FlashSprite = LoadPropSprite("土豆本豆.jpg", 640);
    private static readonly byte[] LineWetWav = LoadWav("line_wet.wav");
    private static readonly byte[] LineStage2Wav = LoadWav("line_stage2.wav");
    private static readonly byte[] LineFinalWav = LoadWav("line_final.wav");
    private static readonly byte[][] LineRandomWavs =
    {
        LoadWav("line_rand1.wav"), LoadWav("line_rand2.wav"), LoadWav("line_rand3.wav"),
        LoadWav("line_rand4.wav"), LoadWav("line_rand5.wav")
    };

    private SoundPlayer? _lineWetSound;
    private SoundPlayer? _lineStage2Sound;
    private SoundPlayer? _lineFinalSound;
    private SoundPlayer?[] _lineRandomSounds = Array.Empty<SoundPlayer?>();
    private bool _flashRunning;
    private double _flashSavedWidth;
    private double _flashSavedHeight;
    private bool _flashHeightAuto;
    private double _flashNeedWidth;
    private Thickness _flashSavedMargin;
    private double _flashSavedLeft;
    private double _flashSavedTop;

    // 随机台词的冷却：播出一句之后，至少再过对应档位次数的点击才允许再出随机台词
    // （那三句专属台词不受冷却限制）。用户 2026-10-11 要求从 40 下调到 30 下。
    // 2026-10-12 分两档：左键 30 下，水枪+中指（主动取乐）20 下 —— 用户："中指和水枪一个入口，左键一个入口"
    private const int RandomLineCooldownClicksHit = 30;
    private const int RandomLineCooldownClicksProp = 20;
    private int _clicksSinceRandomLineHit = RandomLineCooldownClicksHit;
    private int _clicksSinceRandomLineProp = RandomLineCooldownClicksProp;

    // "重要节点"（变湿 / 有点烦 / 摆烂）保护窗口：节点那一下的前、后各 NodeLineBlockClicks 次点击内
    // 一律不出随机台词（用户 2026-10-11："在那三个重要节点附近 20 次也不能出现"，
    // 当晚又调整为"改成前后十次吧，第一状态时肯定不会出现"）。
    // 注：前置保护只作用于第 2（有点烦）与第 6（摆烂）形态，见 NearUpgradeNode()。
    private const int NodeLineBlockClicks = 10;
    private long _clickSeq;                 // 每次有效点击 +1（左键命中/右键/中键共用）
    private long _randomLineBlockedUntil;   // 点击序号 <= 这个值时禁止随机台词

    // 当前台词的预计结束时刻：在这之前点击不打断台词、也不播打击音/水枪声/鄙视声
    // （用户要求"只要播了那几个音频就不能有打击音"）。用 wav 字节算出的时长来标记。
    private DateTime _lineEndsAt = DateTime.MinValue;

    private static readonly int LineWetMs = WavDurationMs(LineWetWav);
    private static readonly int LineStage2Ms = WavDurationMs(LineStage2Wav);
    private static readonly int LineFinalMs = WavDurationMs(LineFinalWav);
    private static readonly int[] LineRandomMs = LineRandomWavs.Select(WavDurationMs).ToArray();

    // 全程序唯一的动画定时器：仅打击动画期间运行（约 180ms），播完立即停止。
    // 连续点击时只重置帧序号，不创建新对象。
    // 唯一的动画计时器：击打瞬间显示受击帧，HitHoldMs 之后切回静息帧
    private readonly DispatcherTimer _animTimer = new() { Interval = TimeSpan.FromMilliseconds(HitHoldMs) };
    private WpfPoint _downPos;
    private bool _dragInProgress;
    private bool _paused;
    private bool _hidden;

    // —— 统计（Phase 3）：内存计数，退出/每满 50 次落盘，不用数据库 —— //
    private sealed class StatsData
    {
        public int TotalHits { get; set; }
        public int TodayHits { get; set; }
        public string TodayDate { get; set; } = "";

        // 本轮 5 个状态阈值（严格递增）。档位一旦确定就写进存档，
        // 重启后读回同一组，不会重新随机导致档位变化。
        public int[]? StateThresholds { get; set; }
    }

    // —— 受伤状态（连击次数 → 状态）—— //
    // 阈值区间（有点烦 8~15 / 轻伤 20~35 / 鼻青脸肿 40~65 / 被打懵 70~100 / 摆烂 110~130）。
    // 最后一档原本是 110~150，2026-10-10 按用户反馈把上限收到 130（其余四档不变）。
    // 区间互不重叠，因此随机出的阈值天然严格递增。
    private static readonly int[,] StateThresholdRanges =
    {
        { 8, 15 }, { 20, 35 }, { 40, 65 }, { 70, 100 }, { 110, 130 }
    };

    private int[] _stateThresholds = Array.Empty<int>();
    private int _stateIndex;  // 0=正常 1=有点烦 2=轻伤 3=鼻青脸肿 4=被打懵 5=摆烂

    private static readonly string StatsPath = IOPath.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BeatPotato", "stats.json");

    private int _totalHits;
    private int _todayHits;

    private string _todayDate = DateTime.Today.ToString("yyyy-MM-dd");

    // —— 设置（Phase 8）：层级/大小/位置/开机启动，本地 JSON —— //
    private sealed class AppSettings
    {
        public string Level { get; set; } = "desktop"; // desktop=仅桌面, topmost=始终置顶
        public int ScalePercent { get; set; } = 100;
        public int VolumePercent { get; set; } = 100;  // 击打音效音量 0~100
        public double? X { get; set; }
        public double? Y { get; set; }
    }

    private static readonly string SettingsPath = IOPath.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BeatPotato", "settings.json");

    // 100% 档的土豆边长（DIP）。2026-10-11 用户要求"把 125% 的大小变成 100%"：
    // 原来的 125% 视觉大小（125 DIP）即现在的 100% 档，其余档位按同一比例同步放大。
    private const double BaseSide = 125;
    private static readonly int[] ScaleOptions = { 50, 75, 100, 125, 150 };
    // 徽章、右侧预留这些固定尺寸常量都是按"100 DIP 的土豆"调出来的，换算时除以这个基准
    private const double LayoutRefSide = 100;

    // 土豆当前的绝对显示高度（DIP）：档位百分比只决定它，其余尺寸都跟着它走
    private double PotatoSide() => BaseSide * _settings.ScalePercent / 100.0;

    // 窗口右侧常驻给水枪预留的宽度（DIP）。徽章右对齐到窗口右边，所以要把它让出来，
    // 否则预留区一加，徽章就被推离土豆（2026-10-11 用户反馈"爆炸数字离本体的距离变了"）。
    private double PropReserve() => PotatoSide() * PropReserveRatio;
    private AppSettings _settings = new();

    // —— 漫画计数显示（Phase 8）：用户素材拼接 —— //
    // 右上角数字 = 连击计数：点击从 1 开始累加，超过 6 秒未击打隐藏并归零，下次点击重新从 1 开始。
    // 下方 = 今日暴打：N，持续显示。所有位图启动时解码一次；击打时只挪动既有元素位置。
    private const double StreakDigitHeight = 36;  // 连击数字高度（DIP，100%）
    private const double TodayDigitHeight = 15;   // 今日数字高度
    private const double DigitOverlapRatio = 0.16;
    private const double StreakHideSeconds = 6;
    private const double BurstHeightRatio = 1.55;  // 爆点高度 / 连击数字高度（数字压在爆点上，四周露出锯齿）
    private const double BadgePadRatio = 0.14;    // 徽章画布四周留白 / 连击数字高度（越小越贴窗口边缘）
    private const double StreakGapAbove = 0;      // 连击徽章与土豆的间距（DIP，100%）；爆点在画布内还有留白，故取 0 仍不贴到土豆
    private const double StreakSideMargin = 1;    // 连击徽章右侧留白（旋转 -3° 不外溢）
    private const double StreakRightOverhang = 25; // 窗口右侧为连击徽章额外预留的宽度（DIP，100%）
    private const double StreakBounceMax = 1.45;   // 点击瞬间连击徽章的最大弹跳倍数（ApplyAnimFrame 共用这一个值）
    // 击打后受击帧保持多久再回静息帧：连点时每次击打都把这个回弹推后，
    // 所以土豆会一直保持被拍扁的样子，不会在受击帧与静息帧之间高频抖动
    private const int HitHoldMs = 120;
    private const double StreakBounceHeadroom = (StreakBounceMax - 1) / 2 + 0.07; // 弹跳时右侧要预留的宽度比例（0.07 是 -3° 倾斜的额外余量）
    private const double StreakTiltTopPad = 5;     // 徽章上方的余量（DIP，100%）：-3° 倾斜后上边角会略微出头
    private const double TodayGapAbove = 4;       // 今日徽章与土豆的间距（DIP，100%）
    private readonly DispatcherTimer _streakHideTimer = new() { Interval = TimeSpan.FromSeconds(StreakHideSeconds) };
    private readonly Random _rng = new();
    private int _streakHits;

    private readonly BitmapImage?[] _totalDigitBmps = new BitmapImage?[10];
    private readonly BitmapImage?[] _todayDigitBmps = new BitmapImage?[10];
    private readonly BitmapImage?[] _burstBmps = new BitmapImage?[4];
    private BitmapImage[] _burstPool = Array.Empty<BitmapImage>();
    private BitmapImage? _labelJin;
    private BitmapImage? _labelBao;
    private bool _counterSpritesReady;
    private WpfImage? _streakBurst;
    private WpfImage? _todayJin;
    private WpfImage? _todayBao;
    private readonly List<WpfImage> _streakDigitImages = new();
    private readonly List<WpfImage> _todayDigitImages = new();

    private WinForms.NotifyIcon? _tray;
    private WinForms.ToolStripMenuItem? _trayShowHide;
    private WinForms.ToolStripMenuItem? _trayPause;
    private readonly WinForms.ToolStripMenuItem[] _trayLevelItems = new WinForms.ToolStripMenuItem[2];
    private readonly WinForms.ToolStripMenuItem[] _trayScaleItems = new WinForms.ToolStripMenuItem[ScaleOptions.Length];
    private readonly WinForms.ToolStripMenuItem[] _trayVolumeItems = new WinForms.ToolStripMenuItem[VolumeOptions.Length];
    private WinForms.ToolStripMenuItem? _trayAutostart;

    public MainWindow()
    {
        InitializeComponent();
        LoadSettings();
        RebuildSounds();  // 暴打 + 4 段水声 + 鄙视，各建一个播放器；只有换音量档时才重建
        LoadCounterAssets();
        BuildCounterBadges();
        ApplyScale(_settings.ScalePercent);
        ApplyRestoredPosition();
        _animTimer.Tick += OnAnimTick;
        LoadStats();
        EnsureStateThresholds();  // 首次运行随机一组阈值并落盘；有存档则沿用
        _stateIndex = ComputeStateIndex();
        var startupSprite = CurrentStateSprite();
        Potato.Source = startupSprite;
        ApplyPotatoSize(startupSprite);
        Title = $"Beat Potato|{_totalHits} today:{_todayHits}";
        LoadWindowIcon();
        ApplyLevel();
        InitTray();
        UpdateStreakBadge();  // 未击打时也预留徽章空间，窗口尺寸恒定
        UpdateTodayBadge();
        ApplyPropLayout();  // 水枪/中指的位置随缩放与土豆宽度变化，最后统一摆一次
        _streakHideTimer.Tick += (_, _) => ResetStreak();
        // 两个道具计时器只负责"到点收回"，没有循环、不待机空转
        _squirtPropTimer.Tick += (_, _) => { _squirtPropTimer.Stop(); SquirtProp.Visibility = Visibility.Hidden; };
        _fingerPropTimer.Tick += (_, _) => { _fingerPropTimer.Stop(); FingerProp.Visibility = Visibility.Hidden; };
        _wetTimer.Tick += (_, _) => ExitWet();
    }

    private static BitmapImage LoadSprite(string fileName, int decodePixelWidth = 400)
    {
        var sprite = new BitmapImage();
        sprite.BeginInit();
        // 相对 URI 会按进程工作目录解析（换目录启动即崩），必须基于 exe 所在目录
        sprite.UriSource = new Uri(IOPath.Combine(AppContext.BaseDirectory, "assets", "potato", fileName));
        sprite.CacheOption = BitmapCacheOption.OnLoad;
        if (decodePixelWidth > 0) sprite.DecodePixelWidth = decodePixelWidth;
        sprite.EndInit();
        sprite.Freeze();
        return sprite;
    }

    // 状态素材源图是 4 倍超分后的大图（约 700x760），而桌面端最大只显示到约 173 DIP，
    // 因此解码时限制宽度，免得为了几十像素的显示把整张大图留在内存里。
    // 素材缺失时留 null，由调用方退化成 idle。
    private static BitmapImage?[] LoadStateSprites()
    {
        var sprites = new BitmapImage?[6];
        for (var i = 1; i <= 5; i++)
        {
            try
            {
                sprites[i] = LoadSprite(IOPath.Combine("state", $"state_{i}.png"), 512);
            }
            catch
            {
                sprites[i] = null;
            }
        }
        return sprites;
    }

    // 受击帧与状态原图共用画布（state_{i}_hit.png），缺失时留 null 由调用方退化成最初的 hit_1
    private static BitmapImage?[] LoadStateHitSprites()
    {
        var sprites = new BitmapImage?[6];
        for (var i = 0; i <= 5; i++)
        {
            try
            {
                sprites[i] = LoadSprite(IOPath.Combine("state", $"state_{i}_hit.png"), 512);
            }
            catch
            {
                sprites[i] = null;
            }
        }
        return sprites;
    }

    private static byte[] LoadHitWav() => LoadWav("hit.wav");

    private static byte[] LoadWav(string fileName)
    {
        try
        {
            return File.ReadAllBytes(IOPath.Combine(AppContext.BaseDirectory, "assets", "audio", fileName));
        }
        catch
        {
            return Array.Empty<byte>();
        }
    }

    // 道具素材（水枪/中指/被滋湿）：缺失时留 null，由调用方跳过这次表现，不影响暴打
    private static BitmapImage? LoadPropSprite(string fileName, int decodePixelWidth = 512)
    {
        try
        {
            return LoadSprite(fileName, decodePixelWidth);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>按百分比缩放 WAV 里的 16-bit PCM 采样（0 = 静音），采样率与时长不变。</summary>
    private static byte[] ScaleWav(byte[] src, int percent)
    {
        var dst = (byte[])src.Clone();
        var gain = Math.Clamp(percent, 0, 100) / 100.0;
        var pos = 12;
        var bits = 16;
        while (pos + 8 <= dst.Length)
        {
            var id = System.Text.Encoding.ASCII.GetString(dst, pos, 4);
            var size = BitConverter.ToInt32(dst, pos + 4);
            if (id == "fmt " && size >= 16) bits = BitConverter.ToInt16(dst, pos + 8 + 14);
            if (id == "data")
            {
                var start = pos + 8;
                var end = Math.Min(start + size, dst.Length);
                if (bits == 16)
                {
                    for (var i = start; i + 1 < end; i += 2)
                    {
                        var s = (short)(dst[i] | (dst[i + 1] << 8));
                        var v = (short)Math.Clamp((int)Math.Round(s * gain), short.MinValue, short.MaxValue);
                        dst[i] = (byte)(v & 0xFF);
                        dst[i + 1] = (byte)((v >> 8) & 0xFF);
                    }
                }
                break;
            }
            pos += 8 + size + (size & 1);
        }
        return dst;
    }

    private static SoundPlayer? CreateSound(byte[] wav, int percent)
    {
        if (wav.Length < 44) return null;
        try
        {
            var player = new SoundPlayer(new MemoryStream(ScaleWav(wav, percent)));
            player.Load();
            return player;
        }
        catch
        {
            return null;
        }
    }

    private void LoadWindowIcon()
    {
        try
        {
            Icon = BitmapFrame.Create(new Uri(IOPath.Combine(AppContext.BaseDirectory, "assets", "potato", "icon.ico")));
        }
        catch
        {
            // 图标缺失不影响功能
        }
    }

    // —— 显示层级：仅桌面 = 挂为桌面窗口(Progman)的附属窗口；始终置顶 = Topmost —— //

    private void ApplyLevel()
    {
        var helper = new WindowInteropHelper(this);
        helper.EnsureHandle();
        // WS_EX_NOACTIVATE：点击土豆不抢焦点（工作窗口保持前台），同时避免首次点击被激活路径吞掉
        var handle = helper.Handle;
        const int GWL_EXSTYLE = -20;
        const long WS_EX_NOACTIVATE = 0x08000000;
        var ex = GetWindowLongPtr(handle, GWL_EXSTYLE);
        SetWindowLongPtr(handle, GWL_EXSTYLE, new IntPtr(ex.ToInt64() | WS_EX_NOACTIVATE));
        if (_settings.Level == "topmost")
        {
            SetOwnerWindow(IntPtr.Zero);
            Topmost = true;
        }
        else
        {
            Topmost = false;
            var progman = FindWindow("Progman", null);
            SetOwnerWindow(progman); // Progman 不存在（如 explorer 未启动）时退化为普通窗口
        }
    }

    private void SetOwnerWindow(IntPtr owner)
        => SetWindowLongPtr(new WindowInteropHelper(this).Handle, GWL_HWNDPARENT, owner);

    // —— 素材加载与计数徽章构建 —— //

    private void LoadCounterAssets()
    {
        try
        {
            var dir = IOPath.Combine(AppContext.BaseDirectory, "assets", "potato", "counter");
            for (var d = 0; d <= 9; d++)
            {
                _totalDigitBmps[d] = LoadCounterBitmap(IOPath.Combine(dir, $"total_{d}.png"), 150);
                _todayDigitBmps[d] = LoadCounterBitmap(IOPath.Combine(dir, $"today_{d}.png"), 100);
            }
            for (var b = 0; b < 4; b++)
            {
                _burstBmps[b] = LoadCounterBitmap(IOPath.Combine(dir, $"burst_{b + 1}.png"), 280);
            }
            _labelJin = LoadCounterBitmap(IOPath.Combine(dir, "label_jin.png"), 40);
            _labelBao = LoadCounterBitmap(IOPath.Combine(dir, "label_bao.png"), 40);
            _counterSpritesReady = _totalDigitBmps.All(b => b != null) && _todayDigitBmps.All(b => b != null)
                                   && _burstBmps.All(b => b != null) && _labelJin != null && _labelBao != null;
            // 击打路径不再现场过滤/建数组，爆点候选启动时固定一次
            _burstPool = _burstBmps.Where(b => b != null).Cast<BitmapImage>().ToArray();
        }
        catch
        {
            _counterSpritesReady = false;
        }
    }

    private static BitmapImage? LoadCounterBitmap(string path, int decodeHeight)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.UriSource = new Uri(path);
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.DecodePixelHeight = decodeHeight;
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch
        {
            return null;
        }
    }

    private void BuildCounterBadges()
    {
        // 连击数字串（右上角）
        _streakBurst = new WpfImage { Stretch = Stretch.Fill };
        StreakBadge.Children.Add(_streakBurst);
        for (var i = 0; i < 8; i++)
        {
            var img = new WpfImage { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed };
            StreakBadge.Children.Add(img);
            _streakDigitImages.Add(img);
        }
        // 今日暴打：标签 + 数字串
        _todayJin = new WpfImage { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed };
        _todayBao = new WpfImage { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed };
        TodayBadge.Children.Add(_todayJin);
        TodayBadge.Children.Add(_todayBao);
        for (var i = 0; i < 8; i++)
        {
            var img = new WpfImage { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed };
            TodayBadge.Children.Add(img);
            _todayDigitImages.Add(img);
        }
    }

    private static void EnsureDigitImages(Canvas canvas, List<WpfImage> list, int count)
    {
        while (list.Count < count)
        {
            var img = new WpfImage { Stretch = Stretch.Fill, Visibility = Visibility.Collapsed };
            canvas.Children.Add(img);
            list.Add(img);
        }
    }

    // —— 状态：连击次数 → 当前土豆素材 —— //

    // 状态由连击次数（右上角爆点数字，6 秒未击打即自动清零）决定；
    // 连击断了就回到「正常」，所以每打一轮都能重新走一遍 正常 → 摆烂。
    private int ComputeStateIndex()
    {
        var state = 0;
        for (var i = 0; i < _stateThresholds.Length; i++)
        {
            if (_streakHits >= _stateThresholds[i]) state = i + 1;
        }
        return state;
    }

    private BitmapImage CurrentStateSprite()
    {
        if (_wet && WetSprite is { } wet) return wet;    // 湿身期间画面保持"被滋湿"，左键照打但不切状态图
        if (_stateIndex <= 0) return IdleSprite;
        return StateSprites[_stateIndex] ?? IdleSprite;  // 素材缺失时退化，不崩
    }

    // 高度恒为 BaseSide×缩放，宽度按素材宽高比（idle 与受击帧是方的，与旧行为完全一致）
    private void ApplyPotatoSize(BitmapImage sprite)
    {
        var side = BaseSide * _settings.ScalePercent / 100.0;
        Potato.Height = side;
        Potato.Width = side * sprite.PixelWidth / sprite.PixelHeight;
        // 各状态素材宽度不一样：统一以"最宽的状态"为基准水平居中，
        // 这样切换状态时土豆的水平中心不动（最宽的摆烂保持在原位，较窄的状态整体往右靠）
        Potato.Margin = new Thickness(Math.Max(0, (MaxPotatoWidth() - Potato.Width) / 2), 0, 0, 0);
    }

    // —— 道具摆放：右键的水枪（土豆右侧、枪口朝左）与中键的中指（土豆正中偏下）—— //
    // 用 Canvas.Left/Top 相对 Row1 左上角摆位，基准是土豆当前的显示框，
    // 所以状态切换 / 湿身 / 换缩放档之后都要重摆（调用点见 ApplyScale、ApplyStateVisual、EnterWet/ExitWet）。
    // 两张素材都带大片透明边距，尺寸按"可见内容"的实测比例从整图反推。
    private void ApplyPropLayout()
    {
        var side = BaseSide * _settings.ScalePercent / 100.0;
        var potatoRight = Potato.Margin.Left + Potato.Width;
        var potatoCenter = potatoRight - Potato.Width / 2;

        if (SquirtPropSprite is { } squirt)
        {
            var h = side * SquirtContentHeightRatio / SquirtContentHRatio;
            var w = h * squirt.PixelWidth / (double)squirt.PixelHeight;
            SquirtProp.Width = w;
            SquirtProp.Height = h;
            // 枪口（内容左缘）落在土豆右缘再往左叠一点，自带的水花正好搭在土豆身上
            var muzzleX = potatoRight - side * SquirtOverlapRatio;
            Canvas.SetLeft(SquirtProp, muzzleX - w * SquirtContentXRatio);
            Canvas.SetTop(SquirtProp, side * SquirtCenterYRatio - h * SquirtContentYRatio);
        }

        if (FingerPropSprite is { } finger)
        {
            var h = side * FingerContentHeightRatio / FingerContentHRatio;
            var w = h * finger.PixelWidth / (double)finger.PixelHeight;
            FingerProp.Width = w;
            FingerProp.Height = h;
            // 水平居中于土豆、内容中心略低于土豆中心（用户要求"正中间偏下，挡住一小部分土豆"）
            Canvas.SetLeft(FingerProp, potatoCenter - w * FingerContentCenterXRatio);
            Canvas.SetTop(FingerProp, side * FingerContentYRatio - h * FingerContentCenterYRatio);
        }
    }

    // 最宽状态下土豆的显示宽度：既是水平居中的基准，也让窗口宽度不随状态变化
    private double MaxPotatoWidth()
    {
        var side = BaseSide * _settings.ScalePercent / 100.0;
        var maxAspect = IdleSprite.PixelWidth / (double)IdleSprite.PixelHeight;
        foreach (var s in StateSprites)
        {
            if (s is null) continue;
            var aspect = s.PixelWidth / (double)s.PixelHeight;
            if (aspect > maxAspect) maxAspect = aspect;
        }
        return side * maxAspect;
    }

    // 计数变化后调用：刷新素材与尺寸，返回状态序号是否发生变化
    // 状态没变时不碰 Potato.Source —— 否则每次点击都会把正在播的受击帧刷成静息帧，连点看着像闪屏
    private bool ApplyStateVisual()
    {
        var state = ComputeStateIndex();
        var changed = state != _stateIndex;
        _stateIndex = state;
        if (!changed) return false;
        var sprite = CurrentStateSprite();
        Potato.Source = sprite;
        ApplyPotatoSize(sprite);
        ApplyPropLayout();  // 各状态素材宽度不同，土豆右轮廓动了，道具要跟着挪
        return true;
    }

    // 首次运行随机一组阈值；已有合法存档则原样沿用（重启不重随机）
    private void EnsureStateThresholds()
    {
        if (IsValidThresholds(_stateThresholds)) return;
        RerollStateThresholds();
    }

    // 直接随机一组新阈值并落盘（不管旧值是否合法）。连击断掉时调用，进入新一轮
    private void RerollStateThresholds()
    {
        var thresholds = new int[StateThresholdRanges.GetLength(0)];
        for (var i = 0; i < thresholds.Length; i++)
        {
            var lo = StateThresholdRanges[i, 0];
            var hi = StateThresholdRanges[i, 1];
            thresholds[i] = _rng.Next(lo, hi + 1);
            // 区间本身不重叠（15<20 / 35<40 / 65<70 / 100<110），这里只是再兜一次底
            if (i > 0 && thresholds[i] <= thresholds[i - 1]) thresholds[i] = thresholds[i - 1] + 1;
        }
        _stateThresholds = thresholds;
        SaveStats();  // 立即落盘，保证重启后还是这一组
    }

    private static bool IsValidThresholds(int[] thresholds)
    {
        if (thresholds.Length != 5) return false;
        for (var i = 0; i < thresholds.Length; i++)
        {
            if (thresholds[i] < StateThresholdRanges[i, 0] || thresholds[i] > StateThresholdRanges[i, 1]) return false;
            if (i > 0 && thresholds[i] <= thresholds[i - 1]) return false;
        }
        return true;
    }

    // —— 大小 / 位置 —— //

    private void ApplyScale(int percent)
    {
        _settings.ScalePercent = percent;
        ApplyPotatoSize(CurrentStateSprite());
        SaveSettings();
        UpdateStreakBadge();  // 连击徽章按新缩放重算（原先漏了，切档后徽章尺寸不跟随）
        UpdateTodayBadge();   // 今日徽章按新缩放重算，并刷新窗口宽度
        ApplyPropLayout();    // 水枪/中指也跟着缩放走
    }

    private void ApplyVolume(int percent)
    {
        _settings.VolumePercent = Math.Clamp(percent, 0, 100);
        SaveSettings();
        RebuildSounds();  // 只有换档时才重算 PCM，点击路径零开销
    }

    // 换音量档时统一重建所有音效播放器（暴打 / 4 段水声 / 鄙视）
    private void RebuildSounds()
    {
        var percent = _settings.VolumePercent;
        _hitSound = CreateSound(HitWav, percent);
        _squirtSounds = SquirtWavs.Select(w => CreateSound(w, percent)).ToArray();
        _despiseSound = CreateSound(DespiseWav, percent);
        // 台词（专属 3 句 + 随机 5 句）与其它音效一样按音量档缩放 PCM
        _lineWetSound = CreateSound(LineWetWav, percent);
        _lineStage2Sound = CreateSound(LineStage2Wav, percent);
        _lineFinalSound = CreateSound(LineFinalWav, percent);
        _lineRandomSounds = LineRandomWavs.Select(w => CreateSound(w, percent)).ToArray();
    }

    private void ApplyRestoredPosition()
    {
        if (_settings.X is not double x || _settings.Y is not double y) return;
        Left = x;
        Top = y;
        // 保存的位置在当前虚拟屏幕之外（如换显示器）则回到系统默认位置
        var vs = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
            SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        if (!vs.IntersectsWith(new Rect(Left, Top, Potato.Width, Potato.Height)))
        {
            Left = double.NaN;
            Top = double.NaN;
        }
    }

    // —— 托盘 —— //

    private void InitTray()
    {
        _tray = new WinForms.NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "暴打土豆",
            Visible = true
        };
        var menu = new WinForms.ContextMenuStrip();

        _trayShowHide = new WinForms.ToolStripMenuItem("隐藏土豆");
        _trayShowHide.Click += (_, _) => ToggleHidden();
        menu.Items.Add(_trayShowHide);
        _trayPause = new WinForms.ToolStripMenuItem("暂停暴打");
        _trayPause.Click += (_, _) => TogglePause();
        menu.Items.Add(_trayPause);
        menu.Items.Add(new WinForms.ToolStripSeparator());

        var levelMenu = new WinForms.ToolStripMenuItem("显示层级");
        _trayLevelItems[0] = CreateRadioItem(levelMenu, "仅桌面", () => _settings.Level == "desktop",
            () => { _settings.Level = "desktop"; SaveSettings(); ApplyLevel(); });
        _trayLevelItems[1] = CreateRadioItem(levelMenu, "始终置顶", () => _settings.Level == "topmost",
            () => { _settings.Level = "topmost"; SaveSettings(); ApplyLevel(); });
        menu.Items.Add(levelMenu);

        var sizeMenu = new WinForms.ToolStripMenuItem("大小");
        for (var i = 0; i < ScaleOptions.Length; i++)
        {
            var percent = ScaleOptions[i];
            _trayScaleItems[i] = CreateRadioItem(sizeMenu, $"{percent}%", () => _settings.ScalePercent == percent,
                () => ApplyScale(percent));
        }
        menu.Items.Add(sizeMenu);

        var volumeMenu = new WinForms.ToolStripMenuItem("音量");
        for (var i = 0; i < VolumeOptions.Length; i++)
        {
            var percent = VolumeOptions[i];
            _trayVolumeItems[i] = CreateRadioItem(volumeMenu, percent == 0 ? "静音" : $"{percent}%",
                () => _settings.VolumePercent == percent, () => ApplyVolume(percent));
        }
        menu.Items.Add(volumeMenu);

        menu.Items.Add(new WinForms.ToolStripSeparator());
        _trayAutostart = new WinForms.ToolStripMenuItem("开机启动")
        {
            CheckOnClick = true,
            Checked = IsAutostartEnabled()
        };
        _trayAutostart.Click += (_, _) => SetAutostart(_trayAutostart.Checked);
        menu.Items.Add(_trayAutostart);
        menu.Items.Add(new WinForms.ToolStripSeparator());
        menu.Items.Add(new WinForms.ToolStripSeparator());
        var exit = new WinForms.ToolStripMenuItem("退出");
        exit.Click += (_, _) => Close();
        menu.Items.Add(exit);

        menu.Opening += (_, _) => RefreshTrayMenu();
        // 托盘菜单同样靠钩子收起（桌宠进程没有前台窗口，菜单拿不到鼠标捕获）
        menu.Opened += (_, _) => { _trayMenuOpen = true; OnAnyMenuOpened(); };
        menu.Closed += (_, _) => { _trayMenuOpen = false; OnAnyMenuClosed(); };
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ToggleHidden();
    }

    private static WinForms.ToolStripMenuItem CreateRadioItem(WinForms.ToolStripMenuItem parent,
        string text, Func<bool> isChecked, Action onClick)
    {
        // 必须挂到父菜单的 DropDownItems 上，否则子菜单不会出现在托盘菜单里
        var item = new WinForms.ToolStripMenuItem(text) { Tag = isChecked };
        item.Click += (_, _) => { onClick(); };
        parent.DropDownItems.Add(item);
        return item;
    }

    private void RefreshTrayMenu()
    {
        _trayShowHide!.Text = _hidden ? "显示土豆" : "隐藏土豆";
        _trayPause!.Text = _paused ? "恢复暴打" : "暂停暴打";
        foreach (var item in _trayLevelItems) item!.Checked = ((Func<bool>)item.Tag!)();
        foreach (var item in _trayScaleItems) item!.Checked = ((Func<bool>)item.Tag!)();
        foreach (var item in _trayVolumeItems) item!.Checked = ((Func<bool>)item.Tag!)();
        _trayAutostart!.Checked = IsAutostartEnabled();
    }

    private SD.Icon LoadTrayIcon()
    {
        try
        {
            return new SD.Icon(IOPath.Combine(AppContext.BaseDirectory, "assets", "potato", "icon.ico"), 32, 32);
        }
        catch
        {
            return SD.SystemIcons.Application;
        }
    }

    private void ToggleHidden()
    {
        _hidden = !_hidden;
        if (_hidden) Hide(); else { Show(); ApplyLevel(); }
        if (_trayShowHide != null) _trayShowHide.Text = _hidden ? "显示土豆" : "隐藏土豆";
    }

    private void TogglePause()
    {
        _paused = !_paused;
        if (_trayPause != null) _trayPause.Text = _paused ? "恢复暴打" : "暂停暴打";
    }

    // —— 开机启动（HKCU Run，无需管理员） —— //

    private const string AutostartRunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AutostartValueName = "BeatPotato";

    private static bool IsAutostartEnabled()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(AutostartRunKey);
        return key?.GetValue(AutostartValueName) != null;
    }

    private static void SetAutostart(bool enabled)
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(AutostartRunKey, true);
        if (key == null) return;
        if (enabled) key.SetValue(AutostartValueName, $"\"{Environment.ProcessPath}\"");
        else key.DeleteValue(AutostartValueName, false);
    }

    // —— 设置读写 —— //

    private void LoadSettings()
    {
        try
        {
            if (!File.Exists(SettingsPath)) return;
            _settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath)) ?? new AppSettings();
        }
        catch
        {
            _settings = new AppSettings();
        }
    }

    private void SaveSettings()
    {
        try
        {
            Directory.CreateDirectory(IOPath.GetDirectoryName(SettingsPath)!);
            File.WriteAllText(SettingsPath, JsonSerializer.Serialize(_settings));
        }
        catch
        {
            // 写盘失败不影响功能
        }
    }

    // —— 交互（点击 / 拖动 / 菜单） —— //

    private void OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        _downPos = e.GetPosition(this);
        _dragInProgress = false;
        Potato.CaptureMouse();
    }

    private void OnMouseMove(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed || _dragInProgress) return;
        if ((e.GetPosition(this) - _downPos).Length < SystemParameters.MinimumHorizontalDragDistance) return;

        _dragInProgress = true;
        Potato.ReleaseMouseCapture();
        Opacity = 0.75;
        try
        {
            DragMove();
        }
        finally
        {
            Opacity = 1.0;
        }
        _dragInProgress = false;
    }

    private void OnMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        Potato.ReleaseMouseCapture();
        if (!_dragInProgress)
        {
            HitPotato();
        }
        _dragInProgress = false;
    }

    private void HitPotato()
    {
        if (_paused) return;
        RollTodayIfNeeded();
        _totalHits++;
        _todayHits++;
        _streakHits++;
        // Phase 4 增加统计显示前，用窗口标题作为计数的外部验证通道
        Title = $"Beat Potato|{_totalHits} today:{_todayHits} streak:{_streakHits}";
        if (_totalHits % 50 == 0) SaveStats();
        // 音效优先级：升级专属台词 > 10% 随机台词（有 30 下冷却 + 节点前后各 NodeLineBlockClicks 下保护）> 暴打音；
        // 台词正在播的那段时间不打断它，也不出打击音
        OnClickTick();
        var prevState = _stateIndex;
        if (!PlayStateLine(prevState, ComputeStateIndex()) && !PlayRandomLineIfLucky(leftClick: true) && !LineIsPlaying) PlaySound(_hitSound);
        // 第一次达到阈值就立刻换状态；尺寸变了要重算徽章布局
        ApplyStateVisual();
        UpdateStreakBadge();
        UpdateTodayBadge();
        // 连击计时：每次击打重新计时，6 秒无击打则隐藏并归零
        _streakHideTimer.Stop();
        _streakHideTimer.Start();
        // 每一次击打都立刻切到当前状态的受击帧（反馈零延迟），并把"回弹"推后 HitHoldMs：
        // 连点时土豆一直保持被拍扁，停手后才回到静息帧 —— 干脆，又不会忽扁忽圆地闪。
        _animTimer.Stop();
        ApplyAnimFrame();
        _animTimer.Start();
    }

    private void OnAnimTick(object? sender, EventArgs e)
    {
        // 受击保持结束：停表并显式回到"当前状态"的静息帧。
        // 这里不能只把帧号置 0 后继续走 ApplyAnimFrame —— 那会让土豆永远停在挨打的那一帧上。
        _animTimer.Stop();
        Potato.Source = CurrentStateSprite();
        TotalBounce.ScaleX = TotalBounce.ScaleY = 1;
    }

    // 击打瞬间：土豆切成"当前状态"的受击帧（每个状态一张自己的受击形变），连击徽章弹到最大。
    // 回弹不在这里做 —— 由 OnAnimTick 在 HitHoldMs 之后切回静息帧。
    private void ApplyAnimFrame()
    {
        Potato.Source = CurrentHitSprite();
        TotalBounce.ScaleX = TotalBounce.ScaleY = StreakBounceMax;
    }

    // 当前状态的受击帧（与状态原图同画布，显示框不变）；素材缺失时退回最初版的 hit_1
    private BitmapImage CurrentHitSprite()
    {
        // 湿身期间没有专门的受击帧：直接用湿身图，连点也不会在两种画风之间闪
        if (_wet && WetSprite is { } wet) return wet;
        return StateHitSprites[_stateIndex] ?? HitSprite1;
    }

    // —— 右键喷水 / 中键竖中指（2026-10-10）—— //
    // 与左键暴打彻底分开：不计数、不推状态、不写存档，只是"打一下有反应"的额外反馈。
    // 计时器都是点一下起一次、到点自己停，待机时没有任何东西在跑。

    private void OnMouseRightButtonDown(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;  // 右键不再有 WPF 菜单，这里只负责滋水
        Squirt();
    }

    // 左键有自己的 MouseLeftButtonDown，这里只认中键
    private void OnMousePropDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Middle) return;
        e.Handled = true;
        ShowFinger();
    }

    private void Squirt()
    {
        if (_paused) return;
        OnClickTick();  // 随机台词的冷却按"按下次数"推进
        _squirtTotal++; // 累计点击，**跨轮不清零** —— "前 N 下不出随机台词"按这个算
        // 第 5 下要变湿：那一下不播水声，改由 EnterWet 播「我后背湿着呢」并甩出展开图
        var willWet = !_wet && _squirtCount + 1 >= SquirtHitsToWet;
        // 水枪的前 SquirtLineBlockClicks 下一律不出随机台词（用户 2026-10-12 要求，先 5 后改 10）
        // 注意用 _squirtTotal 而不是 _squirtCount —— 后者每满 5 下就归零，
        // "_squirtCount + 1 > 10" 永远不成立，这个功能从加上起就没生效过（2026-10-12 修）
        if (!willWet && !LineIsPlaying && _squirtTotal > SquirtLineBlockClicks)
        {
            if (!PlayRandomLineIfLucky()) PlaySquirtSound();
        }
        else if (!willWet && !LineIsPlaying)
        {
            PlaySquirtSound();
        }
        if (SquirtPropSprite is { } squirt)
        {
            SquirtProp.Source = squirt;
            SquirtProp.Visibility = Visibility.Visible;
            _squirtPropTimer.Stop();
            _squirtPropTimer.Start();  // 连点：把"收回水枪"的时间往后推，枪一直举着
        }
        // 满 5 下才湿：前 4 下只有水枪和水声，第 5 下才把土豆换成"被滋湿"
        if (_wet)
        {
            // 已经湿了：继续滋就是"接着滋"，把变干的时间往后推，不累计下一次
            _wetTimer.Stop();
            _wetTimer.Start();
            return;
        }
        if (++_squirtCount >= SquirtHitsToWet)
        {
            _squirtCount = 0;
            EnterWet();
        }
    }

    private void PlaySquirtSound()
    {
        if (_squirtSounds.Length == 0) return;
        PlaySound(_squirtSounds[_rng.Next(_squirtSounds.Length)]);
    }

    private void ShowFinger()
    {
        if (_paused) return;
        OnClickTick();
        if (!LineIsPlaying && !PlayRandomLineIfLucky()) PlaySound(_despiseSound);
        if (FingerPropSprite is not { } finger) return;
        FingerProp.Source = finger;
        FingerProp.Visibility = Visibility.Visible;
        _fingerPropTimer.Stop();
        _fingerPropTimer.Start();
    }

    // 湿身：换成"被滋湿"素材并保持 WetHoldMs，到点自己干、回到当前连击状态的样子
    private void EnterWet()
    {
        if (WetSprite is not { } wet) return;
        _wet = true;
        Potato.Source = wet;
        ApplyPotatoSize(wet);
        ApplyPropLayout();
        // 变形态这一下：顶掉水声，播专属台词（并压制前后各 NodeLineBlockClicks 次点击的随机台词），把「土豆本豆.jpg」甩出来
        PlayNodeLine(_lineWetSound, LineWetMs);
        ShowFlash();
        _wetTimer.Stop();
        _wetTimer.Start();
    }

    private void ExitWet()
    {
        _wetTimer.Stop();
        if (!_wet) return;
        _wet = false;
        var sprite = CurrentStateSprite();
        Potato.Source = sprite;
        ApplyPotatoSize(sprite);
        ApplyPropLayout();
    }

    private static void PlaySound(SoundPlayer? player)
    {
        if (player is null) return;
        try
        {
            player.Play();  // winmm 异步播放，不阻塞 UI 线程
        }
        catch
        {
            // 播放失败不影响交互
        }
    }

    // 10% 概率随机冒一句"没点名"的台词；命中就顶掉本次的基础音效（进程内一次只能响一个声音）
    // leftClick：左键入口传 true，水枪/中指传 false。
    //   冷却两档：左键 30 次，水枪+中指 20 次（用户 2026-10-12："中指和水枪一个入口，左键一个入口"）
    //   第一阶段屏蔽（_stateIndex<=0）与"节点前保护窗口"（NearUpgradeNode）**只对左键生效** ——
    //   水枪/中指是用户的主动取乐操作，不该被连带屏蔽。
    //   注意 NearUpgradeNode 在第一阶段会整段命中（阈值 [8,15] 时 _streakHits 1..阈值 全程落在窗口内），
    //   所以"中指不受限"必须同时绕开这一道，否则看起来仍像被第一阶段挡住（用户 2026-10-12 反馈）
    private bool PlayRandomLineIfLucky(bool leftClick = false)
    {
        if (_lineRandomSounds.Length == 0) return false;
        if (_clickSeq <= _randomLineBlockedUntil) return false;   // 重要节点「之后」的保护窗口（三个入口通用）
        if (leftClick && _stateIndex <= 0) return false;          // 还没进第一阶段：左键不出随机台词
        if (leftClick && NearUpgradeNode()) return false;         // 重要节点「之前」的保护窗口（仅左键）
        if (leftClick)
        {
            if (_clicksSinceRandomLineHit < RandomLineCooldownClicksHit) return false;
        }
        else
        {
            if (_clicksSinceRandomLineProp < RandomLineCooldownClicksProp) return false;
        }
        if (_rng.Next(100) >= RandomLinePercent) return false;
        var i = _rng.Next(_lineRandomSounds.Length);
        PlayLine(_lineRandomSounds[i], LineRandomMs[i]);
        // 只清零自己那一档（另一档继续累计）
        if (leftClick) _clicksSinceRandomLineHit = 0; else _clicksSinceRandomLineProp = 0;
        return true;
    }

    // 距离「有点烦」（第 2 形态）或「摆烂」（第 6 形态）这两个升级节点还差 0~NodeLineBlockClicks 下时，
    // 也一律不出随机台词。这两下是 100% 播专属台词的，随机台词在前或在后冒出来都会和它撞车
    // （用户 2026-10-11 反馈："我在几次的时候都有随机音频，不是马上就要第二形态了吗"）。
    // 阈值是随机存档的，所以按"离阈值还差几下"来判断，而不是按固定点击数。
    private bool NearUpgradeNode()
    {
        if (_stateThresholds.Length < 5) return false;
        return NearThreshold(_stateThresholds[0]) || NearThreshold(_stateThresholds[4]);
    }

    private bool NearThreshold(int threshold)
    {
        var remain = threshold - _streakHits;
        return remain >= 0 && remain <= NodeLineBlockClicks;
    }

    // 每次有效点击（左键命中 / 右键 / 中键）都走这里。
    // 两个冷却计数器**都**推进：一次左键点击也该让"水枪+中指"那一档少等一次，
    // 否则两档会各算各的、与"按次数冷却"的直觉不符
    private void OnClickTick()
    {
        _clickSeq++;
        _clicksSinceRandomLineHit++;
        _clicksSinceRandomLineProp++;
    }

    // 播"重要节点"的专属台词，并顺带把随机台词往后压 NodeLineBlockClicks 次点击
    // （用户要求"在那三个重要节点附近 20 次也不能出现"随机台词，2026-10-11 晚改为前后各 10 次；
    //  这里只管节点「之后」，节点「之前」由 NearUpgradeNode() 拦）
    private void PlayNodeLine(SoundPlayer? player, int durationMs)
    {
        PlayLine(player, durationMs);
        _randomLineBlockedUntil = _clickSeq + NodeLineBlockClicks;
    }

    // 左键打击升级时播专属台词：进入「有点烦」（第 2 个状态）→ 你看有人理你吗；进入「摆烂」（最后一个状态）→ 要死了
    // 这两句和变湿那句是"特定台词"，可以打断正在播的台词，也不参与随机台词的冷却
    private bool PlayStateLine(int prevState, int nextState)
    {
        if (nextState == prevState) return false;
        if (nextState == 1)
        {
            PlayNodeLine(_lineStage2Sound, LineStage2Ms);
            return true;
        }
        if (nextState >= 5)
        {
            PlayNodeLine(_lineFinalSound, LineFinalMs);
            return true;
        }
        return false;
    }

    // 台词正在播吗（依据预计结束时刻判断，SoundPlayer 本身查不到播放进度）
    private bool LineIsPlaying => DateTime.UtcNow < _lineEndsAt;

    // 播一句台词并记下它的结束时刻：这期间点击不打断它、也不出基础音效
    private void PlayLine(SoundPlayer? player, int durationMs)
    {
        if (player is null) return;
        PlaySound(player);
        _lineEndsAt = DateTime.UtcNow.AddMilliseconds(durationMs > 0 ? durationMs : 1500);
    }

    /// <summary>从 WAV 字节算时长（毫秒）：读 fmt 的 nAvgBytesPerSec 与 data 大小。</summary>
    private static int WavDurationMs(byte[] wav)
    {
        if (wav.Length < 44) return 0;
        var pos = 12;
        var byteRate = 0;
        var dataSize = 0;
        while (pos + 8 <= wav.Length)
        {
            var id = System.Text.Encoding.ASCII.GetString(wav, pos, 4);
            var size = BitConverter.ToInt32(wav, pos + 4);
            if (id == "fmt " && size >= 16) byteRate = BitConverter.ToInt32(wav, pos + 8 + 8);
            if (id == "data")
            {
                dataSize = Math.Min(size, wav.Length - pos - 8);
                break;
            }
            pos += 8 + size + (size & 1);
        }
        if (byteRate <= 0 || dataSize <= 0) return 0;
        return (int)(dataSize * 1000L / byteRate);
    }

    // —— 展开图：变湿那一下把「土豆本豆.jpg」从土豆身上由小到大甩出来，停一下再淡出 —— //
    // 全程走 Storyboard（事件驱动、零定时器、零轮询）。竖图比土豆大得多，而窗口左边就贴着土豆，
    // 所以要让它"以土豆为中心"完整显示，就得在动画期间把窗口向左上扩出一块，同时用 Root 的
    // Margin 把内容往右下补偿同样的距离 —— 窗口边界左移了、内容也右移了，两者抵消，
    // 屏幕上的土豆纹丝不动，图却能完整地盖在土豆正中。动画一结束，位置/尺寸/边距全部还原。
    private void ShowFlash()
    {
        if (FlashSprite is not { } sprite) return;
        var h = PotatoSide() * FlashHeightRatio;
        var w = h * sprite.PixelWidth / sprite.PixelHeight;
        FlashImage.Source = sprite;
        FlashImage.Width = w;
        FlashImage.Height = h;

        // 土豆中心（Root 画布坐标）：取实际布局位置，未布局时退回 Margin/Width 估算
        double centerX, centerY;
        try
        {
            var c = Potato.TranslatePoint(new System.Windows.Point(Potato.ActualWidth / 2, Potato.ActualHeight / 2), Root);
            centerX = c.X;
            centerY = c.Y;
        }
        catch
        {
            centerX = Potato.Margin.Left + Potato.Width / 2;
            centerY = Potato.Margin.Top + Potato.Height / 2;
        }

        if (!_flashRunning)
        {
            _flashRunning = true;
            _flashSavedWidth = Root.Width;
            _flashHeightAuto = double.IsNaN(Root.Height);
            _flashSavedHeight = _flashHeightAuto ? Root.ActualHeight : Root.Height;
            _flashSavedMargin = Root.Margin;
            _flashSavedLeft = Left;
            _flashSavedTop = Top;
        }

        // 图要盖住土豆就得往左上扩：padX/padY 是"图左半"超出土豆中心的部分
        var padX = Math.Max(0, w / 2 - centerX);
        var padY = Math.Max(0, h / 2 - centerY);
        Root.Margin = new Thickness(padX, padY, 0, 0);
        _flashNeedWidth = centerX + w / 2 + FlashPadding;
        Root.Width = Math.Max(_flashSavedWidth, _flashNeedWidth);
        Root.Height = Math.Max(_flashSavedHeight, centerY + h / 2 + FlashPadding);
        // 窗口跟着往左上挪同样距离，抵消 Margin 带来的内容位移
        if (!double.IsNaN(_flashSavedLeft)) Left = _flashSavedLeft - padX;
        if (!double.IsNaN(_flashSavedTop)) Top = _flashSavedTop - padY;
        Canvas.SetLeft(FlashImage, centerX - w / 2);
        Canvas.SetTop(FlashImage, centerY - h / 2);

        FlashImage.Visibility = Visibility.Visible;
        FlashScale.ScaleX = FlashScale.ScaleY = FlashScaleFrom;
        FlashImage.Opacity = 1;

        var grow = new DoubleAnimation(FlashScaleFrom, 1.0, TimeSpan.FromMilliseconds(FlashGrowMs))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
        };
        var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromMilliseconds(FlashFadeMs))
        {
            BeginTime = TimeSpan.FromMilliseconds(FlashGrowMs + FlashHoldMs)
        };
        fade.Completed += (_, _) => EndFlash();

        FlashScale.BeginAnimation(ScaleTransform.ScaleXProperty, grow);
        FlashScale.BeginAnimation(ScaleTransform.ScaleYProperty, grow);
        FlashImage.BeginAnimation(OpacityProperty, fade);
    }

    private void EndFlash()
    {
        FlashImage.Visibility = Visibility.Hidden;
        FlashImage.BeginAnimation(OpacityProperty, null);
        FlashScale.BeginAnimation(ScaleTransform.ScaleXProperty, null);
        FlashScale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
        if (!_flashRunning) return;
        _flashRunning = false;
        Root.Margin = _flashSavedMargin;
        Root.Width = _flashSavedWidth;
        Root.Height = _flashHeightAuto ? double.NaN : _flashSavedHeight;
        // 窗口位置还原成动画前的值（闪现阶段 Left/Top 被临时挪过）
        if (!double.IsNaN(_flashSavedLeft)) Left = _flashSavedLeft;
        if (!double.IsNaN(_flashSavedTop)) Top = _flashSavedTop;
    }

    // —— 菜单外部点击收起 —— //
    // 桌宠窗口带 WS_EX_NOACTIVATE（点击土豆不抢焦点），永远不是前台窗口，而 Windows
    // 只允许前台线程的窗口获得鼠标捕获 —— 菜单因此拿不到捕获（实测 GetCapture()=0），
    // 点击菜单外部时收不到任何通知，表现为"菜单赖着不走"。
    // 这里在菜单打开期间挂一个低级别鼠标钩子（事件驱动、无轮询），点到菜单外即收起。
    // 土豆的 WPF 右键菜单已在 2026-10-10 去掉（右键改成滋水），现在还挂这个钩子的只剩托盘菜单。

    private const int WH_MOUSE_LL = 14;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelMouseProc? _mouseProc;   // 静态持有，防止回调委托被 GC 回收
    private IntPtr _mouseHook;
    private int _openMenuCount;   // 土豆右键菜单与托盘菜单可能相继打开，用计数决定钩子装卸
    private bool _trayMenuOpen;

    private void OnAnyMenuOpened()
    {
        _openMenuCount++;
        InstallMenuDismissHook();
    }

    private void OnAnyMenuClosed()
    {
        if (--_openMenuCount < 0) _openMenuCount = 0;
        if (_openMenuCount == 0) UninstallMenuDismissHook();
    }

    private void InstallMenuDismissHook()
    {
        if (_mouseHook != IntPtr.Zero) return;
        _mouseProc = OnLowLevelMouse;
        _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, GetModuleHandle(null), 0);
    }

    private void UninstallMenuDismissHook()
    {
        if (_mouseHook == IntPtr.Zero) return;
        UnhookWindowsHookEx(_mouseHook);
        _mouseHook = IntPtr.Zero;
        _mouseProc = null;
    }

    private IntPtr OnLowLevelMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var msg = wParam.ToInt32();
            if ((msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN) && !IsOverAnyMenu())
            {
                if (_tray?.ContextMenuStrip is { IsDisposed: false, Visible: true } strip) strip.Close();
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    private bool IsOverAnyMenu()
    {
        GetCursorPos(out var pt);
        // 土豆的 WPF 右键菜单已随"右键喷水"一起删掉（2026-10-10），这里只剩托盘菜单要判断。
        // 子菜单是独立的 ToolStripDropDown 窗口，只测主菜单矩形会让点"音量/大小/显示层级"
        // 这些子项时菜单被误关，表现为"点选项没反应"。
        if (_trayMenuOpen && _tray?.ContextMenuStrip is { IsDisposed: false } strip
            && IsOverDropDown(strip, pt)) return true;
        return false;
    }

    private static bool IsOverDropDown(System.Windows.Forms.ToolStripDropDown dd, POINT pt)
    {
        if (dd.IsDisposed) return false;
        if (dd.Visible && dd.IsHandleCreated && HitTestWindow(dd.Handle, pt)) return true;
        foreach (System.Windows.Forms.ToolStripItem item in dd.Items)
        {
            if (item is System.Windows.Forms.ToolStripMenuItem { HasDropDownItems: true } mi
                && IsOverDropDown(mi.DropDown, pt)) return true;
        }
        return false;
    }

    private static bool HitTestWindow(IntPtr hwnd, POINT pt)
        => GetWindowRect(hwnd, out var r) && pt.X >= r.Left && pt.X < r.Right && pt.Y >= r.Top && pt.Y < r.Bottom;

    // —— 连击数字（右上角）：击打从 1 累加，超时归零隐藏 —— //

    private void UpdateStreakBadge()
    {
        var f = PotatoSide() / LayoutRefSide;
        if (!_counterSpritesReady)
        {
            StreakBadge.Visibility = Visibility.Hidden;
            return;
        }

        // 未击打时按 1 位数字走同一套布局（只隐藏不塌陷）：窗口尺寸恒定，点击时土豆不跳动
        var digits = _streakHits.ToString();
        EnsureDigitImages(StreakBadge, _streakDigitImages, digits.Length);
        if (_streakHits > 0 && _streakBurst != null && _burstPool.Length > 0)
            _streakBurst.Source = _burstPool[_rng.Next(_burstPool.Length)];  // 每次击打随机换一张爆点

        var digitH = StreakDigitHeight * f;
        var overlap = digitH * DigitOverlapRatio;

        // 数字串宽度 = 各位宽度之和 - 相邻重叠
        var digitsW = 0.0;
        var drawn = 0;
        for (var i = 0; i < digits.Length; i++)
        {
            var bmp = _totalDigitBmps[digits[i] - '0'];
            if (bmp == null) continue;
            digitsW += bmp.PixelWidth * digitH / bmp.PixelHeight;
            drawn++;
        }
        if (drawn > 1) digitsW -= overlap * (drawn - 1);

        // 爆点：等比缩放到数字高度的 BurstHeightRatio 倍，居中垫在数字下面
        var burstH = digitH * BurstHeightRatio;
        var burstW = burstH;
        if (_streakBurst?.Source is BitmapSource burstSrc && burstSrc.PixelHeight > 0)
            burstW = burstH * burstSrc.PixelWidth / burstSrc.PixelHeight;

        var pad = digitH * BadgePadRatio;
        var canvasW = Math.Max(digitsW, burstW) + pad * 2;
        var canvasH = Math.Max(digitH, burstH) + pad * 2;

        if (_streakBurst != null)
        {
            _streakBurst.Width = burstW;
            _streakBurst.Height = burstH;
            Canvas.SetLeft(_streakBurst, (canvasW - burstW) / 2);
            Canvas.SetTop(_streakBurst, (canvasH - burstH) / 2);
        }

        var x = (canvasW - digitsW) / 2;
        var y = (canvasH - digitH) / 2;
        for (var i = 0; i < digits.Length; i++)
        {
            var bmp = _totalDigitBmps[digits[i] - '0'];
            if (bmp == null) continue;
            var img = _streakDigitImages[i];
            var w = bmp.PixelWidth * digitH / bmp.PixelHeight;
            img.Source = bmp;
            img.Width = w;
            img.Height = digitH;
            Canvas.SetLeft(img, x);
            Canvas.SetTop(img, y);
            img.Visibility = Visibility.Visible;
            x += w - overlap;
        }
        for (var i = digits.Length; i < _streakDigitImages.Count; i++) _streakDigitImages[i].Visibility = Visibility.Collapsed;

        StreakBadge.Width = canvasW;
        StreakBadge.Height = canvasH;
        // 弹跳是从"顶边中点"向外放大到 StreakBounceMax 倍，所以右边要额外让出
        // canvasW*(1.45-1)/2 的宽度，否则点击瞬间徽章的右侧会被窗口边缘切掉。
        // 还要把给水枪预留的那块窗口宽度让出来：徽章是右对齐到窗口右边的，
        // 预留区一加就会把徽章推离土豆（2026-10-11 用户反馈"爆炸数字离本体的距离变了"）。
        StreakBadge.Margin = new Thickness(0, StreakTiltTopPad * f, PropReserve() + StreakSideMargin * f + canvasW * StreakBounceHeadroom, StreakGapAbove * f);
        StreakBadge.Visibility = _streakHits > 0 ? Visibility.Visible : Visibility.Hidden;
        UpdateRootWidth();
    }

    // —— 今日暴打：下方持续显示 —— //

    private void UpdateTodayBadge()
    {
        if (!_counterSpritesReady)
        {
            TodayBadge.Visibility = Visibility.Hidden;
            return;
        }
        var f = PotatoSide() / LayoutRefSide;
        var digits = _todayHits.ToString();
        EnsureDigitImages(TodayBadge, _todayDigitImages, digits.Length);
        var overlap = TodayDigitHeight * f * DigitOverlapRatio;
        var x = 2 * f;
        var lastRight = 0.0;
        // 标签：今日 + 暴打
        if (_labelJin != null)
        {
            var w = _labelJin.PixelWidth * TodayDigitHeight * f / _labelJin.PixelHeight;
            _todayJin.Source = _labelJin;
            _todayJin.Width = w;
            _todayJin.Height = TodayDigitHeight * f;
            Canvas.SetLeft(_todayJin, x);
            Canvas.SetTop(_todayJin, 0);
            _todayJin.Visibility = Visibility.Visible;
            x += w + TodayDigitHeight * f * 0.1;
        }
        if (_labelBao != null)
        {
            var w = _labelBao.PixelWidth * TodayDigitHeight * f / _labelBao.PixelHeight;
            _todayBao.Source = _labelBao;
            _todayBao.Width = w;
            _todayBao.Height = TodayDigitHeight * f;
            Canvas.SetLeft(_todayBao, x);
            Canvas.SetTop(_todayBao, 0);
            _todayBao.Visibility = Visibility.Visible;
            x += w + TodayDigitHeight * f * 0.25;
        }
        for (var i = 0; i < digits.Length; i++)
        {
            var bmp = _todayDigitBmps[digits[i] - '0'];
            if (bmp == null) continue;
            var img = _todayDigitImages[i];
            var w = bmp.PixelWidth * TodayDigitHeight * f / bmp.PixelHeight;
            img.Source = bmp;
            img.Width = w;
            img.Height = TodayDigitHeight * f;
            Canvas.SetLeft(img, x);
            Canvas.SetTop(img, 0);
            img.Visibility = Visibility.Visible;
            lastRight = x + w;
            x = lastRight - overlap;
        }
        for (var i = digits.Length; i < _todayDigitImages.Count; i++) _todayDigitImages[i].Visibility = Visibility.Collapsed;
        var todayW = lastRight + 2 * f;
        TodayBadge.Width = todayW;
        TodayBadge.Height = TodayDigitHeight * f;
        // 今日徽章在土豆正下方居中：土豆自身的左边距（水平居中补偿）+ 土豆内部的居中偏移
        TodayBadge.Margin = new Thickness(Potato.Margin.Left + Math.Max(0, (Potato.Width - todayW) / 2), TodayGapAbove * f, 0, 0);
        TodayBadge.Visibility = Visibility.Visible;
        UpdateRootWidth();
    }

    // —— 窗口宽度：内容最大宽度 + 右侧预留，连击徽章右对齐后即越过土豆右轮廓 —— //

    private void UpdateRootWidth()
    {
        var f = PotatoSide() / LayoutRefSide;
        var todayW = double.IsNaN(TodayBadge.Width) ? 0 : TodayBadge.Width;
        var streakW = double.IsNaN(StreakBadge.Width) ? 0 : StreakBadge.Width;
        var contentW = Math.Max(MaxPotatoWidth(), Math.Max(todayW, streakW));
        // 右侧常驻预留：连击徽章弹跳 + 水枪道具。水枪只在点右键时露出，但预留一直留着，
        // 否则点一下窗口宽度就变，窗口尺寸一变土豆会被挤动、看着很跳。
        var propReserve = PropReserve();
        var width = contentW + propReserve + StreakRightOverhang * f + streakW * StreakBounceHeadroom;
        // 展开图正在放的时候窗口是临时放大的，别把它缩回去（否则竖图会被裁掉两侧）
        Root.Width = _flashRunning ? Math.Max(width, _flashNeedWidth) : width;
    }

    // —— 连击归零：超时未击打，隐藏徽章并重置 —— //

    private void ResetStreak()
    {
        _streakHits = 0;
        _streakHideTimer.Stop();
        StreakBadge.Visibility = Visibility.Hidden;
        foreach (var img in _streakDigitImages) img.Visibility = Visibility.Collapsed;
        // 新一轮重随机阈值：这样"打死一轮 → 断掉 → 再打一轮"时，
        // 每一档需要的连击数都会在区间内浮动，而不是永远固定同一个数字（用户 2026-10-12 反馈）
        RerollStateThresholds();
        ApplyStateVisual();  // 连击断了：土豆回到「正常」
    }

    // —— 统计读写 —— //

    private void LoadStats()
    {
        try
        {
            if (!File.Exists(StatsPath)) return;
            var data = JsonSerializer.Deserialize<StatsData>(File.ReadAllText(StatsPath));
            if (data == null) return;
            _totalHits = data.TotalHits;
            _todayHits = data.TodayDate == _todayDate ? data.TodayHits : 0;
            if (data.StateThresholds is { } saved) _stateThresholds = saved;
        }
        catch
        {
            // 存档缺失或损坏则从头计数
        }
    }

    private void SaveStats()
    {
        try
        {
            Directory.CreateDirectory(IOPath.GetDirectoryName(StatsPath)!);
            var data = new StatsData
            {
                TotalHits = _totalHits,
                TodayHits = _todayHits,
                TodayDate = _todayDate,
                StateThresholds = _stateThresholds.Length == 5 ? _stateThresholds : null
            };
            File.WriteAllText(StatsPath, JsonSerializer.Serialize(data));
        }
        catch
        {
            // 写盘失败不影响游戏
        }
    }

    private void RollTodayIfNeeded()
    {
        var today = DateTime.Today.ToString("yyyy-MM-dd");
        if (today == _todayDate) return;
        _todayDate = today;
        _todayHits = 0;
    }

    protected override void OnClosed(EventArgs e)
    {
        _streakHideTimer.Stop();
        UninstallMenuDismissHook();
        // 闪现阶段窗口位置被临时挪过，存档要用动画前的原始坐标，免得把偏移写进设置
        _settings.X = _flashRunning && !double.IsNaN(_flashSavedLeft) ? _flashSavedLeft : Left;
        _settings.Y = _flashRunning && !double.IsNaN(_flashSavedTop) ? _flashSavedTop : Top;
        SaveSettings();
        if (_tray != null)
        {
            _tray.Visible = false;
            _tray.Dispose();
            _tray = null;
        }
        SaveStats();
        base.OnClosed(e);
    }

    // —— Win32：仅桌面层级依赖 —— //

    private const int GWL_HWNDPARENT = -8;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string? lpWindowName);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    // —— 菜单收起钩子所需的 Win32 —— //

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
