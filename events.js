/* events.js — v1.28.0 联机随机事件：落位触发 → 房主给其他人各抽一次 → 被罚者摇奖 → 效果 → 回报房主 → 房主通知全员(玩家数据条上的小图标)。
   只依赖 Multiplayer.js 的 EV.attach(ctx) / EV.onMsg / EV.stop / EV.detach，以及 index.html 里的几个钩子：
     EV.locked()    撤销/重来/地图菜单键：从收到抽签结果起到效果结束全部锁住(防止撤销逃避惩罚)
     EV.moveLock()  迷雾没擦到 80% 前不能走
     EV.noHold()    混乱/溜冰时不允许按住连走
     EV.durMul()    步时长倍率(中毒×2、加速×0.5)，setMoveDur 里乘上
     EV.remap()     混乱：tryMove 开头换方向(在写走法日志之前，续局重放才不会乱)
     EV.input()     溜冰：requestMove 里接管输入
     EV.slideStep() 溜冰：每一步走完的锁到期时继续滑
   ── 消息(都很短) ──
     et 玩家→房主  {b:箱子ID}                     我把一个箱子推进了目标点
     rl 房主→全体  {t:被罚者, e:事件, n:序号, d:时长ms, c:抵消标记}   抽签结果(全体据此在数据条显示 ❓)
     eb 被罚者→房主 {n}                           摇奖完，效果开始
     ed 被罚者→房主 {n}                           效果结束
     es 房主→全体  {i:谁, e:事件|0, n}            状态更新(效果开始 / 结束)
   房主每个被罚者一条队列：同一时刻只跑一个效果，待执行最多 1 个，两个效果之间隔 GAP_MS。 */
