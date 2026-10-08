/* Multiplayer.js — 联机竞速：对局内的同步 / 竞速规则 / 玩家数据条 / 等待态 / 暂停表决 / 结算画面。
   只经 window.LAN_NET 收发，不碰 PeerJS；大厅界面在 lobby.js，lobby.js 把 onRoom/onGame/onReports/onLatency/onStatus/onClosed 转给本文件(window.MP)。
   对局的关卡/走步/输入在 index.html 核心：loadMpLevel / leaveMp / mpBlocked / Bus 事件 'mpSolved'；暂停菜单灰掉选项在 ui.js。
   加载顺序：… → lobby.js → lan.js → levels_mp.js → Multiplayer.js。

   ── 流程 ──
   房间 phase 变 playing → startMatch：收起大厅和主页，按 room.levelId 从 MP_LEVEL_PACK 取关，loadMpLevel；每秒 setReport({s:步数,p:已落位,f:是否完成})。
   通关(Bus 'mpSolved') → sendGame({k:'fin', s, m:走法})；房主收集：重放走法校验 → 记名次(按收到先后，用时=到达时刻−开局−单程延迟−暂停累计) →
   完成人数 ≥ 有效玩家数−1(至少 1)时 settle()：endRound({rank,total,lv}) → 全体 {k:'result'} → 毛玻璃结算画面 → 「返回大厅」。
   有玩家掉线：房主 bcastGame({k:'pz',on:1,n:[名字]}) → 全体锁住输入并显示暂停；房主可选「不等了，继续」(removePlayer)；用时扣除暂停时段。
   本机与房主断线(onStatus 非 ok)：本机锁住输入，显示重连提示。
   即时消息(k)：fin(玩家→房主)  pz(房主→全体，暂停/恢复)  result(房主→全体，结算)  pg(进度：玩家→房主，房主再转发给其他人)。
   进度同步：每走一步(最快每 120ms 一次)就发 pg，不等 1 秒一次的心跳；心跳(setReport)只当兜底。两边都带 q(单调递增的版本号，用毫秒时间戳)，旧的不会盖掉新的。
   续局：每台设备每秒把「房间码 + 本局编号 + 自己的走法」存进 localStorage(切后台/关页时再存一次)；被杀后从「恢复游戏」回到同一局，按走法重放就回到原来的步数和箱子位置。
   房主还额外存已通关的名次/暂停累计；房主自己被杀时 lan.js 的会话里存了「对局中 + 关卡 + 本局编号 + 开局时刻」，restore 后直接回到 playing。 */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const net = () => window.LAN_NET || null;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BAR_ROW_H = 18; // 数据条每行高度(px)，要和下面 CSS 的 line-height 一致
const NEED_DEF = (valid) => Math.max(1, valid - 1); // 完成多少人就结算：有效玩家数 − 1，至少 1
const MAX_LOG_IN_MSG = 6500; // 走法超过这么长就不随通关消息发(单条消息上限 8000)，房主按步数信任
const PROG_MS = 120;         // 进度消息最短间隔：每步 260ms 左右，基本每一步都会发出去
const SNAP_KEY = 'boxpusher_mp_snap_v1', SNAP_TTL = 30 * 60 * 1000;

/* ---------- 文案(并入 I18N，zh/en 两份) ---------- */
Object.assign(I18N.zh, {
  mpSteps: (n) => `${n}步`, mpFinWait: '已完成！等待其他玩家…', mpResTitle: '本局结算', mpUnfinished: '未完成', mpOffline: '掉线',
  mpEndConfirm: '再点一次，结束本局比赛',
  mpPauseTitle: (n) => `${n} 掉线了`, mpPauseSub: '已暂停，等他重新连上…', mpPauseGo: '不等了，继续',
  mpNetLost: '连接中断', mpNetLostSub: '正在重连，已暂停…', mpNetFailed: '自动重连失败', mpNetFailedSub: '请确认房主在线后手动重连', mpNetRetry: '手动重连', mpNetExit: '退出对局',
  mpNoLevel: '找不到这局的关卡，请更新到最新版本后再试', mpAborted: '本局已结束，回到大厅',
});
Object.assign(I18N.en, {
  mpSteps: (n) => `${n} mv`, mpFinWait: 'Done! Waiting for the others…', mpResTitle: 'Results', mpUnfinished: 'Unfinished', mpOffline: 'Offline',
  mpEndConfirm: 'Tap again to end the match',
  mpPauseTitle: (n) => `${n} went offline`, mpPauseSub: 'Paused, waiting for them to reconnect…', mpPauseGo: 'Continue without',
  mpNetLost: 'Connection lost', mpNetLostSub: 'Reconnecting, paused…', mpNetFailed: 'Auto-reconnect failed', mpNetFailedSub: 'Check the host is online, then reconnect', mpNetRetry: 'Reconnect', mpNetExit: 'Leave match',
  mpNoLevel: 'Race level not found, please update to the latest version', mpAborted: 'The match ended, back to the lobby',
});

