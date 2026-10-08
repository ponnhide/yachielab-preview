/** Public asset versions only. Source URLs and validators remain in Sheets. */
(function (window, document) {
  'use strict';
  if (window.YachieAssets) return;
  const base = new URL('./', window.location.href);
  let versions = {};
  let displayAssets = Object.create(null);
  let originalsByTarget = Object.create(null);

  function safeAssetPath(path) {
    if (typeof path !== 'string' || !/^(?:img|img_new|pdf)\/.+/.test(path) || /[\\?#\x00-\x1f\x7f]/.test(path) || /(^|\/)\.{1,2}(\/|$)|\/\/|\/$/.test(path)) return false;
    try {
      const url = new URL(path, base);
      return url.origin === base.origin && url.pathname.startsWith(base.pathname) && decodeURIComponent(url.pathname.slice(base.pathname.length)) === path;
    } catch (_) { return false; }
  }

  function validManifest(value) {
    return value && value.version === 1 && value.assets && typeof value.assets === 'object' &&
      !Array.isArray(value.assets) && Object.keys(value.assets).length <= 10000 &&
      Object.keys(value.assets).every(function (path) {
        return safeAssetPath(path) && /^[a-f0-9]{40}$/.test(value.assets[path]);
      });
  }

  function readDisplayAssets(value) {
    displayAssets = Object.create(null);
    originalsByTarget = Object.create(null);
    // Optional aliases are disposable. Bad entries cannot invalidate ordinary
    // asset versions or redirect links to an external/unverified destination.
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 10000) return;
    Object.keys(value).forEach(function (original) {
      const alias = value[original];
      if (!safeAssetPath(original) || !/^(?:img|img_new)\//.test(original) || !/\.(?:png|jpe?g)$/i.test(original) ||
          !alias || typeof alias !== 'object' || Array.isArray(alias) || Object.keys(alias).length !== 3 ||
          !safeAssetPath(alias.targetPath) || !/^img\/optimized\//.test(alias.targetPath) || !/\.(?:webp|png|jpe?g)$/i.test(alias.targetPath) ||
          !/^[a-f0-9]{40}$/.test(alias.sourceSha || '') || !/^[a-f0-9]{40}$/.test(alias.targetSha || '') || original === alias.targetPath) return;
      displayAssets[original] = alias;
      const owner = originalsByTarget[alias.targetPath];
      originalsByTarget[alias.targetPath] = owner === undefined || owner === original ? original : null;
    });
  }

  function versionUrl(value, useDisplayAsset) {
    if (!value || /^(?:data|blob|javascript):/i.test(value)) return value;
    let url, path;
    try {
      url = new URL(value, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return value;
      path = decodeURIComponent(url.pathname.slice(base.pathname.length));
    } catch (_) { return value; }
    // Artifact HTML may already contain a derivative. Resolve its original
    // identity so stale mappings can fall back and download links stay original.
    const optimized = /^img\/optimized\//.test(path);
    const markers = url.searchParams.getAll('asset');
    const marked = markers.length === 1 ? markers[0] : '';
    const validIdentity = optimized && safeAssetPath(marked) && /^(?:img|img_new)\/.+\.(?:png|jpe?g)$/i.test(marked) && Object.prototype.hasOwnProperty.call(versions, marked);
    const original = validIdentity ? marked : originalsByTarget[path] || path;
    if (!Object.prototype.hasOwnProperty.call(versions, path) && original === path) return value;
    const alias = displayAssets[original];
    const eligible = alias && versions[original] === alias.sourceSha && versions[alias.targetPath] === alias.targetSha;
    const displayAlias = useDisplayAsset !== false && eligible;
    const selected = displayAlias ? alias.targetPath : original;
    if (!Object.prototype.hasOwnProperty.call(versions, selected)) return value;
    const version = versions[selected].slice(0, 12);
    const correctMarker = displayAlias ? markers.length === 1 && marked === original : !validIdentity;
    if (selected === path && correctMarker && url.searchParams.get('v') === version && url.searchParams.getAll('v').length === 1) return value;
    if (selected !== path) {
      const next = new URL(selected, base);
      next.search = url.search;
      next.hash = url.hash;
      url = next;
    }
    // Keep public logical identity even when compiled HTML/CSS names a target
    // which a later deployment no longer contains. The marker is never a URL.
    if (displayAlias) url.searchParams.set('asset', original);
    else if (optimized && original !== path) url.searchParams.delete('asset');
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
      const old = element.getAttribute(name), next = old && versionUrl(old, name !== 'href');
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
      readDisplayAssets(manifest.displayAssets);
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
