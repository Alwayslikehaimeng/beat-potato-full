/* ==========================================================================
 * 暴打土豆 · 网页版（移动端 / iOS Safari 优先）
 * --------------------------------------------------------------------------
 * 玩法、数值、布局全部对齐 Android 版 MainActivity.kt（用户要求"参考安卓版"）。
 * 单文件、零依赖、零构建；待机时零定时器零动画（遵循 Plan.md §3 性能铁律）。
 *
 * 与 Android 的对应关系：
 *   potatoView(280dp 正方形 FrameLayout + FIT_CENTER) → #potatoBox(side×side) + .frame(object-fit:contain)
 *   SoundPool.play(id, volume)                        → Web Audio AudioBufferSourceNode
 *   SharedPreferences("stats"/"settings")             → localStorage 两个 key
 *   View.postDelayed(...)                             → setTimeout
 *   onTouchEvent(ACTION_UP)                           → pointerdown（零延迟，触摸一次=击打一次）
 * ========================================================================== */
(function () {
'use strict';

/* ======================================================================
 * 1. 常量 —— 逐条抄自 MainActivity.kt，不要凭感觉改
 * ==================================================================== */
var FRAME_MS                = 60;      // 徽章弹跳的帧间隔
var POTATO_REF              = 280;     // Android POTATO_DP，徽章尺寸基准
var HOLD_MS                 = 120;     // 受击帧停留时长
var STATE_COUNT             = 6;
var STATE_THRESHOLD_RANGES  = [[8, 15], [20, 35], [40, 65], [70, 100], [110, 130]];
var STREAK_RESET_MS         = 6000;    // 连击断档
var STREAK_DIGIT_REF        = 36;
var TODAY_DIGIT_REF         = 15;
var DIGIT_OVERLAP_RATIO     = 0.16;
var BURST_HEIGHT_RATIO      = 2.0;
var BADGE_PAD_RATIO         = 0.14;
var STREAK_RIGHT_OVERHANG_REF = 25;
var TODAY_GAP_ABOVE_REF     = 4;
var BADGE_POP_PEAK          = 1.45;
var DEFAULT_VOLUME_PERCENT  = 75;
var VOLUME_LEVELS           = [0, 25, 50, 75, 100];
var VOLUME_75_SCALE         = 0.1;     // 75% 对应内部标量 0.1

var SQUIRT_HITS_TO_WET      = 5;
var SQUIRT_PROP_HOLD_MS     = 300;
var FINGER_PROP_HOLD_MS     = 400;
var WET_HOLD_MS             = 4000;

var SQUIRT_CONTENT_HEIGHT_RATIO = 0.62;
var SQUIRT_OVERLAP_RATIO        = 0.26;
var SQUIRT_CENTER_Y_RATIO       = 0.57;
var SQUIRT_CONTENT_X_RATIO      = 0.1578;
var SQUIRT_CONTENT_Y_RATIO      = 0.5559;
var SQUIRT_CONTENT_H_RATIO      = 0.4078;
var SQUIRT_CONTENT_ASPECT       = 677 / 522;
var FINGER_CONTENT_HEIGHT_RATIO = 0.80;
var FINGER_CONTENT_H_RATIO      = 0.9355;
var FINGER_CONTENT_CENTER_X_RATIO = 0.5098;
var FINGER_CONTENT_CENTER_Y_RATIO = 0.5317;
var FINGER_CONTENT_Y_RATIO      = 0.60;
var PROP_EDGE_MARGIN            = 6;

var RANDOM_LINE_PERCENT     = 10;
var RANDOM_LINE_COOLDOWN_CLICKS_HIT  = 30;   // 左键：30 下冷却
var RANDOM_LINE_COOLDOWN_CLICKS_PROP = 20;   // 水枪/中指：20 下冷却
var NODE_LINE_BLOCK_CLICKS  = 10;            // 升级台词后的保护窗口，兼作 nearThreshold 的 ±N
var SQUIRT_LINE_BLOCK_CLICKS = 10;           // 水枪前 10 下不出随机台词（squirtTotal 累计，跨轮不清零）
var DEFAULT_LINE_MS         = 1500;
var LINE_WET_MS             = 2036;
var LINE_STAGE2_MS          = 2146;
var LINE_FINAL_MS           = 936;

var FLASH_HEIGHT_RATIO      = 2.6;
var FLASH_SCALE_FROM        = 0.12;
var FLASH_GROW_MS           = 150;
var FLASH_HOLD_MS           = 500;
var FLASH_FADE_MS           = 160;

var KEY_STATS    = 'beatpotato.stats.v1';
var KEY_SETTINGS = 'beatpotato.settings.v1';

var P_AUDIO  = 'assets/audio/';
var P_COUNT  = 'assets/potato/counter/';
var P_STATE  = 'assets/potato/state/';

var SFX_NAMES = [
  'hit', 'squirt_1', 'squirt_2', 'squirt_3', 'squirt_4', 'despise',
  'line_wet', 'line_stage2', 'line_final',
  'line_rand1', 'line_rand2', 'line_rand3', 'line_rand4', 'line_rand5'
];
var LINE_RANDOM_IDS = ['line_rand1', 'line_rand2', 'line_rand3', 'line_rand4', 'line_rand5'];

/* ======================================================================
 * 2. 小工具
 * ==================================================================== */
function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function todayKey() {
  var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function $(id) { return document.getElementById(id); }
function setBox(el, left, top, w, h) {
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
}

/* ======================================================================
 * 3. 素材表：路径 → [宽, 高]
 *    尺寸全部靠预载时读 naturalWidth/naturalHeight 填进来，不写死
 * ==================================================================== */
var DIMS = {};
var IMG = {};                      // path -> HTMLImageElement（复用，避免重复下载）
var pending = [];

function imageFor(path) {
  var im = IMG[path];
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    im.src = path;
    IMG[path] = im;
    pending.push(waitImage(path, im));
  }
  return im;
}
function waitImage(path, im) {
  return new Promise(function (res) {
    function done() {
      DIMS[path] = [im.naturalWidth || 1, im.naturalHeight || 1];
      res();
    }
    if (im.complete && im.naturalWidth) { done(); return; }
    im.addEventListener('load', done, { once: true });
    im.addEventListener('error', done, { once: true });
  });
}
function dim(path) { return DIMS[path] || [1, 1]; }
function hRatio(path) { var d = dim(path); return d[0] / d[1]; }
function counterPath(kind, ch) { return P_COUNT + kind + '_' + ch + '.png'; }

function preloadImages() {
  // 土豆 13 帧已经在 DOM 里，直接用现成的 <img>
  var frames = potatoBox.querySelectorAll('img[data-frame]');
  for (var i = 0; i < frames.length; i++) {
    frameMap[frames[i].getAttribute('data-frame')] = frames[i];
    DIMS[frames[i].getAttribute('src')] = [1024, 1024];   // 先给个占位，load 后覆盖
    pending.push(waitImage(frames[i].getAttribute('src'), frames[i]));
  }
  // 徽章用到的 26 张数字 / 爆点 / 文字标签
  for (var d = 0; d <= 9; d++) { imageFor(counterPath('total', d)); imageFor(counterPath('today', d)); }
  for (var b = 1; b <= 4; b++) { imageFor(P_COUNT + 'burst_' + b + '.png'); }
  imageFor(P_COUNT + 'label_jin.png');
  imageFor(P_COUNT + 'label_bao.png');
  // 道具与展开图（DOM 里已有 <img>，这里只补尺寸表）
  var extra = [squirtProp, fingerProp, flashImage, $('gatePotato')];
  for (var j = 0; j < extra.length; j++) {
    pending.push(waitImage(extra[j].getAttribute('src'), extra[j]));
  }
  imageFor('assets/potato/ui/btn_squirt.png');
  imageFor('assets/potato/ui/btn_finger.png');
}

/* ======================================================================
 * 4. 音效引擎
 *    首选 Web Audio（可叠加、低延迟、能拿到真实时长）；
 *    file:// 下 fetch 会被 CORS 拦掉 → 自动退化到 <audio> 元素播放
 * ==================================================================== */
var Audio = (function () {
  var ctx = null;
  var buffers = {};
  var els = {};
  var mode = 'idle';                 // idle | webaudio | html | none
  var scalar = DEFAULT_VOLUME_PERCENT * (VOLUME_75_SCALE / 75);
  var live = [];

  function createCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  function fetchBuf(url) {
    return fetch(url, { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
  }
  function decode(ab) {
    return new Promise(function (res, rej) {
      var p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  function initHtmlMode() {
    mode = 'html';
    SFX_NAMES.forEach(function (n) {
      var a = new window.Audio();
      a.preload = 'auto';
      a.src = P_AUDIO + n + '.wav';
      els[n] = a;
    });
  }

  function init() {
    var c = createCtx();
    if (!c) { initHtmlMode(); return Promise.resolve(); }
    return fetchBuf(P_AUDIO + SFX_NAMES[0] + '.wav')
      .then(function (ab) { return decode(ab); })
      .then(function (buf) {
        mode = 'webaudio';
        buffers[SFX_NAMES[0]] = buf;
        return Promise.all(SFX_NAMES.slice(1).map(function (n) {
          return fetchBuf(P_AUDIO + n + '.wav')
            .then(decode)
            .then(function (b) { buffers[n] = b; })
            .catch(function () { /* 单个失败不影响其它 */ });
        }));
      })
      .catch(function () { initHtmlMode(); });
  }

  // 返回这次播放的时长(ms)；0 = 没能播放
  function play(name, vol) {
    var v = (typeof vol === 'number' ? vol : scalar);
    if (v <= 0) return 0;
    if (mode === 'webaudio') {
      var buf = buffers[name];
      if (!buf) return 0;
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      try {
        var src = ctx.createBufferSource();
        var g = ctx.createGain();
        g.gain.value = v;
        src.buffer = buf;
        src.connect(g);
        g.connect(ctx.destination);
        src.start(0);
        src.onended = function () {
          try { g.disconnect(); } catch (e) {}
          var k = live.indexOf(src); if (k >= 0) live.splice(k, 1);
        };
        live.push(src);
        return buf.duration * 1000;
      } catch (e) { return 0; }
    }
    if (mode === 'html') {
      var el = els[name];
      if (!el) return 0;
      try {
        el.pause();
        el.currentTime = 0;
        el.volume = clamp(v * 2.5, 0, 1);   // <audio> 的 volume 感知偏弱，抬一点
        var pr = el.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) { return 0; }
      return 0;                              // 时长未知 → 调用方用 Android 常量兜底
    }
    return 0;
  }

  function stopAll() {
    live.forEach(function (s) { try { s.stop(); } catch (e) {} });
    live.length = 0;
  }

  function unlock() {
    if (mode !== 'webaudio' || !ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function mute() { stopAll(); }

  return {
    init: init, play: play, unlock: unlock, stopAll: stopAll, mute: mute,
    setScalar: function (s) { scalar = s; },
    getMode: function () { return mode; },
    isReady: function () { return mode === 'webaudio' || mode === 'html'; },
    // 自检页用：不播放，只问时长（0 = 还不知道）
    durationOf: function (name) {
      if (mode === 'webaudio' && buffers[name]) return Math.round(buffers[name].duration * 1000);
      if (mode === 'html' && els[name] && isFinite(els[name].duration)) {
        return Math.round(els[name].duration * 1000);
      }
      return 0;
    }
  };
})();

/* ======================================================================
 * 5. 存档（镜像 Android 的 stats / settings 两个 SharedPreferences）
 * ==================================================================== */
var Store = {
  ok: true,
  read: function (key, def) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return def;
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : def;
    } catch (e) { this.ok = false; return def; }      // 无痕模式 / 被 ITP 清掉
  },
  write: function (key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { this.ok = false; return false; }      // 配额满或 Safari 无痕 → 静默降级
  }
};

/* ======================================================================
 * 6. 运行时状态
 * ==================================================================== */
var S = {
  totalHits: 0,
  todayHits: 0,
  todayDate: '',
  thresholds: [],
  volumePercent: DEFAULT_VOLUME_PERCENT,

  streakHits: 0,
  stateIndex: 0,
  wet: false,
  squirtCount: 0,

  clickSeq: 0,
  // 两个计数器初值 = 各自冷却上限：开局即「已冷却」，第 1 下就可能冒随机台词（对齐 Android）
  clicksSinceRandomLineHit: RANDOM_LINE_COOLDOWN_CLICKS_HIT,
  clicksSinceRandomLineProp: RANDOM_LINE_COOLDOWN_CLICKS_PROP,
  randomLineBlockedUntil: 0,
  squirtTotal: 0,                   // 水枪累计，跨轮不清零，只用于「前 10 下不出台词」
  streakEndsAtMs: 0,                // 连击到期的绝对时刻，用于从后台回来时补判超时
  wetEndsAtMs: 0,                   // 湿身到期的绝对时刻，同上（iOS 后台会冻住 setTimeout）

  lineDurationMs: 0,
  lineEndsAtMs: 0,

  streakVisible: false,
  streakScale: 1,
  burstIndex: 1,

  started: false,
  ready: false
};

var layout = null;
var frameMap = {};
var shownFrame = null;

var hitTimer = null, streakResetTimer = null, dryUpTimer = null;
var propTimers = { squirt: null, finger: null };
var popTimers = [], flashTimers = [];

/* ======================================================================
 * 7. DOM
 * ==================================================================== */
var stage, potatoBox, streakBadge, todayBadge, squirtProp, fingerProp,
    flashImage, topbar, totalLabel, volumeBtn, volumeMenu, propBar,
    squirtBtn, fingerBtn, gate, gateHint, volArc1, volArc2, volSlash;

/* ======================================================================
 * 8. 视口 & 布局
 * ==================================================================== */
function viewport() {
  var vv = window.visualViewport;
  var w = vv ? vv.width : window.innerWidth;
  var h = vv ? vv.height : window.innerHeight;
  var cw = document.documentElement.clientWidth || w;
  var ch = document.documentElement.clientHeight || h;
  // 取小值：地址栏展开时也能保证底部道具条不被工具条盖住
  return { w: Math.max(200, Math.round(Math.min(w, cw))),
           h: Math.max(200, Math.round(Math.min(h, ch))) };
}

function computeLayout() {
  var vp = viewport();
  var W = vp.w, H = vp.h;
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';

  // 土豆边长：横向给徽章让位、纵向给顶栏与道具条让位；大屏封顶
  // 土豆边长：宽度取 80%，高度取 52%（留够上方连击徽章、下方今日徽章与道具条），
  // 120~760 兜底。手机竖屏下永远由 W*0.80 决定，平板才会吃到高度那一项。
  var side = clamp(Math.min(W * 0.80, H * 0.52), 120, 760);

  var f = side / POTATO_REF;
  // 参照素材取 idle（1024×1024 正方形）→ 真实内容框 = 整个正方形
  var dispW = side, dispH = side;
  var boxLeft = Math.round((W - side) / 2);
  var boxTop = Math.round((H - side) / 2);

  layout = {
    W: W, H: H, side: side, f: f,
    boxLeft: boxLeft, boxTop: boxTop,
    dispW: dispW, dispH: dispH,
    contentLeft: boxLeft + (side - dispW) / 2,
    contentTop: boxTop + (side - dispH) / 2,
    contentRight: boxLeft + (side + dispW) / 2,
    contentBottom: boxTop + (side + dispH) / 2
  };

  setBox(potatoBox, boxLeft, boxTop, side, side);
  applyPropLayout();
  renderStreak();
  renderToday();
}

function applyPropLayout() {
  if (!layout) return;
  var L = layout, f = L.f, d = f;
  var margin = PROP_EDGE_MARGIN * d;

  // --- 水枪：枪口朝左顶住土豆右侧，内容中心落在土豆高度 57% 处
  var muzzleX = L.contentRight - L.dispH * SQUIRT_OVERLAP_RATIO;
  var availW = Math.max(1, L.W - margin - muzzleX);
  var contentH = Math.min(L.dispH * SQUIRT_CONTENT_HEIGHT_RATIO, availW / SQUIRT_CONTENT_ASPECT);
  var sImgH = contentH / SQUIRT_CONTENT_H_RATIO;
  var sImgW = sImgH * hRatio('assets/potato/prop_squirt.png');
  setBox(squirtProp,
    muzzleX - sImgW * SQUIRT_CONTENT_X_RATIO,
    L.contentTop + L.dispH * SQUIRT_CENTER_Y_RATIO - sImgH * SQUIRT_CONTENT_Y_RATIO,
    sImgW, sImgH);

  // --- 中指：水平居中于土豆，内容中心落在土豆高度 60% 处
  var fContentH = L.dispH * FINGER_CONTENT_HEIGHT_RATIO;
  var fImgH = fContentH / FINGER_CONTENT_H_RATIO;
  var fImgW = fImgH * hRatio('assets/potato/prop_finger.png');
  setBox(fingerProp,
    L.W / 2 - fImgW * FINGER_CONTENT_CENTER_X_RATIO,
    L.contentTop + L.dispH * FINGER_CONTENT_Y_RATIO - fImgH * FINGER_CONTENT_CENTER_Y_RATIO,
    fImgW, fImgH);

  // --- 展开图：居中、高 = 土豆高 × 2.6（刻意铺满整屏）
  var flH = L.dispH * FLASH_HEIGHT_RATIO;
  var flW = flH * hRatio('assets/potato/flash_potato.jpg');
  setBox(flashImage, (L.W - flW) * 0.5, (L.H - flH) / 2, flW, flH);
}

/* ======================================================================
 * 9. 帧切换（只翻 visibility，绝不换 src → iOS 连点不闪）
 * ==================================================================== */
function currentStateFrame() {
  if (S.wet) return 'wet';
  return S.stateIndex <= 0 ? 'state_0' : 'state_' + S.stateIndex;
}
function currentHitFrame() {
  if (S.wet) return 'wet';
  return 'state_' + S.stateIndex + '_hit';
}
function showFrame(key) {
  if (shownFrame === key) return;
  if (shownFrame && frameMap[shownFrame]) frameMap[shownFrame].classList.remove('on');
  shownFrame = key;
  if (frameMap[key]) frameMap[key].classList.add('on');
}

/* ======================================================================
 * 10. 徽章渲染
 * ==================================================================== */
function renderStrip(host, items) {
  var pool = host._pool || (host._pool = []);
  var i;
  for (i = 0; i < items.length; i++) {
    var it = items[i], img = pool[i];
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      host.appendChild(img);
      pool[i] = img;
    }
    if (img.getAttribute('src') !== it.src) img.setAttribute('src', it.src);
    img.style.left = it.left + 'px';
    img.style.top = it.top + 'px';
    img.style.width = it.w + 'px';
    img.style.height = it.h + 'px';
    img.style.visibility = 'visible';
  }
  for (; i < pool.length; i++) pool[i].style.visibility = 'hidden';
}

function renderTotal() {
  totalLabel.textContent = '总暴打 ' + S.totalHits;
}

// 隐藏一个徽章容器 —— 必须连子元素一起隐藏！
// visibility 是继承属性，但子元素一旦自己声明了 visible 就会盖掉父元素的 hidden。
// renderStrip() 会给每个复用的 <img> 写内联 visibility:visible，
// 所以只设容器 style.visibility='hidden' 的话，数字会照旧画在屏幕上
// （用户报的「一段时间不打，右上角计数不消失」就是这个）。
function hideBadge(host) {
  host.style.visibility = 'hidden';
  var pool = host._pool || [];
  for (var i = 0; i < pool.length; i++) pool[i].style.visibility = 'hidden';
}

// 连击徽章：贴在土豆右上角外侧；数字贴在一个随机爆点上
function renderStreak() {
  if (!S.streakVisible || S.streakHits <= 0) {
    hideBadge(streakBadge);
    return;
  }
  var L = layout;
  if (!L) return;
  var f = L.f;
  var digitH = STREAK_DIGIT_REF * f;
  var overlap = digitH * DIGIT_OVERLAP_RATIO;

  var burstPath = P_COUNT + 'burst_' + S.burstIndex + '.png';
  var burstH = digitH * BURST_HEIGHT_RATIO;
  var burstW = burstH * hRatio(burstPath);

  var digits = String(S.streakHits).split('');
  var widths = digits.map(function (ch) { return digitH * hRatio(counterPath('total', ch)); });
  var digitsW = widths.reduce(function (a, b) { return a + b; }, 0) - overlap * (digits.length - 1);

  var pad = digitH * BADGE_PAD_RATIO;
  var contentW = Math.round(Math.max(digitsW, burstW) + pad * 2);
  var contentH = Math.round(Math.max(digitH, burstH) + pad * 2);

  var items = [{ src: burstPath,
                 left: (contentW - burstW) / 2,
                 top: (contentH - burstH) / 2,
                 w: burstW, h: burstH }];
  var x = (contentW - digitsW) / 2;
  digits.forEach(function (ch, i) {
    items.push({ src: counterPath('total', ch),
                 left: x, top: (contentH - digitH) / 2,
                 w: widths[i], h: digitH });
    x += widths[i] - overlap;
  });

  setBox(streakBadge,
    L.contentRight + STREAK_RIGHT_OVERHANG_REF * f - contentW,
    L.contentTop - contentH,
    contentW, contentH);
  streakBadge.style.visibility = 'visible';
  renderStrip(streakBadge, items);
  applyStreakScale();
}

// 今日暴打徽章：贴在土豆正下方居中，常显
function renderToday() {
  var L = layout;
  if (!L) return;
  var f = L.f, d = f;
  var digitH = TODAY_DIGIT_REF * f;
  var overlap = digitH * DIGIT_OVERLAP_RATIO;
  var side = Math.round(2 * d);
  var items = [];
  var x = side;

  [[P_COUNT + 'label_jin.png', 0.10], [P_COUNT + 'label_bao.png', 0.25]].forEach(function (pair) {
    var p = pair[0], w = digitH * hRatio(p);
    items.push({ src: p, left: x, top: 0, w: w, h: digitH });
    x += w + digitH * pair[1];
  });

  var digits = String(S.todayHits).split('');
  digits.forEach(function (ch, i) {
    var p = counterPath('today', ch);
    var w = digitH * hRatio(p);
    items.push({ src: p, left: x, top: 0, w: w, h: digitH });
    x += w - overlap;
  });

  var contentW = Math.round(x + side);
  var contentH = Math.round(digitH);
  setBox(todayBadge,
    L.contentLeft + (L.side - contentW) / 2,
    L.contentBottom + TODAY_GAP_ABOVE_REF * f,
    contentW, contentH);
  todayBadge.style.visibility = 'visible';
  renderStrip(todayBadge, items);
}

function applyStreakScale() {
  streakBadge.style.transform = 'scale(' + S.streakScale + ')';
}

/* ======================================================================
 * 11. 存档读写
 * ==================================================================== */
function isValidThresholds(t) {
  if (!t || t.length !== STATE_COUNT - 1) return false;
  for (var i = 0; i < t.length; i++) {
    var r = STATE_THRESHOLD_RANGES[i];
    if (typeof t[i] !== 'number' || !isFinite(t[i])) return false;
    if (t[i] < r[0] || t[i] > r[1]) return false;
    if (i > 0 && t[i] <= t[i - 1]) return false;
  }
  return true;
}
// 随机一组阈值并落盘。末尾强制严格递增（对齐 Android RerollStateThresholds）：
// 区间本身不重叠、理论上不会撞车，但保留这道修正以与 Android 行为逐字一致。
function rerollThresholds() {
  var t = STATE_THRESHOLD_RANGES.map(function (r) {
    return r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
  });
  for (var i = 1; i < t.length; i++) {
    if (t[i] <= t[i - 1]) t[i] = t[i - 1] + 1;
  }
  S.thresholds = t;
  saveStats();                        // 立刻落盘：重启后形态不会倒退
}
function ensureThresholds() {
  if (isValidThresholds(S.thresholds)) return;
  rerollThresholds();
}
function loadStats() {
  var d = Store.read(KEY_STATS, null);
  if (d) {
    S.totalHits = Math.max(0, d.total | 0);
    S.todayHits = Math.max(0, d.today | 0);
    S.todayDate = typeof d.date === 'string' ? d.date : '';
    S.thresholds = d.thresholds;
  }
  rollTodayIfNeeded();      // 必须先过日期：否则首次落盘会把空日期写进去
  ensureThresholds();
}
function saveStats() {
  Store.write(KEY_STATS, {
    total: S.totalHits, today: S.todayHits, date: S.todayDate, thresholds: S.thresholds
  });
}
function loadSettings() {
  var d = Store.read(KEY_SETTINGS, null);
  if (d && VOLUME_LEVELS.indexOf(d.volumePercent) >= 0) S.volumePercent = d.volumePercent;
}
function saveSettings() {
  Store.write(KEY_SETTINGS, { volumePercent: S.volumePercent });
}
function rollTodayIfNeeded() {
  var k = todayKey();
  if (S.todayDate !== k) { S.todayDate = k; S.todayHits = 0; }
}

/* ======================================================================
 * 12. 玩法
 * ==================================================================== */
function volumeScalar() { return S.volumePercent * (VOLUME_75_SCALE / 75); }

function computeStateIndex() {
  var st = 0;
  for (var i = 0; i < S.thresholds.length; i++) {
    if (S.streakHits >= S.thresholds[i]) st = i + 1;
  }
  return st;
}

// 状态没变就不碰视图，否则每次点击都把受击帧刷成静息帧 → 连点闪屏
function applyStateVisual() {
  var st = computeStateIndex();
  var changed = (st !== S.stateIndex);
  S.stateIndex = st;
  if (changed) {
    showFrame(currentStateFrame());
    applyPropLayout();
  }
  return changed;
}

function clickTick() {
  S.clickSeq++;
  S.clicksSinceRandomLineHit++;      // 三个入口共用，两个计数器同步 ++（对齐 Android onClickTick）
  S.clicksSinceRandomLineProp++;
}
function lineIsPlaying() {
  return S.lineDurationMs > 0 && now() < S.lineEndsAtMs;
}
function playLine(id, fallbackMs) {
  var dur = Audio.play(id, volumeScalar());
  var ms = dur > 0 ? dur : (fallbackMs > 0 ? fallbackMs : DEFAULT_LINE_MS);
  S.lineDurationMs = ms;
  S.lineEndsAtMs = now() + ms;
}
function playNodeLine(id, fallbackMs) {
  playLine(id, fallbackMs);
  S.randomLineBlockedUntil = S.clickSeq + NODE_LINE_BLOCK_CLICKS;
}
// 逼近升级节点（±10 下）时不放随机台词，保证"升级台词"能被听到
function nearThreshold(t) {
  var remain = t - S.streakHits;
  return remain >= 0 && remain <= NODE_LINE_BLOCK_CLICKS;
}
function nearUpgradeNode() {
  if (S.thresholds.length < STATE_COUNT - 1) return false;
  return nearThreshold(S.thresholds[0]) || nearThreshold(S.thresholds[STATE_COUNT - 2]);
}
// leftClick = true 只由主击打入口传入（对齐 Android playRandomLineIfLucky(leftClick)）。
// 「还没进第一阶段」与「逼近升级节点」两道闸只作用于左键；水枪/中指绕开它们，只用 20 下冷却。
// 升级台词之后的保护窗口（randomLineBlockedUntil）三个入口通用。
function playRandomLineIfLucky(leftClick) {
  if (!LINE_RANDOM_IDS.length) return false;
  if (S.clickSeq <= S.randomLineBlockedUntil) return false;
  if (leftClick && S.stateIndex <= 0) return false;
  if (leftClick && nearUpgradeNode()) return false;
  if (leftClick) {
    if (S.clicksSinceRandomLineHit < RANDOM_LINE_COOLDOWN_CLICKS_HIT) return false;
  } else {
    if (S.clicksSinceRandomLineProp < RANDOM_LINE_COOLDOWN_CLICKS_PROP) return false;
  }
  if (Math.floor(Math.random() * 100) >= RANDOM_LINE_PERCENT) return false;
  var id = LINE_RANDOM_IDS[Math.floor(Math.random() * LINE_RANDOM_IDS.length)];
  playLine(id, 0);
  if (leftClick) S.clicksSinceRandomLineHit = 0;
  else           S.clicksSinceRandomLineProp = 0;
  return true;
}
// 升级台词：进第 1 段（有点烦）与进第 5 段（摆烂）
function playStateLine(prev, next) {
  if (next === prev) return false;
  if (next === 1) { playNodeLine('line_stage2', LINE_STAGE2_MS); return true; }
  if (next >= STATE_COUNT - 1) { playNodeLine('line_final', LINE_FINAL_MS); return true; }
  return false;
}

function popBadge() {
  popTimers.forEach(clearTimeout);
  popTimers.length = 0;
  S.streakScale = BADGE_POP_PEAK;
  applyStreakScale();
  [1.2, 1.1, 1.0].forEach(function (v, i) {
    popTimers.push(setTimeout(function () {
      S.streakScale = v;
      applyStreakScale();
    }, FRAME_MS * (i + 1)));
  });
}

function armStreakReset() {
  if (streakResetTimer) clearTimeout(streakResetTimer);
  S.streakEndsAtMs = Date.now() + STREAK_RESET_MS;
  streakResetTimer = setTimeout(resetStreak, STREAK_RESET_MS);
}
// iOS 会把后台标签页的 setTimeout 一起冻住，只靠定时器会出现
// 「早就该归零了、右上角计数却还挂着」。所以除了定时器，再按绝对时刻补一次判断：
// 页面重新可见时、以及每次击打前都查一遍，超时就直接归零。
function checkStreakTimeout() {
  if (S.streakHits > 0 && S.streakEndsAtMs > 0 && Date.now() >= S.streakEndsAtMs) {
    resetStreak();
    return true;
  }
  return false;
}
function resetStreak() {
  if (streakResetTimer) clearTimeout(streakResetTimer);
  streakResetTimer = null;
  S.streakEndsAtMs = 0;
  S.streakHits = 0;
  popTimers.forEach(clearTimeout);
  popTimers.length = 0;
  S.streakScale = 1;
  applyStreakScale();
  S.streakVisible = false;
  renderStreak();
  rerollThresholds();                 // 连击断了 → 新一轮重新随机阈值（对齐 Android streakReset / PC ResetStreak）
  applyStateVisual();
}

/* ---- 主击打 ---- */
function onHit() {
  rollTodayIfNeeded();
  checkStreakTimeout();       // 从后台回来时先把已超时的连击归零，避免"假性延续"
  clickTick();
  S.totalHits++;
  S.todayHits++;
  S.streakHits++;

  var prev = S.stateIndex;
  var played = playStateLine(prev, computeStateIndex());
  if (!played) played = playRandomLineIfLucky(true);
  if (!played && !lineIsPlaying()) Audio.play('hit', volumeScalar());

  applyStateVisual();

  S.streakVisible = true;
  S.burstIndex = 1 + Math.floor(Math.random() * 4);
  renderStreak();
  renderToday();
  renderTotal();

  showFrame(currentHitFrame());
  if (hitTimer) clearTimeout(hitTimer);
  hitTimer = setTimeout(function () {
    hitTimer = null;
    showFrame(currentStateFrame());
  }, HOLD_MS);

  armStreakReset();
  popBadge();

  // 每打一下就落盘。localStorage 写一条几十字节的 JSON 是微秒级开销，
  // 换来的是「iOS 直接杀掉标签页也不丢进度」——比 Android 每 50 下存一次更保险。
  saveStats();
}

/* ---- 道具 ---- */
function showProp(which, ms) {
  var el = which === 'squirt' ? squirtProp : fingerProp;
  applyPropLayout();
  el.style.visibility = 'visible';
  if (propTimers[which]) clearTimeout(propTimers[which]);
  propTimers[which] = setTimeout(function () {
    propTimers[which] = null;
    el.style.visibility = 'hidden';
  }, ms);
}

function armDryUp() {
  if (dryUpTimer) clearTimeout(dryUpTimer);
  S.wetEndsAtMs = Date.now() + WET_HOLD_MS;
  dryUpTimer = setTimeout(exitWet, WET_HOLD_MS);
}

function showFlash() {
  flashTimers.forEach(clearTimeout);
  flashTimers.length = 0;
  var el = flashImage;
  el.style.transition = 'none';
  el.style.opacity = '1';
  el.style.transform = 'scale(' + FLASH_SCALE_FROM + ')';
  el.style.visibility = 'visible';
  void el.offsetWidth;                                   // 强制回流，让起始 scale 生效
  el.style.transition = 'transform ' + FLASH_GROW_MS + 'ms cubic-bezier(.33,1,.68,1)';
  el.style.transform = 'scale(1)';
  flashTimers.push(setTimeout(function () {
    el.style.transition = 'opacity ' + FLASH_FADE_MS + 'ms linear';
    el.style.opacity = '0';
    flashTimers.push(setTimeout(function () {
      el.style.visibility = 'hidden';
      el.style.transition = 'none';
      el.style.opacity = '1';
    }, FLASH_FADE_MS));
  }, FLASH_GROW_MS + FLASH_HOLD_MS));
}

function enterWet() {
  S.wet = true;
  showFrame('wet');
  applyPropLayout();
  playNodeLine('line_wet', LINE_WET_MS);
  showFlash();
  armDryUp();
}
function exitWet() {
  if (!S.wet) return;
  if (dryUpTimer) clearTimeout(dryUpTimer);
  dryUpTimer = null;
  S.wetEndsAtMs = 0;
  S.wet = false;
  showFrame(currentStateFrame());
  applyPropLayout();
}

// 与连击超时同源：iOS 会把后台标签页的 setTimeout 一起冻住，
// 只靠定时器会出现「早该干了、湿身却一直挂着」→ 水枪再也发不出声音。
// 页面重新可见时、以及每次按水枪前都按绝对时刻补判一次。
function checkWetTimeout() {
  if (S.wet && S.wetEndsAtMs > 0 && Date.now() >= S.wetEndsAtMs) {
    exitWet();
    return true;
  }
  return false;
}

/* ---- 水枪按钮 ---- */
function playSquirtSound() {
  Audio.play('squirt_' + (1 + Math.floor(Math.random() * 4)), volumeScalar());
}
function doSquirt() {
  clickTick();
  checkWetTimeout();                                   // 后台冻结回来时，早该干了就先干掉
  S.squirtTotal++;                                     // 跨轮不清零，只服务「前 10 下不出台词」

  // willWet = 这一下就要变湿。此时不播水声（紧接着 enterWet 会播 line_wet 语音）。
  // 注意这里**只**排除「即将变湿」那一下，不能再写成 !S.wet：
  // 湿身期间每按一次水枪都会 armDryUp() 续命 4 秒，若把整段水声一起挡掉，
  // 用户连按水枪就会从第 6 下开始完全没声音（用户报的「五次触发语音后水声消失」）。
  var willWet = !S.wet && (S.squirtCount + 1 >= SQUIRT_HITS_TO_WET);
  if (!willWet && !lineIsPlaying()) {
    if (S.squirtTotal > SQUIRT_LINE_BLOCK_CLICKS) {
      if (!playRandomLineIfLucky(false)) playSquirtSound();
    } else {
      playSquirtSound();                               // 前 10 下不参与随机台词，先把水声铺垫出来
    }
  }

  showProp('squirt', SQUIRT_PROP_HOLD_MS);
  if (S.wet) { armDryUp(); return; }                     // 已经湿了：续命，不再累计
  S.squirtCount++;
  if (S.squirtCount >= SQUIRT_HITS_TO_WET) { S.squirtCount = 0; enterWet(); }
}

/* ---- 中指按钮 ---- */
function doFinger() {
  clickTick();
  if (!lineIsPlaying() && !playRandomLineIfLucky(false)) {
    Audio.play('despise', volumeScalar());
  }
  showProp('finger', FINGER_PROP_HOLD_MS);
}

/* ======================================================================
 * 13. 音量菜单
 * ==================================================================== */
function buildVolumeMenu() {
  volumeMenu.innerHTML = '';
  VOLUME_LEVELS.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = v === 0 ? '静音' : (v + '%');
    if (v === S.volumePercent) b.className = 'checked';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      setVolume(v);
      closeVolumeMenu();
    });
    volumeMenu.appendChild(b);
  });
  var muted = S.volumePercent === 0;
  volSlash.style.display = muted ? '' : 'none';
  volArc1.style.display = muted ? 'none' : '';
  volArc2.style.display = muted ? 'none' : '';
}
function setVolume(v) {
  S.volumePercent = v;
  Audio.setScalar(volumeScalar());
  if (v === 0) Audio.mute();
  saveSettings();
  buildVolumeMenu();
}
function openVolumeMenu() { volumeMenu.classList.add('open'); }
function closeVolumeMenu() { volumeMenu.classList.remove('open'); }

/* ======================================================================
 * 14. 事件绑定
 * ==================================================================== */
function bindEvents() {
  // 整屏点击：触摸一次 = 击打一次。用 pointerdown，零延迟、无 300ms 等待
  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // 只认左键/触摸
    if (e.isPrimary === false) return;
    var t = e.target;
    if (t && t.closest && t.closest('button, #volumeMenu, #propBar')) return;  // UI 自己管
    if (!S.started) { startGame(); return; }
    if (e.cancelable) e.preventDefault();
    onHit();
  }, { passive: false });

  squirtBtn.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    if (S.started) doSquirt();
  });
  fingerBtn.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    if (S.started) doFinger();
  });

  volumeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (volumeMenu.classList.contains('open')) closeVolumeMenu();
    else openVolumeMenu();
  });
  document.addEventListener('click', function () { closeVolumeMenu(); });

  gate.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    if (S.ready) startGame();
  });

  // iOS 专治：禁掉双指缩放与双击缩放
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // iOS 上 :active 需要页面里存在 touchstart 监听才会生效
  document.addEventListener('touchstart', function () {}, { passive: true });

  var rt = null;
  function onResize() {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { rt = null; computeLayout(); }, 120);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
  }

  // 切到后台就落盘（等价 Android 的 onPause）；回到前台先补一次连击超时判定，
  // 因为 iOS 冻结标签页时 setTimeout 也一起停了，定时器可能还没轮到就已经过期。
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveStats();
    else { checkStreakTimeout(); checkWetTimeout(); }
  });
  window.addEventListener('pagehide', function () { saveStats(); });
}

