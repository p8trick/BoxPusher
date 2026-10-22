/* coop.js — 双人同屏合作(骨架)：房主权威的共享棋盘 + 事件流 + 定期快照兜底。
   规则在 coop_rules.js(纯逻辑)；本文件管：同步协议、把规范状态映射到单机核心的画面(转置)、同伴角色、暂停/断线/通关。
   不碰 PeerJS，只经 window.LAN_NET；整局由 Multiplayer.js 的几个入口(onRoom/onGame/onStatus/onClosed/onLeave/blocked/…)转给 window.COOP 接管。
   加载顺序：… → Multiplayer.js → levels_coop.js → coop_rules.js → coop.js。

   ── 同步(玩家只说「想往哪走」，房主裁判) ──
   玩家按键 → 本机先用副本试探(撞墙/推不动/被人挡：当场弹开，不发)；能走就发 ci{d,s} 给房主(房主自己直接判定)。
   房主 step() 判定：成功 → v+1 → 广播 cm{i,d,v,to,b,bt,s}(谁、往哪、第几步、结果位置、被推箱子 id/新位置)，各端用同一套规则推演并播动画(房主本机经回环走同一条视觉路径)；
   没走成(撞墙/推不动/被人挡，包括两人同一瞬间抢同一格后到的那个)→ 房主只改这个人的朝向，序号 +1，广播 cf{i,d,v,w,s}：所有人都看到他转身并撞一下(失误也看得见)；本人自己的屏幕不等网络，按键当场就转身撞一下，收到自己的 cf 时不重复播。
   后撤(v1.39)：每人只撤自己最近的一步，最多 UNDO_MAX 步；栈只在房主(C.ustk[人])，请求 cx → 房主按 coop_rules.js 的 undoCheck 检查(还站在原地/退回的格子空着/推过的箱子还在) → 通过就广播 cu(带 fr/to/b/bt，各端用同一规则复核后播后撤动画)，不通过就广播 cn(只有请求的人有反应：撤销键抖动 + 错误提示音)；总步数跟着减 1(撤掉的那一步不再算)，撤销次数 G.un 另记，结算卡片显示。栈随房主存档一起存(us)，恢复后还能撤；cs 快照带 ul=各人还能撤几步，玩家据此在按住连撤时知道何时停。
   互推(v1.37/1.38)：走向对方角色=把他推开一格，规则在 coop_rules.js 的 step：对方正面面对我就顶住(推不动)，没正面对着我才推得动(身后空地)；cm 里多带 pp/pt=被推的人和他的新格子。惯性(纯画面)：被推的人在这一步滑动期间按方向转身面对推他的人，所有人屏幕上都立刻看到他转身(不延迟)，但这次转身不弹(cf 带 q=1：只转身，不顶一下也不放撞击音)，推人的人照常把这一步推完，被推的人面对着对方倒退滑到位停下；滑完之后双方面对面，谁再推就按「正面面对=顶住」回弹。房主用 C.inertia 判定「是不是被推的那一步滑动期间的转身」，被推的人本机用 C.pushed 同样预判(不用等房主回执)。
   每 SNAP_MS 房主广播一次整盘快照 cs{v,n,p,b}；玩家端：序号落后/同号但状态不同=跑偏 → 对齐(只让「对不上」的角色/箱子淡出再在正确位置淡入，没变的不动)。
   cm 自带校验：跳号/推演结果和房主给的不一致 → 当场 cq 请求快照，不等下一个周期。常态下快照触发次数应当是 0，不是 0 就是规则/消息处理有 bug，要修源头。
   重连/解除暂停：房主立刻补发快照。房主每步把整盘状态存本机(被杀后从「恢复游戏」回到同一局)；玩家不用存，回来要一份快照即可。
   重开：只有房主能点；房主发 cr{v}，全体重置(v 只增不减，快照比较不受影响)。
   进度/下一关(v1.40)：进度只存「房主这台设备」(localStorage boxpusher_co_prog_v1：已通关 id 集合 + 续玩位置 last)，解锁=已通关的最大序号+1 之内全开(按关卡 id 记，换序不错锁)；
   通关后房主记进度并 setStart(下一关)；结算卡片上玩家「准备好了，下一关」(setNext)、房主「下一关」(startNext，不倒计时)；onRoom 见到「卡片开着+新局编号 mid」就 end()+start() 无缝开下一关。

   ── 显示 ──
   规范状态按横屏行列存，快照/事件永远用规范坐标。显示默认不转置(TRANSPOSE='off')：各设备只按屏幕大小缩放，两台设备上棋盘方向一致；设成 'auto' 则竖屏设备(!isWideLayout)在 toXsb 和方向键两处转置(手机上格子更大，但和横屏设备的样子不一样)，状态本身不转置。单机核心的 state 只是「本机视角的投影」：
   我的角色 = core 的 state.player(走路动画/镜头/连走全部复用)，箱子 = state.boxes，同伴 = 本文件另画的 #partnerEl(class 沿用 .player/.sprite，样式全靠 style.css；皮肤用 base.js 的 loadSkin/skinKey/spriteURL，帧换脚逻辑照核心的 advanceGait 简化)。
   核心里只有几处钩子：tryMove/undo 开头(合作时改走 COOP.intent/undo)、renderBoardStructure/renderDynamic 末尾(afterBuild/afterRender)、holdStep(同伴当障碍)。 */
