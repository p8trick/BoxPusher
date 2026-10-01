/* ui.js — 界面层：设置面板 / 主页 / 选关+章节跳转 / 过关面板 / 暂停菜单 / 调试连点 / toast。
   依赖 base.js(先加载)。这里加载时会执行 bindTap(...) 和 updateModeBtn() 等，只用到 base.js 与本文件内的函数；调用核心(loadLevel/state/camera…)的都写在回调里，点击时才执行。 */
// ===== 木质设置面板(v1.25)：按钮尺寸 + 木滑条填充 =====
// 按文字长度挑木板素材：汉字算 1，其它算 0.55；<=2.6 短板(s)，<=4.5 中板(m)，更长长板(l)
function woodSize(label) {
  let w = 0;
  for (const ch of String(label)) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
  return w <= 2.6 ? 'wp-s' : w <= 4.5 ? 'wp-m' : 'wp-l';
}

// 木滑条：填充条宽度由 --pct(0~1) 决定；程序改了 slider.value 后要手动调一次(input 事件不会触发)
function paintSlider(el) {
  const ws = el && el.parentNode;
  if (!ws || !ws.classList || !ws.classList.contains('woodSlider')) return;
  const mn = Number(el.min) || 0, mx = Number(el.max) || 100;
  const p = (Number(el.value) - mn) / ((mx - mn) || 1);
  ws.style.setProperty('--pct', Math.max(0, Math.min(1, p)));
}
function paintAllSliders() {
  document.querySelectorAll('#settingsSheet input[type="range"]').forEach(paintSlider);
}
document.getElementById('settingsSheet').addEventListener('input', (e) => { if (e.target.type === 'range') paintSlider(e.target); });

function buildAdvancedRow() {
  const sec = document.getElementById('advancedSection');
  sec.style.display = progress.debugMode ? '' : 'none';
  if (!progress.debugMode) return;
  const row = document.getElementById('advancedRow');
  row.innerHTML = '';
  const mk = (label, on, fn) => {
    const b = document.createElement('button');
    b.className = 'pillBtn ' + woodSize(label) + (on ? ' active' : '');
    b.textContent = label;
    bindTap(b, fn);
    row.appendChild(b);
  };
  mk(t('unlockAll'), progress.debugUnlock, () => { progress.debugUnlock = !progress.debugUnlock; saveProgress(); buildAdvancedRow(); });
  buildBoxFxRow();
}

function buildBoxFxRow() {
  const row = document.getElementById('boxFxRow');
  row.innerHTML = '';
  [['off', 'fxOff'], ['rebound', 'fxRebound']].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'pillBtn ' + woodSize(t(label)) + (settings.boxFx === key ? ' active' : '');
    b.textContent = t(label);
    bindTap(b, () => { settings.boxFx = key; saveSettings(); buildBoxFxRow(); });
    row.appendChild(b);
  });
}

function buildLangRow() {
  const row = document.getElementById('langRow');
  row.innerHTML = '';
  [['zh', '中文'], ['en', 'English']].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'pillBtn ' + woodSize(label) + (settings.lang === key ? ' active' : '');
    b.textContent = label;
    bindTap(b, () => {
      settings.lang = key;
      saveSettings();
      applySettings();
      applyI18n();
      buildAllSwatchRows();
      buildAdvancedRow();
    });
    row.appendChild(b);
  });
}

function buildAllSwatchRows() {
  buildLangRow();
  buildDpadStyleRow();
}

const DPAD_STYLE_LABELS = { cross: '十字连体', split: '分离按键' };

function buildDpadStyleRow() {
  const row = document.getElementById('dpadStyleSwatches');
  row.innerHTML = '';
  Object.keys(DPAD_STYLE_LABELS).forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'pillBtn ' + woodSize(t('dpad_' + key)) + (settings.dpadStyle === key ? ' active' : '');
    btn.textContent = t('dpad_' + key);
    bindTap(btn, () => {
      settings.dpadStyle = key;
      saveSettings();
      applySettings();
      buildDpadStyleRow();
      syncDpadSliders(); // 滑块换成这个样式自己的数值
      relayoutBoard();
    });
    row.appendChild(btn);
  });
}

