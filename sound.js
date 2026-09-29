/* sound.js — BoxPusher 游戏音效（SFX）
 * 加载位置：内联核心之后。只订阅 Bus，不改游戏逻辑。
 * 9 个音效：01/03 用 OGG，其余 7 个用 WebAudio 合成（含撤销音）。
 * 结构：OGG / Synth → 单音效 GainNode → SFX 总输出 → destination
 */
(function () {
  'use strict';

  // ── 配置 ─────────────────────────────────────────
  var AUDIO_BASE = 'assets/audio/';
  var AUDIO_VER = '1';                       // 换 OGG 内容时改这个，绕开 iOS 缓存
  var OGG_FILES = {
    uiClick: 'sfx01_ui_click.ogg',
    victory: 'sfx03_victory.ogg'
  };

  // 单音效增益（初始值沿用 Selection Tool 的试听补偿，可再调）
  var SFX_GAIN = {
    uiClick: 1.0,
    footstep: 2.0,
    victory: 1.0,
    boxSlide: 2.0,
    boxPlace: 2.0,
    boxBlocked: 2.0,
    playerBlocked: 2.0,
    confettiPop: 2.0,
    undo: 2.0
  };

  var PLACE_DELAY = 0.14;    // 秒：落位声接在推箱滑动声之后
  var CONFETTI_DELAY = 0.66; // 秒：对应 ui.js 里 setTimeout(burstConfetti, 660)
  var VICTORY_EVENT = 'winPanel'; // 想在最后一步落位瞬间响，改成 'solved'

  // ── 状态 ─────────────────────────────────────────
  var ctx = null, master = null, noiseBuf = null;
  var nodes = {};      // 每个音效各自的 GainNode
  var buffers = {};    // 解码后的 OGG
  var rawBytes = {};   // fetch 回来的 OGG 字节
  var stepCount = 0;     // 脚步计数：偶数步左脚，奇数步右脚
  var activated = false; // 已经有过用户手势

  // ── 初始化 ───────────────────────────────────────
  function init() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

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
  }

  function decode(ab) {
    return new Promise(function (res, rej) {
      var p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.catch) p.catch(rej);
    });
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
  // 包络：4ms 起音 + 指数衰减到接近 0（规格只给了时长和音量）
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

  // ── 7 个合成音效（at = 起始偏移秒）──
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
    // 撤销：轻柔的上滑"倒带"感，和脚步(下沉的闷响)、被挡(下滑)方向相反
    undo: function (d, o) {
      tone(d, o, 'sine', 170, 270, 0.09, 0.09);
      noise(d, o, 0.06, 2200, 0.05);
    }
  };

  // ── 统一播放入口 ─────────────────────────────────
  function play(name, offset) {
    // 还没有过任何用户手势就不响；有过手势但上下文被系统挂起时，先 resume 再排上（首次点击也能出声）
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

    // 彩纸炮只在完美通关、皇冠落定时响
    Bus.on('winPanel', function (d) {
      if (d && d.perfect) play('confettiPop', CONFETTI_DELAY);
    });

    // 菜单/按钮点击（需在 bindTap 里 emit，见接入说明）
    Bus.on('uiTap', function () { play('uiClick'); });
  }

  // ── 对外接口（以后做设置面板音量用）─────────────
  window.SFX = {
    play: play,
    setMasterVolume: function (v) { if (master) master.gain.value = Math.max(0, v); },
    setGain: function (name, v) { if (nodes[name]) nodes[name].gain.value = Math.max(0, v); },
    getGain: function (name) { return nodes[name] ? nodes[name].gain.value : null; },
    unlock: unlock
  };

  init();
  hook();
})();
