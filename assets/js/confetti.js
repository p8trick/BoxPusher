(function (global) {
  'use strict';

  // =========================================================
  // BoxPusher Confetti Engine
  // Based on the core particle physics of canvas-confetti.
  //
  // Features kept:
  //   - square / circle particles
  //   - gravity
  //   - decay
  //   - drift
  //   - spread / angle
  //   - startVelocity
  //   - ticks
  //   - scalar
  //   - color
  //   - origin
  //
  // Removed:
  //   - Web Worker
  //   - OffscreenCanvas
  //   - Path2D / DOMMatrix
  //   - bitmap shapes
  //   - text / emoji shapes
  //   - custom paths
  //   - SSR compatibility
  //   - reduced-motion handling
  // =========================================================


  // ---------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------

  var defaults = {
    particleCount: 50,
    angle: 90,
    spread: 45,
    startVelocity: 45,
    decay: 0.9,
    gravity: 1,
    drift: 0,
    ticks: 200,

    origin: {
      x: 0.5,
      y: 0.5
    },

    shapes: ['square', 'circle'],

    colors: [
      '#26ccff',
      '#a25afd',
      '#ff5e7e',
      '#88ff5a',
      '#fcff42',
      '#ffa62d',
      '#ff36ff'
    ],

    scalar: 1
  };


  // ---------------------------------------------------------
  // Utility
  // ---------------------------------------------------------

  function isOk(value) {
    return value !== null && value !== undefined;
  }

  function prop(options, name, transform) {
    var value =
      options && isOk(options[name])
        ? options[name]
        : defaults[name];

    return transform ? transform(value) : value;
  }

  function onlyPositiveInt(number) {
    return number < 0 ? 0 : Math.floor(number);
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  function hexToRgb(hex) {
    var value = String(hex).replace(/[^0-9a-f]/gi, '');

    if (value.length < 6) {
      value =
        value[0] + value[0] +
        value[1] + value[1] +
        value[2] + value[2];
    }

    return {
      r: parseInt(value.substring(0, 2), 16),
      g: parseInt(value.substring(2, 4), 16),
      b: parseInt(value.substring(4, 6), 16)
    };
  }

  function colorsToRgb(colors) {
    return colors.map(hexToRgb);
  }

  function getOrigin(options) {
    var origin = prop(options, 'origin', Object);

    return {
      x: isOk(origin.x) ? Number(origin.x) : defaults.origin.x,
      y: isOk(origin.y) ? Number(origin.y) : defaults.origin.y
    };
  }


  // ---------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------

  var canvas = null;
  var animation = null;

  function createCanvas(zIndex) {
    var element = document.createElement('canvas');

    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';
    element.style.width = '100vw';
    element.style.height = '100vh';
    element.style.pointerEvents = 'none';
    element.style.zIndex = String(zIndex || 100);

    document.body.appendChild(element);

    resizeCanvas(element);

    return element;
  }

  function resizeCanvas(element) {
    element.width = document.documentElement.clientWidth;
    element.height = document.documentElement.clientHeight;
  }


  // ---------------------------------------------------------
  // Physics
  // ---------------------------------------------------------

  function randomPhysics(options) {
    var radAngle = options.angle * (Math.PI / 180);
    var radSpread = options.spread * (Math.PI / 180);

    return {
      x: options.x,
      y: options.y,

      wobble: Math.random() * 10,
      wobbleSpeed:
        Math.min(
          0.11,
          Math.random() * 0.1 + 0.05
        ),

      velocity:
        options.startVelocity * 0.5 +
        Math.random() * options.startVelocity,

      angle2D:
        -radAngle +
        (0.5 * radSpread) -
        Math.random() * radSpread,

      tiltAngle:
        (Math.random() * 0.5 + 0.25) * Math.PI,

      color: options.color,
      shape: options.shape,

      tick: 0,
      totalTicks: options.ticks,

      decay: options.decay,
      drift: options.drift,

      gravity: options.gravity * 3,

      ovalScalar: 0.6,

      scalar: options.scalar
    };
  }


  // ---------------------------------------------------------
  // Particle rendering
  // ---------------------------------------------------------

  function updateParticle(context, particle) {

    // Movement
    particle.x +=
      Math.cos(particle.angle2D) *
      particle.velocity +
      particle.drift;

    particle.y +=
      Math.sin(particle.angle2D) *
      particle.velocity +
      particle.gravity;

    particle.velocity *= particle.decay;


    // Rotation / wobble
    particle.wobble += particle.wobbleSpeed;

    particle.wobbleX =
      particle.x +
      10 * particle.scalar *
      Math.cos(particle.wobble);

    particle.wobbleY =
      particle.y +
      10 * particle.scalar *
      Math.sin(particle.wobble);

    particle.tiltAngle += 0.1;

    var tiltSin = Math.sin(particle.tiltAngle);
    var tiltCos = Math.cos(particle.tiltAngle);

    var random = Math.random() + 2;

    var progress =
      particle.tick++ /
      particle.totalTicks;


    // Fade out
    context.fillStyle =
      'rgba(' +
      particle.color.r + ', ' +
      particle.color.g + ', ' +
      particle.color.b + ', ' +
      (1 - progress) +
      ')';

    context.beginPath();


    // -------------------------------------------------------
    // Circle
    // -------------------------------------------------------

    if (particle.shape === 'circle') {

      var radiusX =
        Math.abs(
          particle.wobbleX -
          particle.x
        ) * particle.ovalScalar;

      var radiusY =
        Math.abs(
          particle.wobbleY -
          particle.y
        ) * particle.ovalScalar;

      context.ellipse(
        particle.x,
        particle.y,
        radiusX,
        radiusY,
        Math.PI / 10 * particle.wobble,
        0,
        Math.PI * 2
      );

    }


    // -------------------------------------------------------
    // Square / confetti strip
    // -------------------------------------------------------

    else {

      var x1 =
        particle.x +
        random * tiltCos;

      var y1 =
        particle.y +
        random * tiltSin;

      var x2 =
        particle.wobbleX +
        random * tiltCos;

      var y2 =
        particle.wobbleY +
        random * tiltSin;

      context.moveTo(
        Math.floor(particle.x),
        Math.floor(particle.y)
      );

      context.lineTo(
        Math.floor(particle.wobbleX),
        Math.floor(y1)
      );

      context.lineTo(
        Math.floor(x2),
        Math.floor(y2)
      );

      context.lineTo(
        Math.floor(x1),
        Math.floor(particle.wobbleY)
      );
    }

    context.closePath();
    context.fill();


    return particle.tick < particle.totalTicks;
  }


  // ---------------------------------------------------------
  // Animation
  // ---------------------------------------------------------

  function startAnimation(particles) {

    if (animation) {
      animation.particles =
        animation.particles.concat(particles);

      return;
    }

    if (!canvas) {
      canvas = createCanvas(100);
    }

    var context = canvas.getContext('2d');

    animation = {
      particles: particles,
      frame: null
    };


    function update() {

      if (!animation) {
        return;
      }

      resizeCanvas(canvas);

      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );


      animation.particles =
        animation.particles.filter(function (particle) {
          return updateParticle(
            context,
            particle
          );
        });


      if (animation.particles.length) {

        animation.frame =
          requestAnimationFrame(update);

      } else {

        finishAnimation();
      }
    }


    animation.frame =
      requestAnimationFrame(update);
  }


  function finishAnimation() {

    if (!animation) {
      return;
    }

    if (animation.frame) {
      cancelAnimationFrame(
        animation.frame
      );
    }

    animation = null;

    if (canvas) {

      var context =
        canvas.getContext('2d');

      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }

      canvas = null;
    }
  }


  // ---------------------------------------------------------
  // Core cannon
  // ---------------------------------------------------------

  function confetti(options) {

    options = options || {};

    var particleCount =
      prop(
        options,
        'particleCount',
        onlyPositiveInt
      );

    if (!particleCount) {
      return;
    }

    var angle =
      prop(options, 'angle', Number);

    var spread =
      prop(options, 'spread', Number);

    var startVelocity =
      prop(options, 'startVelocity', Number);

    var decay =
      prop(options, 'decay', Number);

    var gravity =
      prop(options, 'gravity', Number);

    var drift =
      prop(options, 'drift', Number);

    var ticks =
      prop(options, 'ticks', Number);

    var scalar =
      prop(options, 'scalar', Number);

    var colors =
      prop(
        options,
        'colors',
        colorsToRgb
      );

    var shapes =
      prop(options, 'shapes');

    var origin =
      getOrigin(options);


    if (!canvas) {
      canvas = createCanvas(
        prop(options, 'zIndex', Number)
      );
    }


    var startX =
      canvas.width * origin.x;

    var startY =
      canvas.height * origin.y;


    var particles = [];

    for (var i = 0; i < particleCount; i++) {

      particles.push(
        randomPhysics({
          x: startX,
          y: startY,

          angle: angle,
          spread: spread,
          startVelocity: startVelocity,

          color:
            colors[i % colors.length],

          shape:
            shapes[
              randomInt(0, shapes.length)
            ],

          ticks: ticks,
          decay: decay,
          gravity: gravity,
          drift: drift,
          scalar: scalar
        })
      );
    }


    startAnimation(particles);
  }


  // ---------------------------------------------------------
  // Basic Cannon
  // ---------------------------------------------------------

  function playBasicConfetti() {

    confetti({
      particleCount: 100,
      spread: 70,
      origin: {
        y: 0.6
      }
    });
  }


  // ---------------------------------------------------------
  // Realistic Look
  //
  // This is the official canvas-confetti demo's
  // multi-cannon celebration effect.
  // ---------------------------------------------------------

  function playVictoryConfetti() {

    var count = 200;

    var defaults = {
      origin: {
        y: 0.7
      }
    };


    function fire(particleRatio, options) {

      var settings = {};

      // Copy defaults
      for (var key in defaults) {
        if (defaults.hasOwnProperty(key)) {
          settings[key] = defaults[key];
        }
      }

      // Copy custom options
      for (var option in options) {
        if (options.hasOwnProperty(option)) {
          settings[option] = options[option];
        }
      }

      settings.particleCount =
        Math.floor(
          count * particleRatio
        );

      confetti(settings);
    }


    // 25%
    fire(0.25, {
      spread: 26,
      startVelocity: 55
    });


    // 20%
    fire(0.20, {
      spread: 60
    });


    // 35%
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8
    });


    // 10%
    fire(0.10, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2
    });


    // 10%
    fire(0.10, {
      spread: 120,
      startVelocity: 45
    });
  }


  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------

  global.BoxPusherConfetti = {
    fire: confetti,
    playBasicConfetti: playBasicConfetti,
    playVictoryConfetti: playVictoryConfetti,
    reset: finishAnimation
  };

})(window);