(function () {
'use strict';

const R = window.COOP_RULES;
const $ = (id) => document.getElementById(id);
const net = () => window.LAN_NET || null;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TRANSPOSE = 'off';     // 竖屏设备是否把地图行列互换后显示：'auto'=竖屏转置(手机上格子更大，但和横屏设备上的样子不一样)；'off'=永远不转置(两台设备画面方向一致，宽地图在手机上格子会小)
const UNDO_MAX = 10;          // 每人最多能连续撤销的步数(撤销栈深度)；撤销会减相应的总步数，另记撤销次数
const SNAP_MS = 2000;          // 房主广播整盘快照的间隔(只是兜底；正常情况下对不上的次数应当是 0)
const END_MS = 900;            // 最后一步落位后停一下，再弹通关卡片
const FADE_MS = 200;           // 对齐时「对不上」的角色/箱子淡出淡入各用多久
const BAR_ROW_H = 18;
const SNAP_KEY = 'boxpusher_co_snap_v1', SNAP_TTL = 30 * 60 * 1000;

/* ---------- 文案 ---------- */
Object.assign(I18N.zh, {
  coWin: '合作通关！', coStat: (time, n, u) => `用时 ${time} · ${n}步` + (u > 0 ? ` · 撤销${u}次` : ''), coHostOnly: '重来由房主决定', coBadRoom: '双人合作需要恰好 2 名玩家',
  coNext: '下一关', coReady: '准备好了，下一关', coReadied: '已准备（点击取消）', coWaitReady: '等待对方准备', coPeerLobby: '对方已回大厅', coPeerOff: '对方已掉线', coAllClear: '全部通关！', coLvToast: (n) => `第 ${n} 关`,
});
Object.assign(I18N.en, {
  coWin: 'Teamwork!', coStat: (time, n, u) => `Time ${time} · ${n} mv` + (u > 0 ? ` · ${u} undo${u > 1 ? 's' : ''}` : ''), coHostOnly: 'Only the host can restart', coBadRoom: 'Co-op needs exactly 2 players',
  coNext: 'Next level', coReady: 'Ready for next', coReadied: 'Ready (tap to cancel)', coWaitReady: 'Waiting for partner', coPeerLobby: 'Partner is in the lobby', coPeerOff: 'Partner is offline', coAllClear: 'All levels cleared!', coLvToast: (n) => `Level ${n}`,
});

/* ---------- 样式(数据条/提示卡复用 Multiplayer.js 里的 .mpP .mpN .mpDot .mpCard .mrBtn) ---------- */
const css = document.createElement('style');
css.textContent = `
#coBar { display: flex; align-items: center; justify-content: center; gap: 10px; width: min(94vw, 460px); margin: 4px auto 0; font-size: 12px; font-weight: 800; line-height: ${BAR_ROW_H}px;
  color: rgba(255, 255, 255, 0.92); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); font-variant-numeric: tabular-nums; -webkit-user-select: none; user-select: none; }
#coBar .mpP { max-width: none; }
#coBar .coMv { min-width: 48px; text-align: center; }
#coBar .coDbg { flex: none; font-size: 10px; font-weight: 700; color: #9fd66b; }
#coModal { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.5); visibility: hidden; pointer-events: none; }
#coModal.show { visibility: visible; pointer-events: auto; }
#coModal .mrBtn.main { display: block; width: 100%; margin: 6px 0 0; }
#coModal .mrBtn.on { background: linear-gradient(180deg, rgba(242, 180, 94, 0.34), rgba(242, 180, 94, 0.16)); border-color: rgba(242, 180, 94, 0.7); }
#coModal .mrBtn.dis { opacity: 0.5; pointer-events: none; }
#coModal .mrBtn.sub { display: block; min-width: 0; height: 34px; margin: 10px auto 0; padding: 0 18px; font-size: 13px; letter-spacing: 0.06em; text-indent: 0.06em; background: none; box-shadow: none; border-color: rgba(243, 223, 178, 0.3); color: #d9c08a; }
.coHeads { display: flex; justify-content: center; gap: 22px; margin: 2px 0 10px; }
.coHeads span { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 13px; font-weight: 800; color: #f6e8c4; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
document.head.appendChild(css);

/* ---------- 状态 ---------- */
let C = null;             // 当前合作对局；null=不在合作对局里
let skipPlaying = false;  // 本轮 playing 已处理过(缺关卡等)：房间回到非 playing 之前不再重复开局
let modalKey = '';
let coNo = 0;
let undoToastAt = 0;

/* ---------- 同步诊断(只记录，不改任何逻辑)：环形缓冲 + 异常标记；联机诊断面板(lobby)里的「合作同步」一段由 diagText() 给出 ---------- */
const TR = [], TR_MAX = 90, TB = [], TB_MAX = 40; // TR=最近的所有操作；TB=异常记录(单独存，不会被正常操作挤掉)
const TR_BAD = { drift: 1, mismatch: 1, gap: 1, stale: 1, 'late-bump': 1, 'pred-bump-moved': 1 };
const TRS = { stat: null, lv: '', host: false, rttSum: 0, rttN: 0, rttMax: 0, stale: 0 };
function trace(k, o) {
  try {
    const e = Object.assign({ t: Date.now(), k, v: C ? C.G.v : -1 }, o || {});
    if (TR_BAD[k]) { // 异常：连同它前面的 6 条操作一起存(时刻差/类型/谁/方向)，方便看是什么节奏下出的事
      let p = e.t; e.pre = TR.slice(-6).map((x) => { const q = '+' + (e.t - x.t) + ' ' + x.k + (x.i !== undefined ? x.i : '') + (x.d || ''); p = x.t; return q; }).join(' | ');
      TB.push(e); if (TB.length > TB_MAX) TB.shift();
    }
    TR.push(e); if (TR.length > TR_MAX) TR.shift();
  } catch (err) { /* 诊断不能影响对局 */ }
}
function snapDiff(G, d) { // 本机状态和房主快照具体哪里不一样
  try {
    const s0 = R.snapshot(G), o = [];
    Object.keys(d).forEach((k) => { if (k === 'k' || k === 'v' || k === 'ul') return; const a = JSON.stringify(s0[k]), b = JSON.stringify(d[k]); if (a !== b) o.push(k + ' 本机' + a + ' 房主' + b); });
    return (o.join(' ; ') || '(只有序号不同)').slice(0, 260);
  } catch (e) { return '?'; }
}
function diagText() {
  try {
    const st = TRS.stat; if (!st) return '';
    const ms = (t) => new Date(t).toTimeString().slice(0, 8) + '.' + String(t % 1000).padStart(3, '0');
    const out = ['合作同步 · ' + (TRS.host ? '房主' : '玩家') + ' · 关卡 ' + TRS.lv + (C ? '' : '(已结束)')];
    out.push('消息 cm' + st.cm + ' cf' + st.bump + ' · Δ跑偏 ' + st.drift + ' · 跳号 ' + st.gap + ' · 旧消息丢弃 ' + TRS.stale + (TRS.rttN ? ' · 回执 平均' + Math.round(TRS.rttSum / TRS.rttN) + 'ms 最大' + TRS.rttMax + 'ms' : ''));
    const bad = TB;
    out.push(bad.length ? '异常记录(最近 ' + Math.min(12, bad.length) + ' 条)：' : '异常记录：无(没有跑偏/跳号/推演对不上)');
    bad.slice(-12).forEach((e) => { const r = Object.assign({}, e); delete r.t; delete r.k; delete r.pre; out.push(' ' + ms(e.t) + ' ' + e.k + ' ' + JSON.stringify(r).slice(0, 300)); if (e.pre) out.push('    此前(距此刻ms)：' + e.pre); });
    out.push('最近操作(时刻 +距上一条ms 类型 谁/方向/序号)：');
    let prev = 0;
    TR.slice(-16).forEach((e) => { out.push(' ' + ms(e.t) + ' +' + (prev ? e.t - prev : 0) + ' ' + e.k + (e.i !== undefined ? ' i' + e.i : '') + (e.d ? ' ' + e.d : '') + ' v' + e.v + (e.rtt !== undefined ? ' rtt' + e.rtt : '')); prev = e.t; });
    return out.join('\n');
  } catch (e) { return '合作同步诊断出错：' + (e && e.message); }
}

function findLevel(id) {
  const pk = window.COOP_LEVEL_PACK;
  if (!pk || !Array.isArray(pk.levels)) return null;
  return pk.levels.find((lv) => lv && lv.id === id && typeof lv.xsb === 'string') || null;
}

/* 规范坐标 ↔ 本机视角(竖屏转置) */
const vk = (rc) => C.tr ? [rc[1], rc[0]] : [rc[0], rc[1]];
const vkey = (rc) => { const v = vk(rc); return v[0] + ',' + v[1]; };
const vword = (d) => R.toView(d, C.tr);

function fmtTime(ms) { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function skinMain(skin) { const c = (typeof SKIN_COLORS !== 'undefined' && SKIN_COLORS[skin]) || null; return c && /^#[0-9a-fA-F]{6}$/.test(c[0]) ? c[0] : ''; }
function chipText(hex) { // 和 Multiplayer.js 同一套：色块上的字在白/深色里选对比度高的
  const n = parseInt(hex.slice(1), 16), lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.062 ? '#ffffff' : '#2a1a0c';
}
function nameChip(pid) {
  const hex = skinMain(C.skins[pid]), st = hex ? ` style="background:${hex};color:${chipText(hex)}"` : '';
  const ab = Array.from(String(C.names[pid] || '')).slice(0, 2).join('').toUpperCase() || '?';
  return `<b class="mpN"${st}>${esc(ab)}</b>`;
}

/* ---------- 关卡进度(只存房主这台设备；按关卡 id 记，换序/插关不错锁) ---------- */
const PROG_KEY = 'boxpusher_co_prog_v1', ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
function coLevels() { const pk = window.COOP_LEVEL_PACK; return pk && Array.isArray(pk.levels) ? pk.levels.filter((l) => l && typeof l.id === 'string' && typeof l.xsb === 'string') : []; }
function loadProg() {
  try {
    const o = JSON.parse(localStorage.getItem(PROG_KEY) || 'null'), done = {};
    if (o && typeof o === 'object') {
      if (o.done && typeof o.done === 'object') Object.keys(o.done).forEach((k) => { if (ID_RE.test(k)) done[k] = 1; });
      return { done, last: typeof o.last === 'string' && ID_RE.test(o.last) ? o.last : '' };
    }
  } catch (e) { /* 存档损坏当没有 */ }
  return { done: {}, last: '' };
}
function saveProg(p) { try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch (e) { /* 存不了就算了 */ } }
function levelIdx(id) { return coLevels().findIndex((l) => l.id === id); }
function unlockedCount() { const pr = loadProg(); let m = -1; coLevels().forEach((l, i) => { if (pr.done[l.id]) m = i; }); return Math.min(coLevels().length, m + 2); } // 序号 < 返回值 的关都已解锁(一关都没通=只开第 1 关)
function isUnlocked(id) { const i = levelIdx(id); return i >= 0 && i < unlockedCount(); }
function isDone(id) { return !!loadProg().done[id]; }
function startId() { // 默认起点=续玩位置的下一关(到了最后一关就停在最后一关)；没有记录=第 1 关
  const lv = coLevels(); if (!lv.length) return '';
  const li = levelIdx(loadProg().last), want = li < 0 ? 0 : Math.min(li + 1, lv.length - 1);
  return lv[Math.max(0, Math.min(want, unlockedCount() - 1))].id;
}
function nextId(id) { const lv = coLevels(), i = lv.findIndex((l) => l.id === id); return i >= 0 && i + 1 < lv.length ? lv[i + 1].id : ''; }
function markDone(id) { const pr = loadProg(); pr.done[id] = 1; pr.last = id; saveProg(pr); }

/* ---------- DOM ---------- */
function ensureDom() {
  if ($('coModal')) return;
  const m = document.createElement('div');
  m.id = 'coModal';
  document.body.appendChild(m);
}
function buildBar() {
  let bar = $('coBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'coBar'; $('levelInfo').after(bar); }
  const me = C.order[C.myIdx], other = C.order[C.oi];
  bar.innerHTML = `<span class="mpP me" data-pid="${esc(me)}"><i class="mpDot"></i>${nameChip(me)}</span><span class="coMv"></span>` +
    `<span class="mpP" data-pid="${esc(other)}"><i class="mpDot"></i>${nameChip(other)}</span><span class="coDbg"></span>`;
}
function dotClass(pid) {
  if (pid === C.myPid) return C.netBad ? 'bad' : 'good';
  const pl = C.room.players.find((p) => p.pid === pid);
  if (!pl || pl.online === false) return 'off';
  return pid === C.hostPid && C.netBad ? 'bad' : 'good';
}
function paintBar() { // 只改文字节点和类名，不重绘(B24)
  const bar = $('coBar');
  if (!C || !bar) return;
  bar.querySelectorAll('.mpP').forEach((el) => { el.querySelector('.mpDot').className = 'mpDot ' + dotClass(el.dataset.pid); });
  bar.querySelector('.coMv').textContent = t('mpSteps', C.G.moves);
  const dbg = bar.querySelector('.coDbg');
  if (typeof progress !== 'undefined' && progress && progress.debugMode) { // 开发者模式：显示 intent→回执延迟(玩家端)、对齐次数、序号，真机测观感用
    const s = C.stat; dbg.textContent = `${C.isHost ? '' : 'rtt ' + (s.rtt < 0 ? '-' : s.rtt + 'ms') + ' '}Δ${s.drift} #${C.G.v}`;
  } else dbg.textContent = '';
}
function paintModal() { // 优先级：通关卡片 > 本机断线 > 别人掉线的暂停；内容没变不重绘
  const el = $('coModal');
  if (!el) return;
  let key = '', html = '';
  const card = (title, sub, btns, extra) => `<div class="mpCard"><h3>${esc(title)}</h3>${extra || ''}<p>${esc(sub || '')}</p>${btns.map(([k, a]) => `<button class="mrBtn" data-act="${a}">${esc(t(k))}</button>`).join('')}</div>`;
  if (C && C.res) {
    const byPid = (pid) => C.room.players.find((p) => p.pid === pid), me = byPid(C.myPid), other = byPid(C.order[C.oi]), host = byPid(C.hostPid), nid = C.res.nid;
    const head = (pid) => `<span>${(window.Lobby && Lobby.headHTML) ? Lobby.headHTML(C.skins[pid], 40, C.genders[pid]) : ''}${esc(C.names[pid] || '?')}</span>`;
    const btn = (label, act, cls) => `<button class="mrBtn ${cls || ''}"${act ? ` data-act="${act}"` : ' disabled'}>${esc(label)}</button>`;
    let st = '', btns = '';
    if (!nid) { st = 'end'; btns = btn(t('lbBackLobby'), 'back'); } // 最后一关：只剩返回大厅
    else if (C.isHost) {
      if (!other || other.online === false) { st = 'off'; btns = btn(t('coPeerOff'), '', 'main dis'); }
      else if (!other.inResult) { st = 'lob'; btns = btn(t('coPeerLobby'), '', 'main dis'); }
      else if (!other.nx) { st = 'wait'; btns = btn(t('coWaitReady'), '', 'main dis'); }
      else { st = 'go'; btns = btn(t('coNext'), 'next', 'main'); }
      btns += btn(t('lbBackLobby'), 'back', 'sub');
    } else if (!host || host.online === false || !host.inResult) { st = 'hb'; btns = btn(t('lbBackLobby'), 'back'); } // 房主已回大厅/掉线：没人能开下一关了，主按钮就是返回大厅
    else if (me && me.nx) { st = 'rdy'; btns = btn(t('coReadied'), 'unready', 'main on') + btn(t('lbBackLobby'), 'back', 'sub'); }
    else { st = 'nrdy'; btns = btn(t('coReady'), 'ready', 'main') + btn(t('lbBackLobby'), 'back', 'sub'); }
    key = 'res:' + st;
    html = `<div class="mpCard"><h3>${esc(t(nid ? 'coWin' : 'coAllClear'))}</h3><div class="coHeads">${head(C.order[0])}${head(C.order[1])}</div><p>${esc(t('coStat', fmtTime(C.res.t), C.res.n | 0, C.res.u | 0))}</p>${btns}</div>`;
  } else if (C && !C.done && C.netBad) {
    key = C.netFailed ? 'nf' : 'nw';
    html = C.netFailed ? card(t('mpNetFailed'), t('mpNetFailedSub'), [['mpNetRetry', 'retry'], ['mpNetExit', 'exit']]) : card(t('mpNetLost'), t('mpNetLostSub'), []);
  } else if (C && !C.done && C.paused) {
    key = 'p:' + C.pauseNames.join('|');
    html = card(t('mpPauseTitle', C.pauseNames.join('、') || '?'), t('mpPauseSub'), [['mpNetExit', 'exit']]);
  }
  if (key === modalKey) return;
  modalKey = key;
  el.classList.toggle('show', !!key);
  el.innerHTML = html;
  el.querySelectorAll('[data-act]').forEach((b) => bindTap(b, () => modalAct(b.dataset.act)));
}
function modalAct(act) {
  const n = net();
  if (act === 'retry') { if (n) n.reconnect(); }
  else if (act === 'exit') { if (window.Lobby) Lobby.close(); end(); } // 离开房间(通知房主)并清掉本机房间状态
  else if (act === 'back') { if (n) n.back(); end(); if (window.Lobby) Lobby.show(); } // 通关卡片「返回大厅」：清掉自己的 inResult，别人那边名字不再灰
  else if (act === 'next') goNext();
  else if (act === 'ready' || act === 'unready') { if (n && n.setNext) n.setNext(act === 'ready'); } // 玩家：准备/取消准备下一关，房主确认后经房间状态把卡片重画
}
function goNext() { // 房主点「下一关」：不倒计时，直接开；对方没准备好会被 lan.js 拒绝
  const n = net();
  if (!n || !n.startNext || !C || !C.isHost || !C.done || !C.res || !C.res.nid || C.nexting) return;
  C.nexting = true;
  n.startNext({ levelId: C.res.nid }).catch(() => { if (C) C.nexting = false; showToast(t('coWaitReady')); });
}
function nextLevel(room) { // 结算卡片开着时房间进了新的一局：收掉上一局(和「返回大厅」同一套收尾，同一任务内不会闪)再开新局
  end(); skipPlaying = false; start(room);
  if (!C) { if (window.Lobby) Lobby.show(); return; } // 新局没开起来(缺关卡等)：回大厅
  const i = levelIdx(room.levelId); if (i >= 0) showToast(t('coLvToast', i + 1));
}

