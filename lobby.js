/* lobby.js — v1.26.1 本地多人：大厅界面（主页多人菜单 / 创建·加入面板 / 房间列表·准备·开始游戏）。
   自带 DOM / 样式 / 文案(同 look.js 的做法)，只依赖 base.js(Bus·t·I18N·bindTap·SKIN_KEYS·SKIN_COLORS·settings) 和 ui.js(showToast)。
   加载顺序：… → sound.js → look.js → lobby.js →（以后）lan.js。

   ── 网络适配器 net（这版用下面的 MockNet 模拟；以后 lan.js 提供同样接口的 window.LAN_NET，大厅 UI 不用改）──
   net.create({me})            → Promise；成功后用 net.onRoom(room) 推送房间状态
   net.join({code, me})        → Promise；失败 reject {reason:'notfound'|'full'|'started'|'timeout'}
   net.setReady(bool) / net.start() → Promise / net.leave()
   net.onRoom   = room => {}   每次变化都推「完整」房间状态(以主机为准，不合并)
   net.onClosed = reason => {} 房间没了：'host'=房主解散 / 'lost'=断线
   room = { code, mode:'race', phase:'lobby', hostToken, players:[{ token, name, skin, ready }] }；me = { token, name }
   玩家身份用 token(存 localStorage，见联网方案§2)，名字只是显示用；远端传来的名字一律转义后再进 innerHTML。 */
