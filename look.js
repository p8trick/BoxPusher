/* look.js —— 「游戏外观」二级面板（独立模块，和 sound.js 一样放在内联核心之后加载）
   功能：设置 → 游戏外观。上方是一块小预览关卡（墙/地板/目标点/箱子/到位的箱子/人物全有），
        下方文字按钮选 角色配色 / 地板 / 目标点光圈 / 墙壁 / 箱子；点一下预览立刻变，选择即时保存。
        「返回菜单」= 回到第一级设置；「返回游戏」= 关掉设置回到游戏(从首页进来的就回首页)。

   依赖主文件里的这些名字(都在调用时才用；改名/删除前先看这里)：
     base.js ：settings  saveSettings  applySettings  t  I18N  bindTap  bindBackdropClose
               spriteURL  skinKey  SPRITE_EXT  FLOOR_KEYS  WALL_KEYS  CRATE_KEYS  HALO_KEYS  SKIN_KEYS
     ui.js   ：closeSettings
     style.css：.cell / .box / .box.done / .player / .sprite / .pillBtn / .settingsSection / .settingsLabel / .swatchRow
                及主题变量 --panel --panel-border --ink --sub --accent --frame-bg --frame-border
     index.html：#themeSwatches(入口按钮插在它所在的设置分区后面)
   缺任何一项：只在控制台报错并且不显示入口，不影响游戏。
   以后新增地板/墙/箱子/皮肤：只改 base.js 里的 *_KEYS 和文案，这里按列表自动生成，不用动。 */