/* ---------- 样式 ---------- */
const css = document.createElement('style');
css.textContent = `
/* 联机对局：棋盘下方原来的「第几关/步数」换成玩家数据条 */
#app.mp #levelInfo { display: none; }
#mpBar { display: flex; flex-wrap: wrap; justify-content: center; width: min(94vw, 460px); margin: 4px auto 0; font-size: 12px; font-weight: 800; line-height: ${BAR_ROW_H}px;
  color: rgba(255, 255, 255, 0.92); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); font-variant-numeric: tabular-nums; -webkit-user-select: none; user-select: none; }
.mpP { box-sizing: border-box; flex: 0 1 auto; min-width: 0; max-width: 50%; padding: 0 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mpBar[data-n="3"] .mpP, #mpBar[data-n="4"] .mpP { flex: 0 0 50%; text-align: center; }
.mpP b { font-weight: 900; }
.mpP.me b { color: #ffe9a8; }
.mpDot { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 50%; vertical-align: 1px; background: #9fd66b; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35); }
.mpDot.bad { background: #ff7a5c; } .mpDot.off { background: #8a8a8a; }

/* 顶部一条：完成后的等待提示 */
#mpTop { position: fixed; z-index: 60; left: 10px; right: 10px; top: calc(max(env(safe-area-inset-top, 0px), 8px) + 8px); display: none; align-items: center; gap: 8px; pointer-events: none; }
#mpBanner { flex: 1; min-width: 0; text-align: center; padding: 6px 12px; border-radius: 14px; font-size: 13px; font-weight: 800; color: #f6e3ae; background: rgba(30, 20, 10, 0.66);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; visibility: hidden; }
#mpBanner.on { visibility: visible; }

/* 暂停菜单里联机对局中灰掉的选项(选关；玩家的「离开」键)：灰色=不响应；房主点「离开」第一下进入待确认(红色描边)，3 秒内再点才结束本局 */
#pauseRow button.mpOff { opacity: 0.35; filter: grayscale(0.7); pointer-events: none; }
#pauseRow button.mpArmed { box-shadow: 0 0 0 3px rgba(255, 112, 80, 0.95), 0 0 14px rgba(255, 90, 60, 0.7); border-radius: 50%; transform: scale(1.08); }

/* 暂停 / 断线提示卡 */
#mpModal { position: fixed; inset: 0; z-index: 240; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.5); visibility: hidden; pointer-events: none; }
#mpModal.show { visibility: visible; pointer-events: auto; }
.mpCard { box-sizing: border-box; width: 100%; max-width: 320px; padding: 20px 20px 18px; border-radius: 14px; text-align: center; color: #f3e6c8;
  background: linear-gradient(180deg, rgba(66, 44, 26, 0.96), rgba(36, 24, 14, 0.97)); border: 1px solid rgba(243, 223, 178, 0.25); box-shadow: inset 0 1px 0 rgba(255, 240, 210, 0.16), 0 8px 30px rgba(0, 0, 0, 0.5); }
.mpCard h3 { margin: 0 0 8px; font-size: 20px; font-weight: 900; letter-spacing: 0.06em; color: #f6e3ae; }
.mpCard p { margin: 0 0 12px; font-size: 14px; font-weight: 700; line-height: 1.5; color: #d9c08a; }
.mpCard p:empty { display: none; }
.mpCard .mrBtn { margin: 4px 4px 0; }

/* 结算画面：深色毛玻璃(结构同大厅/选关面板，B22：浮层自己不带 backdrop-filter，模糊全在 Wrap::before) */
#mpResOv { position: fixed; inset: 0; background: rgba(0, 0, 0, 0); display: flex; align-items: center; justify-content: center;
  padding: max(5vh, env(safe-area-inset-top)) 14px 5vh; z-index: 245; visibility: hidden; pointer-events: none; transition: background-color 0.2s ease, visibility 0s linear 0.2s; }
#mpResOv.show { background: rgba(0, 0, 0, 0.4); visibility: visible; pointer-events: auto; transition: background-color 0.2s ease, visibility 0s; }
#mpResWrap { --lp-blur: 10px; --lp-sat: 0.55; --lp-tint-a: 0.62; --lp-tint-b: 0.72; --lp-gi: 15px 12px 14px 12px;
  position: relative; width: 100%; max-width: 460px; max-height: 100%; display: flex; flex-direction: column; transform: scale(0.96); transition: transform 0.2s ease; }
#mpResOv.show #mpResWrap { transform: scale(1); }
@media (min-width: 700px) { #mpResWrap { max-width: 520px; } }
#mpResWrap::before { content: ''; position: absolute; inset: var(--lp-gi); z-index: 0; pointer-events: none; border-radius: 6px;
  background: linear-gradient(180deg, rgba(66, 44, 26, var(--lp-tint-a)), rgba(36, 24, 14, var(--lp-tint-b)));
  -webkit-backdrop-filter: blur(var(--lp-blur)) saturate(var(--lp-sat)); backdrop-filter: blur(var(--lp-blur)) saturate(var(--lp-sat));
  box-shadow: inset 0 1px 0 rgba(255, 240, 210, 0.16), inset 0 0 26px rgba(0, 0, 0, 0.35); }
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  #mpResWrap::before { background: linear-gradient(180deg, rgba(58, 40, 24, 0.94), rgba(34, 22, 13, 0.96)); } }
#mpResSheet.artPanel { position: relative; z-index: 1; background: transparent; width: 100%; min-height: 0; padding: 10px 16px 20px; overflow-y: auto; overscroll-behavior: contain; }
#mrHead { display: flex; flex-direction: column; align-items: center; margin: 6px 0 16px; }
#mrTitle { font-size: 30px; font-weight: 900; letter-spacing: 0.3em; text-indent: 0.3em; line-height: 1.15; color: #f3dfb2; text-shadow: 0 1px 0 rgba(30, 16, 4, 0.75), 0 2px 6px rgba(0, 0, 0, 0.4); }
html[data-lang="en"] #mrTitle { font-size: 26px; letter-spacing: 0.12em; text-indent: 0.12em; }
#mrList { display: flex; flex-direction: column; gap: 8px; margin: 0 0 18px; }
.mrRow { display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 6px 14px; border-radius: 10px; background: rgba(255, 236, 200, 0.07); box-shadow: inset 0 0 0 1px rgba(243, 223, 178, 0.14); }
.mrRow.first { background: rgba(242, 180, 94, 0.12); box-shadow: inset 0 0 0 1.5px rgba(242, 180, 94, 0.7); }
.mrRank { flex: none; width: 24px; text-align: center; font-size: 22px; font-weight: 900; color: #f2b45e; }
.mrName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 800; color: #f6e8c4; }
.mrRow.me .mrName { color: #fff0c8; }
.mrName em { font-style: normal; font-size: 13px; font-weight: 700; color: #d9c08a; margin-left: 6px; }
.mrRes { flex: none; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.3; }
.mrT { font-size: 19px; font-weight: 900; color: #f6e3ae; font-variant-numeric: tabular-nums; }
.mrT.dim { font-size: 14px; font-weight: 800; color: rgba(217, 192, 138, 0.75); }
.mrRes small { font-size: 12px; font-weight: 700; color: #d9c08a; font-variant-numeric: tabular-nums; }
#mrBtns { display: flex; justify-content: center; }

/* 玻璃按钮(结算画面/提示卡)：半透明奶油色填充 + 细边，不用 backdrop-filter */
.mrBtn { min-width: 150px; height: 46px; padding: 0 20px; border-radius: 12px; border: 1px solid rgba(243, 223, 178, 0.5);
  background: linear-gradient(180deg, rgba(255, 236, 200, 0.2), rgba(255, 236, 200, 0.08)); box-shadow: inset 0 1px 0 rgba(255, 240, 210, 0.25), 0 2px 6px rgba(0, 0, 0, 0.3);
  color: #f6e3ae; font-size: 17px; font-weight: 800; letter-spacing: 0.15em; text-indent: 0.15em; -webkit-tap-highlight-color: transparent; }
.mrBtn:active { background: rgba(255, 236, 200, 0.3); transform: translateY(1px); }
html[data-lang="en"] .mrBtn { font-size: 15px; letter-spacing: 0.05em; text-indent: 0.05em; }
`;
document.head.appendChild(css);

