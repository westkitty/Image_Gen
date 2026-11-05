/* source-hover.js — hover cards for the model picker and the LoRA picker.
 *
 * Any element carrying data-source-hover="model:<id>" or "lora:<id>" shows, on hover or keyboard focus, the
 * archived upstream information from /api/source-info/<kind>/<id>: summary, suggested usage, trigger words,
 * weight, a link to the source, "Randomize into prompt" and "Add trigger words". */
(function () {
  'use strict';
  if (window.__dexSourceHover) return;
  window.__dexSourceHover = true;

  var cache = {};
  var card = null, hideTimer = null;

  var css = document.createElement('style');
  css.textContent =
    '.dsh-list{position:fixed;z-index:99998;max-height:60vh;overflow:auto;background:#0d1420;border:1px solid rgba(148,163,184,.3);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:4px;font:12px/1.35 "DM Sans",system-ui,sans-serif;color:#e8f0f7}' +
    '.dsh-item{padding:6px 9px;border-radius:5px;cursor:pointer;display:flex;gap:8px;align-items:baseline}' +
    '.dsh-item[aria-selected=true]{background:rgba(96,144,168,.22)}.dsh-item:hover,.dsh-item.dsh-hot{background:rgba(96,144,168,.38)}' +
    '.dsh-item[aria-disabled=true]{opacity:.5}' +
    '.dsh-card{position:fixed;z-index:99999;width:340px;max-height:70vh;overflow:auto;background:#101a29;border:1px solid rgba(148,163,184,.35);border-radius:9px;box-shadow:0 14px 36px rgba(0,0,0,.55);padding:12px;font:12px/1.45 "DM Sans",system-ui,sans-serif;color:#dbe6f1}' +
    '.dsh-card h4{margin:0 0 4px;font-size:13px;color:#fff}.dsh-card .dsh-badge{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:1px 6px;border-radius:9px;background:#27384d;color:#9fc2dd;margin-bottom:6px}' +
    '.dsh-card p{margin:6px 0;color:#c4d3e2}.dsh-card ul{margin:4px 0 6px 16px;padding:0}.dsh-card li{margin:2px 0}' +
    '.dsh-card .dsh-k{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#7f9bb5;margin-top:8px}' +
    '.dsh-card code{background:#1b2a3d;padding:1px 5px;border-radius:4px;color:#ffd9a0}' +
    '.dsh-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.dsh-btn{background:#1d3250;color:#e8f0f7;border:1px solid rgba(148,163,184,.3);border-radius:6px;padding:5px 9px;font:inherit;cursor:pointer;text-decoration:none}' +
    '.dsh-btn:hover{background:#27456e}';
  document.head.appendChild(css);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getInfo(kind, id) {
    var key = kind + '/' + id;
    if (cache[key]) return cache[key];
    cache[key] = fetch('/api/source-info/' + kind + '/' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return cache[key];
  }

  function promptEl() { return document.querySelector('[data-dex-field="prompt"]'); }
  function appendToPrompt(text) {
    var el = promptEl();
    if (!el || !text) return false;
    var cur = String(el.value || '').trim();
    var next = cur ? cur + (/[,.]$/.test(cur) ? ' ' : ', ') + text : text;
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function missing(text) { var p = String((promptEl() || {}).value || '').toLowerCase(); return text && p.indexOf(String(text).toLowerCase()) < 0; }

  function randomize(info) {
    var r = info.randomize || {}, parts = [];
    if (r.phrases && r.phrases.length) parts.push(pick(r.phrases));
    else {
      if (r.styles && r.styles.length) parts.push(pick(r.styles).toLowerCase());
      var t = (r.triggers && r.triggers.length) ? r.triggers : (info.trigger_words || []);
      if (t.length) parts.push(pick(t));
    }
    if (info.kind === 'lora' && r.phrases && r.phrases.length && (info.trigger_words || []).length) parts.push(pick(info.trigger_words));
    return parts.filter(missing).join(', ');
  }

  function renderCard(info, anchor) {
    if (!card) { card = document.createElement('div'); card.className = 'dsh-card'; card.setAttribute('role', 'tooltip'); document.body.appendChild(card); }
    card.onmouseenter = function () { clearTimeout(hideTimer); };
    var h = '';
    if (!info) h = '<h4>No archived information</h4><p>Nothing has been archived for this item yet.</p>';
    else {
      h += '<h4>' + esc(info.title) + '</h4>' + (info.status ? '<span class="dsh-badge">' + esc(info.status) + '</span>' : '');
      if (info.summary) h += '<p>' + esc(info.summary) + '</p>';
      if (info.trigger_words && info.trigger_words.length) h += '<div class="dsh-k">Trigger words</div><p>' + info.trigger_words.map(function (t) { return '<code>' + esc(t) + '</code>'; }).join(' ') + '</p>';
      if (info.recommended_weight != null) h += '<div class="dsh-k">Suggested weight</div><p>' + esc(info.recommended_weight) + '</p>';
      if (info.settings && (info.settings.steps || info.settings.cfg || info.settings.resolution)) h += '<div class="dsh-k">Suggested settings</div><p>' + ['steps ' + info.settings.steps, 'cfg ' + info.settings.cfg, info.settings.resolution].filter(function (x) { return x && !/undefined|null/.test(x); }).map(esc).join(' · ') + '</p>';
      if (info.usage && info.usage.length) h += '<div class="dsh-k">Suggested usage (from source)</div><ul>' + info.usage.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul>';
      if (info.note) h += '<p>' + esc(info.note) + '</p>';
      if (info.archived_at) h += '<div class="dsh-k">Archived ' + esc(String(info.archived_at).slice(0, 10)) + '</div>';
      h += '<div class="dsh-row">';
      (info.sources || []).filter(function (s) { return /^https:\/\//.test(s.url); }).forEach(function (s) { h += '<a class="dsh-btn" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(s.label) + ' ↗</a>'; });
      h += '<button type="button" class="dsh-btn" data-act="rand">Randomize into prompt</button>';
      if (info.trigger_words && info.trigger_words.length) h += '<button type="button" class="dsh-btn" data-act="trig">Add trigger words</button>';
      h += '</div><div class="dsh-k" data-role="msg" aria-live="polite"></div>';
    }
    card.innerHTML = h;
    var msg = card.querySelector('[data-role=msg]');
    card.onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b || !info) return;
      var text = b.dataset.act === 'rand' ? randomize(info) : (info.trigger_words || []).filter(missing).slice(0, 3).join(', ');
      msg.textContent = !text ? 'Nothing new to add — already in the prompt.' : appendToPrompt(text) ? 'Added to prompt: ' + text : 'Prompt box not found.';
    };
    var r = anchor.getBoundingClientRect(), left = r.right + 8;
    if (left + 340 > window.innerWidth) left = Math.max(8, r.left - 348);
    card.style.left = left + 'px';
    card.style.top = Math.max(8, Math.min(r.top, window.innerHeight - card.offsetHeight - 8)) + 'px';
  }

  var showTimer = null, anchorEl = null;
  function hideCard() { if (card) { card.remove(); card = null; } anchorEl = null; }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (card && !card.matches(':hover') && !(anchorEl && anchorEl.matches(':hover'))) hideCard(); }, 350); }
  function show(el) {
    var spec = String(el.getAttribute('data-source-hover') || '').split(':');
    var kind = spec.shift(), id = spec.join(':');
    if (!kind || !id) return;
    anchorEl = el;
    getInfo(kind, id).then(function (info) { if (anchorEl === el) renderCard(info, el); });
  }
  document.addEventListener('mouseover', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-source-hover]');
    if (!el) { if (card && !card.contains(e.target)) scheduleHide(); return; }
    clearTimeout(hideTimer); clearTimeout(showTimer);
    if (anchorEl === el && card) return;
    showTimer = setTimeout(function () { show(el); }, 140);
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-source-hover]');
    if (el) { clearTimeout(showTimer); scheduleHide(); }
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-source-hover]');
    if (el) { clearTimeout(hideTimer); show(el); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideCard(); }, true);
  window.DexSourceHover = { show: show, hide: hideCard };
})();