(function () {
'use strict';

/* ---------- 可调参数(概率 / 时长 / 倍率都在这) ---------- */
const CFG = {
  dir: 'assets/events/',
  files: { chaos: 'confusion', blackout: 'lights_out', invisible: 'invisible', poison: 'poison', fog: 'fog', speed: 'speed', ice: 'ice' },
  w:   { speed: 10, chaos: 18, blackout: 16, poison: 16, ice: 14, fog: 14, invisible: 12 }, // 抽中权重(加速是奖励，最低)
  dur: { speed: 5000, chaos: 6000, blackout: 6000, poison: 6000, ice: 4000, fog: 7000, invisible: 7000 }, // 毫秒；迷雾=最长擦拭时间
  speedAfterPoison: 3000, // 中毒期间抽到加速：解毒 + 这么久的加速
  poisonMul: 2, speedMul: 0.5, // 步时长倍率：中毒慢一倍，加速快一倍
  fogNeed: 0.8, fogFadeMs: 1800, // 迷雾：擦到这个比例后可操作，剩下的雾这么久淡完
  gapMs: 2000,  // 两个效果之间的间隔
  queueMax: 1,  // 每人待执行上限
  box: 250, shake: 300, open: 200, roll: 1600, popIn: 220, popHold: 350, popOut: 280 // 开机动画各段(ms)
};
const ROLL_TOTAL = CFG.box + CFG.shake + CFG.open + CFG.roll + CFG.popIn + CFG.popHold + CFG.popOut;
const IDS = Object.keys(CFG.files);
const EMOJI = { chaos: '🌀', blackout: '🔦', invisible: '👻', poison: '☠️', fog: '🌫️', speed: '⚡', ice: '🧊', '?': '❓' };
const NAME = {
  zh: { chaos: '混乱', blackout: '关灯', invisible: '隐身', poison: '中毒', fog: '迷雾', ice: '溜冰', speed: '加速' },
  en: { chaos: 'Chaos', blackout: 'Lights out', invisible: 'Ghost boxes', poison: 'Poison', fog: 'Fog', ice: 'Ice', speed: 'Speed up' }
};
const $ = (id) => document.getElementById(id);
const lang = () => (document.documentElement.dataset.lang === 'en' ? 'en' : 'zh');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- 素材：缺图就退回 emoji，不会空白 ---------- */
const src = { big: (id) => CFG.dir + CFG.files[id] + '.png', small: (id) => CFG.dir + CFG.files[id] + '_s.png', mystery: CFG.dir + 'mystery.png' };
function mkIcon(id, px, kind) { // kind: 'small' | 'big'；id 可以是 '?'(盲盒)
  const emo = () => { const s = document.createElement('span'); s.textContent = EMOJI[id] || '?'; s.style.cssText = `display:inline-block;width:${px}px;height:${px}px;line-height:${px}px;font-size:${Math.round(px * 0.8)}px;text-align:center`; return s; };
  const im = new Image();
  im.draggable = false; im.width = px; im.height = px;
  const file = id === '?' ? src.mystery : (kind === 'big' ? src.big(id) : src.small(id));
  let triedBig = false;
  im.onerror = () => {
    if (id !== '?' && kind !== 'big' && !triedBig) { triedBig = true; im.src = src.big(id); return; } // 没有 _s 小图就用大图
    im.onerror = null; if (im.parentNode) im.parentNode.replaceChild(emo(), im);
  };
  im.src = file;
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
#evBox { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; opacity: 0; will-change: transform, opacity; }
#evBox img, #evBox span { display: block; width: 100%; height: 100%; }
#evPop { position: fixed; z-index: 71; left: 0; top: 0; width: 150px; text-align: center; opacity: 0; pointer-events: none; display: none; will-change: transform, opacity; }
#evPop .evPi { width: 140px; height: 140px; margin: 0 auto; } #evPop .evPi img, #evPop .evPi span { display: block; width: 100%; height: 100%; }
#evPopTxt { margin-top: 2px; font-size: 22px; font-weight: 900; letter-spacing: 0.12em; color: #fff0c8; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.75); }
.evCv { position: fixed; pointer-events: none; z-index: 30; }
#evFogHint { position: fixed; z-index: 31; pointer-events: none; text-align: center; font-size: 20px; font-weight: 900; letter-spacing: 0.15em; color: rgba(80, 90, 100, 0.85); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6); transition: opacity 0.4s; }
.mpE { display: inline-block; vertical-align: middle; } .mpE img, .mpE > span:not(.evS) { width: 16px; height: 16px; margin-left: 3px; vertical-align: -3px; font-size: 13px; line-height: 16px; } .mpE small { font-size: 11px; margin-left: 1px; }
`;
document.head.appendChild(css);

/* ---------- 状态 ---------- */
let C = null;                 // 上下文：Multiplayer.js 在 EV.attach 里传进来
let H = null;                 // 房主的抽签/队列状态
let tickT = null;
let stat = {};                // 每个人当前的状态：0=无，'?'=摇奖中，事件 id=效果中
let me = fresh();             // 本机的效果状态
const trigSent = new Set();   // 本机已经发过触发的箱子
let cmap = null, ice = null, hid = null, fog = null, dk = null, fogOK = false, fogEndT = null;
function fresh() { return { ph: 'idle', e: null, n: 0, dur: 0, until: 0, lastN: 0, raf: 0, anim: null }; }

/* ---------- 数据条上的小图标(所有人都看得到) ---------- */
function slot(pid) { const ps = document.querySelectorAll('#mpBar .mpP'); for (const p of ps) if (p.dataset.pid === pid) return p.querySelector('.mpE'); return null; }
function paintStatus(pid) {
  const el = slot(pid); if (!el || !C) return;
  const v = stat[pid] || 0;
  const secs = (pid === C.myPid && me.ph === 'on' && me.e !== 'fog') ? Math.ceil(Math.max(0, me.until - performance.now()) / 1000) : 0;
  const sig = v + '|' + secs;
  if (el._sig === sig) return;
  el._sig = sig; el.textContent = '';
  if (!v) return;
  el.appendChild(mkIcon(v === '?' ? '?' : v, 16, 'small'));
  if (secs) { const s = document.createElement('small'); s.className = 'evS'; s.textContent = secs; el.appendChild(s); }
}
function paintAll() { if (C) C.order.forEach(paintStatus); }

/* ---------- 附着 / 分离 ---------- */
function attach(c) {
  detach();
  C = c; me = fresh(); stat = {}; trigSent.clear();
  H = C.isHost ? { busy: {}, q: {}, trig: {}, seq: 0, timers: {} } : null;
  preloadAll();
  tickT = setInterval(tick, 120);
  paintAll();
}
function detach() {
  stop(false);
  if (H) Object.values(H.timers).forEach((t) => clearTimeout(t));
  if (tickT) { clearInterval(tickT); tickT = null; }
  C = null; H = null; stat = {};
}

/* ---------- 触发：我把箱子推进目标点 ---------- */
function onPush(d) {
  if (!C || !d || !d.onTarget || typeof state === 'undefined' || !state || !state.mp) return;
  if (me.ph !== 'idle' || C.finished(C.myPid)) { /* 受罚中也能触发，下面不拦；只有已完成才不发 */ }
  if (C.finished(C.myPid)) return;
  let all = true; state.targets.forEach((t) => { if (!state.boxes.has(t)) all = false; });
  if (all) return; // 最后一个箱子：马上通关，不触发
  const id = state.boxId && state.boxId[d.to];
  if (!id || trigSent.has(id)) return;
  trigSent.add(id);
  C.send({ k: 'et', b: String(id).slice(0, 12) });
}
if (typeof Bus !== 'undefined') Bus.on('push', (d) => { onPush(d); if (hid) applyHide(); });

/* ---------- 房主：抽签 / 队列 ---------- */
function bc(d) { C.bcast(d); apply(d); } // 房主发广播：自己也直接处理一遍(重复收到靠序号去重)
function pickEvent(excl) {
  const ws = []; let tot = 0;
  for (const id of IDS) { if (excl.has(id)) continue; ws.push([id, CFG.w[id]]); tot += CFG.w[id]; }
  let r = Math.random() * tot;
  for (const [id, w] of ws) { if ((r -= w) < 0) return id; }
  return ws.length ? ws[ws.length - 1][0] : 'chaos';
}
function onTrigger(pid, b) {
  if (!H || !C.order.includes(pid)) return;
  b = String(b || '').slice(0, 12); if (!b) return;
  const s = H.trig[pid] || (H.trig[pid] = new Set());
  if (s.has(b) || s.size > 60) return; // 同一个箱子不能二次触发(撤销/重推也不算)
  s.add(b);
  C.order.forEach((v) => { if (v !== pid && C.online(v) && !C.finished(v)) drawFor(v); });
}
function drawFor(v) { // 每个被罚者独立抽一次
  const bz = H.busy[v], q = H.q[v] || (H.q[v] = []);
  const excl = new Set();
  if (bz && bz.e) excl.add(bz.e);
  q.forEach((x) => excl.add(x.e));
  if (C.total - C.placedOf(v) <= 1) excl.add('invisible'); // 只剩最后一个箱子：不抽隐身
  const e = pickEvent(excl);
  if (!bz) { dispatch(v, e, false); return; }
  if (e === 'speed' && bz.e === 'poison' && bz.begun) { dispatch(v, e, true); return; } // 加速遇中毒：解毒 + 缩短版加速
  if (q.length < CFG.queueMax) q.push({ e }); // 队列满了就丢掉
}
function dispatch(v, e, cancel) {
  H.seq++;
  const n = H.seq, d = cancel ? CFG.speedAfterPoison : CFG.dur[e];
  if (H.timers[v]) clearTimeout(H.timers[v]);
  H.busy[v] = { e, n, begun: false };
  H.timers[v] = setTimeout(() => endOf(v, n), ROLL_TOTAL + d + CFG.fogFadeMs + 3000); // 兜底：被罚者断线/被杀后台时不让队列卡死
  bc({ k: 'rl', t: v, e, n, d, c: cancel ? 1 : 0 });
}
function onBegin(pid, n) {
  const bz = H && H.busy[pid];
  if (!bz || bz.n !== n) return;
  bz.begun = true;
  bc({ k: 'es', i: pid, e: bz.e, n });
}
function endOf(pid, n) {
  if (!H) return;
  const bz = H.busy[pid];
  if (!bz || bz.n !== n) return;
  if (H.timers[pid]) clearTimeout(H.timers[pid]);
  H.busy[pid] = { e: null, gap: true };
  bc({ k: 'es', i: pid, e: 0, n });
  H.timers[pid] = setTimeout(() => {
    if (!H) return;
    delete H.busy[pid]; delete H.timers[pid];
    const nx = (H.q[pid] || []).shift();
    if (nx && C.online(pid) && !C.finished(pid)) dispatch(pid, nx.e, false);
  }, CFG.gapMs);
}

/* ---------- 消息入口(Multiplayer.js 的 onGame 转进来) ---------- */
function onMsg(d, from) {
  if (!C || !d) return;
  if (d.k === 'et') { if (H) onTrigger(from, d.b); }
  else if (d.k === 'eb') { if (H && C.order.includes(from)) onBegin(from, d.n | 0); }
  else if (d.k === 'ed') { if (H && C.order.includes(from)) endOf(from, d.n | 0); }
  else if ((d.k === 'rl' || d.k === 'es') && from === C.hostPid) apply(d);
}
function apply(d) { // 所有人(含房主自己)都跑：更新数据条；轮到我就开始摇奖
  if (d.k === 'rl') {
    const t = String(d.t);
    if (!C.order.includes(t) || !IDS.includes(d.e)) return;
    if (t === C.myPid) {
      if ((d.n | 0) === me.lastN) return;
      me.lastN = d.n | 0;
      stat[t] = '?'; paintStatus(t);
      startRoll(d.e, d.n | 0, Math.max(1000, Math.min(12000, d.d | 0)), !!d.c);
    } else { stat[t] = '?'; paintStatus(t); }
  } else if (d.k === 'es') {
    const i = String(d.i);
    if (!C.order.includes(i) || i === C.myPid) return; // 自己的图标自己管
    stat[i] = IDS.includes(d.e) ? d.e : 0; paintStatus(i);
  }
}

/* ---------- 本机：摇奖 → 效果 ---------- */
function startRoll(e, n, d, cancel) {
  if (cancel && me.ph === 'on') endEffect(true); // 抵消中毒：不回报(序号已经换了)
  if (me.ph !== 'idle') return;
  me.ph = 'roll'; me.e = e; me.n = n; me.dur = d;
  if (typeof paused !== 'undefined' && paused && typeof setPause === 'function') setPause(false); // 菜单开着就先收起
  if (typeof clearHold === 'function') clearHold();
  if (typeof clearUndoHold === 'function') clearUndoHold();
  playRoll(e, beginEffect);
}
function beginEffect() {
  if (me.ph !== 'roll') return;
  const e = me.e;
  me.ph = 'on';
  me.until = performance.now() + (e === 'fog' ? CFG.dur.fog : me.dur);
  stat[C.myPid] = e; paintStatus(C.myPid);
  C.send({ k: 'eb', n: me.n });
  if (e === 'chaos') mkChaos();
  else if (e === 'ice') ice = { sliding: false, d: null, steps: 0 };
  else if (e === 'fog') startFog();
  else if (e === 'blackout') startDark();
  else if (e === 'invisible') startInvisible();
  if (typeof clearHold === 'function') clearHold();
}
function endEffect(silent) {
  const n = me.n;
  cmap = null; ice = null;
  stopFog(); stopDark(); stopInvisible();
  me.ph = 'idle'; me.e = null;
  if (C) { stat[C.myPid] = 0; paintStatus(C.myPid); if (!silent) C.send({ k: 'ed', n }); }
}
function stop(sendEnd) { // 对局结束/通关/重来：收掉所有东西
  cancelRoll();
  if (me.ph === 'on') endEffect(!sendEnd);
  else if (me.ph === 'roll') { const n = me.n; me.ph = 'idle'; me.e = null; if (sendEnd && C) C.send({ k: 'ed', n }); if (C) { stat[C.myPid] = 0; paintStatus(C.myPid); } }
}
function tick() {
  if (!C) return;
  if (me.ph !== 'on') return;
  const left = me.until - performance.now();
  if (me.e === 'invisible') applyHide();
  if (me.e === 'fog') {
    if (fog && !fogOK) { if (coverage() >= CFG.fogNeed || left <= 0) unlockFog(); }
  } else if (left <= 0) {
    if (me.e === 'ice' && ice && ice.sliding && left > -3000) return; // 滑到一半先滑完(最多多等 3 秒)
    endEffect(false); return;
  }
  paintStatus(C.myPid);
}

/* ---------- 开机 + 摇奖动画 ---------- */
let rollDom = null;
function ensureRollDom() {
  if (rollDom) return rollDom;
  const roll = document.createElement('div'); roll.id = 'evRoll';
  roll.innerHTML = '<div id="evStrip"><div id="evMark"></div></div><div id="evBox"></div>';
  document.body.appendChild(roll);
  const pop = document.createElement('div'); pop.id = 'evPop';
  pop.innerHTML = '<div class="evPi"></div><div id="evPopTxt"></div>';
  document.body.appendChild(pop);
  rollDom = { roll, pop, strip: $('evStrip'), box: $('evBox'), items: [] };
  return rollDom;
}
function cancelRoll() {
  if (me.raf) { cancelAnimationFrame(me.raf); me.raf = 0; }
  if (me.anim) { try { me.anim.cancel(); } catch (e) {} me.anim = null; }
  if (rollDom) { rollDom.roll.style.display = 'none'; rollDom.pop.style.display = 'none'; rollDom.pop.style.opacity = 0; }
}
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
function bounce(p) { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; }
function playRoll(e, done) {
  const D = ensureRollDom();
  D.roll.style.display = 'block'; D.strip.style.opacity = 0; D.strip.style.transform = 'scaleX(0.3)';
  D.box.textContent = ''; D.box.appendChild(mkIcon('?', 56, 'small')); D.box.style.opacity = 0;
  D.strip.querySelectorAll('.evI').forEach((x) => x.remove());
  const S = 58, P = IDS.length * S, laps = 3, idx = IDS.indexOf(e);
  D.items = IDS.map((id) => { const w = document.createElement('div'); w.className = 'evI'; w.appendChild(mkIcon(id, 44, 'small')); D.strip.appendChild(w); return w; });
  const T1 = CFG.box, T2 = T1 + CFG.shake, T3 = T2 + CFG.open, T4 = T3 + CFG.roll;
  const dist = (laps * IDS.length + idx) * S;
  const t0 = performance.now();
  const layout = (x) => D.items.forEach((w, i) => {
    let d = (((i * S - x) % P) + P) % P; if (d > P / 2) d -= P;
    const a = Math.min(1, Math.abs(d) / (2.6 * S)), o = Math.min(1, Math.abs(d) / (3.2 * S));
    const sc = 1.2 - 0.7 * a, yy = Math.pow(d / S, 2) * 2.5;
    w.style.transform = `translate(${d}px, ${yy}px) scale(${sc})`; w.style.opacity = String(1 - 0.85 * o); w.style.zIndex = String(Math.round(sc * 10));
  });
  layout(0);
  const frame = () => {
    if (me.ph !== 'roll') return;
    const t = performance.now() - t0;
    if (t < T1) { const p = t / T1; D.box.style.opacity = 1; D.box.style.transform = `translateY(${-70 * (1 - bounce(p))}px)`; }
    else if (t < T2) { const p = (t - T1) / CFG.shake; D.box.style.opacity = 1; D.box.style.transform = `rotate(${Math.sin(p * 18) * 11 * (1 - p)}deg)`; }
    else if (t < T3) {
      const p = (t - T2) / CFG.open;
      D.box.style.opacity = 1 - p; D.box.style.transform = `scale(${1 + 0.3 * Math.sin(p * Math.PI) * (1 - p) + (0 - 0) })`;
      D.strip.style.opacity = p; D.strip.style.transform = `scaleX(${0.3 + 0.7 * p})`;
    } else if (t < T4) {
      D.box.style.opacity = 0; D.strip.style.opacity = 1; D.strip.style.transform = 'scaleX(1)';
      layout(dist * easeOutCubic((t - T3) / CFG.roll));
    } else {
      layout(dist); me.raf = 0;
      popBig(e, done); return;
    }
    me.raf = requestAnimationFrame(frame);
  };
  me.raf = requestAnimationFrame(frame);
}
function popBig(e, done) { // 结果亮相 → 缩小飞进数据条里自己的位置
  const D = ensureRollDom();
  const r = D.roll.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.bottom + 90;
  D.pop.style.display = 'block'; D.pop.style.left = (cx - 75) + 'px'; D.pop.style.top = (cy - 75) + 'px';
  const pi = D.pop.querySelector('.evPi'); pi.textContent = ''; pi.appendChild(mkIcon(e, 140, 'big'));
  $('evPopTxt').textContent = NAME[lang()][e];
  D.strip.style.transition = 'opacity 0.2s'; D.strip.style.opacity = 0;
  let tx = 0, ty = -160, ts = 0.1;
  const sl = slot(C.myPid);
  if (sl) { const s = sl.getBoundingClientRect(), sr = s.width ? s : sl.parentNode.getBoundingClientRect(); tx = sr.left + 8 - cx; ty = sr.top + sr.height / 2 - cy; ts = 16 / 150; }
  const tot = CFG.popIn + CFG.popHold + CFG.popOut, a = CFG.popIn / tot, b = (CFG.popIn + CFG.popHold) / tot;
  D.pop.style.opacity = 1;
  const fin = () => { me.anim = null; D.pop.style.display = 'none'; D.pop.style.opacity = 0; D.roll.style.display = 'none'; D.strip.style.transition = ''; done(); };
  if (!D.pop.animate) { setTimeout(fin, tot); return; }
  me.anim = D.pop.animate([
    { transform: 'scale(0.35)', opacity: 0, offset: 0 },
    { transform: 'scale(1.1)', opacity: 1, offset: a * 0.75, easing: 'ease-out' },
    { transform: 'scale(1)', opacity: 1, offset: a },
    { transform: 'scale(1)', opacity: 1, offset: b },
    { transform: `translate(${tx}px, ${ty}px) scale(${ts})`, opacity: 0.25, offset: 1, easing: 'ease-in' }
  ], { duration: tot, fill: 'forwards' });
  me.anim.onfinish = fin;
}

/* ---------- 效果：混乱 ---------- */
function mkChaos() {
  const D = ['up', 'down', 'left', 'right']; let p;
  do { p = shuffle(D.slice()); } while (p.some((x, i) => x === D[i])); // 没有任何方向对应到自己
  cmap = {}; D.forEach((d, i) => { cmap[d] = p[i]; });
}
function remap(dr, dc, dir) {
  if (me.ph === 'on' && me.e === 'chaos' && cmap && cmap[dir] && typeof DIR_DELTA !== 'undefined') { const nd = cmap[dir], v = DIR_DELTA[nd]; return [v[0], v[1], nd]; }
  return [dr, dc, dir];
}

/* ---------- 效果：溜冰(走一步滑到底；撞墙停；撞箱子推一格后停，箱子“稳住”人) ---------- */
function input(dr, dc, dir) {
  if (!C || me.ph !== 'on' || me.e !== 'ice' || !ice) return false;
  if (ice.sliding || state.moveLock) return true; // 滑行中/一步没走完：输入丢掉
  const pushing = state.boxes.has((state.player.r + dr) + ',' + (state.player.c + dc));
  const before = state.moves;
  tryMove(dr, dc, dir);
  if (state.moves > before && !pushing) { ice.sliding = true; ice.d = [dr, dc, dir]; ice.steps = 1; }
  return true;
}
function slideStep() {
  if (!ice || !ice.sliding || me.ph !== 'on') return false;
  const [dr, dc, dir] = ice.d, nr = state.player.r + dr, nc = state.player.c + dc, nk = nr + ',' + nc;
  if (ice.steps >= 80) { ice.sliding = false; return false; }
  if (state.walls.has(nk)) { ice.sliding = false; tryMove(dr, dc, dir); return false; } // 撞墙：让 tryMove 走它自己的撞墙反馈
  if (state.boxes.has(nk)) {
    ice.sliding = false;
    const bk = (nr + dr) + ',' + (nc + dc);
    if (state.walls.has(bk) || state.boxes.has(bk)) { tryMove(dr, dc, dir); return false; } // 推不动：撞停
    tryMove(dr, dc, dir); return true; // 推一格，然后停
  }
  const before = state.moves;
  ice.steps++; tryMove(dr, dc, dir);
  if (state.moves === before) { ice.sliding = false; return false; } // 没走成(被锁住了)：别卡在滑行状态
  return true;
}

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
function unlockFog() { // 擦够了(或到了最长时间)：可以操作，剩下的雾淡去，淡完效果结束
  if (!fog || fogOK) return;
  fogOK = true;
  const cv = fog.f.cv; cv.style.pointerEvents = 'none'; cv.style.transition = `opacity ${CFG.fogFadeMs}ms ease`; cv.style.opacity = '0';
  fog.hint.style.opacity = 0;
  fogEndT = setTimeout(() => { fogEndT = null; if (me.ph === 'on' && me.e === 'fog') endEffect(false); }, CFG.fogFadeMs + 100);
}
function stopFog() {
  if (fogEndT) { clearTimeout(fogEndT); fogEndT = null; }
  if (fog) { if (fog.f.cv.parentNode) fog.f.cv.parentNode.removeChild(fog.f.cv); if (fog.hint.parentNode) fog.hint.parentNode.removeChild(fog.hint); fog = null; }
  fogOK = false;
}

/* ---------- 给核心用的钩子 ---------- */
window.EV = {
  attach, detach, stop, onMsg,
  locked: () => !!C && me.ph !== 'idle',
  moveLock: () => !!C && me.ph === 'on' && me.e === 'fog' && !fogOK,
  noHold: () => !!C && me.ph === 'on' && (me.e === 'chaos' || me.e === 'ice'),
  durMul: () => (C && me.ph === 'on' ? (me.e === 'poison' ? CFG.poisonMul : me.e === 'speed' ? CFG.speedMul : 1) : 1),
  remap, input, slideStep,
  cfg: CFG
};
})();
