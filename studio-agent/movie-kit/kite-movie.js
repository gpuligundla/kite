// The bridge between a director's-cut movie and the Kite OS page that hosts it in an iframe.
// Load it after gsap.js and movie-data.js and before the movie's own script.
//
// window.KITE_MOVIE arrives as {title, grade, storyboard, timings} and leaves as one master clock:
// every scene and narration line gets absolute start and end seconds, every word too.
// window.KITE_AUDIO maps a line key ("1-0") to a data: URL. The brain fills it in after the build.
(function () {
  var INTRO = 1.2; // the title breathes before the first line
  var GAP = 0.6; // between scenes
  var OUTRO = 3.5; // the closing card after the last line
  var SECONDS_PER_WORD = 0.35; // only when a line has no timings
  var MUSIC_VOLUME = 0.16;

  gsap.registerPlugin(CustomEase, CustomBounce, CustomWiggle, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, Physics2DPlugin);

  function post(msg) {
    (window.__kite = window.__kite || []).push(msg);
    if (window.parent !== window) window.parent.postMessage(msg, "*");
  }

  function band(grade) {
    return grade <= 2 ? "K-2" : grade <= 5 ? "3-5" : grade <= 8 ? "6-8" : "9-12";
  }

  function clock(raw) {
    var t = INTRO;
    var scenes = raw.storyboard.scenes.map(function (scene, s) {
      var start = t;
      var lines = scene.lines.map(function (line, l) {
        var key = s + "-" + l;
        var words = raw.timings[key] || [];
        var from = t;
        var text = String(line.text).replace(/^\s*\[[^\]]*\]\s*/, "");
        var length = words.length
          ? Math.max.apply(null, words.map(function (w) { return w.end; }))
          : text.split(/\s+/).length * SECONDS_PER_WORD;
        t += length;
        return {
          key: key, speaker: line.speaker, voice: line.voice, text: text, start: from, end: t,
          words: words.map(function (w) { return { text: w.text, start: from + w.start, end: from + w.end }; }),
        };
      });
      var end = t;
      t += GAP;
      return {
        index: s, start: start, end: end, background: scene.background, palette: scene.palette,
        camera: scene.camera, actors: scene.actors, lines: lines,
      };
    });
    var last = scenes[scenes.length - 1].end;
    return {
      title: raw.storyboard.title, grade: raw.grade, band: band(raw.grade), width: 1280, height: 720,
      scenes: scenes, lines: scenes.reduce(function (all, s) { return all.concat(s.lines); }, []),
      check: raw.storyboard.check, outro: { start: last, end: last + OUTRO }, duration: last + OUTRO,
    };
  }

  var movie = (window.KITE_MOVIE = clock(window.KITE_MOVIE));
  var timeline = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
  var sounds = {};
  var playing = null;
  var ownDuration = null;
  var button = null;

  function sound(key) {
    var url = (window.KITE_AUDIO || {})[key];
    if (!url) return null;
    return (sounds[key] = sounds[key] || new Audio(url));
  }

  function hush() {
    if (playing) playing.pause();
    playing = null;
  }

  // KITE_AUDIO.music, when the brain added one: a quiet loop under the voices, on the same clock.
  function bed(on) {
    var a = sound("music");
    if (!a) return;
    a.loop = true;
    a.volume = MUSIC_VOLUME;
    if (!on) return a.pause();
    a.currentTime = a.duration ? timeline.time() % a.duration : 0;
    a.play().catch(function () {});
  }

  // Start the line under the playhead at the right offset; later lines start from their cues.
  function speakAt(t) {
    hush();
    movie.lines.forEach(function (line) {
      if (t >= line.start && t < line.end) {
        var a = sound(line.key);
        if (!a) return;
        a.currentTime = Math.max(0, t - line.start);
        a.play().catch(function () {});
        playing = a;
      }
    });
  }

  function fit() {
    var stage = document.getElementById("stage");
    if (!stage) return;
    var scale = Math.min(window.innerWidth / movie.width, window.innerHeight / movie.height);
    stage.style.transformOrigin = "0 0";
    stage.style.transform = "translate(" + (window.innerWidth - movie.width * scale) / 2 + "px," +
      (window.innerHeight - movie.height * scale) / 2 + "px) scale(" + scale + ")";
  }

  function showButton(label) {
    if (!button) {
      button = document.createElement("button");
      button.id = "kite-play";
      button.setAttribute("style",
        "position:fixed;left:50%;top:50%;width:112px;height:112px;margin:-56px 0 0 -56px;border:0;border-radius:50%;" +
        "background:rgba(255,255,255,.92);box-shadow:0 10px 40px rgba(0,0,0,.35);cursor:pointer;z-index:2147483647;" +
        "font:600 15px system-ui,sans-serif;color:#222");
      button.onclick = function () { window.kite.play(); };
      document.body.appendChild(button);
    }
    button.innerHTML = '<svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><path d="M14 9 L32 20 L14 31 Z" fill="#222"/></svg>';
    button.setAttribute("aria-label", label);
    button.style.display = "block";
  }

  window.kite = {
    movie: movie,
    // Every tween goes on this one timeline at an absolute time from KITE_MOVIE, so seek() is exact.
    timeline: timeline,

    ready: function () {
      if (ownDuration !== null) return;
      ownDuration = timeline.duration();
      movie.lines.forEach(function (line) {
        timeline.call(function () { speakAt(line.start); }, null, line.start);
      });
      if (timeline.duration() < movie.duration) timeline.set({}, {}, movie.duration); // never cut the last line
      timeline.eventCallback("onComplete", function () {
        hush();
        bed(false);
        showButton("Watch again");
        post({ type: "kite.ended" });
      });
      fit();
      window.addEventListener("resize", fit);
      showButton("Play");
      post({ type: "kite.ready" });
    },

    // Call from a tap or a click: browsers only let a gesture start sound.
    play: function () {
      if (button) button.style.display = "none";
      if (timeline.progress() >= 1) timeline.seek(0, true);
      speakAt(timeline.time());
      bed(true);
      timeline.play();
    },

    pause: function () {
      timeline.pause();
      hush();
      bed(false);
      showButton("Play");
    },

    // Deterministic: the same seconds always draw the same frame. The play-test uses it.
    seek: function (seconds) {
      timeline.pause();
      hush();
      bed(false);
      timeline.seek(seconds, true);
    },

    time: function () { return timeline.time(); },

    // The movie's own animation length, measured when ready() ran, beside the narration's.
    info: function () {
      return {
        duration: ownDuration, narration: movie.duration,
        lines: movie.lines.map(function (l) { return [l.key, l.end - l.start]; }),
      };
    },
  };
})();