function updateDpadGapVisibility() {
  document.getElementById('dpadGapSection').style.display = settings.dpadStyle === 'split' ? '' : 'none';
}

function syncDpadSliders() {
  const dc = dpadCfg();
  document.getElementById('dpadSizeSlider').max = settings.dpadStyle === 'split' ? 150 : 140; // 分离按键上限 150%，十字连体仍 140%(要先改 max 再设 value，否则超 140 的值会被夹回)
  document.getElementById('dpadSizeSlider').value = dc.scale;
  document.getElementById('dpadSizeVal').textContent = `${dc.scale}%`;
  document.getElementById('dpadOffsetSlider').value = dc.x;
  document.getElementById('dpadOffsetVal').textContent = `${dc.x}px`;
  document.getElementById('dpadOffsetYSlider').value = dc.y;
  document.getElementById('dpadOffsetYVal').textContent = `${dc.y}px`;
  document.getElementById('dpadGapSlider').value = settings.dpadSplit.gap;
  document.getElementById('dpadGapVal').textContent = `${settings.dpadSplit.gap}px`;
  updateDpadGapVisibility();
  document.getElementById('boardWSlider').value = settings.boardWPct;
  document.getElementById('boardWVal').textContent = `${settings.boardWPct}%`;
  document.getElementById('boardHSlider').value = settings.boardHPct;
  document.getElementById('boardHVal').textContent = `${settings.boardHPct}%`;
  document.getElementById('walkDurSlider').value = settings.walkMs;
  document.getElementById('walkDurVal').textContent = `${settings.walkMs}ms`;
  document.getElementById('pushDurSlider').value = settings.pushMs;
  document.getElementById('pushDurVal').textContent = `${settings.pushMs}ms`;
  paintAllSliders();
}

document.getElementById('dpadSizeSlider').addEventListener('input', (e) => {
  dpadCfg().scale = Number(e.target.value);
  document.getElementById('dpadSizeVal').textContent = `${dpadCfg().scale}%`;
  applySettings();
  relayoutBoard();
});

document.getElementById('dpadSizeSlider').addEventListener('change', saveSettings);

document.getElementById('dpadOffsetSlider').addEventListener('input', (e) => {
  dpadCfg().x = Number(e.target.value);
  document.getElementById('dpadOffsetVal').textContent = `${dpadCfg().x}px`;
  applySettings();
});

document.getElementById('dpadOffsetSlider').addEventListener('change', saveSettings);

document.getElementById('dpadOffsetYSlider').addEventListener('input', (e) => {
  dpadCfg().y = Number(e.target.value);
  document.getElementById('dpadOffsetYVal').textContent = `${dpadCfg().y}px`;
  applySettings();
  relayoutBoard();
});

document.getElementById('dpadOffsetYSlider').addEventListener('change', saveSettings);

document.getElementById('dpadGapSlider').addEventListener('input', (e) => {
  settings.dpadSplit.gap = Number(e.target.value);
  document.getElementById('dpadGapVal').textContent = `${settings.dpadSplit.gap}px`;
  applySettings();
});

document.getElementById('dpadGapSlider').addEventListener('change', saveSettings);

document.getElementById('boardWSlider').addEventListener('input', (e) => {
  settings.boardWPct = Number(e.target.value);
  document.getElementById('boardWVal').textContent = `${settings.boardWPct}%`;
  relayoutBoard();
});

document.getElementById('boardWSlider').addEventListener('change', saveSettings);

document.getElementById('boardHSlider').addEventListener('input', (e) => {
  settings.boardHPct = Number(e.target.value);
  document.getElementById('boardHVal').textContent = `${settings.boardHPct}%`;
  relayoutBoard();
});

document.getElementById('boardHSlider').addEventListener('change', saveSettings);

// 走路/推箱时长滑块：只影响之后的每一步；松手才存
[['walkDurSlider', 'walkDurVal', 'walkMs'], ['pushDurSlider', 'pushDurVal', 'pushMs']].forEach(([sid, vid, key]) => {
  const sl = document.getElementById(sid);
  sl.addEventListener('input', (e) => {
    settings[key] = Number(e.target.value);
    document.getElementById(vid).textContent = `${settings[key]}ms`;
  });
  sl.addEventListener('change', saveSettings);
});

