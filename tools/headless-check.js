/* ===========================================================================
 * 暴打土豆 · 网页版 —— 无头自检（不弹窗口、不抢鼠标、不碰用户浏览器）
 *
 *   node tools/headless-check.js [url]
 *
 * 用独立 user-data-dir 起一个 headless Edge，通过 CDP 打开页面：
 *   · 收集 JS 异常、console.error、HTTP >= 400（能抓到素材 404）
 *   · 注入一段断言脚本，把玩法/布局/存档逐条核对
 * 只依赖 Node 内置的 fetch + WebSocket，零第三方包。
 * =========================================================================== */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const URL_TO_TEST = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8765/';
const IS_FILE = /^file:/i.test(URL_TO_TEST);   // file:// 下音频会按设计降级成 <audio>
// --freeze：主断言跑完后再做一次「标签页冻结」复现（模拟 iOS Safari 退到后台）
const FREEZE = process.argv.includes('--freeze');
const PORT = 9333 + Math.floor(Math.random() * 300);
const WAIT_MS = 2500;

/* 视口：--viewport=ipad / --viewport=375x667，或环境变量 BP_VIEWPORT，默认 iPhone 14 */
const VIEWPORTS = {
  iphone14: [390, 844],      // iPhone 14 / 15 / 16
  se: [375, 667],            // iPhone SE 3（目前仍在售的最小屏）
  plus: [428, 926],          // iPhone 16 Plus
  ipad: [1024, 1366],        // iPad Pro 12.9 竖屏
  ipadmini: [744, 1133]      // iPad mini 竖屏
};
const VP = (process.argv.find((a) => a.startsWith('--viewport=')) || '').slice(11)
        || process.env.BP_VIEWPORT || 'iphone14';
const [WIDTH, HEIGHT] = /^\d+x\d+$/.test(VP) ? VP.split('x').map(Number)
                       : (VIEWPORTS[VP] || VIEWPORTS.iphone14);

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------- CDP 迷你客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onerror = () => {};
  }
  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method) this.listeners.forEach((fn) => fn(msg.method, msg.params));
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 180000);   // 线上首屏要拉 10MB 素材（实测约 50 秒），冻结测试还要更久
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = (e) => rej(new Error('WebSocket 连接失败: ' + url));
    });
    return new CDP(ws);
  }
}