/* ---------- 状态 ---------- */
let M = null;            // 当前对局；null=不在对局里
let curRoom = null;      // 最近一次房间状态
let skipPlaying = false; // 本轮 playing 已经处理过(结算了/缺关卡)：房间回到非 playing 之前，不再因为 playing 状态重新开局
let resultOpen = false;
let matchNo = 0;
let warnedLv = '';
let modalKey = '';

/* ---------- 关卡 / 走法校验 ---------- */
function findLevel(id) {
  const pk = window.MP_LEVEL_PACK;
  if (!pk || !Array.isArray(pk.tiers)) return null;
  for (const tr of pk.tiers) for (const lv of (tr.levels || [])) if (lv && lv.id === id && typeof lv.xsb === 'string') return lv;
  return null;
}
const VEC = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
function parseXsb(xsb) { // 规则和 index.html 的 parseLevel 一致(只取校验需要的部分)
  const rows = xsb.split('\n'), walls = new Set(), targets = new Set(), boxes = new Set();
  let player = null;
  rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) {
    const ch = row[c], k = r + ',' + c;
    if (ch === '#') walls.add(k);
    if (ch === '.' || ch === '*' || ch === '+') targets.add(k);
    if (ch === '$' || ch === '*') boxes.add(k);
    if (ch === '@' || ch === '+') player = { r, c };
  } });
  return { walls, targets, boxes, player };
}
function simulate(xsb, seq) { // 房主用：重放走法，返回 {ok:是否真的推完, steps}；规则同 replayMoves(撞墙/推不动的步不会出现在 moveLog 里，出现就是假的)
  const L = parseXsb(xsb);
  if (!L.player || !L.targets.size) return { ok: false, steps: 0 };
  let { r, c } = L.player;
  for (const ch of seq) {
    const v = VEC[ch];
    if (!v) return { ok: false, steps: 0 };
    const nr = r + v[0], nc = c + v[1], nk = nr + ',' + nc;
    if (L.walls.has(nk)) return { ok: false, steps: 0 };
    if (L.boxes.has(nk)) {
      const bk = (nr + v[0]) + ',' + (nc + v[1]);
      if (L.walls.has(bk) || L.boxes.has(bk)) return { ok: false, steps: 0 };
      L.boxes.delete(nk); L.boxes.add(bk);
    }
    r = nr; c = nc;
  }
  let ok = true; L.targets.forEach((k) => { if (!L.boxes.has(k)) ok = false; });
  return { ok, steps: seq.length };
}