(function () {
'use strict';

const LOBBY_MOCK = true; // 测试期：房间里显示「测试工具」(模拟玩家加入/准备/离开)；接上真网络后改 false
const MAX_PLAYERS = 4;
const NAME_MAX = 8;
const PROFILE_KEY = 'boxpusher_mp_v1'; // { token, name }
const $ = (id) => document.getElementById(id);

/* ---------- 文案(并入 I18N，zh/en 两份) ---------- */
Object.assign(I18N.zh, {
  multi: '本地多人', mpCreate: '创建房间', mpJoin: '加入房间', mpBack: '返回',
  lbDefName: '玩家', lbName: '玩家名字', lbCode: '配对码', lbCodePh: '6 位配对码',
  lbCreateTitle: '创建房间', lbJoinTitle: '加入房间', lbRoomTitle: '房间',
  lbCreateGo: '创建', lbJoinGo: '加入', lbBack: '返回', lbConnecting: '连接中…',
  lbMode: '模式', lbRace: '竞速', lbCoop: '合作 · 敬请期待',
  lbHost: '房主', lbReady: '已准备', lbNotReady: '未准备', lbMe: '我', lbWaitSlot: '等待玩家加入…',
  lbReadyBtn: '准备', lbUnready: '取消准备', lbStart: '开始游戏', lbLeave: '离开房间', lbDisband: '解散房间',
  lbHintNeed: '至少需要 2 名玩家', lbHintWait: (a, b) => `等待玩家准备（${a}/${b}）`, lbHintGo: '全员已准备，可以开始',
  lbHintGuest: '准备好后点「准备」', lbHintReadyGuest: '已准备，等待房主开始…',
  lbErrCode: '请输入 6 位配对码', lbErrNotFound: '找不到这个房间', lbErrFull: '房间已满', lbErrStarted: '游戏已经开始', lbErrTimeout: '连接超时，请重试',
  lbClosedHost: '房主已解散房间', lbClosedLost: '与房间的连接断开了', lbStartSoon: '联机玩法开发中', lbTools: '测试工具（临时）',
  lbErrNetwork: '连不上配对服务器，请检查网络', lbErrSelf: '不能加入自己的房间', lbErrVersion: '双方版本不一致，请更新后重试',
  lbOffline: '掉线', lbHintPlaying: '游戏已开始（联机玩法开发中）', lbHintWaitHost: '连接中断，正在重连…', lbHintFailed: '自动重连失败，请确认房主在线后手动重连',
  lbReconnect: '手动重连', lbEndGame: '返回大厅（测试）', lbDbgTitle: '连接状态（测试）', lbRefresh: '刷新',
});
Object.assign(I18N.en, {
  multi: 'MULTIPLAYER', mpCreate: 'CREATE ROOM', mpJoin: 'JOIN ROOM', mpBack: 'BACK',
  lbDefName: 'Player', lbName: 'Player name', lbCode: 'Room code', lbCodePh: '6-character code',
  lbCreateTitle: 'Create Room', lbJoinTitle: 'Join Room', lbRoomTitle: 'Room',
  lbCreateGo: 'Create', lbJoinGo: 'Join', lbBack: 'Back', lbConnecting: 'Connecting…',
  lbMode: 'Mode', lbRace: 'Race', lbCoop: 'Co-op · Coming soon',
  lbHost: 'Host', lbReady: 'Ready', lbNotReady: 'Not ready', lbMe: 'me', lbWaitSlot: 'Waiting for player…',
  lbReadyBtn: 'Ready', lbUnready: 'Cancel', lbStart: 'Start', lbLeave: 'Leave', lbDisband: 'Close room',
  lbHintNeed: 'Need at least 2 players', lbHintWait: (a, b) => `Waiting for players (${a}/${b})`, lbHintGo: 'Everyone is ready',
  lbHintGuest: 'Tap Ready when you are set', lbHintReadyGuest: 'Ready — waiting for the host…',
  lbErrCode: 'Enter the 6-character code', lbErrNotFound: 'Room not found', lbErrFull: 'Room is full', lbErrStarted: 'Game already started', lbErrTimeout: 'Timed out, try again',
  lbClosedHost: 'The host closed the room', lbClosedLost: 'Connection lost', lbStartSoon: 'Multiplayer gameplay coming soon', lbTools: 'Test tools (temporary)',
  lbErrNetwork: 'Cannot reach the pairing server', lbErrSelf: 'You cannot join your own room', lbErrVersion: 'Version mismatch, please update',
  lbOffline: 'Offline', lbHintPlaying: 'Game started (gameplay coming soon)', lbHintWaitHost: 'Connection lost, reconnecting…', lbHintFailed: 'Auto-reconnect failed. Check the host, then reconnect',
  lbReconnect: 'Reconnect', lbEndGame: 'Back to lobby (test)', lbDbgTitle: 'Connection (test)', lbRefresh: 'Refresh',
});
const ERR_KEY = { notfound: 'lbErrNotFound', full: 'lbErrFull', started: 'lbErrStarted', timeout: 'lbErrTimeout', network: 'lbErrNetwork', self: 'lbErrSelf', version: 'lbErrVersion' };

/* ---------- 样式 ---------- */
const css = document.createElement('style');
css.textContent = `
/* 多人主页：第二张背景(与 #homeBg 同层，淡入淡出) + 主页菜单换成 创建/加入/返回 */
#homeBgMulti { position: fixed; inset: 0; z-index: 199; opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
  background: var(--bg) url('assets/UI/home_bg_portrait_Multiplayer.webp') center / cover no-repeat; }
@media (orientation: landscape) { #homeBgMulti { background-image: url('assets/UI/home_bg_landscape_Multiplayer.webp'); } }
#homeBgMulti.on { opacity: 1; }
#homeBg.hide ~ #homeBgMulti { opacity: 0; }
#homeMenu.multi > .homeBtn:not(.mpOnly) { display: none; }
#homeMenu:not(.multi) > .mpOnly { display: none; }
#homeMenu.multi > .mpOnly { animation: mpIn 0.22s ease both; }
@keyframes mpIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* 大厅浮层：结构/毛玻璃同选关面板(§20.1)。浮层自己不能带 backdrop-filter/opacity(B22)，模糊全在 #lobbyWrap::before */
#lobbyOverlay { position: fixed; inset: 0; background: rgba(0,0,0,0); display: flex; align-items: center; justify-content: center;
  padding: max(5vh, env(safe-area-inset-top)) 14px 5vh; z-index: 250; visibility: hidden; pointer-events: none;
  transition: background-color 0.2s ease, visibility 0s linear 0.2s; }
#lobbyOverlay.show { background: rgba(0,0,0,0.32); visibility: visible; pointer-events: auto; transition: background-color 0.2s ease, visibility 0s; }
#lobbyWrap { --lp-blur: 10px; --lp-sat: 0.55; --lp-tint-a: 0.62; --lp-tint-b: 0.72; --lp-gi: 15px 12px 14px 12px;
  position: relative; width: 100%; max-width: 460px; max-height: 100%; display: flex; flex-direction: column;
  transform: scale(0.96); transition: transform 0.2s ease; }
#lobbyOverlay.show #lobbyWrap { transform: scale(1); }
@media (min-width: 700px) { #lobbyWrap { max-width: 520px; } }
#lobbyWrap::before { content: ''; position: absolute; inset: var(--lp-gi); z-index: 0; pointer-events: none; border-radius: 6px;
  background: linear-gradient(180deg, rgba(66, 44, 26, var(--lp-tint-a)), rgba(36, 24, 14, var(--lp-tint-b)));
  -webkit-backdrop-filter: blur(var(--lp-blur)) saturate(var(--lp-sat)); backdrop-filter: blur(var(--lp-blur)) saturate(var(--lp-sat));
  box-shadow: inset 0 1px 0 rgba(255, 240, 210, 0.16), inset 0 0 26px rgba(0, 0, 0, 0.35); }
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  #lobbyWrap::before { background: linear-gradient(180deg, rgba(58, 40, 24, 0.94), rgba(34, 22, 13, 0.96)); } }
#lobbySheet.artPanel { position: relative; z-index: 1; background: transparent; --ink: #f3e6c8; --sub: #d9c08a; --accent: #f2b45e;
  width: 100%; min-height: 0; padding: 10px 16px 18px; touch-action: pan-y;
  overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }

/* 标题：玻璃上的字=奶油金「浮起来」(一条深棕细阴影 + 很淡的柔影，B14) */
#lbHead { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 6px 0 14px; }
#lbTitle { font-size: 30px; font-weight: 900; letter-spacing: 0.3em; text-indent: 0.3em; line-height: 1.15; color: #f3dfb2;
  text-shadow: 0 1px 0 rgba(30, 16, 4, 0.75), 0 2px 6px rgba(0, 0, 0, 0.4); }
#lbSub { display: flex; flex-direction: column; align-items: center; gap: 2px; }
#lbSub:empty { display: none; }
#lbSub small { font-size: 13px; font-weight: 700; letter-spacing: 0.2em; color: #d9c08a; opacity: 0.85; }
#lbSub b { font-size: 34px; font-weight: 900; letter-spacing: 0.28em; text-indent: 0.28em; color: #f6e3ae;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; text-shadow: 0 1px 0 rgba(30, 16, 4, 0.75), 0 2px 6px rgba(0, 0, 0, 0.4); }

/* 表单 */
.lbField { margin-bottom: 14px; }
.lbField label { display: block; margin: 0 2px 6px; font-size: 14px; font-weight: 800; letter-spacing: 0.1em; color: #d9c08a; }
.lbInput { width: 100%; height: 48px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(243, 223, 178, 0.35);
  background: rgba(20, 12, 6, 0.55); box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.4); color: #f6e8c4;
  font-size: 18px; font-weight: 700; outline: none; -webkit-appearance: none; appearance: none;
  -webkit-user-select: text; user-select: text; touch-action: manipulation; } /* 16px 以上 iOS 聚焦时不会自动放大页面；全局 user-select:none 要在这里改回 text 才能输入 */
.lbInput:focus { border-color: #f2b45e; }
.lbInput::placeholder { color: rgba(217, 192, 138, 0.45); font-weight: 600; letter-spacing: 0.05em; }
.lbInput.code { text-align: center; font-size: 24px; font-weight: 900; letter-spacing: 0.35em; text-indent: 0.35em; text-transform: uppercase; }
.lbMsg { min-height: 22px; margin: 0 0 10px; text-align: center; font-size: 14px; font-weight: 700; color: #ffb089; }
.lbMsg.info { color: #d9c08a; }
.lbBtns { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 4px; }

/* 木板按钮(素材同设置面板 plank_l)：选中/按下态=整块压暗，红色=关闭类 */
.lbBtn { position: relative; isolation: isolate; min-width: 160px; height: 44px; padding: 0 18px 2px; border: 0; background: none;
  color: #4a2a10; font-size: 18px; font-weight: 800; letter-spacing: 0.2em; text-indent: 0.2em;
  text-shadow: 0 1px 0 rgba(255, 226, 170, 0.45); -webkit-tap-highlight-color: transparent; }
.lbBtn::before { content: ''; position: absolute; inset: 0; z-index: -1; box-sizing: border-box;
  border-style: solid; border-color: #aa733c; border-width: 13px 14px;
  border-image-source: url('assets/UI/settings/plank_l.png'); border-image-slice: 40 46 fill; border-image-width: 13px 14px; border-image-repeat: stretch;
  background: #c98f50; background-clip: padding-box; }
.lbBtn:active { transform: translateY(1px); }
.lbBtn.on { color: #fff1d6; text-shadow: 0 1px 0 rgba(40, 15, 0, 0.55); }
.lbBtn.on::before { filter: brightness(0.62) saturate(1.2); }
.lbBtn.red { color: #fff1d6; text-shadow: 0 1px 0 rgba(40, 10, 0, 0.6); }
.lbBtn.red::before { filter: hue-rotate(-16deg) saturate(1.5) brightness(0.72); }
.lbBtn.off { opacity: 0.45; filter: saturate(0.6); pointer-events: none; }
html[data-lang="en"] .lbBtn { font-size: 16px; letter-spacing: 0.06em; text-indent: 0.06em; }

/* 房间 */
.lbMode { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0 0 12px; font-size: 14px; font-weight: 800; }
.lbMode span { color: #d9c08a; margin-right: 2px; }
.lbMode b { padding: 5px 12px; border-radius: 14px; font-weight: 800; }
.lbMode b.on { background: rgba(242, 180, 94, 0.2); color: #f6e3ae; box-shadow: inset 0 0 0 1px rgba(242, 180, 94, 0.55); }
.lbMode b.off { color: rgba(217, 192, 138, 0.5); box-shadow: inset 0 0 0 1px rgba(217, 192, 138, 0.2); }
#lbList { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.lbRow { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 14px; border-radius: 10px;
  background: rgba(255, 236, 200, 0.07); box-shadow: inset 0 0 0 1px rgba(243, 223, 178, 0.14); }
.lbRow.me { box-shadow: inset 0 0 0 1.5px rgba(242, 180, 94, 0.6); }
.lbRow.empty { background: none; box-shadow: none; border: 1px dashed rgba(217, 192, 138, 0.28); }
.lbRow.empty .lbName { color: rgba(217, 192, 138, 0.45); font-weight: 600; }
.lbDot { flex: none; width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255, 240, 210, 0.3);
  background: linear-gradient(90deg, var(--c1, transparent) 50%, var(--c2, transparent) 50%); }
.lbRow.empty .lbDot { background: none; box-shadow: none; border: 1px dashed rgba(217, 192, 138, 0.3); }
.lbName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; font-weight: 800; color: #f6e8c4; }
.lbName em { font-style: normal; font-size: 13px; font-weight: 700; color: #d9c08a; margin-left: 6px; }
.lbTag { flex: none; padding: 4px 11px; border-radius: 12px; font-size: 13px; font-weight: 800; letter-spacing: 0.06em; }
.lbTag.host { color: #f2b45e; background: rgba(242, 180, 94, 0.16); box-shadow: inset 0 0 0 1px rgba(242, 180, 94, 0.5); }
.lbTag.ready { color: #c9eb92; background: rgba(140, 200, 70, 0.2); box-shadow: inset 0 0 0 1px rgba(170, 220, 100, 0.55); }
.lbTag.wait { color: rgba(217, 192, 138, 0.7); box-shadow: inset 0 0 0 1px rgba(217, 192, 138, 0.25); }
.lbHint { min-height: 20px; margin: -4px 0 12px; text-align: center; font-size: 14px; font-weight: 700; color: #d9c08a; }
.lbTools { margin-top: 18px; padding: 10px; border: 1px dashed rgba(217, 192, 138, 0.35); border-radius: 10px;
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.lbToolsTitle { width: 100%; text-align: center; font-size: 12px; color: rgba(217, 192, 138, 0.6); }
.lbMini { height: 32px; padding: 0 12px; border-radius: 16px; border: 1px solid rgba(217, 192, 138, 0.5);
  background: rgba(255, 236, 200, 0.08); color: #f3e6c8; font-size: 13px; font-weight: 700; }
.lbMini:active { background: rgba(255, 236, 200, 0.22); }
.lbDbg { width: 100%; margin: 0; text-align: left; white-space: pre-wrap; word-break: break-all; font: 11px/1.45 ui-monospace, Menlo, monospace;
  color: #d9c08a; -webkit-user-select: text; user-select: text; }
`;
document.head.appendChild(css);

/* ---------- 工具 ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function randHex(n) {
  try { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return Math.random().toString(16).slice(2).padEnd(n * 2, '0').slice(0, n * 2); }
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混的 0/O/1/I
function genCode() {
  let s = '';
  try { const a = new Uint8Array(6); crypto.getRandomValues(a); a.forEach((b) => { s += CODE_CHARS[b % CODE_CHARS.length]; }); }
  catch (e) { for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; }
  return s;
}
function cleanName(s) { return [...String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim()].slice(0, NAME_MAX).join(''); }
function loadProfile() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; } catch (e) { p = {}; }
  if (!p.token) p.token = randHex(12);
  p.name = cleanName(p.name) || (t('lbDefName') + (10 + Math.floor(Math.random() * 90)));
  saveProfile(p);
  return p;
}
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ token: p.token, name: p.name })); } catch (e) {} }
function skinDot(skin) { const c = (typeof SKIN_COLORS !== 'undefined' && SKIN_COLORS[skin]) || ['#2ECC71', '#E74C3C']; return `--c1:${c[0]};--c2:${c[1]}`; }

/* ---------- MockNet：本地模拟(没有网络)，用来先把大厅界面和流程在真机上跑通 ----------
   测试用配对码：ZZZZZZ → 找不到房间；FFFFFF → 房间已满；其它 6 位码 → 加入一个有「房主小明」的房间 */
const MOCK_NAMES = { classic: '小绿', blue: '小蓝', purple: '小紫', gold: '小黄' }; // 名字跟它分到的人物配色对应，方便在列表里一眼对上
const MockNet = {
  room: null, me: null, onRoom: null, onClosed: null,
  _push() { if (this.room && this.onRoom) this.onRoom(JSON.parse(JSON.stringify(this.room))); },
  _freeSkin() { const used = this.room.players.map((p) => p.skin); return SKIN_KEYS.find((k) => !used.includes(k)) || 'classic'; },
  _mine() { return this.room && this.room.players.find((p) => p.token === this.me.token); },
  create({ me }) {
    return wait(250).then(() => {
      this.me = me;
      this.room = { code: genCode(), mode: 'race', phase: 'lobby', hostToken: me.token, players: [{ token: me.token, name: me.name, skin: 'classic', ready: true }] };
      this._push();
    });
  },
  join({ code, me }) {
    return wait(700).then(() => {
      if (code === 'ZZZZZZ') throw { reason: 'notfound' };
      if (code === 'FFFFFF') throw { reason: 'full' };
      this.me = me;
      this.room = { code, mode: 'race', phase: 'lobby', hostToken: 'mock-host', players: [{ token: 'mock-host', name: '房主小明', skin: 'classic', ready: true }] };
      this.room.players.push({ token: me.token, name: me.name, skin: this._freeSkin(), ready: false });
      this._push();
    });
  },
  setReady(v) { const p = this._mine(); if (p) { p.ready = !!v; this._push(); } },
  start() { this.room.phase = 'playing'; this._push(); return Promise.resolve(); },
  endGame() { if (!this.room) return; this.room.phase = 'lobby'; this.room.players.forEach((p) => { if (p.token !== this.room.hostToken) p.ready = false; }); this._push(); },
  leave() { this.room = null; },
  // ---- 测试工具 ----
  mockAdd() {
    if (!this.room || this.room.players.length >= MAX_PLAYERS) return;
    const skin = this._freeSkin();
    this.room.players.push({ token: 'mock-' + randHex(3), name: MOCK_NAMES[skin], skin, ready: false });
    this._push();
  },
  mockDel() {
    if (!this.room) return;
    for (let i = this.room.players.length - 1; i >= 0; i--) {
      const tk = this.room.players[i].token;
      if (tk.startsWith('mock-') && tk !== 'mock-host') { this.room.players.splice(i, 1); this._push(); return; }
    }
  },
  mockToggleAll() { // 模拟玩家(不含我、不含房主)：有人没准备就全部准备，否则全部取消
    if (!this.room) return;
    const gs = this.room.players.filter((p) => p.token.startsWith('mock-') && p.token !== 'mock-host' && p.token !== this.me.token);
    const allReady = gs.length && gs.every((p) => p.ready);
    gs.forEach((p) => { p.ready = !allReady; });
    this._push();
  },
  mockHostClose() { const cb = this.onClosed; this.room = null; if (cb) cb('host'); },
};

/* ---------- 大厅 ---------- */
const LB = { form: 'create', view: 'form', room: null, me: null, busy: false, status: 'ok', lastPhase: 'lobby' };
let net = null;

const ov = document.createElement('div');
ov.id = 'lobbyOverlay';
ov.innerHTML = '<div id="lobbyWrap"><div id="lobbySheet" class="artPanel"><div id="lbHead"><span id="lbTitle"></span><span id="lbSub"></span></div><div id="lbBody"></div></div></div>';
document.body.appendChild(ov);

function tap(id, fn) { // 带「灰掉就不响应」保护的 bindTap
  const el = $(id);
  if (el) bindTap(el, () => { if (!el.classList.contains('off')) fn(); });
}
function showMsg(text, info) { const m = $('lbMsg'); if (m) { m.textContent = text || ''; m.classList.toggle('info', !!info); } }
function setBusy(b) { LB.busy = b; const g = $('lbGo'); if (g) g.classList.toggle('off', b); }
function getNet() { return (window.LAN_NET && !/[?&]mock\b/.test(location.search)) ? window.LAN_NET : MockNet; } // 有 lan.js 就用真网络；网址加 ?mock 强制用模拟

function openLobby(form) {
  LB.me = loadProfile(); LB.form = form; LB.room = null; LB.busy = false; LB.status = 'ok'; LB.lastPhase = 'lobby';
  net = getNet(); net.onRoom = onRoom; net.onClosed = onClosed; net.onStatus = onStatus;
  renderForm();
  ov.classList.add('show');
}
function closeLobby() { // 回到多人主页
  if (LB.room && net) net.leave();
  LB.room = null;
  ov.classList.remove('show');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
function leaveRoom() { if (net) net.leave(); LB.room = null; LB.status = 'ok'; LB.lastPhase = 'lobby'; renderForm(); }

function renderForm() {
  LB.view = 'form';
  const join = LB.form === 'join';
  $('lbTitle').textContent = t(join ? 'lbJoinTitle' : 'lbCreateTitle');
  $('lbSub').innerHTML = '';
  $('lbBody').innerHTML =
    `<div class="lbField"><label>${t('lbName')}</label><input id="lbName" class="lbInput" maxlength="${NAME_MAX}" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(LB.me.name)}"></div>` +
    (join ? `<div class="lbField"><label>${t('lbCode')}</label><input id="lbCode" class="lbInput code" maxlength="6" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${t('lbCodePh')}"></div>` : '') +
    `<div id="lbMsg" class="lbMsg"></div>` +
    `<div class="lbBtns"><button id="lbGo" class="lbBtn">${t(join ? 'lbJoinGo' : 'lbCreateGo')}</button><button id="lbBack" class="lbBtn red">${t('lbBack')}</button></div>`;
  const nameEl = $('lbName'), codeEl = $('lbCode');
  nameEl.addEventListener('blur', () => { LB.me.name = cleanName(nameEl.value) || LB.me.name; nameEl.value = LB.me.name; saveProfile(LB.me); window.scrollTo(0, 0); });
  if (codeEl) {
    codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    codeEl.addEventListener('blur', () => window.scrollTo(0, 0));
  }
  [nameEl, codeEl].forEach((el) => { if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { el.blur(); doGo(); } }); });
  tap('lbGo', doGo);
  tap('lbBack', closeLobby);
}

async function doGo() {
  if (LB.busy) return;
  const nameEl = $('lbName');
  LB.me.name = cleanName(nameEl.value) || LB.me.name; nameEl.value = LB.me.name; saveProfile(LB.me);
  const meInfo = { token: LB.me.token, name: LB.me.name };
  const join = LB.form === 'join';
  let code = '';
  if (join) {
    code = $('lbCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) { showMsg(t('lbErrCode')); return; }
  }
  setBusy(true); showMsg(join ? t('lbConnecting') : '', true);
  try { if (join) await net.join({ code, me: meInfo }); else await net.create({ me: meInfo }); } // 成功后房间状态走 onRoom 渲染
  catch (e) { showMsg(t(ERR_KEY[e && e.reason] || 'lbErrTimeout')); }
  setBusy(false);
}

function onRoom(room) {
  const prev = LB.lastPhase; LB.lastPhase = room.phase; LB.room = room;
  if (!ov.classList.contains('show')) return;
  renderRoom();
  if (room.phase === 'playing' && prev !== 'playing') showToast(t('lbStartSoon')); // 房主和玩家都由房间状态切到 playing 触发
}
function onStatus(s) { // 'ok' | 'waiting' | 'failed'(来自 lan.js 的掉线/重连状态)
  LB.status = s;
  if (ov.classList.contains('show') && LB.view === 'room' && LB.room) renderRoom();
}
function onClosed(reason) {
  LB.room = null; LB.status = 'ok'; LB.lastPhase = 'lobby';
  if (!ov.classList.contains('show')) return;
  renderForm();
  showMsg(t(reason === 'host' ? 'lbClosedHost' : 'lbClosedLost'));
}

function renderRoom() {
  LB.view = 'room';
  const r = LB.room;
  const myTok = LB.me.token;
  const isHost = r.hostToken === myTok;
  const me = r.players.find((p) => p.token === myTok) || {};
  const guests = r.players.filter((p) => p.token !== r.hostToken);
  const readyN = guests.filter((p) => p.ready).length;
  const canStart = r.players.length >= 2 && readyN === guests.length;

  $('lbTitle').textContent = t('lbRoomTitle');
  $('lbSub').innerHTML = `<small>${t('lbCode')}</small><b>${esc(r.code)}</b>`;

  let rows = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = r.players[i];
    if (!p) { rows += `<div class="lbRow empty"><i class="lbDot"></i><span class="lbName">${t('lbWaitSlot')}</span></div>`; continue; }
    const tag = p.online === false ? `<span class="lbTag wait">${t('lbOffline')}</span>`
      : p.token === r.hostToken ? `<span class="lbTag host">${t('lbHost')}</span>`
      : p.ready ? `<span class="lbTag ready">${t('lbReady')}</span>` : `<span class="lbTag wait">${t('lbNotReady')}</span>`;
    rows += `<div class="lbRow${p.token === myTok ? ' me' : ''}"><i class="lbDot" style="${skinDot(p.skin)}"></i>` +
      `<span class="lbName">${esc(p.name)}${p.token === myTok ? `<em>(${t('lbMe')})</em>` : ''}</span>${tag}</div>`;
  }

  const playing = r.phase === 'playing', live = LB.status === 'ok';
  let hint, action;
  if (isHost) {
    hint = playing ? t('lbHintPlaying') : r.players.length < 2 ? t('lbHintNeed') : (canStart ? t('lbHintGo') : t('lbHintWait', readyN, guests.length));
    action = `<button id="lbStart" class="lbBtn${canStart && !playing && live ? '' : ' off'}">${t('lbStart')}</button>`;
  } else {
    hint = playing ? t('lbHintPlaying') : me.ready ? t('lbHintReadyGuest') : t('lbHintGuest');
    action = `<button id="lbReady" class="lbBtn${me.ready ? ' on' : ''}${playing || !live ? ' off' : ''}">${t(me.ready ? 'lbUnready' : 'lbReadyBtn')}</button>`;
  }
  if (LB.status === 'waiting') hint = t('lbHintWaitHost');
  if (LB.status === 'failed') { hint = t('lbHintFailed'); action = `<button id="lbReconn" class="lbBtn">${t('lbReconnect')}</button>`; }

  const endBtn = isHost && playing && net && net.endGame ? `<button id="mkEnd" class="lbMini">${t('lbEndGame')}</button>` : '';
  let tools = '';
  if (LOBBY_MOCK && net && net.mockAdd) {
    tools = `<div class="lbTools"><div class="lbToolsTitle">${t('lbTools')}</div>` + (isHost
      ? `<button id="mkAdd" class="lbMini">＋ 玩家</button><button id="mkDel" class="lbMini">－ 玩家</button><button id="mkRdy" class="lbMini">全员 准备/取消</button>`
      : `<button id="mkAdd" class="lbMini">＋ 玩家</button><button id="mkDel" class="lbMini">－ 玩家</button><button id="mkClose" class="lbMini">房主解散</button>`) + endBtn + `</div>`;
  } else if (net && net.debugInfo) { // 真网络：显示连接状态，真机没有控制台，靠这里排查
    tools = `<div class="lbTools"><div class="lbToolsTitle">${t('lbDbgTitle')}</div><pre id="lbDbg" class="lbDbg">${esc(net.debugInfo())}</pre><button id="dbgRefresh" class="lbMini">${t('lbRefresh')}</button>${endBtn}</div>`;
  }

  // 已准备的玩家：整个房间界面只剩「取消准备」和「离开房间」可点(名字等都不可改)，见上面 action 只有一个键
  $('lbBody').innerHTML =
    `<div class="lbMode"><span>${t('lbMode')}</span><b class="on">${t('lbRace')}</b><b class="off">${t('lbCoop')}</b></div>` +
    `<div id="lbList">${rows}</div><div class="lbHint">${hint}</div>` +
    `<div class="lbBtns">${action}<button id="lbLeave" class="lbBtn red">${t(isHost ? 'lbDisband' : 'lbLeave')}</button></div>${tools}`;

  tap('lbReady', () => net.setReady(!me.ready));
  tap('lbStart', () => { net.start().catch(() => {}); }); // 成功后由 onRoom 里 phase 变 playing 统一弹提示
  tap('lbReconn', () => net.reconnect());
  tap('lbLeave', leaveRoom);
  tap('mkEnd', () => net.endGame());
  tap('dbgRefresh', () => { const d = $('lbDbg'); if (d) d.textContent = net.debugInfo(); });
  if (tools) {
    tap('mkAdd', () => net.mockAdd()); tap('mkDel', () => net.mockDel());
    tap('mkRdy', () => net.mockToggleAll()); tap('mkClose', () => net.mockHostClose());
  }
}

/* ---------- 主页：多人菜单 ---------- */
const menu = $('homeMenu');
const bgMulti = document.createElement('div');
bgMulti.id = 'homeBgMulti';
$('homeBg').after(bgMulti);
function addHomeBtn(id, key) {
  const b = document.createElement('button');
  b.className = 'homeBtn mpOnly'; b.id = id; b.dataset.i18n = key; b.textContent = t(key);
  menu.appendChild(b);
  return b;
}
const bCreate = addHomeBtn('homeMpCreate', 'mpCreate');
const bJoin = addHomeBtn('homeMpJoin', 'mpJoin');
const bBack = addHomeBtn('homeMpBack', 'mpBack');

function enterMultiHome() { menu.classList.add('multi'); bgMulti.classList.add('on'); }
function exitMultiHome() { menu.classList.remove('multi'); bgMulti.classList.remove('on'); }
bindTap($('homeMulti'), enterMultiHome);
bindTap(bCreate, () => openLobby('create'));
bindTap(bJoin, () => openLobby('join'));
bindTap(bBack, exitMultiHome);

// 多人背景图：页面空闲时预加载当前方向那张，第一次点进去不闪
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => {
  const im = new Image();
  im.src = 'assets/UI/' + (window.matchMedia('(orientation: landscape)').matches ? 'home_bg_landscape_Multiplayer.webp' : 'home_bg_portrait_Multiplayer.webp');
});

applyI18n(); // 本文件的文案是 look.js 同样的方式并入 I18N 的，这里补刷一次静态文字(多人按钮)

window.Lobby = { open: openLobby, close: closeLobby, enterMultiHome, exitMultiHome }; // 给以后的 lan.js / 联机模块用
})();
