/* lobby.js — 本地多人：大厅界面（主页多人菜单 / 创建·加入面板 / 房间列表·准备·开始游戏）。
   自带 DOM / 样式 / 文案(同 look.js 的做法)，只依赖 base.js(Bus·t·I18N·bindTap·SKIN_KEYS·SKIN_COLORS·settings) 和 ui.js(showToast)。
   加载顺序：… → sound.js → look.js → lobby.js →（以后）lan.js。

   ── 网络层 net = window.LAN_NET(lan.js)，本文件只管界面，接口：
   net.create({me}) / net.join({code, me}) → Promise(失败 reject {reason:'notfound'|'full'|'started'|'self'|'version'|'timeout'|'network'})
   net.setReady(bool) / net.start() / net.cancelStart() / net.endGame() / net.reconnect() / net.leave()
   net.onRoom(room)  每次变化推「完整」房间状态(以房主为准，不合并)；net.onClosed(reason) 'host'|'lost'；net.onStatus('ok'|'waiting'|'failed')
   net.onLatency({token:ms}) 每秒一次，只更新数字、不重绘；net.onLog(e) 大厅日志事件，只显示加入之后发生的
   room = { code, mode:'race', phase:'lobby'|'starting'|'playing', hostPid, you, players:[{ pid, name, skin, ready, online }] }：只有公开的 pid，没有 token；you=自己的 pid
   me = { token, name }：token 是本机私密的随机串(只用于向房主证明「我还是我」)，昵称仅用于显示
   玩家身份用 token(存 localStorage)，名字只是显示用；远端传来的名字一律转义后再进 innerHTML。 */