/* ---------- 本机数据 ---------- */
function placed() { let n = 0; if (state) state.boxes.forEach((k) => { if (state.targets.has(k)) n++; }); return n; }
function mine() { return { s: state ? state.moves : 0, p: placed(), f: M && M.finished ? 1 : 0, q: M ? M.q : 0 }; }
function pushReport() { const n = net(); if (n && M && !M.done && state && state.mp) n.setReport(mine()); }
function bump() { if (M) M.q = Math.max(M.q + 1, Date.now()); } // 版本号：毫秒时间戳且严格递增，杀后台重开后也比之前发出去的大
function sendProg(force) { // 进度即时发：玩家→房主；房主自己的直接广播给所有人(d.i=谁)
  if (!M || M.done) return;
  const now = Date.now();
  if (!force && now - M.lastProg < PROG_MS) {
    if (!M.progTimer) M.progTimer = setTimeout(() => { if (M) { M.progTimer = null; sendProg(true); } }, PROG_MS - (now - M.lastProg));
    return;
  }
  if (M.progTimer) { clearTimeout(M.progTimer); M.progTimer = null; }
  M.lastProg = now;
  const n = net(); if (!n) return;
  const r = mine(), d = { k: 'pg', s: r.s, p: r.p, f: r.f, q: r.q };
  if (M.isHost) { d.i = M.myPid; n.bcastGame(d); } else n.sendGame(d);
}
function applyProg(pid, d) { // 收到某人的进度(即时消息或心跳里的上报)：版本号不比已有的新就丢掉
  if (!M || !M.order.includes(pid) || pid === M.myPid) return;
  const q = +d.q || 0, old = M.rep[pid];
  if (old && q < (+old.q || 0)) return;
  M.rep[pid] = { s: Math.max(0, Math.min(99999, d.s | 0)), p: Math.max(0, Math.min(99, d.p | 0)), f: d.f ? 1 : 0, q };
}

