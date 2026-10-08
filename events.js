/* events.js — 联机随机事件(组合规则版)：落位触发 → 房主给其他人各抽一次 → 被罚者摇奖(落定那一刻判定) → 效果 → 状态上报 → 房主通知全员(数据条小图标)。
   只依赖 Multiplayer.js 的 EV.attach(ctx) / EV.onMsg / EV.stop / EV.detach，以及 index.html 里的钩子：
     EV.locked()    撤销/重来/地图菜单键：从收到抽签结果起到全部效果(含排队)结束都锁住
     EV.moveLock()  迷雾没擦到 80% 前不能走
     EV.noHold()    混乱/溜冰时不允许按住连走
     EV.durMul()    步时长倍率(中毒×2、加速×0.5)，setMoveDur 里乘上
     EV.remap()     混乱：tryMove 开头换方向(在写走法日志之前，续局重放才不会乱)
     EV.input()     溜冰：requestMove 里接管输入
     EV.slideStep() 溜冰：每一步走完的锁到期时继续滑
   ── 规则(以《随机事件系统 V2 修改说明》为准) ──
   主效果：溜冰/混乱/隐身/迷雾/关灯，同一时刻一个，不同主效果只能串行；速度类：加速/中毒，不排队、直接附着在当前主效果上。
   速度类附着=丢弃旧计时器，按主效果完整基础时长重新计时(迷雾也一样，但雾的画面/擦除状态不重置，剩余的雾按新计时器走)；
   同类再命中(只看当前节点，含速度部分)：第一次=续命 完整周期×50%，之后=免疫；组合共用一根倒计时；
   加速×中毒互相清零(不补偿、不刷新，主效果按剩余时间继续)；队列只等待：最多2个、纯主效果、不合并不续命不计时；
   队列满=强制结束当前、等待1上位、新的入队尾；正常结束=解除→约1秒喘息→等待1上位从完整时长开始；抽签降权×0.7。
   ── 消息(都很短) ──
     et 玩家→房主  {b:箱子ID}                          我把一个箱子推进了目标点
     rl 房主→全体  {t:被罚者, e:事件, n:序号, b:播盲盒} 抽签结果(全体据此在数据条显示 ❓)
     st 被罚者→房主 {c:[当前主,速度], q:[排队], r:剩余ms|-1, l:刚落定的序号, z:清零}   我的效果状态变了
     es 房主→全体  {i,c,q,r,l,z}                        转发 st(数据条图标/预警/排队图标)
   判定与计时都在被罚者本机(效果本来就只作用在他自己的设备上)；房主只管抽签、盲盒标志和转发状态。 */