/* ---------- 房主快照存档(被杀后恢复同一局) ---------- */
function saveSnap() {
  if (!C || !C.isHost || C.done) return;
  try { localStorage.setItem(SNAP_KEY, JSON.stringify({ code: C.room.code, mid: C.room.mid || '', lv: C.lv.id, s: R.snapshot(C.G), us: C.ustk, pm: C.pausedMs, t: Date.now() })); } catch (e) {}
}
function cleanStack(a) { // 本地存档里的撤销栈：形状查一遍，坏的条目直接丢；最多 UNDO_MAX 条
  const ok2 = (q) => Array.isArray(q) && q.length === 2 && Number.isInteger(q[0]) && Number.isInteger(q[1]);
  return (Array.isArray(a) ? a : []).filter((e) => e && ok2(e.from) && ok2(e.to) && Number.isInteger(e.push) && e.push >= -1 && (e.push < 0 || ok2(e.bto)))
    .map((e) => ({ from: [e.from[0], e.from[1]], to: [e.to[0], e.to[1]], push: e.push, bto: e.push >= 0 ? [e.bto[0], e.bto[1]] : null })).slice(-UNDO_MAX);
}
function clearSnap() { try { localStorage.removeItem(SNAP_KEY); } catch (e) {} }
function readSnap(room, lvId) { // 只认「同一个房间 + 同一局」的存档
  try {
    const sn = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
    if (!sn || !room.mid || sn.code !== room.code || sn.mid !== room.mid || sn.lv !== lvId || Date.now() - (sn.t || 0) > SNAP_TTL) return null;
    return sn;
  } catch (e) { return null; }
}