function openSettings() { buildAllSwatchRows(); syncDpadSliders(); buildAdvancedRow(); document.getElementById('settingsOverlay').classList.add('show'); paintAllSliders(); }

function closeSettings() { document.getElementById('settingsOverlay').classList.remove('show'); }

bindTap(document.getElementById('closeSettings'), closeSettings);

// ===== 主页 =====
function hideHomeScreen() {
  document.getElementById('homeScreen').classList.add('hide');
  document.getElementById('homeBg').classList.add('hide');
}

function showHomeScreen() {
  refreshHomeUI();
  document.getElementById('homeScreen').classList.remove('hide');
  document.getElementById('homeBg').classList.remove('hide');
}

let cameFromGame = false; // 从游戏里点HOME回来的：CONTINUE直接回到原来那关，不重置

bindTap(document.getElementById('homeStart'), () => {
  const resumedMoves = cameFromGame ? 0 : loadInitialLevel(); // 冷启动：有存档就接着玩，否则从还没通关的第一关开始；全部通关则停在最后一关
  hideHomeScreen();
  if (resumedMoves) showToast(t('resumed', resumedMoves));
});

bindTap(document.getElementById('homeSettings'), openSettings);

// 每排列数：手机固定4列；iPad 按面板可用宽度反推4~8列(目标格宽150px)，每次 openLevelPick 重算
function lpColumnCount(sheetWidth) {
  if (window.innerWidth < 700) return 4;
  const targetTile = 150; // 目标"格子+间距"宽度，只用来反推列数，不是精确尺寸
  return Math.max(4, Math.min(8, Math.round(sheetWidth / targetTile)));
}

const chapterHeads = []; // openLevelPick 每次重建时填充，章节跳转要用它们的位置

function openLevelPick() {
  const list = document.getElementById('levelPickList');
  const sheet = document.getElementById('levelPickSheet');
  list.innerHTML = '';
  chapterHeads.length = 0;
  const cur = state ? state.levelIndex : firstUnclearedIndex();
  let clearedTotal = 0;
  LEVELS.forEach((_, i) => { if (isCleared(i)) clearedTotal++; });
  document.getElementById('levelPickTitle').textContent = t('pickTitle', clearedTotal, LEVELS.length);
  sheet.style.setProperty('--lp-cols', lpColumnCount(sheet.clientWidth - 24)); // -24：#levelPickSheet 左右 padding
  let curBtn = null;
  let base = 0;
  LEVEL_CHAPTERS.forEach((ch, ci) => {
    let done = 0;
    ch.levels.forEach((_, li) => { if (isCleared(base + li)) done++; });
    const head = document.createElement('div');
    head.className = 'chapterHead';
    head.innerHTML = `<span>${t('chapter', ci + 1)}</span><span>${done} / ${ch.levels.length}</span>`;
    list.appendChild(head);
    chapterHeads.push(head);
    const grid = document.createElement('div');
    grid.className = 'levelPickGrid';
    ch.levels.forEach((_, li) => {
      const i = base + li;
      const unlocked = isUnlocked(i);
      const wrap = document.createElement('div');
      wrap.className = 'lpTileWrap';
      const btn = document.createElement('button');
      btn.className = 'levelPickBtn' + (i === cur ? ' current' : '') + (unlocked ? '' : ' locked');
      btn.innerHTML = unlocked
        ? `<span class="num d${String(i + 1).length}">${i + 1}</span>` // 1/2/3 位数字用不同字号(见 .num.d1/.d2/.d3)
        : `<i class="ico lockIco" style="--ico:url(${ICON_DIR}icon_lock.svg)"></i>`;
      // 列表要能滚动：这里不用bindTap(它会在touchstart里preventDefault把滚动吃掉)，用原生click
      btn.addEventListener('click', () => {
        if (!isUnlocked(i)) { showToast(t('lockedHint', i)); return; }
        loadLevel(i);
        closeLevelPick();
        hideHomeScreen();
      });
      wrap.appendChild(btn);
      const stars = document.createElement('div'); // 三星评级：按历史最佳步数/par 点亮，没通关就是三颗空星
      const bestMoves = progress.cleared[LEVEL_META[i].id];
      const n = starsFor(bestMoves, LEVEL_META[i].par);
      const perfectLv = unlocked && isPerfect(bestMoves, LEVEL_META[i].par); // 达到 par：三颗星换成一枚皇冠
      stars.className = 'lpStars' + (perfectLv ? ' perfect' : '');
      stars.innerHTML = [0, 1, 2].map(k => `<i class="${!unlocked || perfectLv ? 'ph' : k < n ? 'on' : ''}"></i>`).join('') + (perfectLv ? '<i class="crown"></i>' : ''); // 锁定的关卡不显示星星(连空星也不画)，但放隐藏占位保持行高
      wrap.appendChild(stars);
      if (i === cur) curBtn = wrap;
      grid.appendChild(wrap);
    });
    list.appendChild(grid);
    base += ch.levels.length;
  });
  document.getElementById('levelPickOverlay').classList.add('show');
  if (curBtn) { // 把当前关滚动到面板中间(滚动容器是 #levelPickSheet 本身，不是 list)
    const sr = sheet.getBoundingClientRect(), br = curBtn.getBoundingClientRect();
    sheet.scrollTop += br.top - sr.top - sheet.clientHeight / 2 + br.height / 2;
  }
}

