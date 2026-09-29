/* sound.js — BoxPusher 声音模块（SFX + BGM + 设置面板音量控制）
 * 加载位置：内联核心之后。游戏逻辑只通过 Bus 事件对接，不改核心。
 *
 * SFX（9个）：01 UI点击 / 03 胜利 用 OGG，其余 7 个 WebAudio 合成。
 *   OGG / Synth → 单音效 GainNode → SFX 总输出(master) → destination
 * BGM：bgm01–bgm06.ogg，decodeAudioData → AudioBufferSourceNode.loop
 *   → BGM 总输出(bgmMaster) → destination
 * 设置面板：音乐/音效各一个音量滑条 + 一键静音（DOM 由 index.html 提供，这里接线）
 */
(function () {
  'use strict';

  // ── 配置 ─────────────────────────────────────────
  var AUDIO_BASE = 'assets/audio/';
  var AUDIO_VER = '1';                       // 换音频内容时改这个，绕开 iOS 缓存
  var OGG_FILES = {
    uiClick: 'sfx01_ui_click.ogg',
    victory: 'sfx03_victory.ogg'
  };

  // 单音效增益
  // 脚步声本身很轻，保持 2.0；其余动作音效从 2.0 降到 1.5（约 -2.5dB），拉近和脚步声的差距
  var SFX_GAIN = {
    uiClick: 0.75, footstep: 2.0, victory: 1.0, boxSlide: 1.5, boxPlace: 1.5,
    boxBlocked: 1.5, playerBlocked: 1.5, confettiPop: 1.5, undo: 1.5
  };

  var PLACE_DELAY = 0.14;    // 秒：落位声接在推箱滑动声之后
  var CONFETTI_DELAY = 0.66; // 秒：对应 ui.js 里 setTimeout(burstConfetti, 660)
  var VICTORY_EVENT = 'winPanel';

  // BGM
  var BGM_TRACKS = 6;        // bgm01 … bgm06
  var BGM_SEG = 5;           // 每 5 关一段：进入新的一段才换曲
  var BGM_CAP = 15 * 60;     // 秒：同一首连续放满这么久也换（卡关兜底）
  var BGM_FADE = 1.2;        // 秒：换曲淡入淡出 / 回到游戏时的淡入
  var BGM_LEVEL = 0.4;       // BGM 总电平（相对 SFX 的基准，太响/太轻就调这个）

  // 设置面板默认值（settings 里没有这些字段时用）
  var DEF = { musicVol: 50, musicMuted: false, sfxVol: 100, sfxMuted: false };

  // ── 状态 ─────────────────────────────────────────
  var ctx = null, master = null, bgmMaster = null, noiseBuf = null;
  var nodes = {};        // 每个音效各自的 GainNode
  var buffers = {};      // 解码后的 OGG（SFX）
  var stepCount = 0;     // 脚步计数：偶数步左脚，奇数步右脚
  var activated = false; // 已经有过用户手势

  var bgm = { idx: -1, seg: -1, pendingSeg: -1, buf: null, src: null, gain: null,
              t0: 0, resumeAt: 0, pos: 0, played: 0, state: 'stopped', capTimer: null, token: 0 };
  var recent = [];       // 最近用过的两首（下次随机排除）
  var inGame = false;    // 主页盖着 = false
  var curLevel = -1;     // 最近一次 levelLoad 的关卡序号

  // ── 初始化 ───────────────────────────────────────
  function init() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    bgmMaster = ctx.createGain();
    bgmMaster.connect(ctx.destination);

    Object.keys(SFX_GAIN).forEach(function (k) {
      var g = ctx.createGain();
      g.gain.value = SFX_GAIN[k];
      g.connect(master);
      nodes[k] = g;
    });

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    Object.keys(OGG_FILES).forEach(function (k) {
      fetch(AUDIO_BASE + OGG_FILES[k] + '?v=' + AUDIO_VER)
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return decode(ab); })
        .then(function (b) { buffers[k] = b; })
        .catch(function (e) { console.warn('[sfx] load failed:', k, e); });
    });

    applyAudioSettings(true);
  }

  function decode(ab) {
    return new Promise(function (res, rej) {
      var p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.catch) p.catch(rej);
    });
  }

  // ── 音量 / 静音（读 settings，由设置面板改）─────
  function cfg(key) {
    var v = (typeof settings === 'object' && settings && settings[key] != null) ? settings[key] : DEF[key];
    return v;
  }
  function curve(v) { v = Math.max(0, Math.min(100, Number(v) || 0)) / 100; return v * v; } // 感知曲线
  function applyAudioSettings(instant) {
    if (!ctx) return;
    var sv = cfg('sfxMuted') ? 0 : curve(cfg('sfxVol'));
    var mv = cfg('musicMuted') ? 0 : BGM_LEVEL * curve(cfg('musicVol'));
    var t = ctx.currentTime, tc = instant ? 0.001 : 0.03;
    master.gain.setTargetAtTime(sv, t, tc);
    bgmMaster.gain.setTargetAtTime(mv, t, tc);
  }

  // ── iOS 解锁 / 后台恢复 ──────────────────────────
  var primed = false;
  function unlock() {
    if (!ctx) return;
    activated = true;
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    if (!primed) {
      primed = true;
      try {
        var s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) {}
    }
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) unlock();
  });

  // ── 合成积木 ─────────────────────────────────────
  function env(g, t, dur, vol, atk) {
    atk = atk || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function noise(dest, at, dur, cutoff, vol, atk) {
    var t = ctx.currentTime + at;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    var g = ctx.createGain();
    env(g, t, dur, vol, atk);
    src.connect(lp); lp.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  function tone(dest, at, type, f0, f1, dur, vol) {
    var t = ctx.currentTime + at;
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain();
    env(g, t, dur, vol);
    o.connect(g); g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // ── 7 个合成音效（at = 起始偏移秒）──────────────
  var SYNTH = {
    // 脚步：「耳语轻步」，左右脚交替（右脚 B 比左脚 A 更闷、更轻，差异 15%），每步音高±6%、音量±8% 随机
    footstep: function (d, o) {
      var right = (stepCount++ % 2) === 1;
      var p = 1 + (Math.random() * 2 - 1) * 0.06;
      var vr = 1 + (Math.random() * 2 - 1) * 0.08;
      noise(d, o, 0.05, 700 * (right ? 0.85 : 1) * p, 0.06 * (right ? 0.88 : 1) * vr, 0.008);
    },
    boxSlide: function (d, o) {
      noise(d, o, 0.30, 850, 0.12);
      noise(d, o + 0.08, 0.18, 1400, 0.07);
    },
    boxPlace: function (d, o) {
      tone(d, o, 'sine', 115, 70, 0.12, 0.16);
      tone(d, o + 0.015, 'triangle', 310, 310, 0.07, 0.09);
    },
    boxBlocked: function (d, o) {
      tone(d, o, 'sine', 145, 85, 0.08, 0.14);
      tone(d, o + 0.025, 'sine', 80, 80, 0.12, 0.07);
    },
    playerBlocked: function (d, o) {
      noise(d, o, 0.035, 1800, 0.07);
      tone(d, o, 'sine', 260, 170, 0.06, 0.06);
    },
    confettiPop: function (d, o) {
      noise(d, o, 0.16, 4200, 0.20);
      tone(d, o, 'sine', 180, 80, 0.10, 0.10);
    },
    // 撤销：轻柔的上滑"倒带"感
    undo: function (d, o) {
      tone(d, o, 'sine', 170, 270, 0.09, 0.09);
      noise(d, o, 0.06, 2200, 0.05);
    }
  };

  // ── SFX 统一播放入口 ─────────────────────────────
  function play(name, offset) {
    if (!ctx || !activated) return;
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    var dest = nodes[name];
    if (!dest) return;
    var o = offset || 0;
    if (SYNTH[name]) { SYNTH[name](dest, o); return; }
    var b = buffers[name];
    if (!b) return;
    var s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(dest);
    s.start(ctx.currentTime + o);
  }

  // ── BGM ──────────────────────────────────────────
  // 规则：只有主页收起（进了游戏画面）才放；同一段(5关)内换关/重来/撤销都不动；
  //       跨段随机换曲，排除最近两首；同一首连续放满 BGM_CAP 也换；
  //       过关时 BGM 淡出（庆祝短曲接上），重试或同段下一关从停下的位置接着放；回主页淡出停止。
  function bgmUrl(i) { return AUDIO_BASE + 'bgm0' + (i + 1) + '.ogg?v=' + AUDIO_VER; }

  function fetchBgm(i) {
    return fetch(bgmUrl(i))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(decode);
  }

  function pickTrack() {
    var c = [];
    for (var i = 0; i < BGM_TRACKS; i++) if (recent.indexOf(i) < 0) c.push(i);
    if (!c.length) for (var j = 0; j < BGM_TRACKS; j++) c.push(j);
    return c[Math.floor(Math.random() * c.length)];
  }

  function fadeOutSrc(src, g, fade) {
    var t = ctx.currentTime;
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, fade / 4);
      src.stop(t + fade + 0.05);
    } catch (e) {}
    src.onended = function () { try { src.disconnect(); g.disconnect(); } catch (e) {} };
  }

  function releaseCurrent(fade) {
    if (bgm.src) { fadeOutSrc(bgm.src, bgm.gain, fade); bgm.src = null; bgm.gain = null; }
  }

  function playFrom(offset, fade) {
    var t = ctx.currentTime;
    var s = ctx.createBufferSource();
    s.buffer = bgm.buf;
    s.loop = true;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    s.connect(g); g.connect(bgmMaster);
    s.start(0, offset % bgm.buf.duration);
    bgm.src = s; bgm.gain = g;
    bgm.t0 = t - offset;
    bgm.resumeAt = t;
    bgm.state = 'playing';
    armCap();
  }

  function armCap() {
    clearTimeout(bgm.capTimer);
    var left = Math.max(1, BGM_CAP - bgm.played);
    bgm.capTimer = setTimeout(function () {
      if (bgm.state === 'playing' && inGame) startTrack(pickTrack(), bgm.seg);
    }, left * 1000);
  }

  function startTrack(i, seg) {
    var my = ++bgm.token;
    bgm.pendingSeg = seg;
    fetchBgm(i).then(function (buf) {
      if (my !== bgm.token || !inGame) return;   // 已被更新的请求取代，或已经回主页
      releaseCurrent(BGM_FADE);
      bgm.idx = i; bgm.seg = seg; bgm.buf = buf; bgm.played = 0; bgm.pendingSeg = -1;
      recent.push(i); if (recent.length > 2) recent.shift();
      playFrom(0, BGM_FADE);
    }).catch(function (e) {
      if (my === bgm.token) bgm.pendingSeg = -1;
      console.warn('[bgm] load failed:', i, e);
    });
  }

  function pauseBgm(fade) {
    bgm.token++;            // 取消还在解码的请求
    bgm.pendingSeg = -1;
    if (bgm.state !== 'playing') return;
    var now = ctx.currentTime;
    bgm.pos = (now - bgm.t0) % bgm.buf.duration;
    bgm.played += now - bgm.resumeAt;
    clearTimeout(bgm.capTimer);
    releaseCurrent(fade);
    bgm.state = 'paused';
  }

  // 冷启动时核心先于 sound.js 加载，levelLoad 事件已经错过了：直接读核心的当前关卡序号
  function readLevel() {
    if (typeof state === 'object' && state && typeof state.levelIndex === 'number') curLevel = state.levelIndex;
  }

  function syncToLevel() {
    if (!ctx || !inGame || curLevel < 0) return;
    var seg = Math.floor(curLevel / BGM_SEG);
    if (bgm.pendingSeg === seg) return;                       // 这一段已经在加载了
    if (bgm.idx < 0 || bgm.seg !== seg) startTrack(pickTrack(), seg);
    else if (bgm.state === 'paused') playFrom(bgm.pos || 0, BGM_FADE);
  }

  // 主页盖着 / 收起：观察 #homeScreen 的 hide 类，不用改 ui.js
  function watchHome() {
    var home = document.getElementById('homeScreen');
    if (!home) { console.warn('[bgm] #homeScreen not found'); return; }
    var hidden = function () { return home.classList.contains('hide'); };
    inGame = hidden();
    new MutationObserver(function () {
      var g = hidden();
      if (g === inGame) return;
      inGame = g;
      if (g) { readLevel(); syncToLevel(); } else pauseBgm(0.6);
    }).observe(home, { attributes: true, attributeFilter: ['class'] });
  }

  // ── 订阅 Bus ─────────────────────────────────────
  function hook() {
    if (typeof Bus === 'undefined') { console.warn('[sfx] Bus not found'); return; }

    Bus.on('move', function () { play('footstep'); });
    Bus.on('undo', function () { play('undo'); });

    Bus.on('push', function (d) {
      play('boxSlide');
      if (d && d.onTarget) play('boxPlace', PLACE_DELAY);
    });

    Bus.on('bump', function (d) {
      play(d && d.kind === 'box' ? 'boxBlocked' : 'playerBlocked');
    });

    Bus.on(VICTORY_EVENT, function () { play('victory'); });

    Bus.on('winPanel', function (d) {
      if (d && d.perfect) play('confettiPop', CONFETTI_DELAY);
    });

    Bus.on('uiTap', function () { play('uiClick'); });

    // BGM：最后一步落位 → 淡出；换关/重来/恢复存档 → 判断是否换曲或接着放
    Bus.on('solved', function () { if (ctx) pauseBgm(0.3); });
    Bus.on('levelLoad', function (d) {
      if (d && typeof d.index === 'number') curLevel = d.index;
      syncToLevel();
    });
  }

  // ── 设置面板：音乐/音效音量滑条 + 一键静音 ──────
  function initSettingsUI() {
    if (typeof settings !== 'object' || !settings) return;
    Object.keys(DEF).forEach(function (k) { if (settings[k] == null) settings[k] = DEF[k]; });

    [['music', 'musicVol', 'musicMuted'], ['sfx', 'sfxVol', 'sfxMuted']].forEach(function (k) {
      var slider = document.getElementById(k[0] + 'VolSlider');
      var val = document.getElementById(k[0] + 'VolVal');
      var btn = document.getElementById(k[0] + 'MuteBtn');
      if (!slider || !val || !btn) return;
      var row = slider.parentNode;

      function sync() {
        slider.value = settings[k[1]];
        val.textContent = settings[k[1]] + '%';
        btn.classList.toggle('on', !!settings[k[2]]);
        row.classList.toggle('muted', !!settings[k[2]]);
      }
      slider.addEventListener('input', function () {
        settings[k[1]] = +slider.value;
        if (settings[k[2]]) settings[k[2]] = false; // 拖滑条就自动取消静音
        sync(); applyAudioSettings();
      });
      slider.addEventListener('change', function () {
        saveSettings();
        if (k[0] === 'sfx') play('uiClick');        // 松手时响一声，方便判断音量
      });
      bindTap(btn, function () {
        settings[k[2]] = !settings[k[2]];
        sync(); applyAudioSettings(); saveSettings();
      });
      sync();
    });
  }

  // ── 对外接口 ─────────────────────────────────────
  window.SFX = {
    play: play,
    applySettings: applyAudioSettings,
    setGain: function (name, v) { if (nodes[name]) nodes[name].gain.value = Math.max(0, v); },
    getGain: function (name) { return nodes[name] ? nodes[name].gain.value : null; },
    unlock: unlock
  };

  init();
  hook();
  readLevel();
  watchHome();
  initSettingsUI();
})();