/* ---------- 开局 / 收尾 ---------- */
function mySkinIn(room) { const me = room.players.find((p) => p.pid === room.you); return me ? me.skin : null; }
function myGenderIn(room) { const me = room.players.find((p) => p.pid === room.you); return me ? me.gender : null; }

function start(room) {
  const lv = findLevel(room.levelId);
  if (!lv) { skipPlaying = true; showToast(t('mpNoLevel')); return; } // 缺关卡(文件没更新)：留在大厅
  const G = R.fromXsb(lv.xsb), other = room.players.find((p) => p.pid !== room.hostPid);
  if (!G || room.players.length !== 2 || !other) { skipPlaying = true; showToast(t('coBadRoom')); return; }
  const order = [room.hostPid, other.pid], names = {}, skins = {}, genders = {};
  room.players.forEach((p) => { names[p.pid] = p.name; skins[p.pid] = p.skin; genders[p.pid] = p.gender === 'f' ? 'f' : 'm'; });
  const myIdx = order.indexOf(room.you);
  if (myIdx < 0) { skipPlaying = true; return; }
  C = { room, lv, G, mid: room.mid || '', order, names, skins, genders, myIdx, oi: 1 - myIdx, myPid: room.you, hostPid: room.hostPid, isHost: room.you === room.hostPid,
    tr: TRANSPOSE === 'auto' && !isWideLayout(), // 竖屏设备转置显示(开局时定，对局中不跟着转)
    seg: 1000 + (++coNo) * 5, t0: Date.now(), timer: null, endTimer: null, fresh: false,
    paused: false, pauseNames: [], netBad: false, netFailed: false, done: false, ending: false, res: null,
    hostPaused: false, pauseAt: 0, pausedMs: 0, winSent: false, lastSnap: 0, lastAsk: 0, seq: 0, pend: {}, bumped: {}, inertia: null, pushed: null, ustk: [[], []], ul: 0, denyAt: 0,
    boxEl: [], boxKey: [], pg: { dir: 'down', side: 'B', neutral: true, t1: 0, t2: 0 }, pshown: null,
    stat: { cm: 0, bump: 0, drift: 0, gap: 0, rtt: -1, last: '' } };
  TR.length = 0; TB.length = 0; TRS.stat = C.stat; TRS.lv = lv.id; TRS.host = C.isHost; TRS.rttSum = 0; TRS.rttN = 0; TRS.rttMax = 0; TRS.stale = 0;
  if (C.isHost) { // 房主被杀后恢复：回到上次存的整盘状态(玩家端不用存，回来要一份快照就行)
    const sn = readSnap(room, lv.id);
    if (sn && R.validSnap(G, sn.s)) { R.load(G, sn.s); C.pausedMs = +sn.pm || 0; if (Array.isArray(sn.us)) C.ustk = [cleanStack(sn.us[0]), cleanStack(sn.us[1])]; }
  } else C.fresh = true; // 玩家端：第一份快照静默套用(可能是中途加入/重连回来)，不播对齐动画
  modalKey = '';
  if (SPRITE_EXT === 'svg') { const c = C; loadSkin(partnerSkin(), partnerGender()).then(() => { if (C === c) paintPartner(); }); } // 备好同伴那套皮肤的 12 帧(每套只做一次)，好了重画同伴
  if (typeof closeSettings === 'function') closeSettings();
  if (typeof closeLevelPick === 'function') closeLevelPick();
  if (window.Lobby) Lobby.hide();
  hideHomeScreen();
  if (window.SFX && SFX.bgmMatch) SFX.bgmMatch(true);
  ensureDom();
  setSkinOverride(skins[room.you], genders[room.you]); // 角色配色/形象用大厅里选定的(开局后锁定)
  $('app').classList.add('mp');
  buildBar();
  loadMpLevel(R.toXsb(G, myIdx, C.tr), lv.id, C.seg); // 核心的棋盘按「本机视角」的 XSB 建；建完会回调 afterBuild 挂上同伴角色
  state.mp.coop = true;
  paintBar(); paintModal();
  C.timer = setInterval(tick, 1000);
  if (C.isHost) { saveSnap(); hostRoomChanged(); } else askSnap('start', true);
}
function stopTimers() { if (C) { clearInertia(); clearInterval(C.timer); C.timer = null; clearTimeout(C.endTimer); C.endTimer = null; clearTimeout(C.pg.t1); clearTimeout(C.pg.t2); } }
function end() { // 收起合作画面，把主页放回来，单机恢复到进入前的关卡
  if (window.SFX && SFX.bgmMatch) SFX.bgmMatch(false);
  stopTimers(); clearSnap();
  const n = net(); if (n && n.setReport) n.setReport(null);
  C = null; modalKey = '';
  const m = $('coModal'); if (m) { m.classList.remove('show'); m.innerHTML = ''; }
  const bar = $('coBar'); if (bar) bar.remove();
  setSkinOverride(null);
  $('app').classList.remove('mp');
  if (typeof closeSettings === 'function') closeSettings();
  showHomeScreen();
  leaveMp();
}
function abort() { showToast(t('mpAborted')); end(); if (window.Lobby) Lobby.show(); } // 没经通关就回大厅了(房主结束本局等)

function tick() {
  if (!C || C.done) return;
  paintBar();
  if (C.isHost && !C.hostPaused && Date.now() - C.lastSnap >= SNAP_MS) sendSnap();
}