/* ---------- 续局快照(每台设备只存自己的) ---------- */
function snapNow() {
  if (!M || M.done || !state || !state.mp) return;
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify({ code: M.room.code, mid: M.room.mid || '', lv: M.levelId, log: state.moveLog.join(''), t: Date.now(),
      fins: M.isHost ? M.fins : undefined, pm: M.isHost ? M.pausedMs : undefined }));
  } catch (e) {}
}
function clearSnap() { try { localStorage.removeItem(SNAP_KEY); } catch (e) {} }
function readSnap(room, lvId) { // 只认「同一个房间 + 同一局」的快照
  try {
    const sn = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
    if (!sn || !room.mid || sn.code !== room.code || sn.mid !== room.mid || sn.lv !== lvId || Date.now() - (sn.t || 0) > SNAP_TTL) return null;
    return sn;
  } catch (e) { return null; }
}
function fmtTime(ms) { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function skinStyle(skin) { const c = (typeof SKIN_COLORS !== 'undefined' && SKIN_COLORS[skin]) || ['#2ECC71', '#E74C3C']; return `--c1:${c[0]};--c2:${c[1]}`; }

/* ---------- DOM(第一次用到才建) ---------- */
function ensureDom() {
  if ($('mpTop')) return;
  const top = document.createElement('div');
  top.id = 'mpTop';
  top.innerHTML = '<div id="mpBanner"></div>';
  document.body.appendChild(top);
  const modal = document.createElement('div');
  modal.id = 'mpModal';
  document.body.appendChild(modal);
  const res = document.createElement('div');
  res.id = 'mpResOv';
  res.innerHTML = '<div id="mpResWrap"><div id="mpResSheet" class="artPanel"><div id="mrHead"><span id="mrTitle"></span></div><div id="mrList"></div><div id="mrBtns"><button id="mrBack" class="mrBtn"></button></div></div></div>';
  document.body.appendChild(res);
  bindTap($('mrBack'), backToLobby);
}
function buildBar() {
  let bar = $('mpBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'mpBar'; $('levelInfo').after(bar); }
  bar.dataset.n = String(M.order.length);
  bar.innerHTML = M.order.map((pid) => `<span class="mpP${pid === M.myPid ? ' me' : ''}" data-pid="${esc(pid)}"><i class="mpDot"></i><b>${esc(M.names[pid])}</b><span class="mpE"></span> <span class="mpS"></span></span>`).join('');
}
function dotClass(pid) {
  if (pid === M.myPid) return M.netBad ? 'bad' : 'good';
  const pl = M.room.players.find((p) => p.pid === pid);
  if (!pl || pl.online === false) return 'off';
  if (pid === M.hostPid) return M.netBad ? 'bad' : 'good';
  const ms = M.ping[pid], age = Date.now() - (M.pingAt[pid] || M.t0);
  return (age > 3000 || ms > 300) ? 'bad' : 'good'; // 延迟高(>300ms)或 3 秒没回包：红
}
function paintBar() { // 只改文字节点和类名，不重绘(B24)
  const bar = $('mpBar');
  if (!M || !bar) return;
  bar.querySelectorAll('.mpP').forEach((el) => {
    const pid = el.dataset.pid, r = pid === M.myPid ? mine() : M.rep[pid];
    el.querySelector('.mpDot').className = 'mpDot ' + dotClass(pid);
    let txt = '';
    if (r && typeof r.s === 'number') txt = t('mpSteps', r.s) + ' ' + (r.p | 0) + '/' + M.total + (r.f ? ' ✓' : '') + (r.x ? ' ' + r.x : ''); // r.x：以后惩罚状态(如「混乱」)，现在恒为空
    el.querySelector('.mpS').textContent = txt;
  });
}
function paintTop() {
  const top = $('mpTop');
  if (!top) return;
  const on = !!M && !M.done;
  top.style.display = on ? 'flex' : 'none';
  if (!on) return;
  const ban = $('mpBanner');
  ban.textContent = t('mpFinWait');
  ban.classList.toggle('on', M.finished);
}
function card(title, sub, btns) {
  return `<div class="mpCard"><h3>${esc(title)}</h3><p>${esc(sub || '')}</p>${btns.map(([key, act]) => `<button class="mrBtn" data-act="${act}">${esc(t(key))}</button>`).join('')}</div>`;
}
function paintModal() { // 优先级：本机断线 > 别人掉线的暂停；内容没变就不重绘(暂停消息会随房间变化重发)
  const el = $('mpModal');
  if (!el) return;
  let key = '', html = '';
  if (M && !M.done && M.netBad) {
    key = M.netFailed ? 'nf' : 'nw';
    html = M.netFailed ? card(t('mpNetFailed'), t('mpNetFailedSub'), [['mpNetRetry', 'retry'], ['mpNetExit', 'exit']]) : card(t('mpNetLost'), t('mpNetLostSub'), []);
  } else if (M && !M.done && M.paused) {
    key = 'p:' + M.pauseNames.join('|') + (M.isHost ? ':h' : '');
    html = card(t('mpPauseTitle', M.pauseNames.join('、') || '?'), t('mpPauseSub'), M.isHost ? [['mpPauseGo', 'go']] : []);
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
  else if (act === 'exit') { if (window.Lobby) Lobby.close(); endMatchUI(); } // Lobby.close = 离开房间(通知房主)并清掉本机房间状态
  else if (act === 'go') hostSkipOffline();
}

/* ---------- 开局 / 收尾 ---------- */
function startMatch(room) {
  const lv = findLevel(room.levelId);
  if (!lv) { skipPlaying = true; showToast(t('mpNoLevel')); return; } // 缺关卡(文件没更新)：留在大厅，房主可以「结束本局」
  const names = {}, skins = {}, order = [], pingAt = {}, t0 = Date.now();
  room.players.forEach((p) => { names[p.pid] = p.name; skins[p.pid] = p.skin; order.push(p.pid); pingAt[p.pid] = t0; });
  M = { levelId: lv.id, xsb: lv.xsb, total: 0, myPid: room.you, hostPid: room.hostPid, isHost: room.hostPid === room.you, names, skins, order, room,
    rep: {}, ping: {}, pingAt, t0, seg: 100 + (++matchNo) * 5, q: Date.now(), lastProg: 0, progTimer: null, finMsg: null, lastSnap: 0,
    finished: false, paused: false, pauseNames: [], netBad: false, netFailed: false, done: false,
    fins: [], pausedMs: 0, pauseAt: 0, hostPaused: false, settling: false, endArmed: false, timer: null };
  modalKey = '';
  if (typeof closeSettings === 'function') closeSettings();
  if (typeof closeLevelPick === 'function') closeLevelPick();
  if (window.Lobby) Lobby.hide();
  hideHomeScreen();
  if (window.SFX && SFX.bgmMatch) SFX.bgmMatch(true); // 联机对局 BGM：开局显式开(之前靠主页类名推断，联机路径下不触发)
  ensureDom();
  setSkinOverride(skins[room.you]); // 角色配色用房主分配的(房主永远经典、玩家随机不重色)；对局内「游戏外观」里这一栏灰掉
  $('app').classList.add('mp');
  buildBar();
  loadMpLevel(lv.xsb, lv.id, M.seg); // 单机进度先存好、联机不碰单机存档(见 index.html)
  M.total = state.targets.size;
  if (window.EV) EV.attach({ myPid: M.myPid, hostPid: M.hostPid, isHost: M.isHost, order: M.order, total: M.total,
    send: (d) => { const n = net(); if (n) n.sendGame(d); }, bcast: (d) => { const n = net(); if (n) n.bcastGame(d); },
    online: (pid) => { const p = M.room.players.find((x) => x.pid === pid); return !!p && p.online !== false; },
    finished: (pid) => pid === M.myPid ? M.finished : !!(M.rep[pid] && M.rep[pid].f),
    placedOf: (pid) => pid === M.myPid ? placed() : (M.rep[pid] ? M.rep[pid].p | 0 : 0) }); // 随机事件
  const sn = readSnap(room, lv.id); // 杀后台/重连回来：按上次的走法重放，回到原来的步数和箱子位置
  if (sn) {
    if (M.isHost) { M.fins = (Array.isArray(sn.fins) ? sn.fins : []).filter((f) => f && M.order.includes(f.pid)).slice(0, 4); M.pausedMs = +sn.pm || 0; }
    if (sn.log) restoreMpMoves(sn.log); // 重放时若已推完，会走 mpSolved 重发通关消息(房主按人去重，不会重复算)
  }
  bump(); pushReport(); sendProg(true); paintBar(); paintTop(); paintModal();
  M.timer = setInterval(tick, 1000);
  if (M.isHost) hostRoomChanged(); // 房主恢复对局时玩家都还没回来：立刻进入暂停等待
}
function tick() { if (!M || M.done) return; pushReport(); paintBar(); snapNow(); }
function stopMatchTimers() { if (window.EV) EV.detach(); if (M && M.timer) { clearInterval(M.timer); M.timer = null; } if (M && M.progTimer) { clearTimeout(M.progTimer); M.progTimer = null; } }
function hideResultUI() { resultOpen = false; const r = $('mpResOv'); if (r) r.classList.remove('show'); }
function endMatchUI() { // 收起对局画面，把主页放回来，单机恢复到进入前的关卡
  if (window.SFX && SFX.bgmMatch) SFX.bgmMatch(false);
  stopMatchTimers(); clearSnap();
  const n = net(); if (n) n.setReport(null);
  M = null; modalKey = '';
  hideResultUI();
  const top = $('mpTop'); if (top) top.style.display = 'none';
  const modal = $('mpModal'); if (modal) { modal.classList.remove('show'); modal.innerHTML = ''; }
  const bar = $('mpBar'); if (bar) bar.remove();
  setSkinOverride(null); // 还原成玩家自己设置里的配色
  $('app').classList.remove('mp');
  if (typeof closeSettings === 'function') closeSettings();
  showHomeScreen();
  leaveMp();
}
function backToLobby() { // 结算画面「返回大厅」
  const n = net(); if (n) n.back(); // 清掉自己的 inResult：别人那边名字不再灰
  endMatchUI();
  if (window.Lobby) Lobby.show();
}
function abortMatch() { // 没经结算就回大厅了(房主强制结束，或我重连回来时这局早结算完了)
  showToast(t('mpAborted'));
  endMatchUI();
  if (window.Lobby) Lobby.show();
}

/* ---------- 房主：收集通关 / 暂停表决 / 结算 ---------- */
function hostOnFin(pid, d) {
  if (!M || !M.isHost || M.done || !M.order.includes(pid) || M.fins.some((f) => f.pid === pid)) return;
  let steps = Math.max(1, Math.min(99999, Math.floor(Number(d.s)) || 0));
  if (typeof d.m === 'string') { // 带了走法：重放校验，没推完/走法不合规就不算
    const r = simulate(M.xsb, d.m);
    if (!r.ok) { console.warn('[MP] 走法校验没过，忽略这次通关', pid); return; }
    steps = r.steps;
  }
  const n = net(), now = Date.now();
  const t0 = (n && n.startedAt) || M.t0;
  const oneWay = pid === M.hostPid ? 0 : Math.round((M.ping[pid] || 0) / 2);
  const paused = M.pausedMs + (M.hostPaused ? now - M.pauseAt : 0);
  M.fins.push({ pid, t: Math.max(0, now - t0 - paused - oneWay), s: steps }); // 名次=收到的先后；用时只是显示用
  snapNow(); // 房主被杀后恢复，已通关的名次还在
  hostCheckSettle();
}
function validCount() { return M.room.players.filter((p) => p.online !== false).length; }
function hostCheckSettle() {
  if (!M || !M.isHost || M.done || M.settling || M.hostPaused) return; // 有人掉线、正在暂停表决时先不结算
  if (M.fins.length >= NEED_DEF(validCount())) settle();
}
function settle() { // 房主：生成名次，endRound 广播给全体(含自己)
  if (!M || !M.isHost || M.done || M.settling) return;
  M.settling = true;
  const rank = M.fins.map((f) => ({ pid: f.pid, n: M.names[f.pid], c: M.skins[f.pid], t: f.t, s: f.s, p: M.total, d: 1 }));
  const rest = M.order.filter((pid) => !M.fins.some((f) => f.pid === pid)).map((pid) => {
    const r = pid === M.myPid ? mine() : (M.rep[pid] || {});
    const pl = M.room.players.find((x) => x.pid === pid);
    return { pid, n: M.names[pid], c: M.skins[pid], s: r.s | 0, p: r.p | 0, d: 0, o: pl && pl.online !== false ? 0 : 1 };
  }).sort((a, b) => b.p - a.p || a.s - b.s); // 没完成的：已落位箱子多的靠前，再按步数少
  const n = net();
  if (!n || !n.endRound({ rank: rank.concat(rest), total: M.total, lv: M.levelId })) M.settling = false;
}
function hostRoomChanged() { // 房间状态一变：有人掉线就暂停(并反复通知，晚连上的人也能同步)，都回来了就恢复
  if (!M || !M.isHost || M.done) return;
  const off = M.room.players.filter((p) => p.pid !== M.hostPid && p.online === false), now = Date.now(), n = net();
  if (off.length) {
    if (!M.hostPaused) { M.hostPaused = true; M.pauseAt = now; }
    if (n) n.bcastGame({ k: 'pz', on: 1, n: off.map((p) => p.name).slice(0, 3) });
  } else {
    if (M.hostPaused) { M.pausedMs += now - M.pauseAt; M.hostPaused = false; if (n) n.bcastGame({ k: 'pz', on: 0 }); }
    hostCheckSettle();
  }
}
function hostSkipOffline() { // 「不等了，继续」：把掉线的人移出本局；房间一变，hostRoomChanged 会恢复并检查结算
  const n = net();
  if (!M || !M.isHost || !n || typeof n.removePlayer !== 'function') return;
  M.room.players.filter((p) => p.pid !== M.hostPid && p.online === false).forEach((p) => n.removePlayer(p.pid));
}

/* ---------- 结算画面 ---------- */
function showResult(d) {
  if (resultOpen) return;
  const rank = (Array.isArray(d.rank) ? d.rank : []).slice(0, 4);
  stopMatchTimers(); clearSnap();
  if (window.SFX && SFX.bgmMatch) SFX.bgmMatch(false); // 结算：BGM 淡出
  if (M) { M.done = true; paintTop(); paintModal(); }
  skipPlaying = true;
  if (window.Lobby) Lobby.hide(); // 没进到对局画面的人(缺关卡)大厅还开着：收起来，统一看结算
  ensureDom();
  const myPid = (M && M.myPid) || (curRoom && curRoom.you) || '', total = d.total | 0;
  $('mrTitle').textContent = t('mpResTitle');
  $('mrBack').textContent = t('lbBackLobby');
  $('mrList').innerHTML = rank.map((x, i) => {
    const done = !!x.d, me = x.pid === myPid;
    const res = done ? `<b class="mrT">${fmtTime(x.t)}</b><small>${t('mpSteps', x.s | 0)}</small>`
      : `<b class="mrT dim">${t(x.o ? 'mpOffline' : 'mpUnfinished')}</b><small>${t('mpSteps', x.s | 0)} · ${x.p | 0}/${total}</small>`;
    return `<div class="mrRow${i === 0 && done ? ' first' : ''}${me ? ' me' : ''}"><span class="mrRank">${i + 1}</span>${(window.Lobby && Lobby.headHTML) ? Lobby.headHTML(x.c, 32) : `<i class="lbDot" style="${skinStyle(x.c)}"></i>`}` + // 头像和大厅同一套(Lobby.headHTML)，没有 lobby.js 就退回小圆点
      `<span class="mrName">${esc(x.n || '?')}${me ? `<em>(${t('lbMe')})</em>` : ''}</span><span class="mrRes">${res}</span></div>`;
  }).join('');
  resultOpen = true;
  $('mpResOv').classList.add('show');
}

/* ---------- 来自 lobby.js 的转发 ---------- */
function mySkinIn(room) { const me = room.players.find((p) => p.pid === room.you); return me ? me.skin : null; }
function onRoom(room) {
  curRoom = room;
  if (room.phase !== 'playing') skipPlaying = false;
  if (!M) { // 倒计时(starting)就把配色备好，开局时不会闪；倒计时被取消/回到大厅就还原
    if (room.phase === 'starting') setSkinOverride(mySkinIn(room));
    else if (room.phase === 'lobby' && !resultOpen) setSkinOverride(null);
  }
  if (room.phase === 'starting' && room.levelId && warnedLv !== room.levelId && !findLevel(room.levelId)) { warnedLv = room.levelId; showToast(t('mpNoLevel')); } // 倒计时期间就提醒缺关卡
  if (M) {
    M.room = room;
    if (room.phase !== 'playing' && !M.done) { abortMatch(); return; }
    if (room.phase === 'playing') { hostRoomChanged(); paintBar(); }
    return;
  }
  if (room.phase === 'playing' && !skipPlaying) startMatch(room);
}
function onGame(d, fromPid) {
  if (!d || typeof d !== 'object') return;
  const hostPid = (M && M.hostPid) || (curRoom && curRoom.hostPid);
  if (d.k === 'result') { if (fromPid === hostPid) showResult(d); return; }
  if (!M || M.done) return;
  if (d.k === 'pg') { // 进度：房主广播的(d.i=谁)或玩家发给房主的；房主收到后再转发给其他人
    if (fromPid === M.hostPid) { if (d.i && d.i !== M.myPid) applyProg(String(d.i), d); }
    else if (M.isHost && M.order.includes(fromPid)) {
      applyProg(fromPid, d);
      const n = net(); if (n) n.bcastGame({ k: 'pg', i: fromPid, s: d.s | 0, p: d.p | 0, f: d.f ? 1 : 0, q: +d.q || 0 });
    }
    paintBar(); return;
  }
  if (d.k === 'pz') {
    if (fromPid !== M.hostPid) return;
    M.paused = !!d.on;
    M.pauseNames = Array.isArray(d.n) ? d.n.map(String).slice(0, 3) : [];
    paintModal();
  } else if (d.k === 'fin') hostOnFin(fromPid, d);
  else if (/^(et|st|rl|es)$/.test(d.k) && window.EV) EV.onMsg(d, fromPid); // 随机事件(et触发/rl抽签/st状态上报/es转发)
}
function onReports(m) {
  if (!M || M.done || !m) return;
  Object.keys(m).forEach((pid) => { if (m[pid]) applyProg(pid, m[pid]); }); // 兜底：1 秒一次的心跳上报；版本号旧的丢掉，掉线的人保留最后一次，结算要用
  paintBar();
}
function onLatency(m) {
  if (!M || !m) return;
  const now = Date.now();
  Object.keys(m).forEach((pid) => { M.ping[pid] = m[pid]; M.pingAt[pid] = now; });
  paintBar();
}
function onStatus(s) { // 'ok' | 'waiting' | 'failed'：本机和房主之间的连接
  if (!M || M.done) return;
  const bad = s !== 'ok', failed = s === 'failed';
  if (bad === M.netBad && failed === M.netFailed) return;
  M.netBad = bad; M.netFailed = failed;
  paintModal(); paintBar();
  if (!bad) { bump(); pushReport(); sendProg(true); const n = net(); if (n && M.finished && M.finMsg) n.sendGame(M.finMsg); } // 重连回来：补发进度；已通关的把通关消息再发一遍(断线时发丢了也不会卡住，房主按人去重)
}
function onClosed() { // 房间解散/彻底失联/被移出：收掉对局画面；返回 true 让大厅把表单和提示叫出来
  const was = !!M || resultOpen;
  if (was) endMatchUI(); else setSkinOverride(null);
  return was;
}
function onLeave() { setSkinOverride(null); clearSnap(); } // 玩家主动离开房间(大厅返回键)：配色还原，续局快照作废

/* ---------- 给核心(index.html / ui.js)用 ---------- */
function blocked() { return !!M && (M.finished || M.paused || M.netBad || M.done || (window.EV && EV.moveLock())); } // 完成后等待 / 别人掉线暂停 / 本机断线 / 已结算：锁住走步和撤销
function barH() { return M ? (M.order.length > 2 ? 2 : 1) * BAR_ROW_H + 6 : 22; }
function requestEnd(btn) { // 暂停菜单里的「离开」键(房主)：强制结算本局。第一下只是待确认(按钮红色描边 + 提示)，3 秒内再点才生效，免得误触——它会结束所有人的比赛
  if (!M || !M.isHost || M.done) return;
  if (!M.endArmed) {
    M.endArmed = true;
    if (btn) btn.classList.add('mpArmed');
    showToast(t('mpEndConfirm'));
    clearTimeout(M.endTimer);
    M.endTimer = setTimeout(() => { if (M) M.endArmed = false; if (btn) btn.classList.remove('mpArmed'); }, 3000);
    return;
  }
  clearTimeout(M.endTimer); M.endArmed = false;
  if (typeof setPause === 'function') setPause(false); // 先收起暂停菜单，结算画面才不会被盖住
  settle();
}
function restart() { // 暂停菜单「重来」：步数清零，用时照走(房主计时不受影响)
  if (!M || M.done || M.finished || blocked() || (window.EV && EV.locked())) return;
  loadMpLevel(M.xsb, M.levelId, M.seg);
  pushReport(); paintBar();
}

Bus.on('mpSolved', (d) => { // 本机推完最后一个箱子
  if (!M || M.done || M.finished) return;
  if (window.EV) EV.stop(true); // 通关了：收掉效果并通知房主
  M.finished = true;
  const n = net();
  const msg = { k: 'fin', s: d.moves };
  if (typeof d.log === 'string' && d.log.length <= MAX_LOG_IN_MSG) msg.m = d.log;
  M.finMsg = msg;
  if (n) n.sendGame(msg); // 房主自己发也会回环到 onGame，和玩家走同一条路；可能就在这一步里结算完
  if (!M || M.done) return;
  bump(); pushReport(); sendProg(true); paintBar(); paintTop(); snapNow();
});
['move', 'push', 'undo', 'levelLoad'].forEach((ev) => Bus.on(ev, () => { if (M && !M.done) { bump(); pushReport(); paintBar(); sendProg(); } }));
document.addEventListener('visibilitychange', () => { if (document.hidden) snapNow(); }); // 切后台/被杀前最后存一次
window.addEventListener('pagehide', snapNow);

window.MP = { onRoom, onGame, onReports, onLatency, onStatus, onClosed, onLeave, blocked, barH, restart, requestEnd, isHost: () => !!M && M.isHost, active: () => !!M };
})();