/* ======================================================================
 * 15. 启动
 * ==================================================================== */
function startGame() {
  if (S.started) return;
  S.started = true;
  Audio.unlock();                                   // 必须在用户手势里 resume
  stage.classList.remove('gated');
  gate.classList.add('gone');
  setTimeout(function () { gate.style.display = 'none'; }, 260);
}

function boot() {
  stage        = $('stage');
  potatoBox    = $('potatoBox');
  streakBadge  = $('streakBadge');
  todayBadge   = $('todayBadge');
  squirtProp   = $('squirtProp');
  fingerProp   = $('fingerProp');
  flashImage   = $('flashImage');
  topbar       = $('topbar');
  totalLabel   = $('totalLabel');
  volumeBtn    = $('volumeBtn');
  volumeMenu   = $('volumeMenu');
  propBar      = $('propBar');
  squirtBtn    = $('squirtBtn');
  fingerBtn    = $('fingerBtn');
  gate         = $('gate');
  gateHint     = gate.querySelector('.gate-hint');
  volArc1      = $('volArc1');
  volArc2      = $('volArc2');
  volSlash     = $('volSlash');

  loadSettings();
  loadStats();
  Audio.setScalar(volumeScalar());
  buildVolumeMenu();
  renderTotal();

  preloadImages();
  computeLayout();
  showFrame(currentStateFrame());
  renderStreak();
  renderToday();
  bindEvents();

  gateHint.textContent = '正在加载素材…';

  Promise.all([
    Promise.all(pending),
    Audio.init()
  ]).then(function () {
    S.ready = true;
    // 尺寸表可能刚被真实值补全，重排一次
    computeLayout();
    gateHint.textContent = '轻触屏幕开始';
  });

  // 自检页 / 调试用
  window.BeatPotato = {
    version: '1.1.0',
    state: S,
    audio: Audio,
    store: Store,
    dims: DIMS,
    paths: { audio: P_AUDIO, counter: P_COUNT, state: P_STATE },
    sfxNames: SFX_NAMES,
    // 常量表（自检页/无头断言对照 Android 用）
    consts: {
      FRAME_MS: FRAME_MS, POTATO_REF: POTATO_REF, HOLD_MS: HOLD_MS, STATE_COUNT: STATE_COUNT,
      STATE_THRESHOLD_RANGES: STATE_THRESHOLD_RANGES, STREAK_RESET_MS: STREAK_RESET_MS,
      RANDOM_LINE_PERCENT: RANDOM_LINE_PERCENT,
      RANDOM_LINE_COOLDOWN_CLICKS_HIT: RANDOM_LINE_COOLDOWN_CLICKS_HIT,
      RANDOM_LINE_COOLDOWN_CLICKS_PROP: RANDOM_LINE_COOLDOWN_CLICKS_PROP,
      NODE_LINE_BLOCK_CLICKS: NODE_LINE_BLOCK_CLICKS,
      SQUIRT_LINE_BLOCK_CLICKS: SQUIRT_LINE_BLOCK_CLICKS,
      SQUIRT_HITS_TO_WET: SQUIRT_HITS_TO_WET, WET_HOLD_MS: WET_HOLD_MS
    },
    layout: function () { return layout; },
    recompute: computeLayout,
    hit: onHit,
    squirt: doSquirt,
    finger: doFinger,
    setVolume: setVolume,
    startGame: startGame,
    // 玩法内核（自检页/无头断言用）
    resetStreak: resetStreak,
    exitWet: exitWet,
    checkStreakTimeout: checkStreakTimeout,
    checkWetTimeout: checkWetTimeout,
    rerollThresholds: rerollThresholds,
    isValidThresholds: isValidThresholds,
    nearUpgradeNode: nearUpgradeNode,
    playRandomLineIfLucky: playRandomLineIfLucky,
    lineIsPlaying: lineIsPlaying,
    computeStateIndex: computeStateIndex
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