(function () {
'use strict';

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
  lbErrCode: '请输入 6 位配对码', lbErrNotFound: '找不到这个房间，请检查配对码', lbErrFull: '房间已满', lbErrStarted: '游戏已经开始', lbErrTimeout: '连接超时，请确认房主在线后重试', lbErrNoSession: '没有可恢复的房间（已解散或超过 30 分钟）', lbErrRestoreBusy: '旧连接还占着这个配对码，请稍等一会儿再试', lbRestore: '恢复上次的房间', lbRestoring: '正在恢复房间…（旧连接释放最长约 45 秒）', lbLogRestored: '房间已恢复，等待玩家重新连上',
  lbClosedHost: '房主已解散房间', lbClosedLost: '与房间的连接断开了', lbStartSoon: '联机玩法开发中',
  lbErrNetwork: '连不上配对服务器，请检查网络', lbErrNoLan: '联机模块 lan.js 没有加载：请检查 index.html 是否引入了 lan.js，且文件在根目录', lbErrSelf: '不能加入自己的房间', lbErrVersion: '双方版本不一致，请更新后重试',
  lbOffline: '掉线', lbHintPlaying: '游戏已开始（联机玩法开发中）', lbHintWaitHost: '连接中断，正在重连…', lbHintFailed: '自动重连失败，请确认房主在线后手动重连',
  lbReconnect: '手动重连', lbCancelStart: '取消开始', lbBackLobby: '返回大厅', lbHintStarting: (n) => `游戏将在 ${n} 秒后开始…`,
  lbLogCreated: '房间已创建', lbLogJoin: (n) => `${n} 加入了房间`, lbLogLeave: (n) => `${n} 离开了房间`, lbLogOffline: (n) => `玩家 ${n} 掉线了`, lbLogBack: (n) => `玩家 ${n} 已重新上线`, lbLogTimeout: (n) => `${n} 掉线超时，已移出房间`,
  lbLogHostOff: (n) => `房主 ${n} 掉线了`, lbLogHostBack: (n) => `房主 ${n} 已重新上线`, lbRejoin: '加入上次房间', lbLastCode: (c) => `上次的配对码：${c}`,
  lbLogCd: (s) => `游戏将在 ${s} 秒后开始…`, lbLogGo: '游戏开始！（联机玩法开发中）',
  lbLogCdCancel: (why, n) => (why === 'host' ? '房主取消了开始' : why === 'unready' ? `${n} 取消了准备，已取消开始` : why === 'left' ? `${n} 离开了，已取消开始` : why === 'offline' ? `${n} 掉线了，已取消开始` : '已取消开始'),
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
  lbErrCode: 'Enter the 6-character code', lbErrNotFound: 'Room not found, check the code', lbErrFull: 'Room is full', lbErrStarted: 'Game already started', lbErrTimeout: 'Timed out, check the host is online and retry', lbErrNoSession: 'No room to restore (closed or older than 30 min)', lbErrRestoreBusy: 'The old connection still holds this code, try again shortly', lbRestore: 'Restore last room', lbRestoring: 'Restoring room… (up to ~45 s)', lbLogRestored: 'Room restored, waiting for players to reconnect',
  lbClosedHost: 'The host closed the room', lbClosedLost: 'Connection lost', lbStartSoon: 'Multiplayer gameplay coming soon',
  lbErrNetwork: 'Cannot reach the pairing server', lbErrNoLan: 'lan.js is not loaded: check index.html includes it and the file is in the root', lbErrSelf: 'You cannot join your own room', lbErrVersion: 'Version mismatch, please update',
  lbOffline: 'Offline', lbHintPlaying: 'Game started (gameplay coming soon)', lbHintWaitHost: 'Connection lost, reconnecting…', lbHintFailed: 'Auto-reconnect failed. Check the host, then reconnect',
  lbReconnect: 'Reconnect', lbCancelStart: 'Cancel', lbBackLobby: 'Back to lobby', lbHintStarting: (n) => `Starting in ${n}…`,
  lbLogCreated: 'Room created', lbLogJoin: (n) => `${n} joined`, lbLogLeave: (n) => `${n} left`, lbLogOffline: (n) => `Player ${n} went offline`, lbLogBack: (n) => `Player ${n} is back online`, lbLogTimeout: (n) => `${n} timed out and was removed`,
  lbLogHostOff: (n) => `Host ${n} went offline`, lbLogHostBack: (n) => `Host ${n} is back online`, lbRejoin: 'Rejoin last room', lbLastCode: (c) => `Last room code: ${c}`,
  lbLogCd: (s) => `Starting in ${s}…`, lbLogGo: 'Go! (gameplay coming soon)',
  lbLogCdCancel: (why, n) => (why === 'host' ? 'Host cancelled the start' : why === 'unready' ? `${n} cancelled ready, start cancelled` : why === 'left' ? `${n} left, start cancelled` : why === 'offline' ? `${n} went offline, start cancelled` : 'Start cancelled'),
});
const ERR_KEY = { notfound: 'lbErrNotFound', full: 'lbErrFull', started: 'lbErrStarted', timeout: 'lbErrTimeout', network: 'lbErrNetwork', self: 'lbErrSelf', version: 'lbErrVersion', nosession: 'lbErrNoSession', busy: 'lbErrRestoreBusy' };

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
.lbLast { margin: -6px 0 2px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: rgba(217, 192, 138, 0.75); }
.lbLast b { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 900; letter-spacing: 0.18em; color: #f6e3ae; }
.lbDiag { margin: -4px 0 10px; max-height: 130px; overflow-y: auto; font: 11px/1.45 ui-monospace, Menlo, monospace; color: rgba(217, 192, 138, 0.75);
  white-space: pre-wrap; word-break: break-all; text-align: left; -webkit-user-select: text; user-select: text; }
.lbDiag:empty { display: none; }
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
.lbRow { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 14px; border-radius: 10px;
  background: rgba(255, 236, 200, 0.07); box-shadow: inset 0 0 0 1px rgba(243, 223, 178, 0.14); }
.lbRow.me { box-shadow: inset 0 0 0 1.5px rgba(242, 180, 94, 0.6); }
.lbRow.empty { background: none; box-shadow: none; border: 1px dashed rgba(217, 192, 138, 0.28); }
.lbRow.empty .lbName { color: rgba(217, 192, 138, 0.45); font-weight: 600; }
.lbDot { flex: none; width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255, 240, 210, 0.3);
  background: linear-gradient(90deg, var(--c1, transparent) 50%, var(--c2, transparent) 50%); }