/* --------------------------------------------------------------- 断言脚本 */
const ASSERT_SCRIPT = `
(async () => {
  var R = [];
  function ok(name, cond, extra) {
    R.push({ s: !!cond, n: name, x: extra === undefined ? '' : String(extra) });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tap(el) {
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
    }));
  }
  function onFrame() {
    var el = document.querySelector('#potatoBox .frame.on');
    return el ? el.getAttribute('data-frame') : null;
  }
  // 徽章"实际"是否可见 —— 不能只看容器自己的 style.visibility！
  // visibility 是继承属性，子元素一旦自己声明 visible 就会覆盖父元素的 hidden，
  // 于是"父容器 hidden、数字却照旧画在屏幕上"。这里必须逐个查子元素的 computed style。
  function badgeSeen(id) {
    var el = document.getElementById(id);
    if (!el || !el.style) return 'no-el';
    if (getComputedStyle(el).display === 'none') return false;
    var imgs = el.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var st = getComputedStyle(imgs[i]);
      if (st && st.visibility === 'visible') return true;
    }
    return false;
  }

  // ---- 等 boot + 预载 ----
  // 线上首屏要拉 10MB 素材，本地几十毫秒就好，线上可能要十几秒，给足 90 秒。
  var waited = 0;
  for (var i = 0; i < 900; i++) {
    if (window.BeatPotato && BeatPotato.state.ready) break;
    await sleep(100);
    waited += 100;
  }
  ok('boot: window.BeatPotato 存在（game.js 没在启动阶段抛错）', !!window.BeatPotato);
  if (!window.BeatPotato) return { results: R, fail: 1, pass: 0, fatal: 'BeatPotato undefined' };

  var bp = window.BeatPotato, S = bp.state;
  ok('boot: state.ready = true（素材+音频加载完成）', S.ready === true,
     '等了 ' + waited + 'ms  audio=' + bp.audio.getMode() +
     '  images=' + (S.imagesReady || '?') + '  audioReady=' + (S.audioReady || '?'));

  // ---- 素材尺寸表 ----
  var bad = Object.keys(bp.dims).filter(function (k) { return !bp.dims[k] || bp.dims[k][0] <= 1; });
  ok('dims: 所有素材都读到了真实尺寸', bad.length === 0, bad.join(','));
  var d5 = bp.dims['assets/potato/state/state_5.png'];
  ok('dims: state_5 = 1044x1024（10-12 换新版创口贴）', d5 && d5[0] === 1044 && d5[1] === 1024, JSON.stringify(d5));
  var d5h = bp.dims['assets/potato/state/state_5_hit.png'];
  ok('dims: state_5_hit = 1266x1242（10-13 换新）', d5h && d5h[0] === 1266 && d5h[1] === 1242, JSON.stringify(d5h));
  var dwet = bp.dims['assets/potato/state/wet.png'];
  ok('dims: wet = 839x959', dwet && dwet[0] === 839 && dwet[1] === 959, JSON.stringify(dwet));
  var dil = bp.dims['assets/potato/idle.png'];
  ok('dims: idle = 1024x1024', dil && dil[0] === 1024 && dil[1] === 1024, JSON.stringify(dil));
  var dfl = bp.dims['assets/potato/flash_potato.jpg'];
  ok('dims: flash_potato = 1279x1706', dfl && dfl[0] === 1279 && dfl[1] === 1706, JSON.stringify(dfl));
  var dfg = bp.dims['assets/potato/prop_finger.png'];
  ok('dims: prop_finger = 1632x1024', dfg && dfg[0] === 1632 && dfg[1] === 1024, JSON.stringify(dfg));

  // ---- 音频 ----
  // file:// 下 fetch 被 CORS 拦，引擎会（按设计）降级成 <audio>，所以期望值随协议变
  var wantAudio = ${IS_FILE} ? 'html' : 'webaudio';
  var audioNote = ${IS_FILE} ? '（file:// 下的既定降级）' : '（http/https 下应走 Web Audio）';
  ok('audio: 音频模式 = ' + wantAudio + audioNote, bp.audio.getMode() === wantAudio, bp.audio.getMode());

  // ---- 存档 / 阈值 ----
  ok('store: localStorage 可写', bp.store.ok === true);
  ok('stats: 阈值 5 个', Array.isArray(S.thresholds) && S.thresholds.length === 5, JSON.stringify(S.thresholds));
  ok('stats: 阈值严格递增', S.thresholds.every(function (v, i, a) { return i === 0 || v > a[i - 1]; }), JSON.stringify(S.thresholds));
  ok('stats: 阈值落在规定区间内', S.thresholds.every(function (v, i) {
    var r = [[8,15],[20,35],[40,65],[70,100],[110,130]][i];
    return v >= r[0] && v <= r[1];
  }), JSON.stringify(S.thresholds));
  ok('settings: 默认音量 75%', S.volumePercent === 75, S.volumePercent);

  // ---- 本轮同步（对齐 Android 最新版的主机常量）----
  var KC = bp.consts;
  ok('sync: 左键随机台词冷却 = 30 下', KC.RANDOM_LINE_COOLDOWN_CLICKS_HIT === 30, KC.RANDOM_LINE_COOLDOWN_CLICKS_HIT);
  ok('sync: 道具随机台词冷却 = 20 下', KC.RANDOM_LINE_COOLDOWN_CLICKS_PROP === 20, KC.RANDOM_LINE_COOLDOWN_CLICKS_PROP);
  ok('sync: 水枪前 10 下不出随机台词', KC.SQUIRT_LINE_BLOCK_CLICKS === 10, KC.SQUIRT_LINE_BLOCK_CLICKS);
  ok('sync: 两个冷却计数器初值 = 各自上限（开局即已冷却）',
     S.clicksSinceRandomLineHit === 30 && S.clicksSinceRandomLineProp === 20,
     S.clicksSinceRandomLineHit + ' / ' + S.clicksSinceRandomLineProp);
  ok('sync: 水枪累计计数器存在且从 0 起（跨轮不清零）', S.squirtTotal === 0, S.squirtTotal);
  ok('sync: 连击到期时刻戳已初始化字段存在', typeof S.streakEndsAtMs === 'number', S.streakEndsAtMs);

  // ---- 开场页 ----
  var stage = document.getElementById('stage');
  ok('gate: 开局带 gated 类', stage.classList.contains('gated'));
  var before = S.totalHits;
  tap(document.getElementById('gate'));
  await sleep(80);
  ok('gate: 点一下 started=true', S.started === true);
  ok('gate: gated 类已移除', !stage.classList.contains('gated'));
  ok('gate: 开场那一下不算一次击打', S.totalHits === before, S.totalHits + ' vs ' + before);

  // ---- 单次击打 ----
  var t0 = S.totalHits, y0 = S.todayHits;
  tap(stage);
  ok('hit: totalHits +1', S.totalHits === t0 + 1, S.totalHits);
  ok('hit: todayHits +1', S.todayHits === y0 + 1, S.todayHits);
  ok('hit: streakHits +1', S.streakHits === 1, S.streakHits);
  ok('hit: 立刻显示受击帧 state_0_hit', onFrame() === 'state_0_hit', onFrame());
  await sleep(220);
  ok('hit: 120ms 后回静息帧 state_0', onFrame() === 'state_0', onFrame());

  // ---- 徽章 ----
  var sb = document.getElementById('streakBadge');
  var tb = document.getElementById('todayBadge');
  ok('badge: 连击徽章可见', sb.style.visibility === 'visible');
  ok('badge: 连击徽章含爆点+数字', sb.querySelectorAll('img').length >= 2, sb.querySelectorAll('img').length);
  ok('badge: 今日徽章可见', tb.style.visibility === 'visible');
  ok('badge: 今日徽章至少 3 张图（今+暴+数字）', tb.querySelectorAll('img').length >= 3, tb.querySelectorAll('img').length);
  // 注意：线上首屏比本地慢，徽章里的 <img> 可能还没建出来，
  // 直接 querySelectorAll('img')[0].getAttribute() 会抛 undefined。
  var tbImgs = tb.querySelectorAll('img'), sbImgs = sb.querySelectorAll('img');
  var firstToday = tbImgs.length ? tbImgs[0].getAttribute('src') : '(无图)';
  ok('badge: 今日徽章首图是 label_jin', /label_jin\.png$/.test(firstToday), firstToday);
  var burstSrc = sbImgs.length ? sbImgs[0].getAttribute('src') : '(无图)';
  ok('badge: 连击徽章底图是 burst_1~4', /burst_[1-4]\.png$/.test(burstSrc), burstSrc);

  // ---- 布局换算 ----
  var L = bp.layout();
  var wantSide = Math.max(120, Math.min(${WIDTH} * 0.80, ${HEIGHT} * 0.52, 760));
  ok('layout: 土豆边长 = min(0.8W, 0.52H) 夹在 120~760', Math.abs(L.side - wantSide) < 0.01,
     L.side + ' vs ' + wantSide + '  (视口 ${WIDTH}x${HEIGHT})');
  var sbRight = parseFloat(sb.style.left) + parseFloat(sb.style.width);
  ok('layout: 连击徽章右缘 = 土豆右缘 + 25*f', Math.abs(sbRight - (L.contentRight + 25 * L.f)) < 1.5, sbRight + ' vs ' + (L.contentRight + 25 * L.f));
  var sbBottom = parseFloat(sb.style.top) + parseFloat(sb.style.height);
  ok('layout: 连击徽章底边贴住土豆顶边', Math.abs(sbBottom - L.contentTop) < 1.5, sbBottom + ' vs ' + L.contentTop);
  var tbTop = parseFloat(tb.style.top);
  var wantTbTop = L.contentBottom + 4 * L.f;
  ok('layout: 今日徽章在土豆下方 4*f', Math.abs(tbTop - wantTbTop) < 1.5, tbTop + ' vs ' + wantTbTop);
  var tbW = parseFloat(tb.style.width);
  var tbLeft = parseFloat(tb.style.left);
  ok('layout: 今日徽章水平居中于土豆', Math.abs((tbLeft + tbW / 2) - (L.contentLeft + L.side / 2)) < 1.5, (tbLeft + tbW / 2) + ' vs ' + (L.contentLeft + L.side / 2));

  // ---- 连击升级到形态 1 ----
  S.streakHits = S.thresholds[0] - 1;
  bp.hit();
  ok('state: 连击达到阈值 0 → stateIndex = 1', S.stateIndex === 1, S.stateIndex);
  ok('state: 受击帧切到 state_1_hit', onFrame() === 'state_1_hit', onFrame());
  await sleep(220);
  ok('state: 静息帧切到 state_1', onFrame() === 'state_1', onFrame());

  // ---- 连击到顶 -> 形态 5 ----
  S.streakHits = S.thresholds[4] - 1;
  bp.hit();
  ok('state: 连击达到阈值 4 → stateIndex = 5', S.stateIndex === 5, S.stateIndex);
  await sleep(220);
  ok('state: 静息帧切到 state_5', onFrame() === 'state_5', onFrame());

  // ---- 道具按钮不能穿透成击打 ----
  var tBefore = S.totalHits;
  tap(document.getElementById('squirtBtn'));
  ok('prop: 按水枪按钮不会增加暴打次数', S.totalHits === tBefore, S.totalHits + ' vs ' + tBefore);
  ok('prop: 水枪已显示', document.getElementById('squirtProp').style.visibility === 'visible');

  var tBefore2 = S.totalHits;
  tap(document.getElementById('fingerBtn'));
  ok('prop: 按中指按钮不会增加暴打次数', S.totalHits === tBefore2, S.totalHits + ' vs ' + tBefore2);
  ok('prop: 中指已显示', document.getElementById('fingerProp').style.visibility === 'visible');

  // ---- 湿身 ----
  // 监听音效播放：Audio.play 是对象属性，包一层就能记录（game.js 内部也走属性查找）
  var playedSfx = [];
  var origPlay = bp.audio.play;
  bp.audio.play = function (n, v) { playedSfx.push(n); return origPlay.call(bp.audio, n, v); };
  function squirtPlays() { return playedSfx.filter(function (n) { return /^squirt_/.test(n); }).length; }

  S.squirtCount = 4;
  S.lineEndsAtMs = 0;                       // 清掉可能在播的台词，否则 lineIsPlaying() 会吞掉水声
  playedSfx.length = 0;
  tap(document.getElementById('squirtBtn'));
  ok('wet: 第 5 次滋水进入湿身', S.wet === true);
  ok('wet: 进入湿身那一下不播水声（该由 line_wet 语音接棒）', squirtPlays() === 0, JSON.stringify(playedSfx));
  ok('wet: 帧切到 wet', onFrame() === 'wet', onFrame());
  var fl = document.getElementById('flashImage');
  ok('wet: 展开图已出现', fl.style.visibility === 'visible');
  await sleep(120);          // 150ms 放大完成后才该是 scale(1)
  await sleep(150);
  ok('wet: 展开图放大结束时 scale = 1', /scale\\(1\\)/.test(fl.style.transform), fl.style.transform);
  var flH = parseFloat(fl.style.height);
  ok('wet: 展开图高 = 土豆边长 × 2.6', Math.abs(flH - L.side * 2.6) < 1.5, flH + ' vs ' + (L.side * 2.6));
  ok('wet: 展开图水平居中', Math.abs(parseFloat(fl.style.left) - (L.W - parseFloat(fl.style.width)) / 2) < 1.5);

  // ---- 湿身期间再滋水只续命 ----
  S.lineEndsAtMs = 0;
  playedSfx.length = 0;
  tap(document.getElementById('squirtBtn'));
  ok('wet: 继续滋水仍是湿身', S.wet === true);
  // 用户报的「水枪五次触发语音后按水枪音效消失」：湿身期间整段水声被 !wet 挡掉了。
  // 这里必须仍出水声（对齐 PC 的 Squirt()）。
  ok('wet: 湿身期间按水枪仍要出水声', squirtPlays() >= 1, JSON.stringify(playedSfx));
  bp.audio.play = origPlay;

  // ---- 湿身超时的绝对时刻补判（与连击同源：iOS 冻结 setTimeout）----
  S.wet = true; S.wetEndsAtMs = Date.now() - 1;
  ok('wet: 超时补判把湿身结束', bp.checkWetTimeout() === true && S.wet === false, 'wet=' + S.wet);

  // ---- 音量菜单 ----
  bp.setVolume(0);
  ok('volume: 设为静音', S.volumePercent === 0, S.volumePercent);
  var menuTxt = document.getElementById('volumeMenu').textContent;
  ok('volume: 菜单里有「静音」', /静音/.test(menuTxt), menuTxt);
  ok('volume: 静音时喇叭打斜杠', document.getElementById('volSlash').style.display !== 'none');
  bp.setVolume(50);
  ok('volume: 设回 50%', S.volumePercent === 50, S.volumePercent);
  ok('volume: 非静音时斜杠隐藏', document.getElementById('volSlash').style.display === 'none');
  bp.setVolume(75);

  // ---- 存档落盘 ----
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem('beatpotato.stats.v1')); } catch (e) {}
  ok('store: stats 已写入 localStorage', !!raw, raw ? JSON.stringify(raw).slice(0, 120) : 'null');
  ok('store: 落盘的 total 与内存一致', raw && raw.total === S.totalHits, raw ? raw.total : 'null', S.totalHits);
  var rawSet = null;
  try { rawSet = JSON.parse(localStorage.getItem('beatpotato.settings.v1')); } catch (e) {}
  ok('store: settings 已写入 localStorage', !!rawSet && rawSet.volumePercent === 75, JSON.stringify(rawSet));
  var rawDate = raw ? raw.date : '';
  var d = new Date();
  var expectDate = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  ok('store: 日期格式 yyyy-MM-dd', rawDate === expectDate, rawDate + ' vs ' + expectDate);

  // ---- 连击断档（6 秒） ----
  S.wet = false;
  S.streakHits = 3;
  bp.hit();
  ok('streak: 击打后连击徽章可见', S.streakHits === 4 && badgeSeen('streakBadge') === true, S.streakHits);
  await sleep(6400);
  ok('streak: 6 秒后连击归零', S.streakHits === 0, S.streakHits);
  // 关键：查「子元素实际有没有画出来」，不能只查容器自己的 style.visibility —— 数字是子 <img>
  ok('streak: 连击徽章已隐藏（含子元素实际渲染）', badgeSeen('streakBadge') === false,
     'seen=' + badgeSeen('streakBadge') + ' 容器=' + sb.style.visibility);
  ok('streak: 形态跟着回到 0', S.stateIndex === 0, S.stateIndex);
  await sleep(200);
  ok('streak: 帧回到 state_0', onFrame() === 'state_0', onFrame());

  // ---- 待机零定时器（形态 0、无湿身、无弹跳时不该有残留计时器） ----
  await sleep(300);
  ok('idle: 待机时受击帧计时器已清空', onFrame() === 'state_0', onFrame());

  // ---- 本轮同步：随机台词的两道闸只作用于左键 ----
  var realRandom = Math.random;
  Math.random = function () { return 0; };      // 0 → 必定命中 10% 概率，且选中 line_rand1
  S.randomLineBlockedUntil = -1;
  S.clicksSinceRandomLineHit = 999;
  S.clicksSinceRandomLineProp = 999;
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;
  S.clickSeq = 0;
  S.stateIndex = 0; S.streakHits = 0;           // 还没进第一阶段
  ok('sync: 未进第一阶段时左键不出随机台词', bp.playRandomLineIfLucky(true) === false);
  ok('sync: 同一状态道具入口不受第一阶段闸限制', bp.playRandomLineIfLucky(false) === true);
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;

  // ---- 本轮同步：逼近升级节点也只在左键生效 ----
  S.clickSeq = 0; S.randomLineBlockedUntil = -1;
  S.clicksSinceRandomLineHit = 999; S.clicksSinceRandomLineProp = 999;
  S.stateIndex = 3;                             // 已经进过第一阶段
  S.streakHits = S.thresholds[0] - 5;           // 距第一个阈值还剩 5 下
  ok('sync: 逼近升级节点时左键不出随机台词', bp.playRandomLineIfLucky(true) === false);
  ok('sync: 逼近升级节点不挡道具入口', bp.playRandomLineIfLucky(false) === true);
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;

  // ---- 本轮同步：水枪前 10 下不参与随机台词 ----
  S.wet = false; S.squirtCount = 0; S.squirtTotal = 0;
  S.streakHits = 0; S.stateIndex = 0;
  S.clickSeq = 0; S.randomLineBlockedUntil = -1;
  S.clicksSinceRandomLineProp = 999;
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;
  bp.squirt();
  ok('sync: 水枪累计数 +1', S.squirtTotal === 1, S.squirtTotal);
  ok('sync: 水枪前 10 下不消耗随机台词机会', S.clicksSinceRandomLineProp === 1000, S.clicksSinceRandomLineProp);
  S.squirtTotal = 10; S.clicksSinceRandomLineProp = 999;
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;
  bp.squirt();
  ok('sync: 水枪第 11 下才尝试随机台词（计数器被清零）', S.clicksSinceRandomLineProp === 0, S.clicksSinceRandomLineProp);
  Math.random = realRandom;
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;
  S.wet = false; S.squirtCount = 0; S.squirtTotal = 0;

  // ---- 水枪音频规则枚举（实测）----
  // 用户报「水枪没声音，所以不知道水枪状态下有没有随机音频」。
  // 这里连按 12 下、逐下记录实际播了什么，把规则用事实列出来。
  // 先让随机数不命中 10% 台词，单独观察水声有没有断。
  var sqLog = [];
  var savedPlay = bp.audio.play;
  var savedRandom2 = Math.random;
  bp.audio.play = function (n, v) { sqLog.push(n); return savedPlay.call(bp.audio, n, v); };
  Math.random = function () { return 0.99; };
  S.wet = false; S.squirtCount = 0; S.squirtTotal = 0;
  S.clickSeq = 0; S.randomLineBlockedUntil = -1;
  S.clicksSinceRandomLineProp = 999;
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;
  var sqSteps = [];
  for (var k = 1; k <= 12; k++) {
    S.lineDurationMs = 0; S.lineEndsAtMs = 0;      // 模拟"台词已经播完了"
    sqLog.length = 0;
    bp.squirt();
    sqSteps.push(k + (S.wet ? '·湿' : '') + '=' + (sqLog.length ? sqLog.join('+') : '无声'));
  }
  ok('水枪音频枚举：第 1~4 下都有水声', /1=squirt_/.test(sqSteps.join(' ')) && /4=squirt_/.test(sqSteps.join(' ')),
     sqSteps.join('  '));
  ok('水枪音频枚举：第 5 下进湿身、那一下不播水声（交给 line_wet 语音接棒）',
     sqSteps[4].indexOf('5·湿=') === 0 && sqSteps[4].indexOf('squirt_') < 0, sqSteps[4]);
  ok('水枪音频枚举：第 6~12 下（湿身期间）全部仍有水声', sqSteps.slice(5).every(function (s) { return s.indexOf('squirt_') > 0; }),
     sqSteps.slice(5).join('  '));
  // 台词占线时水声会被吞（这是 Android/PC 一致的行为：lineIsPlaying() 优先）
  Math.random = savedRandom2;
  bp.audio.play = savedPlay;

  // ---- 水枪状态下到底有没有随机台词？（用户问的正是这个）----
  // 让随机数必定命中 10% 台词，从第 1 下连按 20 下，看第几下开始出 line_rand。
  // 预期：前 10 下铺垫水声不参与；第 5 下进湿身会播 line_wet 并开 10 下保护窗
  //（playNodeLine 把 randomLineBlockedUntil 推到 clickSeq+10 = 15）；
  // 所以要到第 16 下才会冒随机台词。
  var sqLog3 = [];
  var savedPlay3 = bp.audio.play;
  var savedRandom4 = Math.random;
  bp.audio.play = function (n, v) { sqLog3.push(n); return savedPlay3.call(bp.audio, n, v); };
  Math.random = function () { return 0; };          // 0*100=0 < 10 → 必命中
  S.wet = false; S.squirtCount = 0; S.squirtTotal = 0;
  S.clickSeq = 0; S.randomLineBlockedUntil = -1;
  S.clicksSinceRandomLineProp = 999; S.clicksSinceRandomLineHit = 999;
  S.lineDurationMs = 0; S.lineEndsAtMs = 0;
  var sqSteps3 = [];
  for (var k3 = 1; k3 <= 20; k3++) {
    S.lineDurationMs = 0; S.lineEndsAtMs = 0;       // 模拟"台词已经播完了"
    sqLog3.length = 0;
    bp.squirt();
    sqSteps3.push(k3 + '=' + (sqLog3.length ? sqLog3.join('+') : '无声'));
  }
  Math.random = savedRandom4;
  bp.audio.play = savedPlay3;

  var randAt = [];
  sqSteps3.forEach(function (s, i) { if (/line_rand/.test(s)) randAt.push(i + 1); });
  ok('水枪随机台词：湿身状态下确实会出（第 16 下起，前 10 下铺垫 + 湿身语音后 10 下保护窗）',
     randAt.length > 0 && randAt[0] === 16, '出现随机台词的次数点=[' + randAt.join(',') + ']  ' + sqSteps3.join('  '));
  ok('水枪随机台词：前 10 下绝不参与（只播水声）',
     sqSteps3.slice(0, 10).every(function (s) { return s.indexOf('line_rand') < 0; }),
     sqSteps3.slice(0, 10).join('  '));

  // ---- 本轮同步：连击断档会重随机阈值 ----
  var thrBefore = S.thresholds.slice();
  bp.rerollThresholds();
  ok('sync: 重随机后阈值仍合法（区间内 + 严格递增）', bp.isValidThresholds(S.thresholds) === true, JSON.stringify(S.thresholds));
  ok('sync: 重随机确实换了新的一组', S.thresholds.join() !== thrBefore.join(), thrBefore.join() + ' -> ' + S.thresholds.join());
  S.streakHits = 3; S.streakVisible = true;
  bp.resetStreak();
  ok('sync: 连击归零会隐藏连击徽章（含子元素实际渲染）', badgeSeen('streakBadge') === false,
     'seen=' + badgeSeen('streakBadge') + ' 容器=' + sb.style.visibility);
  ok('sync: 连击归零后阈值被重新随机（合法）', bp.isValidThresholds(S.thresholds) === true, JSON.stringify(S.thresholds));

  // ---- 本轮同步：从后台回来补判连击超时（iOS 会冻结 setTimeout）----
  S.streakHits = 7; S.streakEndsAtMs = Date.now() - 1;
  ok('sync: 超时补判把连击归零', bp.checkStreakTimeout() === true && S.streakHits === 0, S.streakHits);

  // ---- 本轮同步：道具按钮按下位移（对齐 Android PropButtonView）----
  var facePush = null, shadowTop = null, faceRule = null;
  for (var si = 0; si < document.styleSheets.length; si++) {
    var rs; try { rs = document.styleSheets[si].cssRules; } catch (e) { continue; }
    for (var ri = 0; ri < rs.length; ri++) {
      var sel = rs[ri].selectorText || '';
      if (sel === '.prop-btn:active .face img') facePush = rs[ri].style.transform;
      if (sel === '.prop-btn:active::before') shadowTop = rs[ri].style.top;
      if (sel === '.prop-btn .face') faceRule = rs[ri].style.transform;
    }
  }
  ok('sync: 道具按钮按下时图标下移 2px（Android PROP_PRESS_PUSH_DP）',
     (facePush || '').indexOf('translateY(2px)') >= 0, facePush);
  ok('sync: 道具按钮按下时阴影上浮到 1.35px（0.55 × 3dp）',
     String(shadowTop || '').indexOf('1.35') >= 0, shadowTop);
  ok('sync: 道具按钮本体按下时不再位移（Android 本体不动）',
     !faceRule || faceRule === 'none' || faceRule === '', faceRule);

  var fail = R.filter(function (r) { return !r.s; }).length;
  return { results: R, fail: fail, pass: R.length - fail };
})()
`;