function closeLevelPick() { document.getElementById('levelPickOverlay').classList.remove('show'); closeChapterJump(); }

bindTap(document.getElementById('homeLevels'), openLevelPick);

bindTap(document.getElementById('lpBack'), closeLevelPick);

bindBackdropClose(document.getElementById('levelPickOverlay'), closeLevelPick);

// 章节跳转：10 块小木板，点了把 #levelPickSheet 滚到那一章标题的位置，浮层本身不分页、只是快速定位
function openChapterJump() {
  const grid = document.getElementById('chapterJumpGrid');
  if (!grid.childElementCount) {
    LEVEL_CHAPTERS.forEach((_, ci) => {
      const chapterStart = LEVEL_CHAPTERS.slice(0, ci).reduce((n, c) => n + c.levels.length, 0);
      const b = document.createElement('button');
      b.className = 'chapterJumpBtn' + (isUnlocked(chapterStart) ? '' : ' locked'); // 该章第一关没解锁：变暗，仍可点开去看看
      b.textContent = t('chapterShort', ci + 1);
      // 面板本身不滚动，不用像木箱格子那样避开bindTap，用它才能保证在真机触屏上点得到(不然会被全局touchstart拦截吃掉合成的click)
      bindTap(b, () => {
        const sheet = document.getElementById('levelPickSheet'), head = chapterHeads[ci];
        const sr = sheet.getBoundingClientRect(), hr = head.getBoundingClientRect();
        sheet.scrollTop += hr.top - sr.top - sheet.clientTop - 8; // sheet自己就是木框(border画在它上面)，clientTop是上边框厚度，不减掉标题会被压在木框底下
        closeChapterJump();
      });
      grid.appendChild(b);
    });
  }
  document.getElementById('chapterJumpOverlay').classList.add('show');
}

function closeChapterJump() { document.getElementById('chapterJumpOverlay').classList.remove('show'); }

bindTap(document.getElementById('lpMenu'), openChapterJump);

bindBackdropClose(document.getElementById('chapterJumpOverlay'), closeChapterJump);

bindBackdropClose(document.getElementById('settingsOverlay'), closeSettings);

function updateNavButtons() {} // 顶部关卡导航已取消，保留空函数免得到处改调用

function refreshHomeUI() {
  const any = Object.keys(progress.cleared).length > 0;
  document.getElementById('homeStart').textContent = (any || cameFromGame || !!readAutosave()) ? t('continue') : t('start');
}

