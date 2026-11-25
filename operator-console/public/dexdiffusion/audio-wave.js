// Optional azure waveform over the studio while audio plays, and (separately optional) bright text that flickers with
// it. Both are off until switched on in the System screen (Audio visuals). Neither runs with "reduce motion" on or
// while the window is hidden.
//
// The picture is the audio itself: short spans around the playhead are read a second time, each is drawn once into a
// still strip, and the strips slide under the playhead by the element's own currentTime. Nothing is redrawn per frame
// and the whole file is never held. Playback is only watched, never rerouted, and comes first on the network: one small
// read at a time, none while it starts, seeks or buffers. A failure costs the picture only.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DexAudioWave = api; api.install(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WINDOW_S = 4;                        // seconds across the screen, playhead in the middle; also one strip
  const BUCKETS = 1280, LEVELS = 200;        // per strip: one bucket per drawn column, one loudness value per 20 ms
  const STRIP_W = 1280, STRIP_H = 512;       // bounded drawing size, scaled to the window
  const KEEP = 6;                            // strips of data kept around the playhead
  const FRAME_MS = 45, TEXT_MS = 330, MARK_MS = 2000;
  const STEADY_MS = 500;                     // playback must have run this long, undisturbed, before anything is read
  const AHEAD_S = 6, LOW_S = 2;              // and have this much already buffered; a read in flight is dropped below LOW_S
  const HEAD_BYTES = 65536, MAX_COMPRESSED = 6 * 1024 * 1024, MAX_DECODE_S = 600, DECODE_RATE = 8000;
  const KEYS = { wave: 'dex_audio_wave', text: 'dex_audio_wave_text' };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── pure (exported for tests) ─────────────────────────────────────────────────────────────────────────────
  function parseWav(buffer) {
    const d = new DataView(buffer), tag = at => String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
    if (d.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let fmt = null;
    for (let at = 12; at + 8 <= d.byteLength;) {
      const id = tag(at), size = d.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 24 <= d.byteLength) {
        let kind = d.getUint16(at + 8, true);
        if (kind === 0xFFFE && at + 34 <= d.byteLength) kind = d.getUint16(at + 32, true);
        fmt = { float: kind === 3, channels: d.getUint16(at + 10, true), rate: d.getUint32(at + 12, true), block: d.getUint16(at + 20, true), bits: d.getUint16(at + 22, true) };
        const ok = fmt.channels && fmt.rate && fmt.block === fmt.channels * fmt.bits / 8 && (kind === 1 ? [8, 16, 24, 32].includes(fmt.bits) : kind === 3 && fmt.bits === 32);
        if (!ok) return null;
      } else if (id === 'data') return fmt && Object.assign(fmt, { dataAt: at + 8, dataBytes: size });
      at += 8 + size + (size & 1);
    }
    return null;
  }
  // Whole frames of one span as -1..1 values, channels still interleaved.
  function samples(buffer, wav) {
    const n = Math.floor(buffer.byteLength / wav.block) * wav.channels;
    if (wav.float) return { data: new Float32Array(buffer, 0, n), scale: 1 };
    if (wav.bits === 16) return { data: new Int16Array(buffer, 0, n), scale: 1 / 32768 };
    if (wav.bits === 32) return { data: new Int32Array(buffer, 0, n), scale: 1 / 2147483648 };
    const raw = new Uint8Array(buffer), out = new Float32Array(n);
    if (wav.bits === 8) for (let i = 0; i < n; i++) out[i] = (raw[i] - 128) / 128;
    else for (let i = 0; i < n; i++) out[i] = ((raw[3 * i] | raw[3 * i + 1] << 8 | raw[3 * i + 2] << 16) << 8 >> 8) / 8388608;
    return { data: out, scale: 1 };
  }
  // One strip: the true minimum and maximum of every column and the loudness of every 20 ms. `frames` is a full strip's
  // length, so a short last span leaves silence behind it. Channels are interleaved.
  function strip(data, channels, frames, scale = 1) {
    const min = new Float32Array(BUCKETS), max = new Float32Array(BUCKETS), rms = new Float32Array(LEVELS);
    const have = Math.min(frames, Math.floor(data.length / channels));
    let peak = 0;
    for (let b = 0; b < BUCKETS; b++) {
      const to = Math.min(have, Math.ceil((b + 1) * frames / BUCKETS)) * channels;
      let lo = 0, hi = 0;
      for (let i = Math.floor(b * frames / BUCKETS) * channels; i < to; i++) { const v = data[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      min[b] = lo * scale; max[b] = hi * scale;
      peak = Math.max(peak, hi * scale, -lo * scale);
    }
    for (let l = 0; l < LEVELS; l++) {
      const from = Math.floor(l * frames / LEVELS) * channels, to = Math.min(have, Math.floor((l + 1) * frames / LEVELS)) * channels;
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i] * data[i];
      if (to > from) rms[l] = Math.sqrt(sum / (to - from)) * scale;
    }
    return { min, max, rms, peak, loud: rms.reduce((a, b) => Math.max(a, b), 0) };
  }
  // Loudness at the playhead, 0..1 of the loudest passage seen so far in this file.
  function levelAt(span, loud, time) {
    if (!span || loud < 0.001) return 0;
    const l = clamp(Math.floor((time / WINDOW_S - Math.floor(time / WINDOW_S)) * LEVELS), 0, LEVELS - 1);
    return clamp(Math.max(span.rms[l], span.rms[Math.max(0, l - 1)]) / loud, 0, 1);
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
    if (!doc || !win.HTMLMediaElement) return;
    const still = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const stored = key => { try { return win.localStorage.getItem(key) === '1'; } catch (_) { return false; } };
    const on = { wave: stored(KEYS.wave), text: stored(KEYS.text) };
    const watched = new WeakSet(), playing = new Set();
    let source = null, view = null, frame = 0, last = 0, fade = 0, level = 0, time = 0, disturbed = 0;
    let sheet = null, textAt = 0, markAt = 0, textStep = -1;

    const allowed = () => on.wave && !still.matches && !doc.hidden;
    // Seconds already buffered past the playhead; Infinity once the rest of the file is there.
    function ahead(el) {
      for (let i = 0; i < el.buffered.length; i++) if (el.buffered.start(i) <= el.currentTime + 0.1 && el.buffered.end(i) >= el.currentTime) return el.buffered.end(i) >= el.duration - 0.5 ? Infinity : el.buffered.end(i) - el.currentTime;
      return 0;
    }
    const audible = el => !el.paused && !el.ended && !el.muted && el.volume > 0;

    // ── reading: bounded spans only ──
    async function openSource(src, duration) {
      const s = source = { src, spans: new Map(), peak: 0, loud: 0, read: null, wav: null, busy: null, stop: new win.AbortController() };
      try {
        const part = (a, b, signal = s.stop.signal) => win.fetch(src, { signal, priority: 'low', headers: { Range: 'bytes=' + a + '-' + (b - 1) } });   // blob: URLs answer spans too
        const first = await part(0, HEAD_BYTES);
        if (first.status === 206) {
          s.size = +(/\/(\d+)$/.exec(first.headers.get('content-range') || '') || [])[1] || 0;
          s.read = async (a, b, signal) => { const r = await part(a, b, signal); if (r.status !== 206) throw new Error('range'); return r.arrayBuffer(); };
        } else {
          const length = +first.headers.get('content-length');
          if (!first.ok || (!/^data:/.test(src) && !(length > 0 && length <= MAX_COMPRESSED))) throw new Error('no spans');   // would mean holding the whole file
          const blob = await first.blob();
          s.size = blob.size; s.read = (a, b) => blob.slice(a, b).arrayBuffer();
        }
        const head = first.status === 206 ? await first.arrayBuffer() : await s.read(0, HEAD_BYTES);
        const wav = parseWav(head);
        if (wav) {
          wav.dataBytes = Math.min(wav.dataBytes || Infinity, s.size - wav.dataAt);
          s.frames = wav.rate * WINDOW_S;
          s.wav = wav;
        } else if (Offline && s.size && s.size <= MAX_COMPRESSED && duration <= MAX_DECODE_S) {
          // Compressed and short: decoded once at a low rate, reduced to strips, and released.
          const audio = await new Offline(1, 1, DECODE_RATE).decodeAudioData(await s.read(0, s.size)), frames = DECODE_RATE * WINDOW_S, n = audio.numberOfChannels;
          s.whole = [];
          for (let k = 0; k * frames < audio.length; k++) {
            const end = Math.min(audio.length, (k + 1) * frames), mix = new Float32Array((end - k * frames) * n);
            for (let c = 0; c < n; c++) { const data = audio.getChannelData(c); for (let i = k * frames; i < end; i++) mix[(i - k * frames) * n + c] = data[i]; }
            s.whole.push(strip(mix, n, frames));
          }
        } else throw new Error('unsupported');
      } catch (_) { s.failed = true; }                            // no picture for this file; playback is unaffected
    }
    // One span at a time. A read that a seek has made pointless is dropped rather than left competing with playback.
    async function need(s, k) {
      if (s.busy || k < 0 || s.failed || s.spans.has(k) || !(s.wav || s.whole)) return;
      const busy = s.busy = { k, stop: new win.AbortController() };
      try {
        let span = null;
        if (s.whole) span = s.whole[k] || null;
        else {
          const bytes = s.frames * s.wav.block, from = k * bytes, to = Math.min(s.wav.dataBytes, from + bytes);
          if (to > from) { const part = samples(await s.read(s.wav.dataAt + from, s.wav.dataAt + to, busy.stop.signal), s.wav); span = strip(part.data, s.wav.channels, s.frames, part.scale); }
        }
        s.spans.set(k, span);                                     // null past the end of the file: an empty strip
        if (span && span.peak > s.peak) s.peak = span.peak;
        if (span && span.loud > s.loud) s.loud = span.loud;
      } catch (_) { if (!busy.stop.signal.aborted) s.spans.set(k, null); /* this passage stays empty */ }
      if (s.busy === busy) s.busy = null;
    }
    function dropRead() { if (source && source.busy) { source.busy.stop.abort(); source.busy = null; } }
    function closeSource() { dropRead(); if (source) source.stop.abort(); source = null; }

    // ── drawing: one still strip per four seconds ──
    function show() {
      if (view) return;
      const box = doc.createElement('div'), mover = doc.createElement('div');
      box.setAttribute('aria-hidden', 'true'); box.setAttribute('data-audio-wave', '1');
      box.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:99980;contain:strict;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,.25),#000 50%,rgba(0,0,0,.25));';
      mover.style.cssText = 'position:absolute;left:0;top:10%;width:100%;height:80%;will-change:transform,opacity;';
      const strips = [0, 1, 2].map(() => {
        const c = doc.createElement('canvas');
        c.width = STRIP_W; c.height = STRIP_H;
        c.style.cssText = 'position:absolute;top:0;width:100%;height:100%;';
        mover.appendChild(c);
        return { canvas: c, s: null, k: null, span: null, gain: 0 };
      });
      box.appendChild(mover); doc.body.appendChild(box);
      view = { box, mover, strips, base: null, opacity: -1 };
    }
    function paint(target, s, k, span, gain) {
      const g = target.canvas.getContext('2d'), mid = STRIP_H / 2, w = STRIP_W;
      Object.assign(target, { s, k, span, gain });
      g.clearRect(0, 0, w, STRIP_H);
      if (!span) return;
      g.beginPath();
      g.moveTo(0, mid - span.max[0] * gain * mid);
      for (let x = 1; x < w; x++) g.lineTo(x, mid - span.max[x] * gain * mid);
      for (let x = w - 1; x >= 0; x--) g.lineTo(x, mid - span.min[x] * gain * mid);
      g.closePath();
      g.fillStyle = 'rgba(0,127,255,.32)'; g.fill();
      g.lineJoin = 'round'; g.lineWidth = 1.25; g.strokeStyle = 'rgba(0,127,255,.75)'; g.stroke();
    }
    function place(steady) {
      const k = Math.floor(time / WINDOW_S), s = source, gain = s.peak > 0.001 ? 1 / s.peak : 0;
      if (s.busy && (s.busy.k < k - 1 || s.busy.k > k + 1)) dropRead();
      if (steady) for (const i of [k, k + 1, k - 1]) need(s, i);
      for (const i of s.spans.keys()) if (s.spans.size > KEEP && (i < k - 1 || i > k + 1)) s.spans.delete(i);
      for (const i of [k - 1, k, k + 1]) {
        const target = view.strips[(i + 3) % 3], span = s.spans.get(i) || null;
        // Drawn once, and again only if a louder passage changed the scale noticeably.
        if (target.s !== s || target.k !== i || target.span !== span || (span && Math.abs(target.gain - gain) > 0.05 * gain)) paint(target, s, i, span, gain);
        if (view.base !== k) target.canvas.style.left = (i - k) * 100 + '%';
      }
      view.base = k;
      view.mover.style.transform = 'translate3d(' + ((0.5 - (time / WINDOW_S - k)) * 100).toFixed(3) + '%,0,0)';
    }
    function glow() {
      const opacity = Math.round((0.5 + 0.5 * level) * fade * 32) / 32;
      if (opacity !== view.opacity) view.mover.style.opacity = view.opacity = opacity;
    }
    function hide() {
      if (view) { for (const s of view.strips) s.canvas.width = s.canvas.height = 0; view.box.remove(); }
      view = null; fade = level = 0;
      clearText();
    }

    // ── text: at most three changes a second, so fewer than two flashes ──
    function clearText() {
      if (sheet) sheet.remove();
      sheet = null; textStep = -1; markAt = 0;
      for (const el of doc.querySelectorAll('[data-dex-flicker]')) el.removeAttribute('data-dex-flicker');
    }
    function mark() {
      const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT), seen = new Set(), bright = new Set();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || seen.has(el) || !node.data.trim()) continue;
        seen.add(el);
        if (/^(?:SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION|TITLE)$/.test(el.tagName) || el.isContentEditable) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
        if (isBright(win.getComputedStyle(el).color)) bright.add(el);
      }
      for (const el of doc.querySelectorAll('[data-dex-flicker]')) if (!bright.has(el)) el.removeAttribute('data-dex-flicker');
      for (const el of bright) if (!el.hasAttribute('data-dex-flicker')) el.setAttribute('data-dex-flicker', '');
    }
    function flicker(now) {
      if (now - textAt < TEXT_MS) return;
      textAt = now;
      if (!sheet) {
        sheet = doc.createElement('style');
        sheet.setAttribute('data-audio-wave-style', '1');
        sheet.textContent = '[data-dex-flicker]{}[data-dex-flicker]>:not([data-dex-flicker]){-webkit-text-fill-color:currentcolor}';
        doc.head.appendChild(sheet);
      }
      if (now - markAt > MARK_MS) { markAt = now; mark(); }
      const step = Math.round(level * fade * 6);
      if (step === textStep) return;
      textStep = step;
      sheet.sheet.cssRules[0].style.setProperty('-webkit-text-fill-color', 'color-mix(in srgb, currentcolor ' + Math.round(100 - fade * 45 * (1 - step / 6)) + '%, #0b5fc0)');
    }

    // ── one clock ──
    function draw(now) {
      frame = 0;
      if (!allowed()) return stop();
      if (now - last < FRAME_MS) { frame = win.requestAnimationFrame(draw); return; }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.03;
      last = now;
      for (const el of playing) if (!audible(el)) playing.delete(el);
      const el = [...playing].pop(), src = el && (el.currentSrc || el.src);
      if (el && (el.seeking || el.readyState < 3)) { disturbed = now; dropRead(); }
      const buffered = el ? ahead(el) : 0, steady = !!el && now - disturbed > STEADY_MS && buffered >= AHEAD_S;
      if (buffered < LOW_S) dropRead();
      if (source && src && source.src !== src) closeSource();
      if (src && !source && steady) openSource(src, el.duration);
      const live = !!src && !!source && !source.failed && !!(source.wav || source.whole);
      if (live) time = el.currentTime;
      const span = live && source.spans.get(Math.floor(time / WINDOW_S));
      const target = span && el.readyState >= 3 ? Math.sqrt(levelAt(span, source.loud, time)) : 0;
      level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.06 : 0.22)));
      fade += ((live ? 1 : 0) - fade) * (1 - Math.exp(-dt / 0.15));
      if (live) show();
      if (view) {
        if (!live && fade < 0.02) { hide(); closeSource(); }
        else { if (source) place(steady); glow(); if (on.text) flicker(now); }
      }
      if (view || (playing.size && !(source && source.failed))) frame = win.requestAnimationFrame(draw);
      else closeSource();
    }
    function stop() {
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0; last = 0;
      hide(); closeSource();
    }
    function refresh() {
      if (!allowed()) return stop();
      for (const el of playing) if (!audible(el)) playing.delete(el);
      if (playing.size && !frame) { last = 0; frame = win.requestAnimationFrame(draw); }
    }
    function begin(el) {
      if (!audible(el)) return;
      if (!playing.has(el)) disturbed = win.performance.now();
      playing.delete(el); playing.add(el);       // newest last
      refresh();
    }
    function watch(el) {
      if (watched.has(el) || !(el instanceof win.HTMLAudioElement)) return;
      watched.add(el);
      el.addEventListener('playing', () => begin(el));
      el.addEventListener('volumechange', () => { if (!el.paused) begin(el); });
      for (const gone of ['pause', 'ended', 'emptied', 'error']) el.addEventListener(gone, () => { if (gone !== 'emptied' || el.paused) playing.delete(el); });
      for (const busy of ['seeking', 'waiting']) el.addEventListener(busy, () => { if (playing.has(el)) { disturbed = win.performance.now(); dropRead(); } });
      if (!el.paused) begin(el);
    }

    const play = win.HTMLMediaElement.prototype.play;
    win.HTMLMediaElement.prototype.play = function () { watch(this); return play.apply(this, arguments); };   // objects never added to the page
    doc.addEventListener('play', e => watch(e.target), true);                                                  // native controls
    doc.addEventListener('visibilitychange', refresh);
    if (still.addEventListener) still.addEventListener('change', refresh);

    this.settings = () => ({ wave: on.wave, text: on.text });
    this.set = change => {
      for (const key of Object.keys(KEYS)) if (key in change) {
        on[key] = !!change[key];
        try { win.localStorage.setItem(KEYS[key], on[key] ? '1' : '0'); } catch (_) {}
      }
      if (!on.text) clearText();
      refresh();
    };
    this.state = () => ({ active: !!view, running: !!frame, level, fade, time, ahead: [...playing].length ? Math.min(9999, ahead([...playing].pop())) : 0, spans: source ? source.spans.size : 0, failed: !!(source && source.failed), marked: doc.querySelectorAll('[data-dex-flicker]').length });
  }

  return { parseWav, samples, strip, levelAt, isBright, install, WINDOW_S, BUCKETS, LEVELS };
});
