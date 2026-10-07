/** Public asset versions only. Source URLs and validators remain in Sheets. */
(function (window, document) {
  'use strict';
  if (window.YachieAssets) return;
  const base = new URL('./', window.location.href);
  let versions = {};

  function validManifest(value) {
    return value && value.version === 1 && value.assets && typeof value.assets === 'object' &&
      !Array.isArray(value.assets) && Object.keys(value.assets).length <= 10000 &&
      Object.keys(value.assets).every(function (path) {
        return /^(img|img_new|pdf)\/.+/.test(path) && !/(^|\/)\.\.(\/|$)|[\\\x00-\x1f]/.test(path) &&
          /^[a-f0-9]{40}$/.test(value.assets[path]);
      });
  }

  function versionUrl(value) {
    if (!value || /^(?:data|blob|javascript):/i.test(value)) return value;
    let url, path;
    try {
      url = new URL(value, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return value;
      path = decodeURIComponent(url.pathname.slice(base.pathname.length));
    } catch (_) { return value; }
    if (!Object.prototype.hasOwnProperty.call(versions, path)) return value;
    const version = versions[path].slice(0, 12);
    if (url.searchParams.get('v') === version && url.searchParams.getAll('v').length === 1) return value;
    url.searchParams.set('v', version);
    return url.href;
  }

  function versionCss(value) {
    return value.replace(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi, function (whole, quote, url) {
      const next = versionUrl(url.trim());
      return next === url.trim() ? whole : 'url("' + next.replace(/"/g, '%22') + '")';
    });
  }

  function updateElement(element) {
    if (!element || typeof element.getAttribute !== 'function') return;
    ['src', 'poster', 'href'].forEach(function (name) {
      if (name === 'href' && !/^(?:A|AREA)$/.test(element.tagName)) return;
      const old = element.getAttribute(name), next = old && versionUrl(old);
      if (old && next !== old) element.setAttribute(name, next);
    });
    const srcset = element.getAttribute('srcset');
    if (srcset) {
      const next = srcset.split(',').map(function (candidate) {
        return candidate.replace(/^(\s*)(\S+)/, function (_, space, url) { return space + versionUrl(url); });
      }).join(',');
      if (next !== srcset) element.setAttribute('srcset', next);
    }
    const style = element.getAttribute('style');
    if (style && /url\(/i.test(style)) {
      const next = versionCss(style);
      if (next !== style) element.setAttribute('style', next);
    }
  }

  function updateStylesheets() {
    const visited = new Set();
    function visit(sheet) {
      if (!sheet || visited.has(sheet)) return;
      visited.add(sheet);
      let rules;
      try { rules = sheet.cssRules; } catch (_) { return; }
      Array.from(rules || []).forEach(function walk(rule) {
        if (rule.styleSheet) visit(rule.styleSheet);
        if (rule.cssRules) Array.from(rule.cssRules).forEach(walk);
        if (!rule.style) return;
        Array.from(rule.style).forEach(function (property) {
          const old = rule.style.getPropertyValue(property);
          if (!/url\(/i.test(old)) return;
          // CSS relative URLs resolve against the stylesheet, not the page.
          const resolved = old.replace(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi, function (whole, quote, url) {
            let absolute; try { absolute = new URL(url.trim(), sheet.href || base.href).href; } catch (_) { return whole; }
            const next = versionUrl(absolute);
            return next === absolute ? whole : 'url("' + next.replace(/"/g, '%22') + '")';
          });
          if (resolved !== old) rule.style.setProperty(property, resolved, rule.style.getPropertyPriority(property));
        });
      });
    }
    Array.from(document.styleSheets || []).forEach(visit);
  }

  function apply() {
    document.querySelectorAll('img, source, video, a, area, [style]').forEach(updateElement);
    updateStylesheets();
  }

  const api = {versionUrl: versionUrl, apply: apply, ready: Promise.resolve(false)};
  window.YachieAssets = api;
  if (typeof window.fetch !== 'function') return;
  api.ready = window.fetch(new URL('asset-versions.json', base).href, {credentials: 'same-origin', cache: 'no-store'})
    .then(function (response) { if (!response.ok) throw new Error('Asset versions unavailable'); return response.json(); })
    .then(function (manifest) {
      if (!validManifest(manifest)) throw new Error('Invalid asset versions');
      versions = manifest.assets;
      apply();
      if (typeof window.MutationObserver === 'function') {
        const observer = new window.MutationObserver(function (changes) {
          changes.forEach(function (change) {
            if (change.type === 'attributes') updateElement(change.target);
            Array.from(change.addedNodes || []).forEach(function (node) {
              updateElement(node);
              if (node.querySelectorAll) node.querySelectorAll('img, source, video, a, area, [style]').forEach(updateElement);
            });
          });
        });
        observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'href', 'style']});
      }
      window.addEventListener('load', apply, {once: true});
      return true;
    }).catch(function () { return false; });
})(window, document);