(function () {
'use strict';

/* ---------- 可调参数(概率 / 时长 / 倍率都在这) ---------- */
const CFG = {
  dir: 'assets/events/',
  files: { chaos: 'confusion', blackout: 'lights_out', invisible: 'invisible', poison: 'poison', fog: 'fog', speed: 'speed', ice: 'ice' },
  layer2: true,   // 第二层总开关：速度类能附在主效果上、加速×中毒抵消、迷雾组合。关掉=加速/中毒当普通主效果排队
  layer3: true,   // 第三层总开关：盲盒只在完全空闲时播、排队图标、预警闪烁、节点间隔。关掉=盲盒每次都播、无排队图标/预警/间隔
  w:   { speed: 10, poison: 15, ice: 10, chaos: 13, invisible: 17, fog: 17, blackout: 18 }, // V2 基础权重(合计100)
  dur: { speed: 5000, poison: 5000, ice: 6000, chaos: 7000, invisible: 8000, fog: 8000, blackout: 10000 }, // V2 基础时长(毫秒)；迷雾=最长擦拭时间
  extra: 0.5,     // 同类再命中：追加 当前节点完整周期×extra
  extMax: 1,      // 每个节点最多被延长几次，超出=免疫
  queueMax: 2,    // 当前节点之外最多排几个(只排纯主效果)
  fogBlock: true, // 当前节点带迷雾时，新抽签直接屏蔽迷雾(没有迷雾了才恢复原概率)
  downW: 0.7,     // 抽签降权：身上已有(当前/排队)的类型，权重×这个数(1=关闭)
  gapMs: 1000,    // 当前节点正常结束到下一个排队节点开始之间的喘息间隔(0=无缝)
  warn: { def: 2000, ice: 2000 }, // 预警：剩余多少毫秒开始慢闪(溜冰只有4秒，可单独调)
  pulseMe: 1.5, pulseOther: 1.25, pulseMs: 400, // 等待节点转为当前时，数据条图标放大再回弹一次(自己/别人的倍数、总时长)
  iceAccel: [1, 0.85, 0.72, 0.62, 0.55], // 溜冰起步加速：第1格(迈出第一脚)=1倍步时长，之后每格更快，到最后一项保持匀速(越小越快)
  iceLead: 1.6,   // 溜冰滑行时镜头朝滑行方向的前瞻(格)，平时是 CAMERA_CFG.lead
  poisonMul: 2, speedMul: 0.5,    // 步时长倍率：中毒慢一倍，加速快一倍
  fogNeed: 0.8, fogFadeMs: 1800,  // 迷雾：擦到这个比例后可操作，剩下的雾这么久淡完
  boxW: 240, boxVw: 0.64, boxAsp: 841 / 803, // 开机盲盒：最大宽度(px)、不超过屏宽的比例、素材宽高比(803×841)
  long:  { drop: 380, shake: 450, fly: 380, roll: 1600, popIn: 220, popHold: 350, popOut: 280 }, // 带盲盒：落下→晃动→缩小飞向转盘位→滚动→亮相(ms)
  short: { drop: 0,   shake: 0,   fly: 200, roll: 1200, popIn: 200, popHold: 260, popOut: 260 }, // 不带盲盒(身上已有效果/连续抽中)：缩短版
  sfx: true, sfxGain: 1.5 // 事件音效总开关 / 总增益(在 sound.js 的音效音量之上再乘；整体觉得吵或轻就调这个)
};
const IDS = Object.keys(CFG.files);
const SPEED_IDS = ['speed', 'poison'];
const EMOJI = { chaos: '🌀', blackout: '🔦', invisible: '👻', poison: '☠️', fog: '🌫️', speed: '⚡', ice: '🧊', '?': '❓' };
const NAME = {
  zh: { chaos: '混乱', blackout: '关灯', invisible: '隐身', poison: '中毒', fog: '迷雾', ice: '溜冰', speed: '加速' },
  en: { chaos: 'Chaos', blackout: 'Lights out', invisible: 'Ghost boxes', poison: 'Poison', fog: 'Fog', ice: 'Ice', speed: 'Speed up' }
};
const TXT = { zh: { ext: '加时', imm: '免疫', can: '互相抵消', que: '排队中' }, en: { ext: 'Extended', imm: 'Immune', can: 'Cancelled out', que: 'Queued' } };
const $ = (id) => document.getElementById(id);
const lang = () => (document.documentElement.dataset.lang === 'en' ? 'en' : 'zh');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isSpd = (e) => CFG.layer2 && SPEED_IDS.includes(e);   // 速度类(第二层关掉时当主效果)
const opp = (e) => (e === 'speed' ? 'poison' : 'speed');
const D = (e) => CFG.dur[e];
const gapMs = () => (CFG.layer3 ? CFG.gapMs : 0);
const warnMs = (e) => (CFG.warn[e] != null ? CFG.warn[e] : CFG.warn.def);


/* ---------- 音效(WebAudio 合成，接到 sound.js 的 SFX 总输出：音效音量/静音自动生效；没解锁/没有 sound.js 就静默) ---------- */
const SX = (function () {
  let c = null, o = null, nb = null;
  function ok() {
    if (!CFG.sfx || !window.SFX || !SFX.ready || !SFX.ready()) return false;
    const x = SFX.ctx(); if (!x || !SFX.out()) return false;
    if (x !== c) { c = x; o = c.createGain(); o.gain.value = CFG.sfxGain; o.connect(SFX.out()); nb = null; }
    if (!nb) { nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return true;
  }
  function env(g, t, dur, vol, atk) { atk = atk || 0.004; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  function nz(at, dur, f0, f1, vol, type) { // 噪声(滤波扫频)
    const t = c.currentTime + at, s = c.createBufferSource(); s.buffer = nb;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); env(g, t, dur, vol, 0.006);
    s.connect(f); f.connect(g); g.connect(o); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  function tn(at, type, f0, f1, dur, vol, atk) { // 音调(可滑音)
    const t = c.currentTime + at, os = c.createOscillator(); os.type = type;
    os.frequency.setValueAtTime(f0, t); if (f1 !== f0) os.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); env(g, t, dur, vol, atk); os.connect(g); g.connect(o); os.start(t); os.stop(t + dur + 0.03);
  }
  return {
    drop() { if (!ok()) return; nz(0, 0.32, 2200, 500, 0.10, 'bandpass'); tn(0, 'sine', 520, 190, 0.28, 0.05); },        // 盲盒从上面落下：嗖
    thud(v) { if (!ok()) return; tn(0, 'sine', 135, 52, 0.24, 0.55 * v); nz(0, 0.09, 600, 200, 0.28 * v); tn(0.008, 'triangle', 250, 120, 0.09, 0.12 * v); }, // 落地/弹跳：咚
    knock(v) { if (!ok()) return; tn(0, 'triangle', 540, 360, 0.055, 0.17 * v); nz(0, 0.03, 2600, 1800, 0.10 * v, 'bandpass'); }, // 晃动：木盒咯咯
    fly(dur) { if (!ok()) return; tn(0, 'sine', 300, 1150, dur, 0.09); nz(0, dur, 900, 3800, 0.07, 'bandpass'); tn(dur, 'sine', 950, 520, 0.07, 0.13); }, // 缩小飞向转盘：嗖 + 啵
    tick(v) { if (!ok()) return; const f = 600 + 950 * v; tn(0, 'triangle', f, f * 0.78, 0.04, 0.21, 0.002); nz(0, 0.014, 4200, 3000, 0.07); }, // 经过一个图标：哒(越快越尖)
    stop() { if (!ok()) return; tn(0, 'sine', 230, 120, 0.13, 0.30); tn(0, 'triangle', 880, 600, 0.06, 0.14, 0.002); },  // 转盘停下：咔
    result(res, e) { // 判定结果的反馈
      if (!ok()) return;
      if (res === 'imm') { tn(0.04, 'sine', 240, 130, 0.09, 0.18); nz(0.04, 0.08, 700, 300, 0.08); return; } // 免疫：噗
      if (res === 'can') { tn(0.04, 'sine', 400, 760, 0.16, 0.10); tn(0.04, 'sine', 760, 400, 0.16, 0.10); nz(0.18, 0.06, 900, 400, 0.06); return; } // 抵消：两边交错
      if (res === 'que') { tn(0.04, 'sine', 330, 330, 0.16, 0.13, 0.01); return; }                          // 排队：嘟
      if (res === 'ext') { tn(0.04, 'sine', 880, 880, 0.30, 0.13); tn(0.04, 'sine', 1760, 1760, 0.18, 0.04); tn(0.12, 'sine', 1175, 1175, 0.26, 0.10); return; } // 加时：叮↗
      if (e === 'speed') { [660, 880, 1320].forEach((f, i) => tn(0.04 + i * 0.075, 'triangle', f, f, 0.22, 0.13)); return; } // 加速(奖励)：上行三连音
      if (e === 'poison') { tn(0.04, 'sine', 240, 150, 0.40, 0.17); tn(0.04, 'sawtooth', 120, 80, 0.30, 0.04); nz(0.04, 0.25, 500, 200, 0.07); return; } // 中毒：下沉
      tn(0.04, 'sine', 784, 784, 0.42, 0.15); tn(0.04, 'sine', 1568, 1568, 0.22, 0.05); tn(0.11, 'sine', 988, 988, 0.34, 0.11); // 其他效果：叮咚
    }
  };
})();

/* ---------- 素材：缺图就退回 emoji，不会空白 ---------- */
const src = { big: (id) => CFG.dir + CFG.files[id] + '.png', small: (id) => CFG.dir + CFG.files[id] + '_s.png', mystery: CFG.dir + 'mystery.png' };
function mkIcon(id, px, kind) { // kind: 'small' | 'big'；id 可以是 '?'(盲盒，数据条里用的小问号)
  const emo = () => { const s = document.createElement('span'); s.textContent = EMOJI[id] || '?'; s.style.cssText = `display:inline-block;width:${px}px;height:${px}px;line-height:${px}px;font-size:${Math.round(px * 0.8)}px;text-align:center;margin-left:3px;vertical-align:-3px`; return s; };
  const im = new Image();
  im.draggable = false; im.width = px; im.height = px;
  if (id === '?') im.style.objectFit = 'contain';
  const file = id === '?' ? src.mystery : (kind === 'big' ? src.big(id) : src.small(id));
  let triedBig = false;
  im.onerror = () => {
    if (id !== '?' && kind !== 'big' && !triedBig) { triedBig = true; im.src = src.big(id); return; } // 没有 _s 小图就用大图
    im.onerror = null; if (im.parentNode) im.parentNode.replaceChild(emo(), im);
  };
  im.src = file;
  return im;
}
function mkBox(w) { // 开机盲盒大图：按素材原比例(803×841)，不压成正方形
  const im = new Image();
  im.draggable = false; im.style.cssText = 'display:block;width:100%;height:auto';
  im.onerror = () => { im.onerror = null; const s = document.createElement('span'); s.textContent = '❓'; s.style.cssText = `display:block;text-align:center;font-size:${Math.round(w * 0.6)}px;line-height:${Math.round(w * CFG.boxAsp)}px`; if (im.parentNode) im.parentNode.replaceChild(s, im); };
  im.src = src.mystery;
  return im;
}
const preload = [];
function preloadAll() { if (preload.length) return; IDS.forEach((id) => { const a = new Image(); a.src = src.small(id); const b = new Image(); b.src = src.big(id); preload.push(a, b); }); const m = new Image(); m.src = src.mystery; preload.push(m); }

/* ---------- 样式 ---------- */
const css = document.createElement('style');
css.textContent = `
#evRoll { position: fixed; z-index: 70; left: 50%; top: calc(max(env(safe-area-inset-top, 0px), 8px) + 10px); width: min(320px, 90vw); height: 60px; transform: translateX(-50%); pointer-events: none; display: none; }
#evStrip { position: absolute; inset: 0; border-radius: 30px; opacity: 0; overflow: hidden; background: rgba(40, 26, 14, 0.62); box-shadow: inset 0 0 0 1px rgba(243, 223, 178, 0.28), 0 4px 14px rgba(0, 0, 0, 0.35);
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24%, #000 76%, transparent 100%); mask-image: linear-gradient(90deg, transparent 0, #000 24%, #000 76%, transparent 100%); }
#evMark { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 14px; box-shadow: inset 0 0 0 2px rgba(242, 180, 94, 0.85); }
.evI { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; will-change: transform, opacity; }
.evI img, .evI span { display: block; width: 100%; height: 100%; }
#evBox { position: fixed; z-index: 71; pointer-events: none; display: none; opacity: 0; transform-origin: 50% 50%; will-change: transform, opacity; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45)); }
#evPop { position: fixed; z-index: 71; left: 0; top: 0; width: 150px; text-align: center; opacity: 0; pointer-events: none; display: none; will-change: transform, opacity; }
#evPop .evPi { width: 140px; height: 140px; margin: 0 auto; } #evPop .evPi img, #evPop .evPi span { display: block; width: 100%; height: 100%; }
#evPopTxt { display: block; width: 280px; margin: 2px 0 0 -65px; white-space: nowrap; font-size: 22px; font-weight: 900; letter-spacing: 0.12em; color: #fff0c8; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.75); }
.evCv { position: fixed; pointer-events: none; z-index: 30; }
#evFogHint { position: fixed; z-index: 31; pointer-events: none; text-align: center; font-size: 20px; font-weight: 900; letter-spacing: 0.15em; color: rgba(80, 90, 100, 0.85); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6); transition: opacity 0.4s; }
.mpE { display: inline-block; vertical-align: middle; } .mpE img { width: 16px; height: 16px; margin-left: 3px; vertical-align: -3px; } .mpE small { font-size: 11px; margin-left: 1px; }
.mpE .evC, .mpE .evQ { display: inline-block; }
.mpE .evQ img { width: 14px; height: 14px; margin-left: 2px; vertical-align: -2px; opacity: 0.55; filter: saturate(0.35); }
.mpE .evC.evWarn { animation: evBreath 1s ease-in-out infinite; }
@keyframes evBreath { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
`;
document.head.appendChild(css);

/* ---------- 状态 ---------- */
let C = null;                 // 上下文：Multiplayer.js 在 EV.attach 里传进来
let H = null;                 // 房主的抽签状态
let tickT = null;
let stat = {};                // 别人的状态：{c:[当前主,速度], q:[排队], rs:Map(摇奖中序号→时间), warnAt}
let N = fresh();              // 本机的效果模型
const trigSent = new Set();   // 本机已经发过触发的箱子
let cmap = null, ice = null, hid = null, fog = null, dk = null, fogOK = false, fogOKAt = 0;
/* 本机模型：cur={m:主效果|null, s:速度类|null, until:到期(performance.now), full:完整周期, x:已续命次数} ；q=[{m}]；rq=等着演出的抽签；rolling=正在演出 */
function fresh() { return { cur: null, q: [], gapAt: 0, pulse: false, rq: [], rolling: false, seen: new Set(), raf: 0, anim: null }; }
function ps(pid) { return stat[pid] || (stat[pid] = { c: [], q: [], rs: new Map(), warnAt: 0, pulse: false }); }

/* ---------- 数据条上的小图标(所有人都看得到) ---------- */
function slot(pid) { const ps_ = document.querySelectorAll('#mpBar .mpP'); for (const p of ps_) if (p.dataset.pid === pid) return p.querySelector('.mpE'); return null; }
function view(pid) {
  const now = performance.now();
  if (pid === C.myPid) {
    const cur = N.cur, c = []; if (cur) { if (cur.m) c.push(cur.m); if (cur.s) c.push(cur.s); }
    const left = cur ? cur.until - now : 0, timed = !!cur && cur.m !== 'fog' && left > 0;
    return { c, q: N.q.map((x) => x.m), rolling: N.rq.length + (N.rolling ? 1 : 0), secs: timed ? Math.ceil(left / 1000) : 0, warn: timed && left <= warnMs(cur.m || cur.s), pulse: N.pulse };
  }
  const s = ps(pid);
  s.rs.forEach((ts, k) => { if (Date.now() - ts > 20000) s.rs.delete(k); }); // 摇奖中的标记最多保留 20 秒，防止消息丢了一直显示问号
  return { c: s.c, q: s.q, rolling: s.rs.size, secs: 0, warn: s.warnAt > 0 && now >= s.warnAt, pulse: s.pulse };
}
function paintStatus(pid) {
  const el = slot(pid); if (!el || !C) return;
  const v = view(pid), q = CFG.layer3 ? v.q : [], warn = CFG.layer3 && v.warn;
  const sig = v.c.join() + '|' + q.join() + '|' + v.rolling + '|' + (v.secs > 0 ? 1 : 0);
  if (el._sig !== sig) {
    el._sig = sig; el.textContent = ''; el._c = null; el._s = null;
    if (v.c.length) { const w = document.createElement('span'); w.className = 'evC'; v.c.forEach((id) => w.appendChild(mkIcon(id, 16, 'small'))); el.appendChild(w); el._c = w; }
    if (v.secs > 0) { const s = document.createElement('small'); s.className = 'evS'; el.appendChild(s); el._s = s; }
    if (v.rolling) el.appendChild(mkIcon('?', 16, 'small'));
    if (q.length) { const w = document.createElement('span'); w.className = 'evQ'; q.forEach((id) => w.appendChild(mkIcon(id, 14, 'small'))); el.appendChild(w); }
  }
  if (v.pulse) { // 等待→当前：当前图标放大再回弹一次(不抖动、不闪)
    if (pid === C.myPid) N.pulse = false; else ps(pid).pulse = false;
    const im = el._c && el._c.firstChild, k = pid === C.myPid ? CFG.pulseMe : CFG.pulseOther;
    if (im && im.animate) im.animate([{ transform: 'scale(1)' }, { transform: 'scale(' + k + ')', offset: 0.5 }, { transform: 'scale(1)' }], { duration: CFG.pulseMs, easing: 'ease-in-out' });
  }
  if (el._s && String(v.secs) !== el._s.textContent) el._s.textContent = v.secs;
  if (el._c) el._c.classList.toggle('evWarn', !!warn);
}
function paintAll() { if (C) C.order.forEach(paintStatus); }

/* ---------- 附着 / 分离 ---------- */
function attach(c) {
  detach();
  C = c; N = fresh(); stat = {}; trigSent.clear();
  H = C.isHost ? { st: {}, pend: {}, trig: {}, seq: 0 } : null;
  preloadAll();
  tickT = setInterval(tick, 120);
  paintAll();
}
function detach() {
  stop(false);
  if (tickT) { clearInterval(tickT); tickT = null; }
  C = null; H = null; stat = {};
}

/* ---------- 触发：我把箱子推进目标点 ---------- */
function onPush(d) {
  if (!C || !d || !d.onTarget || typeof state === 'undefined' || !state || !state.mp) return;
  if (C.finished(C.myPid)) return;
  let all = true; state.targets.forEach((t) => { if (!state.boxes.has(t)) all = false; });
  if (all) return; // 最后一个箱子：马上通关，不触发
  const id = state.boxId && state.boxId[d.to];
  if (!id || trigSent.has(id)) return;
  trigSent.add(id);
  C.send({ k: 'et', b: String(id).slice(0, 12) });
}
if (typeof Bus !== 'undefined') Bus.on('push', (d) => { onPush(d); if (hid) applyHide(); });

/* ---------- 房主：抽签(只抽、不管队列) ---------- */
function bc(d) { C.bcast(d); apply(d); } // 房主发广播：自己也直接处理一遍(重复收到靠序号去重)
function livePend(v) { const m = H.pend[v]; if (!m) return 0; let n = 0; const now = Date.now(); m.forEach((ts, k) => { if (now - ts > 20000) m.delete(k); else n++; }); return n; }
function onTrigger(pid, b) {
  if (!H || !C.order.includes(pid)) return;
  b = String(b || '').slice(0, 12); if (!b) return;
  const s = H.trig[pid] || (H.trig[pid] = new Set());
  if (s.has(b) || s.size > 60) return; // 同一个箱子不能二次触发(撤销/重推也不算)
  s.add(b);
  C.order.forEach((v) => { if (v !== pid && C.online(v) && !C.finished(v)) drawFor(v); });
}
function drawFor(v) { // 每个被罚者独立抽一次；抽奖永远即时，不因效果中/队列满而暂停
  const s = H.st[v] || { c: [], q: [] }, ws = []; let tot = 0;
  IDS.forEach((id) => { let w = CFG.w[id]; if (CFG.fogBlock && id === 'fog' && s.c.includes('fog')) w = 0; else if (s.c.includes(id) || s.q.includes(id)) w *= CFG.downW; ws.push([id, w]); tot += w; }); // 降权×0.7(不排除)；唯一例外：当前正带着迷雾时不再抽迷雾(雾基本擦完了，重置计时对残留的雾没意义)；排队里的迷雾不算，照常降权
  let r = Math.random() * tot, e = ws[ws.length - 1][0];
  for (const [id, w] of ws) { if ((r -= w) < 0) { e = id; break; } }
  const idle = !s.c.length && !s.q.length && livePend(v) === 0; // 盲盒只在完全空闲时播：没效果、没转盘在转、没排队
  const n = ++H.seq; (H.pend[v] || (H.pend[v] = new Map())).set(n, Date.now());
  bc({ k: 'rl', t: v, e, n, b: (!CFG.layer3 || idle) ? 1 : 0 });
}
const okIds = (a) => (Array.isArray(a) ? a : []).filter((x) => IDS.includes(x)).slice(0, 3);
function onState(from, d) { // 被罚者汇报状态：房主记下(抽签降权/盲盒判断用)并转发全体
  const c = okIds(d.c), q = okIds(d.q), r = (typeof d.r === 'number' && d.r >= 0) ? Math.min(60000, d.r | 0) : -1;
  H.st[from] = { c, q };
  if (d.z) H.pend[from] = new Map(); else if (d.l && H.pend[from]) H.pend[from].delete(d.l | 0);
  bc({ k: 'es', i: from, c, q, r, l: d.l | 0, z: d.z ? 1 : 0 });
}

/* ---------- 消息入口(Multiplayer.js 的 onGame 转进来) ---------- */
function onMsg(d, from) {
  if (!C || !d) return;
  if (d.k === 'et') { if (H) onTrigger(from, d.b); }
  else if (d.k === 'st') { if (H && C.order.includes(from)) onState(from, d); }
  else if ((d.k === 'rl' || d.k === 'es') && from === C.hostPid) apply(d);
}
function apply(d) { // 所有人(含房主自己)都跑：更新数据条；轮到我就排进演出队列
  if (d.k === 'rl') {
    const t = String(d.t), n = d.n | 0;
    if (!C.order.includes(t) || !IDS.includes(d.e)) return;
    if (t === C.myPid) {
      if (N.seen.has(n)) return;
      N.seen.add(n);
      if (C.finished(C.myPid)) return;
      N.rq.push({ e: d.e, n, box: !!d.b });
      if (typeof paused !== 'undefined' && paused && typeof setPause === 'function') setPause(false); // 菜单开着就先收起
      if (typeof clearHold === 'function') clearHold();
      if (typeof clearUndoHold === 'function') clearUndoHold();
      pump(); paintStatus(t);
    } else { ps(t).rs.set(n, Date.now()); paintStatus(t); }
  } else if (d.k === 'es') {
    const i = String(d.i);
    if (!C.order.includes(i) || i === C.myPid) return; // 自己的图标自己管
    const s = ps(i), c = okIds(d.c), pc = s.c[0], pq = s.q;
    if (c[0] && c[0] !== pc && pq.includes(c[0])) s.pulse = true; // 等待节点上位
    s.c = c; s.q = okIds(d.q);
    s.warnAt = (typeof d.r === 'number' && d.r >= 0 && c.length) ? performance.now() + d.r - warnMs(c[0]) : 0;
    if (d.z) s.rs.clear(); else if (d.l) s.rs.delete(d.l | 0);
    paintStatus(i);
  }
}

/* ---------- 本机：节点模型(R1~R10) ---------- */
function report(l, z) { // 把本机状态告诉房主(房主转发全体)
  if (!C) return;
  const cur = N.cur, c = []; if (cur) { if (cur.m) c.push(cur.m); if (cur.s) c.push(cur.s); }
  const m = { k: 'st', c, q: N.q.map((x) => x.m), r: (cur && cur.m !== 'fog') ? Math.max(0, Math.round(cur.until - performance.now())) : -1 };
  if (l) m.l = l; if (z) m.z = 1;
  C.send(m);
}
function changed(l) { report(l); if (C) paintStatus(C.myPid); }
function startMain(m) {
  if (m === 'chaos') mkChaos();
  else if (m === 'ice') ice = { sliding: false, d: null, n: 0 };
  else if (m === 'fog') startFog();
  else if (m === 'blackout') startDark();
  else if (m === 'invisible') startInvisible();
  if (typeof clearHold === 'function') clearHold();
}
function setSlide(on) { if (ice) ice.sliding = on; }
function stopMain() { setSlide(false); cmap = null; ice = null; stopFog(); stopDark(); stopInvisible(); }
function endNode() { // 当前节点结束(含它的速度部分)
  stopMain(); N.cur = null;
  N.gapAt = N.q.length ? performance.now() + gapMs() : 0;
  changed();
}
function promote() { // 队列最前面的纯主效果上场；若当前只有速度类，就并进去(时长取后来者)
  const h = N.q.shift(); if (!h) return;
  const now = performance.now(); N.gapAt = 0;
  const full = D(h.m); // 从自己的完整基础时长开始计时(排队期间不消耗)
  if (N.cur) { N.cur.m = h.m; N.cur.full = full; N.cur.until = now + full; } else N.cur = { m: h.m, s: null, until: now + full, full, x: 0 };
  N.pulse = true; // 数据条图标放大回弹一次(等待→当前的入场提示)
  startMain(h.m); changed();
}
function enqueue(e) { // 不同类型的主效果：排队；满了顶掉当前，队列前进一格，新的入队尾
  const item = { m: e };
  if (N.q.length >= CFG.queueMax) {
    if (N.cur && N.cur.m) { stopMain(); N.cur = null; promote(); N.q.push(item); return 'bump'; } // 被顶掉的当前节点连同速度部分一起结束
    N.q.shift(); N.q.push(item); return 'que'; // 当前没有主效果：牺牲最前面排队的那个
  }
  N.q.push(item); return 'que';
}
function resolve(e) { // 转盘落定那一刻的判定，返回结果码：new 新开 / mrg 并入当前 / que 排队 / bump 顶掉当前 / ext 续命 / imm 免疫 / can 抵消
  const now = performance.now(), cur = N.cur;
  if (cur && (cur.m === e || cur.s === e)) { // 同类再命中：只看当前节点；队列里的节点不参与(不合并、不续命)
    if (cur.x >= CFG.extMax) return 'imm';
    cur.x++; cur.until += cur.full * CFG.extra; // 增加量=节点完整周期的50%(不是剩余时间的)
    return 'ext';
  }
  if (isSpd(e)) {
    if (cur && cur.s === opp(e)) { cur.s = null; if (!cur.m) endNode(); return 'can'; } // 互相清零，不补偿不刷新，新事件被消耗
    if (!cur) { N.cur = { m: null, s: e, until: now + D(e), full: D(e), x: 0 }; return 'new'; }
    cur.s = e;
    if (cur.m) cur.until = now + cur.full; // 组合：丢弃旧计时器，按主效果完整基础时长重新计时(迷雾的画面状态不动，雾继续按新计时器走)
    return 'mrg';
  }
  if (!(cur && cur.m) && N.q.length === 0) { // 空闲或只有速度类，且没人排队：直接上场
    if (cur) { cur.m = e; cur.full = D(e); cur.until = now + cur.full; startMain(e); return 'mrg'; }
    N.cur = { m: e, s: null, until: now + D(e), full: D(e), x: 0 }; startMain(e); return 'new';
  }
  return enqueue(e);
}
function land(r) { const res = resolve(r.e); changed(r.n); return res; }
function pump() { // 演出排队：同一时刻只有一个转盘在转，后来的等前一个亮相结束
  if (N.rolling || !N.rq.length || !C) return;
  const r = N.rq.shift(); N.rolling = true;
  playRoll(r, () => land(r), () => { N.rolling = false; paintStatus(C.myPid); pump(); });
}
function stop(sendEnd) { // 对局结束/通关/重来：收掉所有东西(R7：当事人已通关=当前节点和整条队列全部清空)
  cancelRoll(); stopMain();
  N.cur = null; N.q = []; N.rq = []; N.rolling = false; N.gapAt = 0;
  if (C) { paintStatus(C.myPid); if (sendEnd) C.send({ k: 'st', c: [], q: [], r: -1, z: 1 }); }
}
function tick() {
  if (!C) return;
  const now = performance.now(), cur = N.cur;
  if (cur) {
    const left = cur.until - now;
    if (cur.m === 'invisible') applyHide();
    if (cur.m === 'fog') {
      if (fog && !fogOK) { if (coverage() >= CFG.fogNeed || left <= 0) unlockFog(); }
      else if (fogOK && now >= fogOKAt + CFG.fogFadeMs && (!cur.s || left <= 0)) endNode(); // 单独的迷雾：淡完就结束；带速度类：控制时间走完才结束
    } else if (left <= 0) {
      if (!(cur.m === 'ice' && ice && ice.sliding && left > -3000)) endNode(); // 溜冰滑到一半先滑完(最多多等 3 秒)
    }
  }
  if (!(N.cur && N.cur.m) && N.q.length) { // 间隔到了，下一个排队节点上场
    if (!N.gapAt) N.gapAt = now + gapMs();
    if (now >= N.gapAt) promote();
  }
  paintAll();
}

/* ---------- 开机 + 摇奖动画(纯本机表现；判定在转盘落定那一刻) ---------- */
let rollDom = null;
function ensureRollDom() {
  if (rollDom) return rollDom;
  const roll = document.createElement('div'); roll.id = 'evRoll';
  roll.innerHTML = '<div id="evStrip"><div id="evMark"></div></div>';
  document.body.appendChild(roll);
  const box = document.createElement('div'); box.id = 'evBox'; document.body.appendChild(box);
  const pop = document.createElement('div'); pop.id = 'evPop';
  pop.innerHTML = '<div class="evPi"></div><div id="evPopTxt"></div>';
  document.body.appendChild(pop);
  rollDom = { roll, box, pop, strip: $('evStrip'), items: [] };
  return rollDom;
}
function cancelRoll() {
  if (N.raf) { cancelAnimationFrame(N.raf); N.raf = 0; }
  if (N.anim) { try { N.anim.cancel(); } catch (e) {} N.anim = null; }
  if (rollDom) { rollDom.roll.style.display = 'none'; rollDom.box.style.display = 'none'; rollDom.pop.style.display = 'none'; rollDom.pop.style.opacity = 0; }
}
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
function bounce(p) { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; }
function playRoll(r, onLand, done) {
  const R = ensureRollDom(), e = r.e, K = r.box ? CFG.long : CFG.short;
  R.roll.style.display = 'block'; R.strip.style.transition = ''; R.strip.style.opacity = 0; R.strip.style.transform = 'scaleX(0.3)';
  R.strip.querySelectorAll('.evI').forEach((x) => x.remove());
  const S = 58, P = IDS.length * S, laps = 3, idx = IDS.indexOf(e);
  R.items = IDS.map((id) => { const w = document.createElement('div'); w.className = 'evI'; w.appendChild(mkIcon(id, 44, 'small')); R.strip.appendChild(w); return w; });
  const rr = R.roll.getBoundingClientRect(), scx = rr.left + rr.width / 2, scy = rr.top + rr.height / 2;
  let bw = 0, bh = 0, cy0 = 0, dy = 0, sEnd = 1;
  if (r.box) { // 大盲盒：先在上部大大地落下来，再缩小飞向转盘的位置
    bw = Math.min(CFG.boxW, window.innerWidth * CFG.boxVw); bh = bw * CFG.boxAsp;
    cy0 = rr.top + bh / 2 + 4; dy = scy - cy0; sEnd = Math.min(1, 54 / bw);
    R.box.textContent = ''; R.box.appendChild(mkBox(bw));
    R.box.style.cssText = `display:block;opacity:0;left:${scx - bw / 2}px;top:${cy0 - bh / 2}px;width:${bw}px;transform:translateY(${-(cy0 + bh)}px)`;
  } else R.box.style.display = 'none';
  const T1 = K.drop, T2 = T1 + K.shake, T3 = T2 + K.fly, T4 = T3 + K.roll;
  const dist = (laps * IDS.length + idx) * S;
  const t0 = performance.now();
  const fl = {}; let lastK = 0, lastTk = 0; // 音效：一次性触发标记 / 转盘经过的图标计数 / 上一声哒的时刻
  const layout = (x) => R.items.forEach((w, i) => {
    let d = (((i * S - x) % P) + P) % P; if (d > P / 2) d -= P;
    const a = Math.min(1, Math.abs(d) / (2.6 * S)), o = Math.min(1, Math.abs(d) / (3.2 * S));
    const sc = 1.2 - 0.7 * a, yy = Math.pow(d / S, 2) * 2.5;
    w.style.transform = `translate(${d}px, ${yy}px) scale(${sc})`; w.style.opacity = String(1 - 0.85 * o); w.style.zIndex = String(Math.round(sc * 10));
  });
  layout(0);
  const frame = () => {
    if (!N.rolling || !C) return;
    const t = performance.now() - t0;
    if (t < T1) {
      const p = t / T1;
      if (!fl.d) { fl.d = 1; SX.drop(); }
      if (!fl.h1 && p >= 0.364) { fl.h1 = 1; SX.thud(1); } if (!fl.h2 && p >= 0.727) { fl.h2 = 1; SX.thud(0.5); } if (!fl.h3 && p >= 0.909) { fl.h3 = 1; SX.thud(0.28); } // 三次落地/弹跳(对应 bounce 曲线)
      R.box.style.opacity = 1; R.box.style.transform = `translateY(${-(cy0 + bh) * (1 - bounce(p))}px)`; }
    else if (t < T2) {
      const p = (t - T1) / K.shake;
      const k = Math.floor((p * 20 - Math.PI / 2) / Math.PI) + 1; // 每摆到一边一声
      while ((fl.k || 0) < k && (fl.k || 0) < 6) { fl.k = (fl.k || 0) + 1; SX.knock(Math.max(0.35, 1 - p)); }
      R.box.style.opacity = 1; R.box.style.transform = `rotate(${Math.sin(p * 20) * 9 * (1 - p)}deg) scale(${1 + 0.04 * Math.sin(p * Math.PI)})`; }
    else if (t < T3) {
      const p = (t - T2) / K.fly;
      if (r.box && !fl.f) { fl.f = 1; SX.fly(K.fly / 1000); }
      let so = p;
      if (r.box) { const k = easeInOut(p); R.box.style.opacity = p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.4); R.box.style.transform = `translateY(${dy * k}px) scale(${1 - (1 - sEnd) * k})`; so = Math.max(0, (p - 0.35) / 0.65); }
      R.strip.style.opacity = so; R.strip.style.transform = `scaleX(${0.3 + 0.7 * so})`;
    } else if (t < T4) {
      R.box.style.display = 'none'; R.strip.style.opacity = 1; R.strip.style.transform = 'scaleX(1)';
      const q = (t - T3) / K.roll, x = dist * easeOutCubic(q), k = Math.floor(x / S + 0.5); // 经过一个图标响一声哒；速度越快音越尖、越密，快到一帧过好几个就合并
      layout(x);
      if (k > lastK) { lastK = k; if (t - lastTk >= 28) { lastTk = t; SX.tick(Math.pow(1 - q, 2)); } }
    } else {
      layout(dist); N.raf = 0;
      SX.stop();
      const res = onLand(); SX.result(res, e);
      popBig(e, res, K, done); return; // 转盘落定：判定就在这一刻做
    }
    N.raf = requestAnimationFrame(frame);
  };
  N.raf = requestAnimationFrame(frame);
}
function popText(e, res) {
  const L = lang(), nm = NAME[L][e];
  if (res === 'imm' || res === 'can') return TXT[L][res];
  if (res === 'ext' || res === 'que') return nm + ' · ' + TXT[L][res];
  return nm;
}
function popBig(e, res, K, done) { // 结果亮相 → 缩小飞进数据条里自己的位置
  const R = ensureRollDom();
  const r = R.roll.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.bottom + 90;
  R.pop.style.display = 'block'; R.pop.style.left = (cx - 75) + 'px'; R.pop.style.top = (cy - 75) + 'px';
  const pi = R.pop.querySelector('.evPi'); pi.textContent = ''; pi.appendChild(mkIcon(e, 140, 'big'));
  $('evPopTxt').textContent = popText(e, res);
  R.strip.style.transition = 'opacity 0.2s'; R.strip.style.opacity = 0;
  let tx = 0, ty = -160, ts = 0.1;
  const sl = slot(C.myPid);
  if (sl) { const s = sl.getBoundingClientRect(), sr = s.width ? s : sl.parentNode.getBoundingClientRect(); tx = sr.left + 8 - cx; ty = sr.top + sr.height / 2 - cy; ts = 16 / 150; }
  const tot = K.popIn + K.popHold + K.popOut, a = K.popIn / tot, b = (K.popIn + K.popHold) / tot;
  R.pop.style.opacity = 1;
  const fin = () => { N.anim = null; R.pop.style.display = 'none'; R.pop.style.opacity = 0; R.roll.style.display = 'none'; R.strip.style.transition = ''; done(); };
  if (!R.pop.animate) { setTimeout(fin, tot); return; }
  N.anim = R.pop.animate([
    { transform: 'scale(0.35)', opacity: 0, offset: 0 },
    { transform: 'scale(1.1)', opacity: 1, offset: a * 0.75, easing: 'ease-out' },
    { transform: 'scale(1)', opacity: 1, offset: a },
    { transform: 'scale(1)', opacity: 1, offset: b },
    { transform: `translate(${tx}px, ${ty}px) scale(${ts})`, opacity: 0.25, offset: 1, easing: 'ease-in' }
  ], { duration: tot, fill: 'forwards' });
  N.anim.onfinish = fin;
}

/* ---------- 效果：混乱 ---------- */
function mkChaos() {
  const Dd = ['up', 'down', 'left', 'right']; let p;
  do { p = shuffle(Dd.slice()); } while (p.some((x, i) => x === Dd[i])); // 没有任何方向对应到自己
  cmap = {}; Dd.forEach((d, i) => { cmap[d] = p[i]; });
}
function remap(dr, dc, dir) {
  if (C && N.cur && N.cur.m === 'chaos' && cmap && cmap[dir] && typeof DIR_DELTA !== 'undefined') { const nd = cmap[dir], v = DIR_DELTA[nd]; return [v[0], v[1], nd]; }
  return [dr, dc, dir];
}

/* ---------- 效果：溜冰(走一步滑到底；撞墙停；撞箱子推一格后停，箱子“稳住”人) ----------
   动画：迈出第一脚后定格这个迈脚帧一路滑，撞停后由主文件自带的静止收拢切回站立(=收脚)；
   起步加速：第 n 格的步时长=基础×iceAccel[n]，之后匀速、撞停瞬间直接停；玩家和镜头本来就是线性过渡(style.css)，同步靠 --move-dur；镜头前瞻拉长。 */
function input(dr, dc, dir) {
  if (!C || !N.cur || N.cur.m !== 'ice' || !ice) return false;
  if (ice.sliding || state.moveLock) return true; // 滑行中/一步没走完：输入丢掉
  const pushing = state.boxes.has((state.player.r + dr) + ',' + (state.player.c + dc));
  const before = state.moves;
  if (!pushing) { ice.d = [dr, dc, dir]; ice.n = 0; setSlide(true); } // 先标记再走：第一步的迈脚就是定格帧
  tryMove(dr, dc, dir);
  if (state.moves > before && !pushing) ice.n = 1; else setSlide(false); // 撞墙/推箱子：不滑
  return true;
}
function slideStep() {
  if (!ice || !ice.sliding || !N.cur || N.cur.m !== 'ice') return false;
  const [dr, dc, dir] = ice.d, nr = state.player.r + dr, nc = state.player.c + dc, nk = nr + ',' + nc;
  if (ice.n >= 80) { setSlide(false); return false; }
  if (state.walls.has(nk)) { setSlide(false); tryMove(dr, dc, dir); return false; } // 撞墙：让 tryMove 走它自己的撞墙反馈
  if (state.boxes.has(nk)) {
    setSlide(false);
    const bk = (nr + dr) + ',' + (nc + dc);
    if (state.walls.has(bk) || state.boxes.has(bk)) { tryMove(dr, dc, dir); return false; } // 推不动：撞停
    tryMove(dr, dc, dir); return true; // 推一格，然后停
  }
  const before = state.moves;
  tryMove(dr, dc, dir); // 这一步的时长由 durMul 按 ice.n 决定
  if (state.moves === before) { setSlide(false); return false; } // 没走成(被锁住了)：别卡在滑行状态
  ice.n++; return true;
}
const iceMul = () => { const t = CFG.iceAccel; return t[Math.min(ice.n, t.length - 1)]; };

/* ---------- 效果：隐身(未落位的箱子里一半——向上取整——看不见，但还能推) ---------- */
function startInvisible() {
  const un = []; state.boxes.forEach((k) => { if (!state.targets.has(k)) un.push((state.boxId && state.boxId[k]) || k); });
  shuffle(un); hid = new Set(un.slice(0, Math.ceil(un.length / 2)));
  applyHide();
}
function applyHide() {
  if (typeof state === 'undefined' || !state || !state.boxEls) return;
  for (const k in state.boxEls) {
    const el = state.boxEls[k], id = (state.boxId && state.boxId[k]) || k;
    el.style.visibility = (hid && hid.has(id) && !state.targets.has(k)) ? 'hidden' : ''; // 推进目标点就现身
  }
}
function stopInvisible() { if (hid) { hid = null; applyHide(); } }

/* ---------- 画布覆盖层的位置：盖在棋盘视窗上 ---------- */
function mkCanvas(scale) {
  const r = $('board-wrap').getBoundingClientRect();
  const cv = document.createElement('canvas'); cv.className = 'evCv';
  cv.style.left = r.left + 'px'; cv.style.top = r.top + 'px'; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  cv.width = Math.max(2, Math.round(r.width * scale)); cv.height = Math.max(2, Math.round(r.height * scale));
  document.body.appendChild(cv);
  return { cv, g: cv.getContext('2d'), w: r.width, h: r.height, scale };
}

/* ---------- 效果：关灯(手电筒扇形光区，跟着朝向，边缘淡出) ---------- */
function startDark() {
  dk = mkCanvas(0.5); dk.ang = null;
  const loop = () => { if (!dk) return; drawDark(); dk.raf = requestAnimationFrame(loop); };
  loop();
}
function drawDark() {
  const r = $('board-wrap').getBoundingClientRect();
  if (Math.abs(r.width - dk.w) > 2 || Math.abs(r.height - dk.h) > 2) { const old = dk; document.body.removeChild(old.cv); const n = mkCanvas(0.5); n.ang = old.ang; n.raf = old.raf; dk = n; }
  const g = dk.g, pr = $('playerEl').getBoundingClientRect();
  const px = pr.left + pr.width / 2 - r.left, py = pr.top + pr.height / 2 - r.top, tile = Math.max(24, pr.width);
  const v = (typeof DIR_DELTA !== 'undefined' && DIR_DELTA[state.dir]) || [1, 0];
  const ta = Math.atan2(v[0], v[1]);
  if (dk.ang === null) dk.ang = ta;
  let df = ta - dk.ang; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI;
  dk.ang += df * 0.3;
  g.setTransform(dk.scale, 0, 0, dk.scale, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, dk.w, dk.h);
  g.fillStyle = 'rgba(0,0,0,0.94)'; g.fillRect(0, 0, dk.w, dk.h);
  g.globalCompositeOperation = 'destination-out';
  const R = tile * 4.6, rad = Math.PI / 180;
  [44, 34, 24, 14].forEach((deg) => { // 四层叠出来：中间亮、两侧角度上渐暗
    g.beginPath(); g.moveTo(px, py); g.arc(px, py, R, dk.ang - deg * rad, dk.ang + deg * rad); g.closePath();
    const gr = g.createRadialGradient(px, py, tile * 0.3, px, py, R);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.65, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fill();
  });
  const fr = g.createRadialGradient(px, py, 0, px, py, tile * 0.9); // 脚下一小圈，免得完全迷失
  fr.addColorStop(0, 'rgba(0,0,0,0.9)'); fr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fr; g.beginPath(); g.arc(px, py, tile * 0.9, 0, 2 * Math.PI); g.fill();
}
function stopDark() { if (dk) { if (dk.raf) cancelAnimationFrame(dk.raf); if (dk.cv.parentNode) dk.cv.parentNode.removeChild(dk.cv); dk = null; } }

/* ---------- 效果：迷雾(手指擦开，擦到 80% 才能走，剩下的慢慢淡去) ---------- */
function startFog() {
  fogOK = false;
  const f = mkCanvas(1), g = f.g, w = f.w, h = f.h;
  g.fillStyle = 'rgb(208,216,224)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 34; i++) { // 云团：深浅不一的软圆
    const x = Math.random() * w, y = Math.random() * h, rr = 50 + Math.random() * 90, light = Math.random() < 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, light ? 'rgba(255,255,255,0.55)' : 'rgba(150,162,176,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  f.cv.style.pointerEvents = 'auto'; f.cv.style.touchAction = 'none'; f.cv.style.opacity = '0.97'; f.cv.style.zIndex = 31;
  const mw = Math.max(8, Math.round(w / 10)), mh = Math.max(8, Math.round(h / 10));
  const mk = document.createElement('canvas'); mk.width = mw; mk.height = mh;
  const mg = mk.getContext('2d', { willReadFrequently: true }); mg.fillStyle = '#fff'; mg.fillRect(0, 0, mw, mh);
  const hint = document.createElement('div'); hint.id = 'evFogHint'; hint.textContent = lang() === 'en' ? 'Wipe the fog!' : '用手擦开迷雾！';
  const rr = $('board-wrap').getBoundingClientRect(); hint.style.left = rr.left + 'px'; hint.style.width = rr.width + 'px'; hint.style.top = (rr.top + rr.height * 0.42) + 'px';
  document.body.appendChild(hint);
  fog = { f, mk, mg, mw, mh, hint, last: null, id: null };
  const pos = (e) => { const b = f.cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const erase = (x, y, x0, y0) => {
    g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000'; g.lineWidth = 48;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke();
    const kx = mw / w, ky = mh / h;
    mg.globalCompositeOperation = 'destination-out'; mg.lineCap = 'round'; mg.strokeStyle = '#000'; mg.lineWidth = 48 * kx;
    mg.beginPath(); mg.moveTo(x0 * kx, y0 * ky); mg.lineTo(x * kx, y * ky); mg.stroke();
    hint.style.opacity = 0;
  };
  f.cv.addEventListener('pointerdown', (e) => { if (fogOK) return; fog.id = e.pointerId; try { f.cv.setPointerCapture(e.pointerId); } catch (x) {} const [x, y] = pos(e); fog.last = [x, y]; erase(x, y, x, y); e.preventDefault(); });
  f.cv.addEventListener('pointermove', (e) => { if (fog && fog.id === e.pointerId && fog.last && !fogOK) { const [x, y] = pos(e); erase(x, y, fog.last[0], fog.last[1]); fog.last = [x, y]; } });
  const up = (e) => { if (fog && fog.id === e.pointerId) { fog.id = null; fog.last = null; } };
  f.cv.addEventListener('pointerup', up); f.cv.addEventListener('pointercancel', up);
}
function coverage() {
  if (!fog) return 0;
  const d = fog.mg.getImageData(0, 0, fog.mw, fog.mh).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) n++;
  return n / (fog.mw * fog.mh);
}
function unlockFog() { // 擦够了(或到了最长时间)：可以操作，剩下的雾淡去；单独的迷雾淡完就结束(tick 里判断)
  if (!fog || fogOK) return;
  fogOK = true; fogOKAt = performance.now();
  const cv = fog.f.cv; cv.style.pointerEvents = 'none'; cv.style.transition = `opacity ${CFG.fogFadeMs}ms ease`; cv.style.opacity = '0';
  fog.hint.style.opacity = 0;
}
function stopFog() {
  if (fog) { if (fog.f.cv.parentNode) fog.f.cv.parentNode.removeChild(fog.f.cv); if (fog.hint.parentNode) fog.hint.parentNode.removeChild(fog.hint); fog = null; }
  fogOK = false;
}

/* ---------- 给核心用的钩子 ---------- */
const spdOf = (cur) => cur.s || ((cur.m === 'speed' || cur.m === 'poison') ? cur.m : null); // 第二层关掉时速度类是主效果
window.EV = {
  attach, detach, stop, onMsg,
  locked: () => !!C && (N.rolling || N.rq.length > 0 || !!N.cur || N.q.length > 0), // 演出中、效果中、排队中都锁
  moveLock: () => !!C && !!N.cur && N.cur.m === 'fog' && !fogOK,
  noHold: () => !!C && !!N.cur && (N.cur.m === 'chaos' || N.cur.m === 'ice'),
  durMul: () => { if (!C || !N.cur) return 1; const s = spdOf(N.cur); let m = s === 'poison' ? CFG.poisonMul : s === 'speed' ? CFG.speedMul : 1; if (ice && ice.sliding) m *= iceMul(); return m; },
  gaitFreeze: () => (C && ice && ice.sliding) ? (ice.n === 0 ? 1 : 2) : 0, // 给 advanceGait：0 正常；1 迈出第一脚(照常换脚、不插收脚帧)；2 滑行中(定格，不换脚)
  camLead: (base) => (C && ice && ice.sliding) ? CFG.iceLead : base,          // 给 updateCamera：滑行时镜头多往前看
  remap, input, slideStep,
  cfg: CFG
};
})();