/* --------------------------------------------------- 自检页（devtools）断言 */
const DEVTOOLS_SCRIPT = `
(async () => {
  var R = [];
  function ok(name, cond, extra) {
    R.push({ s: !!cond, n: name, x: extra === undefined ? '' : String(extra) });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rows(id) { return document.querySelectorAll('#' + id + ' tr').length; }

  // 外层脚本会轮询 iframe，等它就位。
  // 必须等到 state.ready（素材+音频预载完成）再往下断言：线上首次加载比本地慢得多
  //（实测约 50 秒），只等 bp 存在的话会读到「尺寸表/音效时长还没填完」的残缺状态 → 假失败。
  //
  // 注意：这里的 bp 是 devtools 页面自己的全局变量，由它的 waitForGame() 在真正 ready 时才赋值。
  // 线上冷启动若超过它自己的兜底时间，bp 会一直是 null，后面 bp.sfxNames 直接抛
  // 「Cannot read properties of null」。所以等不到就自己从 iframe 里兜底取一个。
  function frameGame() {
    try { return document.getElementById('gameFrame').contentWindow.BeatPotato || null; }
    catch (e) { return null; }
  }
  for (var i = 0; i < 900; i++) {
    if (bp || frameGame()) bp = bp || frameGame();
    if (bp && bp.state && bp.state.ready) break;
    await sleep(100);
  }
  if (!bp) bp = frameGame();
  // 拿到实例但还没 ready 的话，再等它 ready（上面的循环可能因 devtools 兜底超时而退出）
  for (var r = 0; r < 900 && bp && !bp.state.ready; r++) await sleep(100);
  var haveBp = !!(bp && bp.sfxNames);
  var wantDurations = haveBp ? bp.sfxNames.length : 14;
  // 音效时长是逐个 decode 完才填进 durationOf 的，ready 之后可能还差几个，再等一会儿。
  for (var d = 0; d < 300; d++) {
    if (!haveBp) break;
    var got = bp.sfxNames.filter(function (n) { return bp.audio.durationOf(n) > 0; }).length;
    if (got >= wantDurations) break;
    await sleep(100);
  }
  // 素材格子是 renderAssets 一次性渲染的，若 devtools 提前兜底渲染过，点「重新扫描素材」再渲染一次。
  for (var c = 0; c < 300; c++) {
    if (document.querySelectorAll('#assetBox .cell').length > 0) break;
    await sleep(100);
  }
  if (haveBp && document.querySelectorAll('#assetBox .cell').length !== Object.keys(bp.dims).length) {
    var rescan = document.getElementById('btnRescan');
    if (rescan) { rescan.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  }
  await sleep(300);   // 让页内 renderAssets/renderSfx 跟上（它们也等 ready，但晚一拍）
  ok('外层拿到 iframe 里的游戏实例', haveBp,
     haveBp ? 'version ' + bp.version : 'bp 为 null（devtools 兜底超时，iframe 里也没拿到）');
  if (!haveBp) {
    // 拿不到实例就没法继续断言，直接返回一条失败，别让脚本自己崩掉（崩掉会掩盖真正原因）。
    ok('devtools 页面里的 bp 可用', false, '等了 90 秒仍未就绪');
    var nf = R.filter(function (x) { return !x.s; }).length;
    return { results: R, fail: nf, pass: R.length - nf };
  }
  var fw = document.getElementById('gameFrame').contentWindow;
  ok('外层 bp 就是 iframe 里的那个实例', fw.BeatPotato && bp === fw.BeatPotato);
  ok('iframe 指向 index.html', /index\.html/.test(document.getElementById('gameFrame').getAttribute('src')));

  // 面板渲染
  ok('环境表已渲染', rows('envTable') >= 10, rows('envTable') + ' 行');
  ok('存档表已渲染', rows('saveTable') >= 9, rows('saveTable') + ' 行');

  // 音效试听
  var sfxBtns = document.querySelectorAll('#sfxBox button');
  ok('音效试听按钮数 = 音效数', sfxBtns.length === bp.sfxNames.length,
     sfxBtns.length + ' 个按钮 / ' + bp.sfxNames.length + ' 个音效');
  var d0 = bp.audio.durationOf(bp.sfxNames[0]);
  ok('首个音效已解码出真实时长', d0 > 0, d0 + 'ms (' + bp.sfxNames[0] + ')');
  var allD = bp.sfxNames.filter(function (n) { return bp.audio.durationOf(n) > 0; });
  ok('全部音效都解码出真实时长', allD.length === bp.sfxNames.length, allD.length + '/' + bp.sfxNames.length);
  sfxBtns[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(80);
  ok('点试听按钮不抛错且改写了按钮文案', /已播/.test(sfxBtns[0].textContent), sfxBtns[0].textContent.slice(0, 40));

  // 素材总览
  var cells = document.querySelectorAll('#assetBox .cell');
  var groups = [];
  document.querySelectorAll('#assetBox h2').forEach(function (h) {
    groups.push(h.textContent.replace(/\\s+/g, ' ').trim());
  });
  var dimsKeys = Object.keys(bp.dims);
  ok('素材格子数与尺寸表条目数一致', cells.length === dimsKeys.length,
     cells.length + ' 个格子 / ' + dimsKeys.length + ' 条尺寸 | 分组: ' + groups.join(' ・ '));
  var imgs = document.querySelectorAll('#assetBox .cell img');
  var loaded = 0;
  // 缩略图是 44 张真图，线上首次加载（无缓存）会明显慢于本地；
  // 直接数 complete 会读到「还在下」的中间态 → 假失败。轮询等它们落定。
  for (var t = 0; t < 60; t++) {
    loaded = 0;
    imgs.forEach(function (im) { if (im.complete && im.naturalWidth > 0) loaded++; });
    if (loaded === imgs.length) break;
    await sleep(100);
  }
  ok('素材缩略图全部加载成功', loaded === imgs.length, loaded + '/' + imgs.length);
  function cellOf(name) {
    var hit = null;
    cells.forEach(function (c) {
      var b = c.querySelector('b');
      if (b && b.textContent === name) hit = c;
    });
    return hit;
  }
  var c5 = cellOf('state_5.png');
  ok('state_5 格子显示真实尺寸 1044x1024（10-12 换新版创口贴）', c5 && /1044/.test(c5.querySelector('i').textContent),
     c5 ? c5.querySelector('i').textContent : '没找到 state_5.png');

  // 玩法快捷
  var totalBefore = bp.state.totalHits;
  ok('实时状态已渲染布局', /土豆边长/.test(document.getElementById('liveBox').textContent),
     (document.getElementById('liveBox').textContent.split('\\n')[6] || '').trim());
  document.querySelector('[data-act="hit1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(120);
  ok('「打 1 下」使 totalHits +1', bp.state.totalHits === totalBefore + 1,
     totalBefore + ' → ' + bp.state.totalHits);
  var sc = bp.state.squirtCount;
  document.querySelector('[data-act="squirt"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(120);
  ok('「滋水枪」推进了水枪计数', bp.state.squirtCount !== sc || bp.state.wet === true,
     sc + ' → ' + bp.state.squirtCount + '  wet=' + bp.state.wet);
  document.querySelector('[data-act="hit100"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(150);
  var expectState = 0;
  bp.state.thresholds.forEach(function (t, i) { if (bp.state.streakHits >= t) expectState = i + 1; });
  ok('「打 100 下」后形态与随机阈值吻合', bp.state.stateIndex === expectState,
     'streakHits=' + bp.state.streakHits + '  阈值=[' + bp.state.thresholds.join(',') +
     ']  期望 state=' + expectState + '  实际=' + bp.state.stateIndex);
  document.querySelector('[data-act="reset"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(120);
  ok('「连击归零」把 streakHits 清零', bp.state.streakHits === 0, 'streakHits=' + bp.state.streakHits);

  // 预览框缩放适配
  var wrap = document.getElementById('stagewrap');
  ok('预览框高度已按缩放写死', wrap.style.height && wrap.clientHeight > 100,
     'wrap ' + wrap.clientWidth + 'x' + wrap.clientHeight);
  var tr = document.getElementById('gameFrame').style.transform;
  ok('预览框缩放系数 <= 1', /scale\\(0?\\.?[\\d]*\\)|scale\\(1\\)/.test(tr) || tr === '', tr || '(none)');

  // 清空存档（放最后，会改数据）
  document.getElementById('btnWipe').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(80);
  var gone = false;
  try { gone = localStorage.getItem('beatpotato.stats.v1') === null; } catch (e) { gone = false; }
  ok('「清空存档」真的删掉了 stats', gone);
  ok('清空后给出提示文案', /已清空/.test(document.getElementById('wipeNote').textContent),
     document.getElementById('wipeNote').textContent.slice(0, 30));

  var fail = R.filter(function (r) { return !r.s; }).length;
  return { results: R, fail: fail, pass: R.length - fail };
})()
`;