(function () {
  'use strict';

  /* ---------- 依赖自检 ---------- */
  const NEED = ['settings', 'saveSettings', 'applySettings', 't', 'I18N', 'bindTap', 'bindBackdropClose',
    'spriteURL', 'skinKey', 'SPRITE_EXT', 'FLOOR_KEYS', 'WALL_KEYS', 'CRATE_KEYS', 'HALO_KEYS', 'SKIN_KEYS', 'closeSettings'];
  const missing = NEED.filter(n => { try { return new Function('return typeof ' + n)() === 'undefined'; } catch (e) { return true; } });
  const themeRow = document.getElementById('themeSwatches');
  if (missing.length || !themeRow) {
    console.error('[look.js] 依赖缺失，游戏外观面板未启用：', missing.join(', ') || '#themeSwatches');
    return;
  }

  /* ---------- 文案(并进主表，这样 t() 和 data-i18n 都能直接用) ---------- */
  Object.assign(I18N.zh, {
    lookEntry: '游戏外观', lookOpen: '打开 ›', lookTitle: '游戏外观',
    lookBackMenu: '返回菜单', lookBackGame: '返回游戏',
    lookRow_player: '角色', lookRow_floor: '地板', lookRow_halo: '目标点光圈', lookRow_wall: '墙壁', lookRow_crate: '箱子'
  });
  Object.assign(I18N.en, {
    lookEntry: 'Game look', lookOpen: 'Open ›', lookTitle: 'Game look',
    lookBackMenu: 'Back to menu', lookBackGame: 'Back to game',
    lookRow_player: 'Outfit', lookRow_floor: 'Floor', lookRow_halo: 'Target ring', lookRow_wall: 'Walls', lookRow_crate: 'Crates'
  });

  /* ---------- 选项行：顺序 = 面板里从上到下；key 对应 settings 里的字段 ---------- */
  const ROWS = [
    { key: 'player', keys: () => SKIN_KEYS,  label: k => t('skin_' + k) },
    { key: 'floor',  keys: () => FLOOR_KEYS, label: k => t(k) },
    { key: 'halo',   keys: () => HALO_KEYS,  label: k => t('halo_' + k) },
    { key: 'wall',   keys: () => WALL_KEYS,  label: k => t('wall_' + k) },
    { key: 'crate',  keys: () => CRATE_KEYS, label: k => t(k) }
  ];

  /* 预览小关卡：# 墙  . 地板  T 目标点  B 箱子  D 目标点上的箱子  P 人物 */
  const MAP = ['######', '#T.B.#', '#.P.D#', '#B.T.#', '######'];

  /* ---------- 样式(自带，style.css 不用动) ---------- */
  const css = document.createElement('style');
  css.id = 'lookStyle';
  css.textContent = `
#lookOverlay { position: fixed; inset: 0; z-index: 260; display: flex; align-items: center; justify-content: center;
  padding: max(4vh, env(safe-area-inset-top)) 14px 4vh; background: rgba(0,0,0,0.55);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
#lookOverlay.show { opacity: 1; pointer-events: auto; }
#lookSheet { box-sizing: border-box; width: 100%; max-width: 460px; max-height: 100%; display: flex; flex-direction: column;
  background: var(--panel); color: var(--ink); border: 1px solid var(--panel-border); border-radius: 16px;
  padding: 12px 14px 14px; box-shadow: 0 10px 28px rgba(0,0,0,0.35); }
.lookTitle { flex: none; text-align: center; font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.lookPreviewWrap { flex: none; display: flex; justify-content: center; padding: 10px;
  background: var(--frame-bg); border: 1px solid var(--frame-border); border-radius: 12px; }
.lookBoard { --tile: min(44px, calc((100vw - 106px) / 6)); display: grid;
  grid-template-columns: repeat(6, var(--tile)); grid-template-rows: repeat(5, var(--tile)); border-radius: 6px; overflow: hidden; }
.lookBoard .box, .lookBoard .player { left: 0; top: 0; transition: none; }
.lookOptions { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  touch-action: pan-y; margin-top: 6px; }
.lookRow { margin-top: 8px; }
.lookRowLabel { font-size: 12px; color: var(--sub); margin-bottom: 4px; }
.lookRowBtns { display: flex; flex-wrap: wrap; gap: 6px; }
.lookRowBtns .pillBtn { padding: 6px 12px; font-size: 13px; }
.lookBar { flex: none; display: flex; gap: 10px; margin-top: 12px; }
.lookBtn { flex: 1; padding: 11px 8px; border-radius: 12px; border: 1px solid var(--panel-border);
  background: none; color: var(--ink); font-size: 15px; }
.lookBtn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.lookBtn:active { filter: brightness(0.88); }
@media (min-width: 700px) { #lookSheet { max-width: 520px; } .lookBoard { --tile: 56px; } }
`;
  document.head.appendChild(css);

  /* ---------- DOM(第一次打开时才建) ---------- */
  let overlay = null, boardEl = null, optionsEl = null;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'lookOverlay';
    overlay.innerHTML = `
      <div id="lookSheet">
        <div class="lookTitle"></div>
        <div class="lookPreviewWrap"><div class="lookBoard"></div></div>
        <div class="lookOptions"></div>
        <div class="lookBar"><button class="lookBtn" data-act="menu"></button><button class="lookBtn primary" data-act="game"></button></div>
      </div>`;
    document.body.appendChild(overlay);
    boardEl = overlay.querySelector('.lookBoard');
    optionsEl = overlay.querySelector('.lookOptions');
    // 全局有"拦 touchstart 防双击放大"和"滑动走路"的监听：面板内的触摸到此为止，既能滚动选项区，也不会误触发走路
    ['touchstart', 'touchmove', 'touchend'].forEach(ev => overlay.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
    bindBackdropClose(overlay, closeLook);
    bindTap(overlay.querySelector('[data-act="menu"]'), closeLook);
    bindTap(overlay.querySelector('[data-act="game"]'), () => { closeLook(); closeSettings(); });
  }

  /* ---------- 渲染 ---------- */
  function renderTexts() {
    overlay.querySelector('.lookTitle').textContent = t('lookTitle');
    overlay.querySelector('[data-act="menu"]').textContent = t('lookBackMenu');
    overlay.querySelector('[data-act="game"]').textContent = t('lookBackGame');
  }

  function renderPreview() {
    boardEl.innerHTML = '';
    const playerImg = spriteURL(skinKey(`assets/Player/Down2.${SPRITE_EXT}`, settings.player)); // Down2 = 站立正面帧，每套皮肤启动时都已备好
    MAP.forEach(line => [...line].forEach(ch => {
      const cell = document.createElement('div');
      cell.className = 'cell ' + (ch === '#' ? 'wall' : (ch === 'T' || ch === 'D') ? 'target' : 'floor');
      if (ch === 'B' || ch === 'D') {
        const box = document.createElement('div');
        box.className = 'box' + (ch === 'D' ? ' done' : '');
        cell.appendChild(box);
      } else if (ch === 'P') {
        const p = document.createElement('div');
        p.className = 'player';
        const s = document.createElement('div');
        s.className = 'sprite';
        s.style.backgroundImage = `url(${playerImg})`;
        p.appendChild(s);
        cell.appendChild(p);
      }
      boardEl.appendChild(cell);
    }));
  }

  function renderOptions() {
    optionsEl.innerHTML = '';
    ROWS.forEach(row => {
      const wrap = document.createElement('div');
      wrap.className = 'lookRow';
      wrap.innerHTML = `<div class="lookRowLabel">${t('lookRow_' + row.key)}</div><div class="lookRowBtns"></div>`;
      const btns = wrap.querySelector('.lookRowBtns');
      row.keys().forEach(k => {
        const b = document.createElement('button');
        b.className = 'pillBtn' + (settings[row.key] === k ? ' active' : '');
        b.textContent = row.label(k);
        bindTap(b, () => {
          settings[row.key] = k;
          saveSettings();
          applySettings();   // 换 --img-* 变量；人物 12 帧在后台备货，备好才切
          renderOptions();
          renderPreview();
        });
        btns.appendChild(b);
      });
      optionsEl.appendChild(wrap);
    });
  }

  /* ---------- 打开 / 关闭 ---------- */
  function openLook() {
    if (!overlay) build();
    renderTexts(); renderOptions(); renderPreview();
    optionsEl.scrollTop = 0;
    overlay.classList.add('show');
  }
  function closeLook() { if (overlay) overlay.classList.remove('show'); }
  function isOpen() { return !!overlay && overlay.classList.contains('show'); }

  // 桌面 Esc：先退二级面板(回菜单)，再按一次才关设置；抢在主文件的 Esc 处理之前
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) { e.stopImmediatePropagation(); closeLook(); }
  }, true);

  /* ---------- 第一级设置里的入口(插在「界面主题」后面) ---------- */
  const entry = document.createElement('div');
  entry.className = 'settingsSection';
  entry.innerHTML = `<div class="settingsLabel" data-i18n="lookEntry"></div><div class="swatchRow"><button class="pillBtn" data-i18n="lookOpen"></button></div>`;
  entry.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  themeRow.closest('.settingsSection').insertAdjacentElement('afterend', entry);
  bindTap(entry.querySelector('.pillBtn'), openLook);

  window.LookPanel = { open: openLook, close: closeLook };
})();
