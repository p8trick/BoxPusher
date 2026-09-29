/* base.js — 数据与存取层：素材表 / 中英文 / 主题与设置读写 / 关卡与进度 / 工具函数 / 事件总线。
   加载顺序：levels.js → confetti.js → base.js → ui.js → index.html 内联核心。本文件只依赖 levels.js，加载时不调用 ui.js 和核心里的任何东西。 */
/* ---------- 事件总线 Bus：给音效/多人等扩展模块留的口子 ----------
   核心在关键节点 Bus.emit(事件名, 数据)，扩展模块(sound.js / multiplayer.js …)只用 Bus.on 订阅，不改核心；没人订阅时 emit 什么都不做。
   订阅回调抛错会被吞掉并打印，不会连累游戏。已有事件：
   move(走一步) / push({onTarget}) / bump({kind:'wall'|'box'}，wall=人物撞墙，box=箱子推不动) / undo / levelLoad({index}) / solved({moves}，最后一步落位瞬间) / winPanel({stars,perfect,moves,isNewBest}，过关面板弹出时)
   / uiTap(菜单类按钮被点，由 bindTap / bindBackdropClose 发；D-pad 和撤销键不发，它们有自己的音效) */
const Bus = {
  _h: {},
  on(evt, fn) { (this._h[evt] = this._h[evt] || []).push(fn); },
  emit(evt, data) { (this._h[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[Bus]', evt, e); } }); }
};

/* ---------- 素材帧表：行走与推箱共用同一套12帧，不再区分动作 ---------- */
const PLAYER_FRAMES = {
  Down1: "assets/Player/Down1.png", Down2: "assets/Player/Down2.png", Down3: "assets/Player/Down3.png",
  Up1:   "assets/Player/Up1.png",   Up2:   "assets/Player/Up2.png",   Up3:   "assets/Player/Up3.png",
  Left1: "assets/Player/Left1.png", Left2: "assets/Player/Left2.png", Left3: "assets/Player/Left3.png",
  Right1:"assets/Player/Right1.png",Right2:"assets/Player/Right2.png",Right3:"assets/Player/Right3.png"
};

const SPRITE = {
  down:  { stand: 'Down1',  stepA: 'Down2',  stepB: 'Down3'  },
  up:    { stand: 'Up1',    stepA: 'Up2',    stepB: 'Up3'    },
  left:  { stand: 'Left1',  stepA: 'Left2',  stepB: 'Left3'  },
  right: { stand: 'Right1', stepA: 'Right2', stepB: 'Right3' }
};

/* ---------- 图标：单色 svg 放 assets/UI/icons/(Kenney CC0) ----------
   CSS mask 当模具，background:currentColor 跟随按钮颜色，三主题不用各配一套；svg 只看透明度，颜色随便写但要有 viewBox */
const ICON_DIR = 'assets/UI/icons/';

const ICON_NAMES = ['restart', 'levels', 'home', 'settings', 'map', 'back', 'lock', 'menu', 'star', 'star_outline', 'next'];

function iconSVG(name) {
  return `<i class="ico" style="--ico:url(${ICON_DIR}icon_${name}.svg)" aria-hidden="true"></i>`;
}

/* ---------- 界面语言：中文 / English ----------
   默认跟随系统语言，设置里可切换并记住；新增文案在 I18N.zh/en 两张表各加一条同名 key，用 t('key') 取值 */
const I18N = {
  zh: {
    start: '开始游戏', continue: '继续游戏', levels: '关卡选择', settings: '游戏设置', soon: '敬请期待',
    undo: '撤销', moves: n => `${n} 步`, levelTag: n => `第 ${n} 关`, chapter: n => `第 ${n} 章`,
    pickTitle: (c, total) => `选择关卡 · 已通关 ${c} / ${total}`,
    lockedHint: n => `先通关第 ${n} 关`, chapterShort: n => `第 ${n} 章`,
    cleared: m => `过关！用了 ${m} 步`, newBest: '（新纪录）', best: b => `（最佳 ${b}）`, allDone: '全部关卡完成 🎉',
    winTitle: '通关', winPerfect: '完美通关', winSteps: m => `本局 ${m} 步`, winBest: b => `最佳 ${b} 步`, winNewBest: '新纪录！', winAllDone: '已是最后一关 🎉',
    resumed: n => `已恢复上次进度（${n} 步）`,
    bestTag: b => `最佳 ${b}`,
    devOn: '开发者模式：已开启（设置里有「高级」）', devOff: '开发者模式：已关闭',
    settingsTitle: '设置', lang: '语言 / Language', theme: '界面主题',
    theme_green: '森林绿', theme_dark: '酷黑', theme_blue: '海蓝',
    floor: '地板颜色（目标点光圈随地板配套）', wall: '墙壁样式', crate: '箱子颜色',
    grey: '灰', brown: '棕', green: '绿', red: '红', blue: '蓝',
    wall_grey: '灰砖', wall_brown: '棕砖', wall_red1: '红砖A', wall_red2: '红砖B',
    dpadStyle: 'D-pad 样式', dpad_cross: '十字连体', dpad_split: '分离按键',
    dpadSize: 'D-pad 大小', dpadX: 'D-pad 位置（左右偏移）', dpadY: 'D-pad 位置（上下偏移）', dpadGap: '分离按键间距',
    boardW: '棋盘宽度', boardH: '棋盘高度',
    musicVol: '音乐音量', sfxVol: '音效音量', mute: '静音',
    advanced: '高级（开发者模式）', unlockAll: '全部解锁',
    walkDur: '走路每步时长', pushDur: '推箱每步时长', durHint: '镜头平移、帧切换、输入节奏自动跟随。数字越小越快，太小会显得飘。',
    boxFx: '箱子推动反馈', fxOff: '关', fxRebound: '回弹', close: '关闭'
  },
  en: {
    start: 'START', continue: 'CONTINUE', levels: 'LEVELS', settings: 'SETTINGS', soon: 'COMING SOON',
    undo: 'UNDO', moves: n => `${n} ${n === 1 ? 'move' : 'moves'}`, levelTag: n => `Level ${n}`, chapter: n => `Chapter ${n}`,
    pickTitle: (c, total) => `Levels · ${c} / ${total} cleared`,
    lockedHint: n => `Clear level ${n} first`, chapterShort: n => `Ch ${n}`,
    cleared: m => `Cleared! ${m} ${m === 1 ? 'move' : 'moves'}`, newBest: ' (new best)', best: b => ` (best ${b})`, allDone: 'All levels cleared 🎉',
    winTitle: 'Level Clear!', winPerfect: 'Perfect!', winSteps: m => `${m} ${m === 1 ? 'move' : 'moves'} this run`, winBest: b => `Best: ${b}`, winNewBest: 'New record!', winAllDone: 'Last level 🎉',
    resumed: n => `Progress restored (${n} ${n === 1 ? 'move' : 'moves'})`,
    bestTag: b => `Best ${b}`,
    devOn: 'Developer mode on (Advanced is in Settings)', devOff: 'Developer mode off',
    settingsTitle: 'Settings', lang: '语言 / Language', theme: 'Theme',
    theme_green: 'Forest', theme_dark: 'Dark', theme_blue: 'Ocean',
    floor: 'Floor colour (targets match the floor)', wall: 'Wall style', crate: 'Crate colour',
    grey: 'Grey', brown: 'Brown', green: 'Green', red: 'Red', blue: 'Blue',
    wall_grey: 'Grey brick', wall_brown: 'Brown brick', wall_red1: 'Red brick A', wall_red2: 'Red brick B',
    dpadStyle: 'D-pad style', dpad_cross: 'Cross', dpad_split: 'Split',
    dpadSize: 'D-pad size', dpadX: 'D-pad position (left / right)', dpadY: 'D-pad position (up / down)', dpadGap: 'Split button spacing',
    boardW: 'Board width', boardH: 'Board height',
    musicVol: 'Music volume', sfxVol: 'Sound effects volume', mute: 'Mute',
    advanced: 'Advanced (developer mode)', unlockAll: 'Unlock all',
    walkDur: 'Walk step duration', pushDur: 'Push step duration', durHint: 'Camera pan, frame swaps and input timing follow automatically. Lower is faster; too low feels floaty.',
    boxFx: 'Box push feedback', fxOff: 'Off', fxRebound: 'Rebound', close: 'CLOSE'
  }
};

function defaultLang() { return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'; }

function t(key, ...args) {
  const table = I18N[settings.lang] || I18N.zh;
  const v = table[key] !== undefined ? table[key] : (I18N.zh[key] !== undefined ? I18N.zh[key] : key);
  return typeof v === 'function' ? v(...args) : v;
}

/* ---------- 界面主题：三套 ---------- */
const THEME_KEYS = ['green', 'dark', 'blue'];

const THEMES = {
  green: { label: '森林绿', bg: '#7f8a6a', frame: '#cfc4a4' },
  dark:  { label: '酷黑',   bg: '#0c0e11', frame: '#2c3138' },
  blue:  { label: '海蓝',   bg: '#27506f', frame: '#5b8db3' }
};

/* ---------- 外观配色：地板/墙壁/箱子，对应用户重新整理后的文件名 ---------- */
const FLOOR_KEYS = ['grey', 'brown', 'green'];

const FLOOR_LABELS = { grey: '灰', brown: '棕', green: '绿' };

const WALL_KEYS = ['grey', 'brown', 'red1', 'red2'];

const WALL_LABELS = { grey: '灰砖', brown: '棕砖', red1: '红砖A', red2: '红砖B' };

const CRATE_KEYS = ['grey', 'red', 'brown', 'blue', 'green'];

const CRATE_LABELS = { grey: '灰', red: '红', brown: '棕', blue: '蓝', green: '绿' };

const SETTINGS_KEY = 'sokoban_appearance_v1';

const DEFAULT_SETTINGS = { lang: defaultLang(), theme: 'green', floor: 'grey', wall: 'red1', crate: 'brown', dpadStyle: 'cross', dpadCross: { scale: 100, x: 0, y: 0 }, dpadSplit: { scale: 100, x: 0, y: 0, gap: 48 }, boardWPct: 100, boardHPct: 100, walkMs: 260, pushMs: 300, boxFx: 'rebound', musicVol: 50, musicMuted: false, sfxVol: 100, sfxMuted: false, tuneVer: 1 };

// tuneVer：手感默认值版本号，存档里的版本落后就重置这几项为新默认值；以后改默认值把 tuneVer 加 1 即可

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    const st = { ...DEFAULT_SETTINGS, ...saved };
    if (!saved.dpadCross && !saved.dpadSplit) { // 旧版本：十字/分离共用一套参数 → 拆成各自一份，起始值都等于旧值(间距只属于分离式)
      const o = { scale: saved.dpadScale ?? 100, x: saved.dpadOffset ?? 0, y: saved.dpadOffsetY ?? 0 };
      st.dpadCross = { ...o };
      st.dpadSplit = { ...o, gap: saved.dpadGap ?? 48 };
    }
    ['dpadScale', 'dpadOffset', 'dpadOffsetY', 'dpadGap'].forEach(k => delete st[k]);
    if (saved.tuneVer !== DEFAULT_SETTINGS.tuneVer) {
      ['walkMs', 'pushMs', 'boxFx'].forEach(k => { st[k] = DEFAULT_SETTINGS[k]; });
      delete st.boxFxPct; // 旧版本的强度滑块，已取消
      st.tuneVer = DEFAULT_SETTINGS.tuneVer;
    }
    return st;
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function dpadCfg() { return settings.dpadStyle === 'split' ? settings.dpadSplit : settings.dpadCross; } // 当前样式的那一份 D-pad 参数

function applySettings() {
  if (!THEMES[settings.theme]) settings.theme = 'green';
  document.documentElement.dataset.theme = settings.theme;
  if (settings.lang !== 'zh' && settings.lang !== 'en') settings.lang = defaultLang();
  document.documentElement.dataset.lang = settings.lang;
  document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';
  settings.walkMs = Math.max(120, Math.min(600, Number(settings.walkMs) || 280)); // 防止存档里的怪值
  settings.pushMs = Math.max(120, Math.min(600, Number(settings.pushMs) || 300));
  if (!['off', 'rebound'].includes(settings.boxFx)) settings.boxFx = 'rebound';
  const tc = document.getElementById('themeColorMeta');
  if (tc) tc.content = THEMES[settings.theme].bg;
  const root = document.documentElement.style;
  root.setProperty('--img-floor', `url('assets/Ground/ground_${settings.floor}.png')`);
  root.setProperty('--img-target', `url('assets/Ground/ground_${settings.floor}Target.png')`);
  root.setProperty('--img-wall', `url('assets/Blocks/block_${settings.wall}.png')`);
  root.setProperty('--img-crate', `url('assets/Crates/crate_${settings.crate}.png')`);
  root.setProperty('--img-crateDone', `url('assets/Crates/crate_${settings.crate}Done.png')`);
  // 十字和分离式各存一份大小/位置(分离式还有间距)，切样式时滑块跟着换；这里顺便把存档里的怪值夹回范围
  const nd = (o, d, lim) => { const r = { ...d, ...(o || {}) }; Object.keys(lim).forEach(k => { r[k] = Math.max(lim[k][0], Math.min(lim[k][1], Number(r[k]) || d[k])); }); return r; };
  settings.dpadCross = nd(settings.dpadCross, DEFAULT_SETTINGS.dpadCross, { scale: [70, 140], x: [-50, 50], y: [-200, 40] });
  settings.dpadSplit = nd(settings.dpadSplit, DEFAULT_SETTINGS.dpadSplit, { scale: [70, 140], x: [-50, 50], y: [-200, 40], gap: [36, 95] });
  const dc = dpadCfg();
  root.setProperty('--dpad-scale', dc.scale / 100);
  root.setProperty('--dpad-offset', `${dc.x}px`);
  root.setProperty('--dpad-offset-y', `${dc.y}px`);
  root.setProperty('--split-r', `${settings.dpadSplit.gap}px`);
  document.getElementById('dpad').classList.toggle('style-split', settings.dpadStyle === 'split');
}

let settings = loadSettings();

applySettings();

// 把所有带 data-i18n 的静态文字、主页按钮、关卡编号/步数按当前语言刷新
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  refreshHomeUI();
  updateLevelInfo();
}

/* ---------- 贴图预加载 ----------
   页面打开就把全部动作帧+配色变体建 Image() 抓进缓存，避免第一次用到某张图时才发请求造成的闪烁；纯后台抓取，不阻塞渲染 */
const _preloadedImages = [];

/* D-pad 分离式四块：素材文件名里的方位 north/east/south/west = 上/右/下/左；poly 是命中形状(64×64 内，五边形，尖角朝中心) */
const DPAD_DIR = 'assets/UI/dpad/';

const DPAD_SPLIT_DEFS = [
  { id: 'sup',    name: 'north', tx: 0,  ty: -1, dr: -1, dc: 0,  dir: 'up',    poly: '0 0, 64px 0, 64px 32px, 32px 64px, 0 32px' },
  { id: 'sdown',  name: 'south', tx: 0,  ty: 1,  dr: 1,  dc: 0,  dir: 'down',  poly: '32px 0, 64px 32px, 64px 64px, 0 64px, 0 32px' },
  { id: 'sleft',  name: 'west',  tx: -1, ty: 0,  dr: 0,  dc: -1, dir: 'left',  poly: '0 0, 32px 0, 64px 32px, 32px 64px, 0 64px' },
  { id: 'sright', name: 'east',  tx: 1,  ty: 0,  dr: 0,  dc: 1,  dir: 'right', poly: '32px 0, 64px 0, 64px 64px, 32px 64px, 0 32px' },
];

const DPAD_FILES = ['dpad.svg', 'dpad_fill.svg', 'dpad_highlight.svg',
  ...DPAD_SPLIT_DEFS.flatMap(d => [`dpad_element_${d.name}.svg`, `dpad_element_${d.name}_fill.svg`, `dpad_element_${d.name}_highlight.svg`])];

function preloadAllAssets() {
  const paths = [
    'assets/UI/btn_wood_menu.png',
    'assets/UI/btn_wood_panel.png',
    'assets/UI/level_tile_light.png',
    'assets/UI/panel_win_wood.webp',
    'assets/UI/btn_win_retry.png', 'assets/UI/btn_win_next.png',
    ...DPAD_FILES.map(f => DPAD_DIR + f),
    ...ICON_NAMES.map(n => `${ICON_DIR}icon_${n}.svg`),
    ...Object.values(PLAYER_FRAMES),
    ...FLOOR_KEYS.flatMap(k => [`assets/Ground/ground_${k}.png`, `assets/Ground/ground_${k}Target.png`]),
    ...WALL_KEYS.map(k => `assets/Blocks/block_${k}.png`),
    ...CRATE_KEYS.flatMap(k => [`assets/Crates/crate_${k}.png`, `assets/Crates/crate_${k}Done.png`])
  ];
  paths.forEach(src => {
    const img = new Image();
    img.src = src;
    _preloadedImages.push(img);
  });
}

preloadAllAssets();

/* ---------- 关卡数据 ---------- */
// 关卡数据来自 levels.js (window.LEVEL_PACK)，按 章节 -> 关卡 拍平成一个顺序数组
const LEVEL_CHAPTERS = (window.LEVEL_PACK && window.LEVEL_PACK.chapters && window.LEVEL_PACK.chapters.length)
  ? window.LEVEL_PACK.chapters
  : [{ name: '第 1 章', levels: [{ id: 'T-1', xsb: "#####\n#   #\n# $ #\n#.@ #\n#   #\n#####" }] }]; // levels.js 没加载到时的兜底

const LEVELS = [];      // 每关的 XSB 文本

const LEVEL_META = [];  // 每关的 {id, chapter, pos}，和 LEVELS 下标一一对应

LEVEL_CHAPTERS.forEach((ch, ci) => ch.levels.forEach((lv, li) => {
  LEVELS.push(lv.xsb);
  LEVEL_META.push({ id: lv.id, chapter: ci, pos: li, par: lv.par }); // par = 最少人物总步数(levels.js 里的 par 字段)
}));

/* ---------- 进度：顺序解锁 ----------
   progress.cleared 以关卡id为key存最佳步数(按id而不是下标，以后调整关卡顺序不会错位)；
   第i关解锁 = 第i-1关已通关(第1关永远解锁)。调试开关在主页连点版本号7次。 */
const PROGRESS_KEY = 'sokoban_progress_v1';

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { cleared: p.cleared || {}, debugUnlock: !!p.debugUnlock, debugMode: !!(p.debugMode || p.debugUnlock) };
    }
  } catch (e) {}
  return { cleared: {}, debugUnlock: false, debugMode: false };
}

