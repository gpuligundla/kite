// The bridge between a brand-new game and the Kite OS page that hosts it in an iframe.
// Load it after the game library (kaplay.js or phaser.js, plus gsap.js if used) and before the
// game's own script. window.KITE_SOUNDS maps a sound name to a data: URL; the brain fills it in.
(function () {
  function post(msg) {
    (window.__kite = window.__kite || []).push(msg);
    if (window.parent !== window) window.parent.postMessage(msg, "*");
  }

  // Esc pressed inside the game never reaches the Kite OS page, so pass it up: it leaves full screen.
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && window.parent !== window) window.parent.postMessage({ type: "kite.escape" }, "*");
  }, true);

  var sounds = {};

  // The game's own coordinates. The page fits the canvas to whatever size the Kite OS shows it at,
  // and the canvas holds a device pixel for every pixel on screen, up to full screen on this display.
  var W = 1280, H = 800;
  var ratio = Math.min(3, (window.devicePixelRatio || 1) * Math.max(1, Math.min(screen.width / W, screen.height / H)));
  function fillPage() {
    var s = "margin:0;width:100%;height:100%;overflow:hidden";
    document.documentElement.style.cssText += ";" + s;
    document.body.style.cssText += ";" + s;
  }

  // Simple flat shapes as inert data: URLs. Any script inside an SVG image never runs.
  var SHAPES = {
    circle: '<circle cx="32" cy="32" r="28"/>',
    square: '<rect x="6" y="6" width="52" height="52" rx="8"/>',
    triangle: '<polygon points="32,4 60,58 4,58"/>',
    star: '<polygon points="32,4 40,24 62,24 44,38 50,60 32,47 14,60 20,38 2,24 24,24"/>',
    heart: '<path d="M32 58 L8 32 A14 14 0 0 1 32 16 A14 14 0 0 1 56 32 Z"/>',
    drop: '<path d="M32 4 C32 4 10 30 10 42 A22 22 0 0 0 54 42 C54 30 32 4 32 4 Z"/>',
    sun: '<circle cx="32" cy="32" r="18"/><g stroke-width="4" stroke="currentColor">' +
      '<line x1="32" y1="2" x2="32" y2="12"/><line x1="32" y1="52" x2="32" y2="62"/>' +
      '<line x1="2" y1="32" x2="12" y2="32"/><line x1="52" y1="32" x2="62" y2="32"/></g>',
    dino: '<path d="M10 56 L10 36 Q10 20 26 20 L40 20 L40 10 L56 10 L56 24 L46 24 L46 44 L36 44 L36 56 L28 56 L28 46 L20 46 L20 56 Z"/>' +
      '<circle cx="50" cy="16" r="2" fill="#fff"/>',
    cat: '<path d="M12 16 L22 28 L42 28 L52 16 L52 50 Q32 60 12 50 Z"/>' +
      '<circle cx="24" cy="38" r="3" fill="#fff"/><circle cx="40" cy="38" r="3" fill="#fff"/>',
    rocket: '<path d="M32 2 Q50 20 44 50 L20 50 Q14 20 32 2 Z"/><path d="M20 50 L12 62 L24 56 Z"/>' +
      '<path d="M44 50 L52 62 L40 56 Z"/><circle cx="32" cy="28" r="5" fill="#fff"/>',
  };

  window.kite = {
    W: W,
    H: H,
    ratio: ratio,

    // new Phaser.Game(kite.phaser({ scene: Play, backgroundColor: "#0b1020" })). Phaser 3 has no
    // HiDPI mode, so the canvas is W x H times kite.ratio and every scene's camera zooms by kite.ratio:
    // the game still draws in W x H coordinates. Text gets the same resolution unless it sets its own.
    phaser: function (config) {
      var P = window.Phaser;
      var cameras = P.Cameras.Scene2D.CameraManager.prototype;
      var start = cameras.start;
      cameras.start = function () {
        start.call(this);
        this.main.setZoom(ratio).centerOn(W / 2, H / 2);
      };
      var factory = P.GameObjects.GameObjectFactory.prototype;
      var text = factory.text;
      factory.text = function (x, y, words, style) {
        return text.call(this, x, y, words, Object.assign({ resolution: ratio }, style));
      };
      fillPage();
      var physics = config.physics || {};
      return Object.assign({ type: P.AUTO, banner: false }, config, {
        width: W * ratio,
        height: H * ratio,
        scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH },
        audio: { noAudio: true },
        loader: { imageLoadType: "HTMLImageElement" },
        physics: Object.assign({}, physics, { arcade: Object.assign({ width: W, height: H }, physics.arcade) }),
      });
    },

    // kaplay(kite.kaplay({ background: [16, 24, 48] })): W x H, letterboxed, at kite.ratio.
    kaplay: function (opt) {
      fillPage();
      return Object.assign({ global: false }, opt, { width: W, height: H, letterbox: true, pixelDensity: ratio, texFilter: "linear" });
    },

    ready: function () { post({ type: "kite.ready" }); },

    // One of kite.sounds. Silent where there are none, as in the play-test.
    sound: function (name) {
      var url = (window.KITE_SOUNDS || {})[name];
      if (!url) return;
      var a = (sounds[name] = sounds[name] || new Audio(url));
      a.currentTime = 0;
      a.play().catch(function () {});
    },
    sounds: ["correct", "oops", "cheer", "ready"],
    finish: function (score) { post({ type: "kite.finish", correct: score.correct, total: score.total }); },

    // Kid-friendly text: short, calm, at most one exclamation mark in a row.
    say: function (text) { return String(text).replace(/!+/g, "!").slice(0, 80); },

    // SVG as a data: URL for k.loadSprite() or Phaser's this.load.image(). Shapes drawn in a
    // 64 x 64 box, or a whole <svg ...> element with its own viewBox, width and height.
    svg: function (markup, size) {
      var s = size || 64;
      var full = /^\s*<svg/.test(markup) ? markup : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="' + s +
        '" height="' + s + '">' + markup + "</svg>";
      return "data:image/svg+xml;utf8," + encodeURIComponent(full);
    },

    // A named flat sprite in one color: kite.sprite("dino", "#4caf50").
    sprite: function (name, color) {
      var shape = SHAPES[name] || SHAPES.circle;
      return window.kite.svg('<g fill="' + (color || "#ff9800") + '" color="' + (color || "#ff9800") + '">' + shape + "</g>");
    },
    shapes: Object.keys(SHAPES),
  };
})();