// 过关石板：等玩家自己点「重试」或「下一关」，不再自动跳关(旧版本是1.1秒后自动跳)。
// 三星按本局步数/par 点亮(见 starsFor)，通关至少 1 星。
function openWinPanel(idxAtWin, meta, moves, isNewBest, best) {
  const nStars = starsFor(moves, meta.par);
  const perfect = isPerfect(moves, meta.par);
  const titleEl = document.getElementById('winTitle'); // 完美通关：标题换成「完美通关」+ 金色，星星加光晕
  titleEl.dataset.i18n = perfect ? 'winPerfect' : 'winTitle';
  titleEl.textContent = t(titleEl.dataset.i18n);
  titleEl.classList.toggle('perfect', perfect);
  document.getElementById('winStars').classList.toggle('perfect', perfect);
  // 拍3：空心星跟内容层一起淡入；实心星按星级用不同 keyframe(wpStarIn1/2/3)；完美时动画交给纯 CSS 的 #winStars.perfect::after
  document.querySelectorAll('#winStars .ico').forEach((el, k) => {
    const on = k < nStars;
    el.classList.toggle('filled', on);
    el.classList.toggle('wpFadeGroup', !on); // 空心星：不单独设计动画，跟内容层同一拍出现
    el.style.setProperty('--ico', `url(${ICON_DIR}${on ? 'icon_star.svg' : 'icon_star_empty.svg'})`);
    el.style.animation = '';
    el.style.removeProperty('--star3To');
    if (!on) return;
    if (nStars === 1) el.style.animation = 'wpStarIn1 .22s ease-out .4s both';
    else if (nStars === 2) el.style.animation = 'wpStarIn2 .24s cubic-bezier(.3,.7,.4,1.15) .4s both';
    else { // 3星：中间那颗(k===1)稍晚40-60ms、定住时略大一点
      el.style.setProperty('--star3To', k === 1 ? '1.06' : '1');
      el.style.animation = `wpStarIn3 .26s cubic-bezier(.3,.7,.4,1.15) ${k === 1 ? '.45s' : '.4s'} both`;
    }
  });
  Bus.emit('winPanel', { stars: nStars, perfect, moves, isNewBest });
  document.getElementById('winSteps').textContent = t('winSteps', moves);
  const bestEl = document.getElementById('winBest');
  if (best === undefined) { bestEl.textContent = ''; bestEl.style.visibility = 'hidden'; } // 第一次通关这关，没有旧纪录可比，不留空行
  else if (isNewBest) { bestEl.textContent = t('winNewBest'); bestEl.style.visibility = 'visible'; } // 破了旧纪录：用"新纪录"这行字，不重复念一遍数字
  else { bestEl.textContent = t('winBest', best); bestEl.style.visibility = 'visible'; }
  const hasNext = idxAtWin + 1 < LEVELS.length;
  if (!hasNext) { bestEl.textContent = (bestEl.textContent ? bestEl.textContent + ' · ' : '') + t('winAllDone'); bestEl.style.visibility = 'visible'; }
  document.getElementById('winButtons').classList.toggle('single', !hasNext);
  document.getElementById('app').classList.add('winShown');
  document.getElementById('winOverlay').classList.add('show');
  document.getElementById('winOverlay').dataset.idx = idxAtWin; // 供重试/下一关按钮读取，避免闭包捕获旧值
  // 整套入场动画靠 #winPanel.wpAnim 这个 class 驱动(见 CSS 里的 wpFadeUp/wpStarIn*/wpCrownIn)。
  // 先摘掉再强制重排再加回来，是让同一个 class 在"连续通关两关"时也能每次从头重播，不这样做的话第二次不会重新触发。
  const panelEl = document.getElementById('winPanel');
  panelEl.classList.remove('wpAnim');
  void panelEl.offsetWidth;
  panelEl.classList.add('wpAnim');
  // 按钮固定 0.55s 后才能点，不管动画/彩纸播完没有(彩纸更晚也没关系，见下面 burstConfetti 的调用时机)
  const btnsEl = document.getElementById('winButtons');
  btnsEl.classList.add('wpLocked');
  setTimeout(() => btnsEl.classList.remove('wpLocked'), 550);
  if (perfect) setTimeout(burstConfetti, 660); // 0.38s(皇冠动画延迟) + 0.28s(动画时长) = 皇冠刚好定住的那一帧，彩纸才发射
}