/* ---------- 同步：玩家侧 ---------- */
function askSnap(why, force) { // 请求房主补发一份快照(跳号/推演对不上/重连/刚开局)；500ms 内不重复要
  const n = net(), now = Date.now();
  if (!n || !C || C.isHost || (!force && now - C.lastAsk < 500)) return;
  C.lastAsk = now; C.stat.last = why; trace('ask', { why });
  n.sendGame({ k: 'cq' });
}
function onCm(d) {
  if (!C || C.done) return;
  const i = d.i | 0;
  if ((i !== 0 && i !== 1) || typeof d.d !== 'string' || !Array.isArray(d.to)) return;
  const pp = (d.pp === 0 || d.pp === 1) && d.pp !== i && Array.isArray(d.pt) ? d.pp : -1; // 被推的角色(没有=-1)
  let res = { ok: true, to: d.to, push: Number.isInteger(d.b) ? d.b : -1, bto: Array.isArray(d.bt) ? d.bt : null, pp, pto: pp >= 0 ? d.pt : null };
  if (!C.isHost) { // 玩家：用同一套规则推演，并核对房主给的结果；房主本机的状态在广播前已经走完了，这里只播画面
    const G = C.G, v = d.v | 0;
    if (v <= G.v) { TRS.stale++; trace('stale', { src: d.k, i, got: v }); return; }                                  // 重复/旧消息
    if (v !== G.v + 1) { C.stat.gap++; trace('gap', { src: d.k, exp: G.v + 1, got: v }); askSnap('gap'); return; } // 跳号：漏了东西，当场要快照，不等周期
    const r = R.step(G, i, d.d);
    if (!r.ok || r.to[0] !== d.to[0] || r.to[1] !== d.to[1] || r.push !== res.push || r.pp !== res.pp || (r.pp >= 0 && (r.pto[0] !== res.pto[0] || r.pto[1] !== res.pto[1]))) { C.stat.drift++; trace('mismatch', { src: 'cm', i, d: d.d, host: d.to, mine: r.ok ? r.to : 'fail:' + r.why, push: [r.push, res.push], pp: [r.pp, res.pp] }); askSnap('mismatch', true); return; }
    res = r;
  }
  let rtt0; if (i === C.myIdx && d.s) { const t0 = C.pend[d.s]; if (t0) { C.stat.rtt = rtt0 = Math.round(performance.now() - t0); TRS.rttSum += rtt0; TRS.rttN++; if (rtt0 > TRS.rttMax) TRS.rttMax = rtt0; delete C.pend[d.s]; } }
  if (i === C.myIdx && d.s && C.bumped[d.s]) { trace('pred-bump-moved', { i, d: d.d }); delete C.bumped[d.s]; } // 本机预判撞了、房主却说走成了
  C.stat.cm++;
  trace('cm', { i, d: d.d, rtt: rtt0 });
  if (i === C.myIdx && !C.isHost) C.ul = Math.min(UNDO_MAX, C.ul + 1);
  if (i === C.myIdx) mineMove(d.d, res); else partnerMove(d.d, res);
}
function onCs(d) { // 房主的整盘快照(玩家端)：同号同状态=一切正常；落后或同号不同=跑偏，对齐
  if (!C || C.isHost || !R.validSnap(C.G, d)) return;
  const G = C.G;
  if (d.v < G.v) return; // 旧快照
  if (Array.isArray(d.ul)) C.ul = Math.max(0, Math.min(UNDO_MAX, d.ul[C.myIdx] | 0)); // 我还能撤几步(按住连撤用)
  const quiet = C.fresh;
  C.fresh = false;
  if (R.same(G, d)) { G.v = d.v; return; } // 状态一样(序号可能因重开错开了)：只对齐序号，不算跑偏
  trace('drift', { quiet: quiet ? 1 : 0, gv: G.v, dv: d.v, diff: snapDiff(G, d) }); // 要整盘覆盖了：记下具体哪里不一样
  if (!quiet) { C.stat.drift++; C.stat.last = 'snap v' + G.v + '→' + d.v; if (window.console) console.warn('[CO] 状态跑偏，已对齐', C.stat.last); }
  R.load(G, d);
  reconcileView(!quiet);
}
const BUMP_K = 0.06; // 撞墙/推不动的回弹幅度 = 格子的 6%(原来 8%，减弱 25%)；最小 2px
function nudge(el, vd, x, y) { // 身体朝撞到的方向顶一下再回来(纯画面，160ms)；x,y=角色当前格子左上角的像素位置
  if (!el || !el.animate) return;
  const dv = DIR_DELTA[vd], k = Math.max(2, Math.round(tileSize() * BUMP_K)), base = el.style.transform;
  el.animate([{ transform: base }, { transform: `translate(${x + dv[1] * k}px, ${y + dv[0] * k}px)`, offset: 0.4 }, { transform: base }], { duration: 160, easing: 'ease-out' });
}
function ownBump(d, w) { // 本机角色转身撞一下，并且和同伴那边一样身体回弹一下
  state.dir = vword(d);
  Bus.emit('bump', { kind: w === 'wall' ? 'wall' : 'box' });
  renderDynamic(); scheduleIdle();
  const tile = tileSize();
  nudge($('playerEl'), state.dir, state.player.c * tile, state.player.r * tile);
}
function ownTurn(d) { // 本机角色只转身(被推滑动中面朝推我的人)：没有撞一下，也没有撞击音，滑动照常继续
  state.dir = vword(d);
  renderDynamic(); scheduleIdle();
}
function partnerTurn(d) { // 同伴只转身(同上)，不顶一下
  const g = C.pg;
  clearTimeout(g.t1); clearTimeout(g.t2);
  g.dir = vword(d); g.neutral = true; paintPartner();
}
function partnerBump(d) { // 同伴转身面朝撞到的东西，身体朝那边顶一下再回来(纯画面；不发 bump 事件，免得被当成我自己的撞墙计数)
  const vd = vword(d), g = C.pg, el = $('partnerEl');
  clearTimeout(g.t1); clearTimeout(g.t2);
  g.dir = vd; g.neutral = true; paintPartner();
  if (!el || !el.animate) return;
  const tile = tileSize(), v = vk(C.G.p[C.oi]);
  nudge(el, vd, v[1] * tile, v[0] * tile);
}
function onCu(d) { // 房主确认：某人后撤了一步(玩家端先用同一规则复核)
  if (!C || C.done) return;
  const i = d.i | 0;
  const ok2 = (q) => Array.isArray(q) && q.length === 2 && Number.isInteger(q[0]) && Number.isInteger(q[1]);
  if ((i !== 0 && i !== 1) || !ok2(d.fr) || !ok2(d.to) || !Number.isInteger(d.b) || d.b < -1 || (d.b >= 0 && !ok2(d.bt))) return;
  const e = { from: d.fr, to: d.to, push: d.b, bto: d.b >= 0 ? d.bt : null };
  if (!C.isHost) {
    const G = C.G, v = d.v | 0;
    if (v <= G.v) { TRS.stale++; trace('stale', { src: 'cu', i, got: v }); return; }
    if (v !== G.v + 1) { C.stat.gap++; trace('gap', { src: 'cu', exp: G.v + 1, got: v }); askSnap('gap'); return; }
    const r = R.undo(G, i, e);
    if (!r.ok) { C.stat.drift++; trace('mismatch', { src: 'cu', i, fr: d.fr, to: d.to }); askSnap('mismatch', true); return; }
    if (i === C.myIdx) C.ul = Math.max(0, C.ul - 1);
  }
  if (i === C.myIdx && d.s) { const t0 = C.pend[d.s]; if (t0) { C.stat.rtt = Math.round(performance.now() - t0); delete C.pend[d.s]; } }
  C.stat.cm++;
  trace('cu', { i });
  if (i === C.myIdx) mineUndo(e); else partnerUndo(e);
}
function onCn(d) { // 房主：某人的撤销没成。只有请求的人有反应
  if (!C || (d.i | 0) !== C.myIdx) return;
  if (d.w === 'empty' && !C.isHost) C.ul = 0;
  denyUndo();
}
function onCf(d) { // 房主确认：某人这一步没走成，转身面向 d.d(w=撞到什么：wall/box/boxplayer/player)
  if (!C || C.done) return;
  const i = d.i | 0;
  if ((i !== 0 && i !== 1) || typeof d.d !== 'string' || !(d.d in R.DIRS)) return;
  if (!C.isHost) { // 玩家：和 cm 一样按序号推演
    const G = C.G, v = d.v | 0;
    if (v <= G.v) { TRS.stale++; trace('stale', { src: 'cf', i, got: v }); return; }
    if (v !== G.v + 1) { C.stat.gap++; trace('gap', { src: 'cf', exp: G.v + 1, got: v }); askSnap('gap'); return; }
    R.face(G, i, d.d);
  }
  C.stat.bump++;
  trace('cf', { i, d: d.d, w: d.w, q: d.q ? 1 : 0 });
  if (d.q) { // 滑动中的转身：只转身，不弹
    if (i !== C.myIdx) { partnerTurn(d.d); return; }
    if (C.isHost) return;                                         // 房主自己的：按键时已经转过了
    if (d.s && C.bumped[d.s]) { delete C.bumped[d.s]; return; }   // 玩家自己的：本机预判时已经转过了
    ownTurn(d.d); return;
  }
  if (i === C.myIdx) {
    if (C.isHost) return;                                         // 房主自己的：按键时已经播过
    if (d.s && C.bumped[d.s]) { delete C.bumped[d.s]; return; }   // 玩家自己的：本机预判撞墙时已经播过
    trace('late-bump', { d: d.d, w: d.w }); ownBump(d.d, d.w); return;                                    // 本机副本没预判到(比如刚好被同伴抢了格子)：房主说撞了，现在补播
  }
  partnerBump(d.d);
}
function onCr(d) { // 重开
  if (!C) return;
  if (!C.isHost) { const G = R.fromXsb(C.lv.xsb); if (!G) return; G.v = d.v | 0; C.G = G; C.pend = {}; }
  C.ul = 0; // 重开：撤销栈清空(房主那边在 restart 里清)
  resetView();
}
function onCz(d) { // 暂停/恢复(房主：有人掉线)
  if (!C) return;
  C.paused = !!d.on;
  C.pauseNames = Array.isArray(d.n) ? d.n.map(String).slice(0, 2) : [];
  paintModal();
}