let progress = loadProgress();

function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) {}
}

/* 星级：按 步数/par 算，par 是每关最少人物总步(moves，不是 pushes)。
   ≤110% = 3星，≤130% = 2星，超过 130% 一律 1星(不封顶)；没通关 = 0星(三颗空星)。通关至少 1 星。
   用整数乘法比较，避免浮点边界误差；选关页按历史最佳步数算，过关面板按本局步数算，不额外存星级。 */
function starsFor(moves, par) {
  if (moves === undefined) return 0;
  if (!par) return 1;
  const m = moves * 100;
  return m <= par * 110 ? 3 : m <= par * 130 ? 2 : 1;
}

// 完美：步数达到(或低于)par。par 只有一部分关是求解器证明的最优，其余是社区已知最佳，所以文案叫「完美」不叫「最优」。
function isPerfect(moves, par) { return moves !== undefined && !!par && moves <= par; }

function isCleared(i) { return progress.cleared[LEVEL_META[i].id] !== undefined; }

function isUnlocked(i) { return progress.debugUnlock || i === 0 || isCleared(i - 1); }

function firstUnclearedIndex() {
  for (let i = 0; i < LEVELS.length; i++) if (!isCleared(i)) return i;
  return LEVELS.length - 1;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// 菜单类按钮点击音：D-pad 的键和撤销键自带脚步/撤销音，不发 uiTap，免得叠音
function emitUiTap(el) {
  if (el.id === 'undo' || (el.closest && el.closest('#dpad'))) return;
  Bus.emit('uiTap');
}

// bindBackdropClose：遮罩点空白处关闭专用，手动判 e.target===overlay 避免点到子元素也触发；touchend 原理同 bindTap，见避坑B1
function bindBackdropClose(overlay, closeFn) {
  let touched = false;
  overlay.addEventListener('touchend', (e) => {
    if (e.target !== overlay) return;
    e.preventDefault(); touched = true; emitUiTap(overlay); closeFn();
    setTimeout(() => { touched = false; }, 400);
  }, { passive: false });
  overlay.addEventListener('click', (e) => {
    if (touched) { touched = false; return; }
    if (e.target === overlay) { emitUiTap(overlay); closeFn(); }
  });
}

// bindTap: touchstart只拦手势，动作在touchend触发；click监听作桌面兜底，touched标记防重复
function bindTap(el, handler) {
  let touched = false;
  el.addEventListener('touchstart', (e) => {
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    e.preventDefault();
    touched = true;
    emitUiTap(el);
    handler(e);
    setTimeout(() => { touched = false; }, 400);
  }, { passive: false });
  el.addEventListener('click', (e) => {
    if (touched) { touched = false; return; }
    emitUiTap(el);
    handler(e);
  });
}