// 彩纸外包给根目录 confetti.js(BoxPusherConfetti 模块，ChatGPT 提供)，内部实现不用管；库没加载到就静默跳过
function burstConfetti() {
  if (typeof BoxPusherConfetti === 'undefined' || typeof BoxPusherConfetti.playVictoryConfetti !== 'function') return;
  BoxPusherConfetti.playVictoryConfetti();
}

function closeWinPanel() {
  document.getElementById('winOverlay').classList.remove('show');
  document.getElementById('app').classList.remove('winShown');
}

bindTap(document.getElementById('winRetry'), () => {
  const idx = Number(document.getElementById('winOverlay').dataset.idx);
  closeWinPanel();
  loadLevel(idx);
});

bindTap(document.getElementById('winNext'), () => {
  const idx = Number(document.getElementById('winOverlay').dataset.idx);
  const meta = LEVEL_META[idx];
  closeWinPanel();
  const next = idx + 1;
  if (next < LEVELS.length) {
    const newChapter = LEVEL_META[next].chapter !== meta.chapter;
    loadLevel(next);
    if (newChapter) showToast(t('chapter', LEVEL_META[next].chapter + 1));
  }
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1000);
}

/* ---------- 暂停 / 地图模式 ----------
   点右下角圆形按钮进入：棋盘切成全图预览(拖动查看)，D-pad/撤销/步数隐藏，四个选项排成一行悬在按钮上方；
   同一个按钮(此时是返回图标)再点一次退出。选项行只在暂停时才创建，退出即删除。 */
let paused = false;

function updateModeBtn() { document.getElementById('modeBtn').innerHTML = iconSVG(paused ? 'back' : 'map'); }

function removePauseRow() {
  const r = document.getElementById('pauseRow');
  if (r) r.remove();
}

function resetPauseUI() { // 换关/重来时调用：直接退出暂停模式(后面loadLevel会整体重排)
  paused = false;
  document.getElementById('app').classList.remove('paused');
  removePauseRow();
  updateModeBtn();
}

const PAUSE_ITEMS = [
  ['restart',  'Restart level', () => loadLevel(state.levelIndex)], // 直接重来，不再二次确认(按钮在最左边，不容易误碰)
  ['levels',   'Levels',        () => openLevelPick()],
  ['home',     'Home',          () => goHome()],
  ['settings', 'Settings',      () => openSettings()]
];

function buildPauseRow() {
  removePauseRow();
  const row = document.createElement('div');
  row.id = 'pauseRow';
  PAUSE_ITEMS.forEach(([name, label, fn]) => {
    const b = document.createElement('button');
    b.id = 'pause_' + name;
    b.setAttribute('aria-label', label);
    b.innerHTML = iconSVG(name);
    bindTap(b, fn);
    row.appendChild(b);
  });
  document.getElementById('controls').appendChild(row);
}

function setPause(on) {
  if (paused === on) return;
  paused = on;
  if (on) saveAutosaveNow(); // 点开暂停菜单时存一次
  document.getElementById('app').classList.toggle('paused', on);
  if (on) buildPauseRow(); else removePauseRow();
  if ((camera.mode === 'preview') !== on) togglePreview();
  updateModeBtn();
}

function goHome() { setPause(false); cameFromGame = true; showHomeScreen(); }

bindTap(document.getElementById('modeBtn'), () => setPause(!paused));

updateModeBtn();

// 开发者模式：主页连点版本号7次(4秒内)开关。开启后设置里出现"高级"(慢动作、全部解锁)
let _dbgTaps = 0, _dbgTimer = null;

bindTap(document.getElementById('homeVersion'), () => {
  _dbgTaps++;
  clearTimeout(_dbgTimer);
  _dbgTimer = setTimeout(() => { _dbgTaps = 0; }, 4000);
  if (_dbgTaps >= 7) {
    _dbgTaps = 0;
    progress.debugMode = !progress.debugMode;
    if (!progress.debugMode) { progress.debugUnlock = false; }
    saveProgress();
    showToast(progress.debugMode ? t('devOn') : t('devOff'));
  }
});