/* ---------- 同步：房主侧 ---------- */
function bcast(d) { const n = net(); if (n) n.bcastGame(d); }
function sendSnap() { if (!C || !C.isHost) return; C.lastSnap = Date.now(); bcast(Object.assign({ k: 'cs' }, R.snapshot(C.G), { ul: C.ustk.map((q) => q.length) })); }
function stepMs() { return Math.max(50, Math.round(settings.walkMs * (window.EV ? EV.durMul() : 1))); } // 一步(走路)的时长，和核心 setMoveDur 同一算法
function clearInertia() { if (C) { C.inertia = null; C.pushed = null; } }
function inertiaDir(w, pi, d) { // 惯性窗口 w 里，pi 的方向 d 是不是「朝着推他的人」(转身顶住)
  if (!w || (w.pp !== undefined && w.pp !== pi) || Date.now() >= w.until) return false;
  const a = R.DIRS[d], b = R.DIRS[w.d]; return a[0] + b[0] === 0 && a[1] + b[1] === 0;
}
function pushedInertia(pi, d) { return !!C && inertiaDir(C.inertia, pi, d); } // 房主：pi 刚被推开、这一步还在滑，d 是朝着推他的人
function pushedNow(d) { // 本机：我刚被同伴推开、这一步还在滑，d 是朝着推我的人(用 performance.now，和 partnerMove 里记的一致)
  const p = C && C.pushed; if (!p || performance.now() >= p.until) return false;
  const a = R.DIRS[d], b = R.DIRS[p.d]; return a[0] + b[0] === 0 && a[1] + b[1] === 0;
}
function hostStep(pi, d, s) { // 房主裁判：所有人(含自己)的移动意图都走这里
  if (!C || !C.isHost || C.done || C.ending || C.hostPaused) return;
  const f0 = C.G.p[pi].slice();
  const r = R.step(C.G, pi, d);
  if (!r.ok) { if (r.why !== 'bad') hostFace(pi, d, r.why, s); return; } // 没走成：转身撞一下，大家都看得见
  const stk = C.ustk[pi]; stk.push({ from: f0, to: r.to, push: r.push, bto: r.push >= 0 ? r.bto : null }); if (stk.length > UNDO_MAX) stk.shift(); // 记一条撤销记录(只记自己这一步；推了对方角色也只记自己)
  const m = { k: 'cm', i: pi, d, v: C.G.v, to: r.to, b: r.push };
  if (r.push >= 0) m.bt = r.bto; // P5：消息里不放 undefined
  if (r.pp >= 0) { m.pp = r.pp; m.pt = r.pto; C.inertia = { pp: r.pp, d, until: Date.now() + stepMs() }; } // 推到了对方角色：被推的人这一步滑动期间有惯性
  if (s) m.s = s;
  saveSnap();
  bcast(m); // 本机经 onGame 回环，和玩家走同一条视觉路径
  if (R.solved(C.G)) hostWin();
}
function hostFace(pi, d, why, s) { // 某人这一步没走成：房主改他的朝向(序号 +1)并广播 cf
  if (!C || !C.isHost || C.done || C.ending || C.hostPaused) return;
  if (!R.face(C.G, pi, d)) return;
  const m = { k: 'cf', i: pi, d, v: C.G.v, w: why };
  if (s) m.s = s;
  if (pushedInertia(pi, d)) m.q = 1; // 被推的那一步滑动期间转身面对推他的人：只转身，不回弹(大家同步看到)
  saveSnap();
  bcast(m); // 房主本机经回环 onCf：自己的不重播、玩家的在房主屏幕上播
}
function hostWin() {
  if (!C || !C.isHost || C.winSent) return;
  C.winSent = true;
  const n = net(), now = Date.now(), t0 = (n && n.startedAt) || C.t0, paused = C.pausedMs + (C.hostPaused ? now - C.pauseAt : 0);
  // endRound：phase 回 lobby、在线的人标记 inResult，并先广播 result 再广播房间状态(保序)；co=1 表示这是合作通关(不是竞速结算)
  const lvId = C.lv.id;
  if (!n || !n.endRound({ co: 1, n: C.G.moves, t: Math.max(0, now - t0 - paused), lv: lvId })) { C.winSent = false; return; }
  markDone(lvId); // 进度只记房主这台设备；回大厅后默认起点=下一关(最后一关则停在原地)
  if (n.setStart) n.setStart(nextId(lvId) || lvId);
}
function hostRoomChanged() { // 房间状态一变：有人掉线就暂停(并反复通知，晚连上的人也能同步)，都回来了就恢复并补发快照
  if (!C || !C.isHost || C.done) return;
  const off = C.room.players.filter((p) => p.pid !== C.hostPid && p.online === false), now = Date.now();
  if (off.length) {
    if (!C.hostPaused) { C.hostPaused = true; C.pauseAt = now; }
    bcast({ k: 'cz', on: 1, n: off.map((p) => p.name).slice(0, 2) });
  } else if (C.hostPaused) {
    C.pausedMs += now - C.pauseAt; C.hostPaused = false;
    bcast({ k: 'cz', on: 0 }); sendSnap(); saveSnap();
  }
}
function beginEnd(d) { // 收到合作通关结果：锁输入，停一下让大家看清最后一步，再弹卡片；期间房间转 lobby 是正常次序(同竞速的 M1)
  if (!C || C.done || C.ending) return;
  C.ending = true;
  stopTimers(); clearSnap();
  Bus.emit('solved', { moves: d.n | 0 });
  C.endTimer = setTimeout(() => { if (!C) return; C.endTimer = null; C.done = true; C.res = { t: +d.t || 0, n: d.n | 0, u: C.G.un | 0, nid: nextId(ID_RE.test(d.lv || '') ? d.lv : C.lv.id) }; paintModal(); }, END_MS); // u=撤销次数：各端自己都有(撤销消息会同步)，不用走结算消息
}

/* ---------- 本机输入 → 意图(核心 tryMove 开头的钩子) ---------- */
function sendIntent(d, bumped) { // 把「想往哪走」发给房主；bumped=本机已经预判撞墙并播过了，回执里别重播
  const s = ++C.seq, n = net();
  if (Object.keys(C.pend).length > 64) C.pend = {};
  if (Object.keys(C.bumped).length > 64) C.bumped = {};
  C.pend[s] = performance.now();
  if (bumped) C.bumped[s] = 1;
  return !!(n && n.sendGame({ k: 'ci', d, s }));
}
function intent(dr, dc, vdir) {
  if (!C || C.done || C.ending) return;
  const d = R.fromView(vdir, C.tr), i = C.myIdx;
  const chk = R.step(C.G, i, d, true); // 用本机副本先试探：撞墙/推不动/被人挡，当场转身撞一下(和单机一样，不等网络)
  if (!chk.ok) {
    if (pushedNow(d)) ownTurn(d); else ownBump(d, chk.why); // 被推滑动中转身面对推我的人：只转身不弹
    if (C.isHost) hostFace(i, d, chk.why, 0); else sendIntent(d, true); // 同时告诉房主，让同伴也看到这个失误
    return;
  }
  if (C.isHost) { hostStep(i, d, 0); return; }
  if (!sendIntent(d, false)) return;
  lockMovement(); // 等房主回执的这段时间也锁住，节奏和单机一样(连走/排队照常)；回执到了会按真正的步时长重新上锁
}
function ulOf() { return C ? (C.isHost ? C.ustk[C.myIdx].length : C.ul) : 0; }
function hostUndo(pi, s) { // 房主裁判：撤销请求(含自己)。栈顶就是这个人最近一步；检查通过才撤，不通过就 cn(只有请求的人有反应)
  if (!C || !C.isHost || C.done || C.ending || C.hostPaused || C.winSent) return;
  const stk = C.ustk[pi], e = stk[stk.length - 1];
  const chk = e ? R.undoCheck(C.G, pi, e) : { ok: false, why: 'empty' };
  if (!chk.ok) { const m = { k: 'cn', i: pi, w: chk.why }; if (s) m.s = s; bcast(m); return; }
  stk.pop(); R.undo(C.G, pi, e);
  const m = { k: 'cu', i: pi, v: C.G.v, fr: e.from, to: e.to, b: e.push };
  if (e.push >= 0) m.bt = e.bto; // P5：消息里不放 undefined
  if (s) m.s = s;
  saveSnap();
  bcast(m);
  if (R.solved(C.G)) hostWin(); // 撤销也可能把箱子退回目标点，凑成通关
}
function denyUndo() { // 撤销没成(没得撤/位置被对方动过)：撤销键抖一下 + 错误提示音
  if (!C) return;
  C.denyAt = Date.now();
  Bus.emit('bump', { kind: 'box' });
  const el = document.getElementById('undo');
  if (el && el.animate) el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 280, easing: 'ease-out' });
}
function undo() { // 后撤：只撤自己最近一步；真正的裁判在房主，这里只发请求
  if (!C || C.done || C.ending) return;
  if (blocked() || (window.EV && EV.locked())) return; // 和单机一样：暂停/断线/随机事件期间不动作
  clearHold(); state.inputQueue.length = 0;            // 和单机撤销一样：停下按住的连走、清掉排队的方向
  if (C.isHost) { hostUndo(C.myIdx, 0); return; }
  if (!C.ul) { denyUndo(); return; }                   // 本机知道没得撤了：当场提示，不用问房主
  const s = ++C.seq, n = net();
  if (Object.keys(C.pend).length > 64) C.pend = {};
  C.pend[s] = performance.now();
  n && n.sendGame({ k: 'cx', s });
}
function undoLeft() { return C ? (Date.now() - C.denyAt < 600 ? 0 : ulOf()) : 0; } // 按住连撤用：没得撤了/刚被拒就停

