// Completion feedback: a subtle ding, an in-app toast, and (if allowed) an OS notification.
// Only genuinely successful jobs call completed(); failures and cancellations never do. Each job id notifies once,
// even across SSE reconnects and page refreshes (ids are remembered for the browser session).
// Preferences (non-sensitive) live in localStorage: dexdiffusion.notify.v1 = { muted, volume, os }.
(function () {
  'use strict';
  var PREF = 'dexdiffusion.notify.v1', SEEN = 'dexdiffusion.notify.seen.v1';
  function load() { try { var p = JSON.parse(localStorage.getItem(PREF) || '{}') || {}; return { muted: !!p.muted, volume: Math.min(1, Math.max(0, p.volume == null ? 0.35 : Number(p.volume))), os: !!p.os }; } catch (_) { return { muted: false, volume: 0.35, os: false }; } }
  function save(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (_) {} }
  function seenSet() { try { return new Set(JSON.parse(sessionStorage.getItem(SEEN) || '[]')); } catch (_) { return new Set(); } }
  function remember(id) { try { var s = seenSet(); s.add(id); sessionStorage.setItem(SEEN, JSON.stringify(Array.from(s).slice(-200))); } catch (_) {} }
  var ctx = null;
  // Browsers block audio until the user has interacted with the page; the context is created lazily and resumed on first gesture.
  function audio() { try { if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); } return ctx; } catch (_) { return null; } }
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { var c = audio(); if (c && c.state === 'suspended') c.resume().catch(function () {}); }, { capture: true, passive: true }); });
  function ding(volume) {
    var c = audio(); if (!c || c.state !== 'running') return false;
    var t = c.currentTime;
    [[880, 0], [1320, 0.11]].forEach(function (n) {
      var o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t + n[1]); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.5), t + n[1] + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.35);
      o.connect(g); g.connect(c.destination); o.start(t + n[1]); o.stop(t + n[1] + 0.4);
    });
    return true;
  }
  var api = {
    prefs: load,
    setMuted: function (m) { var p = load(); p.muted = !!m; save(p); return p; },
    setVolume: function (v) { var p = load(); p.volume = Math.min(1, Math.max(0, Number(v) || 0)); save(p); return p; },
    enableOs: function () {
      if (!('Notification' in window)) return Promise.resolve('unsupported');
      return Notification.requestPermission().then(function (r) { var p = load(); p.os = r === 'granted'; save(p); return r; });
    },
    completed: function (job) {
      var id = job && (job.id || job.job_id); if (!id) return false;
      if (seenSet().has(id)) return false;
      remember(id);
      var p = load(), label = (job.label || job.operation || 'Job') + ' finished';
      if (window.__dex && typeof window.__dex.toast === 'function') window.__dex.toast(label, '#65d66e');
      var played = !p.muted && p.volume > 0 ? ding(p.volume) : false;
      if (p.os && 'Notification' in window && Notification.permission === 'granted' && document.hidden) { try { new Notification('DexDiffusion', { body: label, tag: String(id) }); } catch (_) {} }
      return played;
    },
    _ding: ding,
  };
  window.DexNotify = api;
})();