.lbRow.empty .lbDot { background: none; box-shadow: none; border: 1px dashed rgba(217, 192, 138, 0.3); }
.lbName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 800; color: #f6e8c4; }
.lbName em { font-style: normal; font-size: 13px; font-weight: 700; color: #d9c08a; margin-left: 6px; }
.lbTag { flex: none; padding: 4px 11px; border-radius: 12px; font-size: 13px; font-weight: 800; letter-spacing: 0.06em; }
.lbTag.host { color: #f2b45e; background: rgba(242, 180, 94, 0.16); box-shadow: inset 0 0 0 1px rgba(242, 180, 94, 0.5); }
.lbTag.ready { color: #c9eb92; background: rgba(140, 200, 70, 0.2); box-shadow: inset 0 0 0 1px rgba(170, 220, 100, 0.55); }
.lbTag.wait { color: rgba(217, 192, 138, 0.7); box-shadow: inset 0 0 0 1px rgba(217, 192, 138, 0.25); }
.lbHint { min-height: 20px; margin: -4px 0 12px; text-align: center; font-size: 14px; font-weight: 700; color: #d9c08a; }
.lbPing { flex: none; min-width: 42px; text-align: right; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.lbPing.good { color: #9fd66b; } .lbPing.mid { color: #f2c14e; } .lbPing.bad { color: #ff8f6b; } .lbPing.off { color: rgba(217, 192, 138, 0.5); }
#lbLog { margin-top: 18px; height: 120px; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 8px 10px; border-radius: 10px;
  background: rgba(15, 9, 4, 0.5); box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(243, 223, 178, 0.1);
  font-size: 13px; line-height: 1.6; color: #d9c08a; touch-action: pan-y; }
.lbLogRow time { margin-right: 7px; opacity: 0.5; font-variant-numeric: tabular-nums; }
.lbLogRow.warn { color: #ffb089; } .lbLogRow.go { color: #c9eb92; font-weight: 800; } .lbLogRow.cd { color: #f6e3ae; font-weight: 800; }
`;
document.head.appendChild(css);

/* ---------- 工具 ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function randHex(n) {
  try { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return Math.random().toString(16).slice(2).padEnd(n * 2, '0').slice(0, n * 2); }
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
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ token: p.token, name: p.name, last: p.last || '' })); } catch (e) {} } // last=最后一次成功加入的房间配对码
function skinDot(skin) { const c = (typeof SKIN_COLORS !== 'undefined' && SKIN_COLORS[skin]) || ['#2ECC71', '#E74C3C']; return `--c1:${c[0]};--c2:${c[1]}`; }

/* ---------- 倒计时音效：自带 WebAudio 合成，不依赖 sound.js；音量/静音跟随设置里的「音效」 ---------- */
let actx = null;
function audioCtx() { // 必须在用户点按(touchend)里创建/恢复，iOS 才允许后面由网络事件触发的声音出声；openLobby 和 tap() 里都会调一次
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (e) { return null; }
}
function sfxLevel() { try { return (typeof settings !== 'undefined' && !settings.sfxMuted) ? Math.max(0, Math.min(100, +settings.sfxVol || 0)) / 100 : 0; } catch (e) { return 0; } }
function beep(freq, dur, gain, type, delay) {
  const lv = sfxLevel(); if (!lv) return;
  const c = audioCtx(); if (!c) return;
  try {
    const t0 = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * lv), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) {}
}
const cdSound = {
  tick() { beep(880, 0.1, 0.4); },                                   // 3、2、1：短促的「滴」
  go() { beep(1175, 0.12, 0.4); beep(1760, 0.34, 0.45, 'sine', 0.11); }, // 开始：两声上扬的「叮」
  cancel() { beep(392, 0.14, 0.35, 'triangle'); beep(262, 0.22, 0.35, 'triangle', 0.12); }, // 取消：下行
};

/* ---------- 大厅 ---------- */
const LB = { form: 'create', view: 'form', room: null, me: null, busy: false, status: 'ok', lastPhase: 'lobby', log: [], ping: {}, cd: 0 };
function resetLive() { LB.log = []; LB.ping = {}; LB.cd = 0; LB.status = 'ok'; LB.lastPhase = 'lobby'; }
let net = null;

const ov = document.createElement('div');
ov.id = 'lobbyOverlay';
ov.innerHTML = '<div id="lobbyWrap"><div id="lobbySheet" class="artPanel"><div id="lbHead"><span id="lbTitle"></span><span id="lbSub"></span></div><div id="lbBody"></div></div></div>';
document.body.appendChild(ov);

function tap(id, fn) { // 带「灰掉就不响应」保护的 bindTap；顺便在用户点按里恢复音频(iOS 解锁)
  const el = $(id);
  if (el) bindTap(el, () => { audioCtx(); if (!el.classList.contains('off')) fn(); });
}
function showMsg(text, info) { const m = $('lbMsg'); if (m) { m.textContent = text || ''; m.classList.toggle('info', !!info); } }
function showDiag(text) { const d = $('lbDiag'); if (d) d.textContent = text || ''; }
function setBusy(b) { LB.busy = b; ['lbGo', 'lbRejoin', 'lbRestore'].forEach((id) => { const el = $(id); if (el) el.classList.toggle('off', b); }); }
function getNet() { return window.LAN_NET || null; }

function openLobby(form) {
  LB.me = loadProfile(); LB.form = form; LB.room = null; LB.busy = false; resetLive();
  audioCtx();
  net = getNet();
  if (net) { net.onRoom = onRoom; net.onClosed = onClosed; net.onStatus = onStatus; net.onLatency = onLatency; net.onLog = onLog; }
  renderForm();
  if (!net) showMsg(t('lbErrNoLan')); // 一打开面板就提示，不用等点创建
  ov.classList.add('show');
}
function closeLobby() { // 回到多人主页
  if ((LB.room || LB.busy) && net) net.leave(); // 正在连接/恢复时点返回，也要取消掉
  LB.room = null;
  ov.classList.remove('show');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
function leaveRoom() { if (net) net.leave(); LB.room = null; resetLive(); renderForm(); }

function renderForm() {
  LB.view = 'form';
  const join = LB.form === 'join';
  const hs = (!join && net && net.hostSession) ? net.hostSession(LB.me.token) : null; // 房主 App 被杀前的房间(30 分钟内、没主动解散)
  $('lbTitle').textContent = t(join ? 'lbJoinTitle' : 'lbCreateTitle');
  $('lbSub').innerHTML = '';
  $('lbBody').innerHTML =
    `<div class="lbField"><label>${t('lbName')}</label><input id="lbName" class="lbInput" maxlength="${NAME_MAX}" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(LB.me.name)}"></div>` +
    (join ? `<div class="lbField"><label>${t('lbCode')}</label><input id="lbCode" class="lbInput code" maxlength="6" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${t('lbCodePh')}"></div>` : '') +
    `<div id="lbMsg" class="lbMsg"></div><div id="lbDiag" class="lbDiag"></div>` +
    `<div class="lbBtns"><button id="lbGo" class="lbBtn">${t(join ? 'lbJoinGo' : 'lbCreateGo')}</button>` +
    (join && LB.me.last ? `<button id="lbRejoin" class="lbBtn">${t('lbRejoin')}</button><div class="lbLast">${t('lbLastCode', `<b>${esc(LB.me.last)}</b>`)}</div>` : '') +
    (!join && hs ? `<button id="lbRestore" class="lbBtn">${t('lbRestore')}</button><div class="lbLast">${t('lbLastCode', `<b>${esc(hs.code)}</b>`)}</div>` : '') +
    `<button id="lbBack" class="lbBtn red">${t('lbBack')}</button></div>`;
  const nameEl = $('lbName'), codeEl = $('lbCode');
  nameEl.addEventListener('blur', () => { LB.me.name = cleanName(nameEl.value) || LB.me.name; nameEl.value = LB.me.name; saveProfile(LB.me); window.scrollTo(0, 0); });
  if (codeEl) {
    codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    codeEl.addEventListener('blur', () => window.scrollTo(0, 0));
  }
  [nameEl, codeEl].forEach((el) => { if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { el.blur(); doGo(); } }); });
  tap('lbGo', doGo);
  tap('lbRestore', doRestore);
  tap('lbRejoin', () => { const c = $('lbCode'); if (c) c.value = LB.me.last; doGo(); }); // 杀后台/重开后不用再手输配对码
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
  if (!net) { showMsg(t('lbErrNoLan')); return; } // lan.js 没加载：这和「网络不通」是两回事，要分开提示
  setBusy(true); showMsg(join ? t('lbConnecting') : '', true); showDiag('');
  try {
    if (join) { await net.join({ code, me: meInfo }); LB.me.last = code; saveProfile(LB.me); } else await net.create({ me: meInfo });
  } // 成功后房间状态走 onRoom 渲染
  catch (e) {
    showMsg(t(ERR_KEY[e && e.reason] || 'lbErrTimeout') + (e && e.detail ? ` [${e.detail}]` : '')); // 网络类错误附上原因代码，方便排查
    if (e && e.reason === 'network' && net.diag) showDiag(net.diag()); // 并把最近几条网络日志直接显示在屏幕上(真机没有控制台)
  }
  setBusy(false);
}

async function doRestore() {
  if (LB.busy || !net) return;
  const nameEl = $('lbName');
  LB.me.name = cleanName(nameEl.value) || LB.me.name; nameEl.value = LB.me.name; saveProfile(LB.me);
  setBusy(true); showMsg(t('lbRestoring'), true); showDiag('');
  try { await net.restore({ me: { token: LB.me.token, name: LB.me.name } }); } // 成功后房间状态走 onRoom 渲染
  catch (e) {
    if (!(e && e.reason === 'cancelled')) {
      showMsg(t(ERR_KEY[e && e.reason] || 'lbErrTimeout') + (e && e.detail ? ` [${e.detail}]` : ''));
      if (e && e.reason === 'network' && net.diag) showDiag(net.diag());
    }
  }
  setBusy(false);
}

function onRoom(room) {
  const prev = LB.lastPhase; LB.lastPhase = room.phase; LB.room = room;
  if (room.phase !== 'starting') LB.cd = 0;
  if (!ov.classList.contains('show')) return;
  renderRoom();
  if (room.phase === 'playing' && prev !== 'playing') showToast(t('lbStartSoon')); // 房主和玩家都由房间状态切到 playing 触发
}
function onStatus(s) { // 'ok' | 'waiting' | 'failed'(来自 lan.js 的掉线/重连状态)
  LB.status = s;
  if (ov.classList.contains('show') && LB.view === 'room' && LB.room) renderRoom();
}
function onClosed(reason) {
  if (reason === 'host' && LB.me && LB.me.last) { LB.me.last = ''; saveProfile(LB.me); } // 房主主动解散的房间码已作废，不再提示
  LB.room = null; resetLive();
  if (!ov.classList.contains('show')) return;
  renderForm();
  showMsg(t(reason === 'host' ? 'lbClosedHost' : 'lbClosedLost'));
}

function logText(e) {
  const n = e.n || '';
  switch (e.k) {
    case 'created': return t('lbLogCreated');
    case 'restored': return t('lbLogRestored');
    case 'join': return t('lbLogJoin', n);
    case 'leave': return t('lbLogLeave', n);
    case 'offline': return t('lbLogOffline', n);
    case 'back': return t('lbLogBack', n);
    case 'timeout': return t('lbLogTimeout', n);
    case 'hostoff': return t('lbLogHostOff', n);
    case 'hostback': return t('lbLogHostBack', n);
    case 'cd': return t('lbLogCd', e.s);
    case 'cdcancel': return t('lbLogCdCancel', e.why, n);
    case 'go': return t('lbLogGo');
  }
  return '';
}
const LOG_CLS = { offline: 'warn', hostoff: 'warn', timeout: 'warn', cdcancel: 'warn', go: 'go', cd: 'cd' };
const p2 = (x) => String(x).padStart(2, '0');
function paintLog() {
  const box = $('lbLog'); if (!box) return;
  box.innerHTML = LB.log.map((x) => { const d = new Date(x.ts); return `<div class="lbLogRow ${LOG_CLS[x.e.k] || ''}"><time>${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}</time>${esc(logText(x.e))}</div>`; }).join('');
  box.scrollTop = box.scrollHeight;
}
function onLog(e) { // 大厅日志：只收「加入之后」发生的事件；倒计时的每一格也在这里驱动提示文字
  if (!e || !e.k) return;
  if (e.k === 'cd') cdSound.tick(); else if (e.k === 'go') cdSound.go(); else if (e.k === 'cdcancel') cdSound.cancel();
  if (e.k === 'cd') {
    LB.cd = e.s;
    const h = document.querySelector('#lobbySheet .lbHint');
    if (h && LB.room && LB.room.phase === 'starting' && LB.status === 'ok') h.textContent = t('lbHintStarting', LB.cd);
  }
  LB.log.push({ e, ts: Date.now() }); if (LB.log.length > 40) LB.log.shift();
  paintLog();
}
function paintPings() { // 只改数字和颜色，不重绘房间(重绘会吃掉正在进行的点按)
  document.querySelectorAll('#lbList .lbPing').forEach((el) => {
    const on = el.dataset.on === '1', ms = LB.ping[el.dataset.pid];
    let cls = 'off', txt = '—';
    if (on && typeof ms === 'number') { txt = ms + 'ms'; cls = ms < 60 ? 'good' : ms < 150 ? 'mid' : 'bad'; }
    else if (on) txt = '…';
    el.className = 'lbPing ' + cls; el.textContent = txt;
  });
}
function onLatency(m) { LB.ping = m || {}; paintPings(); }

function renderRoom() {
  LB.view = 'room';
  const r = LB.room;
  const myPid = r.you; // 房间状态里只有公开的 pid；token 留在本机和房主，不出现在界面数据里
  const isHost = r.hostPid === myPid;
  const me = r.players.find((p) => p.pid === myPid) || {};
  const guests = r.players.filter((p) => p.pid !== r.hostPid);
  const readyN = guests.filter((p) => p.ready).length;
  const canStart = r.players.length >= 2 && readyN === guests.length;
  const starting = r.phase === 'starting', playing = r.phase === 'playing', live = LB.status === 'ok';

  $('lbTitle').textContent = t('lbRoomTitle');
  $('lbSub').innerHTML = `<small>${t('lbCode')}</small><b>${esc(r.code)}</b>`;

  let rows = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = r.players[i];
    if (!p) { rows += `<div class="lbRow empty"><i class="lbDot"></i><span class="lbName">${t('lbWaitSlot')}</span></div>`; continue; }
    const isH = p.pid === r.hostPid;
    const tag = p.online === false ? `<span class="lbTag wait">${t('lbOffline')}</span>`
      : isH ? `<span class="lbTag host">${t('lbHost')}</span>`
      : p.ready ? `<span class="lbTag ready">${t('lbReady')}</span>` : `<span class="lbTag wait">${t('lbNotReady')}</span>`;
    const ping = isH ? '' : `<span class="lbPing off" data-pid="${esc(p.pid)}" data-on="${p.online === false ? 0 : 1}"></span>`; // 房主自己没有延迟
    rows += `<div class="lbRow${p.pid === myPid ? ' me' : ''}"><i class="lbDot" style="${skinDot(p.skin)}"></i>` +
      `<span class="lbName">${esc(p.name)}${p.pid === myPid ? `<em>(${t('lbMe')})</em>` : ''}</span>${ping}${tag}</div>`;
  }

  let hint, action;
  if (isHost) {
    if (playing) { hint = t('lbHintPlaying'); action = `<button id="lbEnd" class="lbBtn">${t('lbBackLobby')}</button>`; }
    else if (starting) { hint = t('lbHintStarting', LB.cd || '…'); action = `<button id="lbCancelStart" class="lbBtn red">${t('lbCancelStart')}</button>`; }
    else {
      hint = r.players.length < 2 ? t('lbHintNeed') : (canStart ? t('lbHintGo') : t('lbHintWait', readyN, guests.length));
      action = `<button id="lbStart" class="lbBtn${canStart && live ? '' : ' off'}">${t('lbStart')}</button>`;
    }
  } else {
    hint = playing ? t('lbHintPlaying') : starting ? t('lbHintStarting', LB.cd || '…') : me.ready ? t('lbHintReadyGuest') : t('lbHintGuest');
    action = `<button id="lbReady" class="lbBtn${me.ready ? ' on' : ''}${playing || !live ? ' off' : ''}">${t(me.ready ? 'lbUnready' : 'lbReadyBtn')}</button>`;
  }
  if (LB.status === 'waiting') hint = t('lbHintWaitHost');
  if (LB.status === 'failed') { hint = t('lbHintFailed'); action = `<button id="lbReconn" class="lbBtn">${t('lbReconnect')}</button>`; }

  $('lbBody').innerHTML =
    `<div class="lbMode"><span>${t('lbMode')}</span><b class="on">${t('lbRace')}</b><b class="off">${t('lbCoop')}</b></div>` +
    `<div id="lbList">${rows}</div><div class="lbHint">${hint}</div>` +
    `<div class="lbBtns">${action}<button id="lbLeave" class="lbBtn red">${t(isHost ? 'lbDisband' : 'lbLeave')}</button></div><div id="lbLog"></div>`;

  tap('lbReady', () => net.setReady(!me.ready));
  tap('lbStart', () => { net.start().catch(() => {}); }); // 先倒计时，结束后 phase 变 playing，由 onRoom 统一弹提示
  tap('lbCancelStart', () => net.cancelStart());
  tap('lbEnd', () => net.endGame());
  tap('lbReconn', () => net.reconnect());
  tap('lbLeave', leaveRoom);
  paintPings(); paintLog();
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