/* ---------- 画面：把房主确认过的一步播出来 ---------- */
function moveBox(id, bto) { // 箱子 id 从旧格到新格：改核心的 boxes/boxEls(和 tryMove 推箱同一套)，元素换格键后 renderDynamic 会让它滑过去
  const fk = C.boxKey[id], tk = vkey(bto), el = C.boxEl[id] || null;
  state.boxes.delete(fk); state.boxes.add(tk);
  if (state.boxEls[fk]) delete state.boxEls[fk];
  if (el) state.boxEls[tk] = el;
  if (state.boxId) { delete state.boxId[fk]; state.boxId[tk] = id; }
  C.boxKey[id] = tk;
  return { el, fk, tk };
}
function mineMove(d, res) { // 我自己的角色：复用核心的步时长/步态/上锁/镜头
  const vd = vword(d), dv = DIR_DELTA[vd], to = vk(res.to), push = res.push >= 0;
  setMoveDur(push);
  state.dir = vd;
  advanceGait(vd);
  lockMovement();
  state.player = { r: to[0], c: to[1] };
  state.moves++;
  let mv = null;
  if (push) mv = moveBox(res.push, res.bto);
  renderDynamic();
  if (push) {
    C.boxEl[res.push] = state.boxEls[mv.tk] || mv.el;
    playBoxFx(C.boxEl[res.push], dv[0], dv[1]);
    Bus.emit('push', { onTarget: state.targets.has(mv.tk), from: mv.fk, to: mv.tk });
  } else Bus.emit('move');
  scheduleIdle();
  updateCamera(vd);
  paintBar();
}
function partnerMove(d, res) { // 同伴角色：位置由 afterRender 按 G 摆，这里管朝向/换帧/推箱音
  const vd = vword(d), dv = DIR_DELTA[vd], push = res.push >= 0, g = C.pg;
  setMoveDur(push); // --move-dur 是全局的：同伴的位移/箱子滑动也用同一个时长
  g.dir = vd; g.side = g.side === 'A' ? 'B' : 'A'; g.neutral = false;
  paintPartner();
  clearTimeout(g.t1); clearTimeout(g.t2);
  if (FOOTFALL_DIRS.has(vd)) g.t1 = setTimeout(() => { g.neutral = true; paintPartner(); }, Math.max(30, Math.round(MOVE_DUR * FOOTFALL_RATIO)));
  g.t2 = setTimeout(() => { g.neutral = true; paintPartner(); }, MOVE_DUR + IDLE_GRACE);
  let mv = null;
  if (push) mv = moveBox(res.push, res.bto);
  if (res.pp === C.myIdx) { const pt = vk(res.pto); state.player = { r: pt[0], c: pt[1] }; C.pushed = { d, until: performance.now() + MOVE_DUR }; } // 我被同伴推开了一格：我的角色跟着滑过去；记下这一步的滑动期(这期间我转身面对他不弹)
  renderDynamic(); // 末尾的 afterRender 会把同伴摆到新格子(CSS 过渡滑过去)
  if (push) {
    C.boxEl[res.push] = state.boxEls[mv.tk] || mv.el;
    playBoxFx(C.boxEl[res.push], dv[0], dv[1]);
    Bus.emit('push', { onTarget: state.targets.has(mv.tk), from: mv.fk, to: mv.tk });
  }
  if (res.pp === C.myIdx) updateCamera(vd); // 被推的是我：镜头跟着我
  paintBar();
}
function mineUndo(e) { // 我后撤一步：朝向不变(倒退)，推过的箱子退回我刚离开的格子；步数减 1
  const to = vk(e.from), push = e.push >= 0;
  state.moves = Math.max(0, state.moves - 1); // 核心的本机步数(HUD 显示)，renderDynamic 会刷新
  setMoveDur(push);
  advanceGait(state.dir);
  lockMovement();
  state.player = { r: to[0], c: to[1] };
  let mv = null;
  if (push) mv = moveBox(e.push, e.to);
  renderDynamic();
  if (push) C.boxEl[e.push] = state.boxEls[mv.tk] || mv.el;
  Bus.emit('undo');
  scheduleIdle();
  updateCamera();
  paintBar();
}
function partnerUndo(e) { // 同伴后撤一步：朝向不变，位置由 afterRender 按 G 摆(滑回去)
  const push = e.push >= 0, g = C.pg;
  setMoveDur(push);
  g.side = g.side === 'A' ? 'B' : 'A'; g.neutral = false;
  paintPartner();
  clearTimeout(g.t1); clearTimeout(g.t2);
  g.t2 = setTimeout(() => { g.neutral = true; paintPartner(); }, MOVE_DUR + IDLE_GRACE);
  let mv = null;
  if (push) mv = moveBox(e.push, e.to);
  renderDynamic();
  if (push) C.boxEl[e.push] = state.boxEls[mv.tk] || mv.el;
  Bus.emit('undo');
  paintBar();
}
function pFrameKey() { const d = SPRITE[C.pg.dir]; return C.pg.neutral ? d.stand : (C.pg.side === 'A' ? d.stepA : d.stepB); }
function partnerGender() { const g = C && C.genders[C.order[C.oi]]; return g === 'f' ? 'f' : 'm'; }
function partnerSkin() { const k = C && C.skins[C.order[C.oi]]; return (typeof SKIN_KEYS !== 'undefined' && SKIN_KEYS.includes(k)) ? k : 'classic'; }
function partnerURL(key) { // 同伴的帧：和 frameURL 同一套(base.js)，只是皮肤用房主分配给同伴的那套；还没栅格化好时 spriteURL 退回原版，备好后 loadSkin().then 会重画
  const fr = framesOf(partnerGender()); // 同伴的形象(男/女)也是大厅里选的，帧路径跟着变
  if (SPRITE_EXT !== 'svg') return spriteURL(fr[key]);
  return spriteURL(skinKey(fr[key], partnerSkin()));
}
function paintPartner() {
  const s = $('partnerSprite');
  if (C && s) s.style.backgroundImage = `url(${partnerURL(pFrameKey())})`;
}
function placePartner() {
  const el = $('partnerEl');
  if (!C || !el) return;
  const v = vk(C.G.p[C.oi]), tile = tileSize();
  el.style.transform = `translate(${v[1] * tile}px, ${v[0] * tile}px)`;
  C.pshown = v;
}

/* 核心钩子：renderBoardStructure 重建棋盘后(换关/缩放/重开)，重新认箱子元素、挂同伴角色 */
function afterBuild() {
  if (!C) return;
  const board = $('board');
  if (!board) return;
  C.boxEl = []; C.boxKey = [];
  C.G.boxes.forEach((b, id) => { const k = vkey(b); C.boxKey[id] = k; C.boxEl[id] = state.boxEls[k] || null; });
  const old = $('partnerEl'); if (old) old.remove();
  const el = document.createElement('div'), sp = document.createElement('div');
  el.className = 'player'; el.id = 'partnerEl'; sp.className = 'sprite'; sp.id = 'partnerSprite';
  el.appendChild(sp);
  const v = vk(C.G.p[C.oi]), tile = tileSize();
  el.style.transform = `translate(${v[1] * tile}px, ${v[0] * tile}px)`; // 先设位置再挂上去：新元素不会从原点滑过来
  C.pshown = v;
  C.pg.dir = vword(C.G.d[C.oi]); C.pg.neutral = true;
  board.appendChild(el);
  paintPartner();
}
function afterRender() { if (C) { placePartner(); } } // 缩放/格子大小变了或任何一次重画后，同伴跟着摆正
function partnerAt(key) { return !!C && vkey(C.G.p[C.oi]) === key; } // 按住连走时同伴算障碍(index.html 的 holdStep 用)