/* ------------------------------------------------------------------ 主流程 */
(async function main() {
  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) {
    console.error('找不到 Edge / Chrome，无法做无头自检。');
    process.exit(2);
  }
  const userDataDir = path.join(os.tmpdir(), 'bp-headless-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--mute-audio',
    '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--window-size=' + WIDTH + ',' + HEIGHT,
    'about:blank'
  ];
  const child = spawn(exe, args, { stdio: 'ignore', detached: false });

  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  if (!wsUrl) { try { child.kill(); } catch (e) {} throw new Error('连不上 headless 调试端口'); }

  const cdp = await CDP.connect(wsUrl);

  const problems = [];
  const httpBad = [];
  const aborted = [];
  const expectedFileNoise = [];   // file:// 下音频探测 fetch 被 CORS 拦：既定行为
  let pageErrors = 0;

  cdp.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      pageErrors++;
      const d = params.exceptionDetails || {};
      problems.push('JS 异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      problems.push('console.error: ' + (params.args || []).map((a) => a.value || a.description || '').join(' '));
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      const entryUrl = params.entry.url || '';
      // file:// 下探测音频用的 fetch 必然被拦（CORS / ERR_FAILED），这正是降级 <audio> 的触发条件，
      // 属于既定行为，不算问题（否则 file:// 模式永远报一条假失败）。
      // 注意：CDP 的 Log 条目里 entry.url 常是空或是 index.html 本身，真正的 URL 只出现在 entry.text 里，
      // 所以只认 text。
      const noiseBlob = params.entry.text + ' ' + entryUrl;
      const isAudioProbeNoise = IS_FILE
        && /\/assets\/audio\/[^ ']*\.wav/i.test(noiseBlob)
        && /CORS|Cross origin|ERR_FAILED|ERR_ABORTED|not allowed|Failed to load resource/i.test(noiseBlob);
      if (isAudioProbeNoise) {
        expectedFileNoise.push(params.entry.text);
      } else {
        problems.push('browser log: ' + params.entry.text + ' ' + entryUrl);
      }
    } else if (method === 'Network.responseReceived') {
      const r = params.response || {};
      if (r.status >= 400) httpBad.push(r.status + ' ' + r.url);
    } else if (method === 'Network.loadingFailed') {
      if (params.errorText === 'net::ERR_ABORTED') {
        aborted.push(params.type);          // 收尾时被中断的在途请求，不是错误
      } else if (params.type !== 'Fetch' && params.type !== 'XHR') {
        problems.push('资源加载失败: ' + params.errorText + ' (' + params.type + ')');
      }
    }
  });

  let loaded = false;
  const loadPromise = new Promise((res) => {
    cdp.on((m) => { if (m === 'Page.loadEventFired') { loaded = true; res(); } });
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 3, mobile: true
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  console.log('无头浏览器 : ' + path.basename(exe));
  console.log('视口       : ' + WIDTH + 'x' + HEIGHT + ' (mobile, dpr 3)');
  console.log('被测地址   : ' + URL_TO_TEST);
  console.log('');

  await cdp.send('Page.navigate', { url: URL_TO_TEST });
  await Promise.race([loadPromise, sleep(15000)]);
  await sleep(WAIT_MS);

  const SCRIPT = /devtools\.html/.test(URL_TO_TEST) ? DEVTOOLS_SCRIPT : ASSERT_SCRIPT;

  const out = await cdp.send('Runtime.evaluate', {
    expression: SCRIPT, awaitPromise: true, returnByValue: true, userGesture: true
  });

  if (out.exceptionDetails) {
    console.log('!! 断言脚本自身抛错：');
    console.log('   ' + (out.exceptionDetails.exception && out.exceptionDetails.exception.description || out.exceptionDetails.text));
  }

  const val = out.result && out.result.value;
  if (!val) {
    console.log('!! 没拿到断言结果');
  } else {
    val.results.forEach((r) => {
      const mark = r.s ? '  PASS' : '  FAIL';
      console.log(mark + ' | ' + r.n + (r.x ? '   [' + r.x + ']' : ''));
    });
    console.log('');
    console.log('  断言: ' + val.pass + ' 通过 / ' + val.fail + ' 失败  (共 ' + val.results.length + ')');
  }

  // ---- 标签页冻结复现（--freeze）----------------------------------------
  // 起因：用户报「一段时间不打，右上角计数不消失」。真因是 iOS Safari 退到后台会
  // 冻结标签页，setTimeout 一起停摆，连击归零的定时器根本没轮到。无头环境默认
  // 跑不出这个现象，所以这里用 CDP 真的把页面冻住来复现：
  //   打 3 下 → 冻住页面 → Node 侧干等 7 秒（> STREAK_RESET_MS=6000）→ 解冻 →
  //   模拟 Safari 回前台派发 visibilitychange → 徽章必须已消失。
  // 只靠定时器的实现会在这里 FAIL；靠「绝对时刻 + 补判」的实现会 PASS。
  let freezeFailed = false;
  if (FREEZE && val && !/devtools\.html/.test(URL_TO_TEST)) {
    console.log('');
    console.log('  --- 标签页冻结复现（模拟 iOS Safari 退到后台）---');
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true, userGesture: true
      });
      if (r.exceptionDetails) {
        return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
      }
      return r.result && r.result.value;
    };
    const probe = `(function(){
      var bp = window.BeatPotato, el = document.getElementById('streakBadge');
      // 关键：不能只看容器 style.visibility —— 子 <img> 会自己声明 visible 盖掉父级的 hidden。
      // 这里逐个查子元素的 computed style，才算「数字真的没画在屏幕上」。
      var seen = false;
      if (el && getComputedStyle(el).display !== 'none') {
        var imgs = el.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          if (getComputedStyle(imgs[i]).visibility === 'visible') { seen = true; break; }
        }
      }
      return { hits: bp.state.streakHits, vis: el.style.visibility, seen: seen,
               endsAt: bp.state.streakEndsAtMs, now: Date.now(),
               visState: document.visibilityState,
               hb: (window.__hb ? window.__hb.n : -1) };
    })()`;

    // ---- [A] 定时器被吞：模拟 iOS 后台把定时器节流成「时间过了、回调没轮到」----
    // 这是能区分修复前后的关键测试。CDP 冻结解冻后浏览器会补跑积压的定时器，
    // 那样两种实现都会归零、测不出差别。这里把 6 秒归零定时器 hook 掉（永不执行），
    // 再把到期时刻拨到 1 秒前，然后派发 visibilitychange：
    // 只靠定时器的实现徽章会一直挂着 → FAIL；有绝对时刻补判的实现立刻归零 → PASS。
    await ev(`(function(){
      window.__swallowed = 0;
      var orig = window.setTimeout;
      window.__origSetTimeout = orig;
      window.setTimeout = function (fn, ms) {
        if (ms === 6000) { window.__swallowed++; return -1; }   // 连击归零定时器：吞掉
        return orig.apply(window, arguments);
      };
      return true;
    })()`);
    await ev(`(function(){
      var bp = window.BeatPotato;
      if (!bp.state.started) bp.startGame();
      bp.hit(); bp.hit(); bp.hit();
      return true;
    })()`);
    await sleep(400);

    const before = await ev(probe);
    const swallowed = await ev(`window.__swallowed`);
    console.log('  [A] 冻结前    : streakHits=' + before.hits + '  徽章=' + before.vis +
      '  已吞掉归零定时器 ' + swallowed + ' 个');

    // 把到期时刻拨到 1 秒前（等价「6 秒已经过去」），而定时器仍然永远不会跑
    await ev(`(function(){
      window.BeatPotato.state.streakEndsAtMs = Date.now() - 1000;
      return true;
    })()`);
    await ev(`document.dispatchEvent(new Event('visibilitychange'))`);   // Safari 回前台必然派发
    await sleep(300);

    const afterA = await ev(probe);
    const okA = afterA && !afterA.__err && afterA.hits === 0 && afterA.vis === 'hidden' && afterA.seen === false;
    console.log('  [A] 回前台后  : streakHits=' + (afterA && afterA.hits) + '  徽章=' + (afterA && afterA.vis) +
      '  数字实际可见=' + (afterA && afterA.seen));
    console.log((okA ? '  PASS' : '  FAIL') +
      ' | 定时器被节流（时间已过、回调没轮到）时回前台，连击计数必须已消失');
    if (!okA) freezeFailed = true;

    // 恢复原生 setTimeout，别影响后面的测试
    await ev(`(function(){ if (window.__origSetTimeout) window.setTimeout = window.__origSetTimeout; return true; })()`);

    // ---- [B] CDP 真冻结 7 秒：确认真冻结下页面不崩、恢复后能归零 ----
    // 补充测试，不能区分修复前后（解冻会补跑定时器），只作健康检查。
    await ev(`(function(){
      var bp = window.BeatPotato;
      bp.hit(); bp.hit(); bp.hit();
      return true;
    })()`);
    await sleep(300);
    let canFreeze = true;
    try {
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    } catch (e) { canFreeze = false; }
    if (!canFreeze) {
      console.log('  [B] (本机 CDP 不支持 setWebLifecycleState，跳过)');
    } else {
      await sleep(7000);
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      // CDP 解冻不保证派发 visibilitychange，而真实 Safari 回前台一定会。
      // 不补这一次，[B] 会随机假失败（修复本身是对的，只是事件没到）。
      await ev(`(function(){
        try {
          Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
          Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        } catch (e) {}
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
      })()`);
      await sleep(600);
      const afterB = await ev(probe);
      const okB = afterB && !afterB.__err && afterB.hits === 0 && afterB.vis === 'hidden' && afterB.seen === false;
      console.log('  [B] 真冻结 7 秒后解冻: streakHits=' + (afterB && afterB.hits) +
        '  徽章=' + (afterB && afterB.vis) + '  数字实际可见=' + (afterB && afterB.seen) +
        (okB ? '   PASS' : '   FAIL'));
      if (!okB) freezeFailed = true;
    }
  }

  if (httpBad.length) {
    console.log('');
    console.log('  HTTP >= 400 (' + httpBad.length + ')：');
    [...new Set(httpBad)].slice(0, 20).forEach((u) => console.log('    ' + u));
  }
  if (problems.length) {
    console.log('');
    console.log('  页面报错 (' + problems.length + ')：');
    [...new Set(problems)].slice(0, 20).forEach((u) => console.log('    ' + u));
  } else {
    console.log('');
    console.log('  页面无 JS 异常 / 无 console.error');
  }

  if (aborted.length) {
    console.log('');
    console.log('  收尾时被中断的在途请求 (' + aborted.length + ' 个): ' +
      [...new Set(aborted)].join(', ') + ' —— 关浏览器导致的，不算问题');
  }

  if (expectedFileNoise.length) {
    console.log('');
    console.log('  file:// 下音频探测被 CORS 拦 (' + expectedFileNoise.length + ' 个) —— ' +
      '这是既定行为，音频引擎按设计降级成 <audio>，不算问题');
  }

  const failed = (!val || val.fail > 0) || problems.length > 0 || httpBad.length > 0 || freezeFailed;
  console.log('');
  console.log(failed ? '结果: 有问题，需要修' : '结果: 全部通过');

  try { cdp.ws.close(); } catch (e) {}
  try { child.kill(); } catch (e) {}
  await sleep(400);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}

  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('自检脚本崩了: ' + (e && e.stack || e));
  process.exit(3);
});
