/** Recover a cached HTML page after a successful Pages deployment. */
(function (window, document) {
  'use strict';
  const script = document.currentScript;
  const revision = script && script.getAttribute('data-page-version');
  const page = script && script.getAttribute('data-page');
  if (!/^[a-f0-9]{64}$/.test(revision || '') || !/^[\w-]+\.html$/.test(page || '') || typeof window.fetch !== 'function') return;
  const base = new URL('../', script.src);
  const current = new URL(window.location.href);
  if (current.origin !== base.origin || (current.pathname !== base.pathname + page && !(page === 'index.html' && current.pathname === base.pathname))) return;

  const started = Date.now();
  let interacted = false;
  const interaction = function () { interacted = true; };
  document.addEventListener('pointerdown', interaction, {once: true, passive: true});
  document.addEventListener('keydown', interaction, {once: true});

  window.fetch(new URL('site-version.json', base).href, {cache: 'no-store', credentials: 'same-origin'})
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (manifest) {
      const latest = manifest && manifest.version === 1 && manifest.pages && manifest.pages[page];
      if (!/^[a-f0-9]{64}$/.test(latest || '') || latest === revision || interacted || Date.now() - started > 5000) return;
      const next = new URL(window.location.href);
      if (next.pathname !== current.pathname || next.searchParams.get('_sitev') === latest) return;
      // At most one automatic refresh per page/minute, including temporarily
      // inconsistent CDN edges. If storage is unavailable, leave the page usable.
      try {
        const key = 'yachie:html-refresh:' + base.pathname + page;
        const previous = Number(window.sessionStorage.getItem(key));
        if (previous && Date.now() - previous < 60000) return;
        window.sessionStorage.setItem(key, String(Date.now()));
      } catch (_) { return; }
      next.searchParams.set('_sitev', latest);
      window.location.replace(next.href);
    })
    .catch(function () { /* Offline/failed checks never block the current page. */ })
    .finally(function () {
      document.removeEventListener('pointerdown', interaction);
      document.removeEventListener('keydown', interaction);
    });
})(window, document);
