// Registers the static-asset service worker and shows a truthful connectivity notice.
(function () {
  'use strict';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
  }
  var bar = null, fails = 0;
  function show(on) {
    if (on && !bar) {
      bar = document.createElement('div'); bar.setAttribute('role', 'status'); bar.setAttribute('data-offline-notice', '1');
      bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:52px;z-index:99990;background:#7f1d1d;color:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:6px 12px;font:600 12px DM Sans,system-ui,sans-serif;';
      bar.textContent = 'Disconnected from the DexDiffusion console. Generation and the library are unavailable until it reconnects.';
      document.body.appendChild(bar);
    } else if (!on && bar) { bar.remove(); bar = null; }
  }
  function probe() {
    if (navigator.onLine === false) { show(true); return; }
    fetch('/api/version', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('bad'); fails = 0; show(false); })
      .catch(function () { fails++; if (fails >= 2) show(true); });
  }
  window.addEventListener('offline', function () { show(true); });
  window.addEventListener('online', probe);
  setInterval(probe, 20000);
})();
