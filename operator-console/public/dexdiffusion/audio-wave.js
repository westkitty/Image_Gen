// Azure waveform over the studio while audio plays, with the bright text flickering in time.
//
// The picture is the audio itself: the playing file is decoded a second time and its sample envelope is drawn
// around the element's own currentTime. Playback is only watched, never rerouted, so a decoding failure costs the
// picture and nothing else. Every <audio> is covered, including new Audio() objects that never join the page.
// With "reduce motion" on, nothing is drawn and no text changes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DexAudioWave = api; api.install(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WINDOW_S = 4;                  // seconds across the screen, playhead in the middle
  const RATE = 22050;                  // decode rate; enough for an envelope, a quarter of the memory
  const BUCKETS_PER_S = 600;
  const MAX_BYTES = 128 * 1024 * 1024;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── pure (exported for tests) ─────────────────────────────────────────────────────────────────────────────
  function loudness(rms, from, to) {
    let sum = 0;
    for (let b = from; b < to; b++) sum += rms[b] * rms[b];
    return to > from ? Math.sqrt(sum / (to - from)) : 0;
  }
  // Sample envelope: the true minimum and maximum of every short bucket, plus its loudness.
  function analyse(channels, rate) {
    const length = channels[0].length, size = Math.max(1, Math.round(rate / BUCKETS_PER_S)), n = Math.ceil(length / size);
    const min = new Float32Array(n), max = new Float32Array(n), rms = new Float32Array(n);
    let peak = 0;
    for (let b = 0; b < n; b++) {
      const from = b * size, to = Math.min(length, from + size);
      let lo = 0, hi = 0, sum = 0;
      for (const data of channels) for (let i = from; i < to; i++) {
        const v = data[i];
        if (v < lo) lo = v; else if (v > hi) hi = v;
        sum += v * v;
      }
      min[b] = lo; max[b] = hi; rms[b] = Math.sqrt(sum / ((to - from) * channels.length));
      peak = Math.max(peak, hi, -lo);
    }
    // "Loud" for this file: the 95th percentile over the same 60 ms spans levelAt() measures. Single buckets are
    // shorter than one cycle of a low note, so they cannot be compared with it.
    const span = Math.max(1, Math.round(0.06 * rate / size)), spans = [];
    for (let b = 0; b < n; b += span) spans.push(loudness(rms, b, Math.min(n, b + span)));
    spans.sort((a, b) => a - b);
    return { min, max, rms, peak, perSecond: rate / size, loud: spans[Math.min(spans.length - 1, Math.floor(spans.length * 0.95))] || 0 };
  }
  // One {lo, hi} pair per pixel column, in -1..1 of the file's own peak. Outside the file is silence.
  function columns(track, time, width, seconds = WINDOW_S) {
    const lo = new Float32Array(width), hi = new Float32Array(width), gain = track.peak > 0.001 ? 1 / track.peak : 0;
    const first = (time - seconds / 2) * track.perSecond, step = seconds * track.perSecond / width;
    for (let x = 0; x < width; x++) {
      const from = Math.floor(first + x * step), to = Math.max(from + 1, Math.floor(first + (x + 1) * step));
      for (let b = Math.max(0, from); b < Math.min(track.min.length, to); b++) {
        if (track.min[b] * gain < lo[x]) lo[x] = track.min[b] * gain;
        if (track.max[b] * gain > hi[x]) hi[x] = track.max[b] * gain;
      }
    }
    return { lo, hi };
  }
  // Loudness at the playhead, 0..1 of the file's own loud passages.
  function levelAt(track, time) {
    if (track.loud < 0.001) return 0;
    const from = Math.max(0, Math.floor((time - 0.03) * track.perSecond)), to = Math.min(track.rms.length, Math.ceil((time + 0.03) * track.perSecond));
    return clamp(loudness(track.rms, from, to) / track.loud, 0, 1);
  }
  // Whites and near-whites by luminance; oranges by hue, since a strong orange is not light.
  function isBright(color) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color || '');
    if (!m || (m[4] !== undefined && +m[4] < 0.5)) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map(v => v / 255), lin = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    if (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) >= 0.55) return true;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    if (!d || max !== r || max < 0.8 || d / max < 0.6) return false;
    const hue = 60 * ((g - b) / d);
    return hue >= 15 && hue <= 50;
  }

  // ── browser ───────────────────────────────────────────────────────────────────────────────────────────────
  function install(win) {
    const doc = win.document, Offline = win.OfflineAudioContext || win.webkitOfflineAudioContext;
    if (!doc || !win.HTMLMediaElement || !Offline) return;
    const still = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const watched = new WeakSet(), tracks = new WeakMap(), playing = new Set();
    let canvas = null, sheet = null, observer = null, frame = 0, last = 0, fade = 0, level = 0, shown = -1, rescan = 0, track = null, time = 0;

    const audible = el => !el.paused && !el.ended && !el.muted && el.volume > 0;

    async function load(el) {
      const src = el.currentSrc || el.src, known = tracks.get(el);
      if (!src || (known && known.src === src)) return;
      const entry = { src, track: null };
      tracks.set(el, entry);
      try {
        const response = await win.fetch(src);
        if (!response.ok || +response.headers.get('content-length') > MAX_BYTES) return;
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > MAX_BYTES) return;
        const audio = await new Offline(1, 1, RATE).decodeAudioData(bytes);
        entry.track = analyse(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)), audio.sampleRate);
      } catch (_) { /* no picture for this file; playback is unaffected */ }
    }
    function begin(el) {
      if (still.matches || !audible(el)) return;
      playing.delete(el); playing.add(el);       // newest last
      load(el);
      if (!frame) { last = 0; frame = win.requestAnimationFrame(draw); }
    }
    function watch(el) {
      if (watched.has(el) || !(el instanceof win.HTMLAudioElement)) return;
      watched.add(el);
      el.addEventListener('playing', () => begin(el));
      el.addEventListener('volumechange', () => { if (!el.paused) begin(el); });
      el.addEventListener('emptied', () => tracks.delete(el));
      if (!el.paused) begin(el);
    }

    // Text is dimmed toward azure when the sound is quiet and returns to its own colour, with an azure glow, when it
    // is loud. text-fill is used because it repaints only: no layout, no stacking contexts, readable at every level.
    function mark() {
      rescan = 0;
      const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || seen.has(el) || !node.data.trim()) continue;
        seen.add(el);
        if (/^(?:SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION|TITLE)$/.test(el.tagName) || el.isContentEditable) continue;
        if (el.hasAttribute('data-dex-flicker')) continue;
        const style = win.getComputedStyle(el);
        if (isBright(style.color)) el.setAttribute('data-dex-flicker', '');
      }
    }
    function show() {
      if (!canvas) {
        canvas = doc.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('data-audio-wave', '1');
        canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99980;';
        sheet = doc.createElement('style');
        sheet.setAttribute('data-audio-wave-style', '1');
        sheet.textContent = '[data-dex-flicker]{}[data-dex-flicker]>:not([data-dex-flicker]){-webkit-text-fill-color:currentcolor;text-shadow:none}';
        doc.head.appendChild(sheet);
        mark();
        observer = new win.MutationObserver(() => { if (!rescan) rescan = win.setTimeout(mark, 150); });
        observer.observe(doc.body, { childList: true, subtree: true });
      }
      if (!canvas.isConnected) doc.body.appendChild(canvas);
    }
    function hide() {
      if (observer) observer.disconnect();
      win.clearTimeout(rescan);
      if (canvas) canvas.remove();
      if (sheet) sheet.remove();
      for (const el of doc.querySelectorAll('[data-dex-flicker]')) el.removeAttribute('data-dex-flicker');
      canvas = sheet = observer = track = null; rescan = 0; fade = level = 0; shown = -1;
    }
    function flicker() {
      const step = Math.round(level * fade * 24);   // change the rule only when the eye could see it
      if (step === shown) return;
      shown = step;
      const v = step / 24, rule = sheet.sheet.cssRules[0].style, keep = Math.round(100 - fade * 58 * (1 - v));
      rule.setProperty('-webkit-text-fill-color', 'color-mix(in srgb, currentcolor ' + keep + '%, #0b5fc0)');
      rule.setProperty('text-shadow', v > 0.05 ? '0 0 ' + (2 + 9 * v).toFixed(1) + 'px rgba(0,127,255,' + (0.85 * v).toFixed(2) + ')' : 'none');
    }
    function paint() {
      const w = win.innerWidth, h = win.innerHeight, dpr = Math.min(2, win.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext('2d'), mid = h / 2, amp = h * 0.4, { lo, hi } = columns(track, time, w);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.beginPath();
      g.moveTo(0, mid - hi[0] * amp);
      for (let x = 1; x < w; x++) g.lineTo(x, mid - hi[x] * amp);
      for (let x = w - 1; x >= 0; x--) g.lineTo(x, mid - lo[x] * amp);
      g.closePath();
      const shade = alpha => {
        const edge = g.createLinearGradient(0, 0, w, 0), c = a => 'rgba(0,127,255,' + (a * fade).toFixed(3) + ')';
        edge.addColorStop(0, c(alpha * 0.25)); edge.addColorStop(0.5, c(alpha)); edge.addColorStop(1, c(alpha * 0.25));
        return edge;
      };
      g.fillStyle = shade(0.16 + 0.16 * level); g.fill();
      g.lineJoin = 'round'; g.lineWidth = 1.25; g.strokeStyle = shade(0.4 + 0.35 * level); g.stroke();
    }
    function draw(now) {
      frame = 0;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      for (const el of playing) if (!audible(el)) playing.delete(el);
      const el = [...playing].pop(), entry = el && tracks.get(el), live = entry && entry.track && !still.matches;
      if (live) { track = entry.track; time = el.currentTime; }
      const target = live && el.readyState >= 3 ? Math.sqrt(levelAt(track, time)) : 0;
      // Smoothed so speech and drums read as a flicker, not a strobe.
      level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.05 : 0.22)));
      fade += ((live ? 1 : 0) - fade) * (1 - Math.exp(-dt / 0.15));
      if (track) {
        if (!live && fade < 0.02) hide();
        else { show(); paint(); flicker(); }
      }
      if (playing.size || track) frame = win.requestAnimationFrame(draw);
    }

    const play = win.HTMLMediaElement.prototype.play;
    win.HTMLMediaElement.prototype.play = function () { watch(this); return play.apply(this, arguments); };   // objects never added to the page
    doc.addEventListener('play', e => watch(e.target), true);                                                  // native controls
    this.state = () => ({ active: !!canvas, level, fade, time, marked: doc.querySelectorAll('[data-dex-flicker]').length });
  }

  return { analyse, columns, levelAt, isBright, install, WINDOW_S };
});