/* 对齐：把核心画面按 C.G 摆正；fade=true 时只让「对不上」的角色/箱子淡出，在正确位置淡入，没变的不动 */
function reconcileView(fade) {
  if (!C) return;
  const G = C.G, fix = [];
  const me = vk(G.p[C.myIdx]);
  if (state.player.r !== me[0] || state.player.c !== me[1]) { state.player = { r: me[0], c: me[1] }; fix.push($('playerEl')); }
  state.dir = vword(G.d[C.myIdx]);
  const pp = vk(G.p[C.oi]);
  if (!C.pshown || C.pshown[0] !== pp[0] || C.pshown[1] !== pp[1]) fix.push($('partnerEl'));
  C.pg.dir = vword(G.d[C.oi]); C.pg.neutral = true;
  const nb = new Set(), nel = {};
  G.boxes.forEach((b, id) => {
    const k = vkey(b); nb.add(k);
    if (C.boxKey[id] !== k) fix.push(C.boxEl[id]);
    C.boxKey[id] = k; if (C.boxEl[id]) nel[k] = C.boxEl[id];
    if (state.boxId) state.boxId[k] = id;
  });
  state.boxes = nb; state.boxEls = nel;
  const place = () => { renderDynamic(); paintPartner(); updateCamera(); paintBar(); };
  const els = fix.filter(Boolean);
  if (!fade || !els.length) { place(); return; }
  els.forEach((el) => { el.style.transition = 'opacity ' + FADE_MS + 'ms'; el.style.opacity = '0'; });
  setTimeout(() => {
    if (!C) return;
    els.forEach((el) => { el.style.transition = 'none'; });
    place();
    void document.body.offsetWidth; // 强制重排：位置先瞬间到位，再淡入
    els.forEach((el) => { el.style.transition = 'opacity ' + FADE_MS + 'ms'; el.style.opacity = '1'; });
    setTimeout(() => els.forEach((el) => { el.style.transition = ''; el.style.opacity = ''; }), FADE_MS + 40);
  }, FADE_MS);
}
function resetView() { // 重开：用 C.G(已是初始局面)重建核心画面
  loadMpLevel(R.toXsb(C.G, C.myIdx, C.tr), C.lv.id, C.seg); // 同一个 seg：BGM 不换曲
  state.mp.coop = true;
  C.pg.neutral = true;
  paintBar();
}

/* ---------- 来自 Multiplayer.js 的转发 ---------- */
function onRoom(room) { // 返回 true=合作接管了，竞速那边别再处理
  const mine = room.tier === 'coop';
  if (!C) {
    if (!mine) return false;
    if (room.phase !== 'playing') skipPlaying = false;
    if (room.phase === 'starting') setSkinOverride(mySkinIn(room), myGenderIn(room)); // 倒计时就把配色/形象备好，开局时不闪
    else if (room.phase === 'lobby') setSkinOverride(null);
    if (room.phase === 'playing' && !skipPlaying) start(room);
    return true;
  }
  C.room = room;
  if (room.phase === 'playing' && C.done && room.mid && room.mid !== C.mid) { nextLevel(room); return true; } // 卡片开着、房间进了新的一局：房主点了「下一关」
  if (C.done) paintModal(); // 结算卡片：对方准备/回大厅/掉线一变就重画(内容没变不重绘)
  if (room.phase !== 'playing' && !C.done && !C.ending) { abort(); return true; } // 结算过渡期间(ending)房间先转 lobby 是正常的
  if (room.phase === 'playing') { hostRoomChanged(); paintBar(); }
  return true;
}
function onGame(d, fromPid) { // 返回 true=这条消息是合作的(已处理或忽略)，竞速那边别再处理
  if (!d || typeof d !== 'object') return false;
  const k = d.k;
  if (k === 'result') { if (!d.co) return false; if (C && fromPid === C.hostPid) beginEnd(d); return true; }
  if (typeof k !== 'string' || !/^c[a-z]$/.test(k)) return false;
  if (!C || C.done || C.ending) return true;
  const fromHost = fromPid === C.hostPid;
  if (k === 'ci') {
    const pi = C.order.indexOf(fromPid);
    if (C.isHost && !fromHost && pi === 1 && typeof d.d === 'string' && d.d.length === 1 && 'UDLR'.includes(d.d)) hostStep(pi, d.d, d.s | 0);
  } else if (k === 'cx') { if (C.isHost && !fromHost && C.order.indexOf(fromPid) === 1) hostUndo(1, d.s | 0); }
  else if (k === 'cq') { if (C.isHost && !fromHost) sendSnap(); }
  else if (!fromHost) return true; // 下面这些只认房主
  else if (k === 'cm') onCm(d);
  else if (k === 'cs') onCs(d);
  else if (k === 'cf') onCf(d);
  else if (k === 'cu') onCu(d);
  else if (k === 'cn') onCn(d);
  else if (k === 'cr') onCr(d);
  else if (k === 'cz') onCz(d);
  return true;
}
function onStatus(s) { // 'ok' | 'waiting' | 'failed'：本机和房主之间的连接
  if (!C) return false;
  if (C.done || C.ending) return true;
  const bad = s !== 'ok', failed = s === 'failed';
  if (bad === C.netBad && failed === C.netFailed) return true;
  C.netBad = bad; C.netFailed = failed;
  paintModal(); paintBar();
  if (!bad) askSnap('reconnect', true); // 重连回来：要一份快照对齐
  return true;
}
function onClosed() { if (!C) return false; end(); return true; } // 房间解散/彻底失联/被移出
function onLeave() { clearSnap(); }                                 // 玩家主动离开房间：续局存档作废

/* ---------- 给核心(index.html / ui.js / Multiplayer.js)用 ---------- */
function blocked() { return !!C && (C.paused || C.netBad || C.done || C.ending); } // 别人掉线暂停 / 本机断线 / 已通关：锁住走步
function barH() { return BAR_ROW_H + 6; }
function restart() { // 暂停菜单「重来」：只有房主能点，全体重来
  if (!C || C.done || C.ending) return;
  if (!C.isHost) { showToast(t('coHostOnly')); return; }
  if (blocked()) return;
  const G = R.fromXsb(C.lv.xsb);
  if (!G) return;
  clearInertia(); // 重开时惯性/等着的转身作废
  C.ustk = [[], []];
  G.v = C.G.v + 1; C.G = G; C.winSent = false; // v 只增不减：重开后的快照/事件序号仍然比重开前的大
  saveSnap();
  bcast({ k: 'cr', v: G.v }); // 本机经回环 onCr → resetView(loadMpLevel 里的 resetPauseUI 会收起暂停菜单)，和玩家同一条路
}
function requestEnd(btn) { // 暂停菜单里的「离开」键(房主)：结束本局回大厅(所有人)。第一下待确认，3 秒内再点才生效
  if (!C || !C.isHost || C.done || C.ending) return;
  if (!C.endArmed) {
    C.endArmed = true;
    if (btn) btn.classList.add('mpArmed');
    showToast(t('mpEndConfirm'));
    clearTimeout(C.armTimer);
    C.armTimer = setTimeout(() => { if (C) C.endArmed = false; if (btn) btn.classList.remove('mpArmed'); }, 3000);
    return;
  }
  clearTimeout(C.armTimer); C.endArmed = false;
  if (typeof setPause === 'function') setPause(false);
  const n = net(); if (n) n.endGame(); // 房间回大厅 → 各端 onRoom 发现不在 playing → abort
}

window.addEventListener('pagehide', saveSnap);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSnap(); });

window.COOP = { levels: coLevels, levelIndex: levelIdx, isUnlocked, isDone, startId, onRoom, onGame, onStatus, onClosed, onLeave, blocked, barH, restart, requestEnd, intent, undo, undoLeft, afterBuild, afterRender, partnerAt,
  diag: diagText, active: () => !!C, isHost: () => !!C && C.isHost, debug: () => C ? { v: C.G.v, moves: C.G.moves, stat: C.stat, tr: C.tr, snap: R.snapshot(C.G) } : null,
  _state: () => C }; // _state：调试/自动化测试用，直接拿内部状态(控制台里 COOP._state().G 看整盘)
})();
