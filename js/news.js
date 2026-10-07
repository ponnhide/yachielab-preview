/** Lazy SNS widgets. Each provider script is loaded once; process new containers
 * through its public API instead of removing and reexecuting scripts on scroll.
 */
(function (window, document) {
  'use strict';
  const site = window.YachieSite;
  const scripts = new Map();
  const prepared = new WeakSet();
  const providers = [
    {
      name: 'twitter', selector: 'blockquote.pre-twitter-tweet, blockquote.twitter-tweet',
      preClass: 'pre-twitter-tweet', activeClass: 'twitter-tweet',
      source: 'https://platform.twitter.com/widgets.js',
      ready: function () { return Boolean(window.twttr && window.twttr.widgets && window.twttr.widgets.load); },
      process: function (container) { return window.twttr.widgets.load(container); }
    },
    {
      name: 'instagram', selector: 'blockquote.pre-instagram-media, blockquote.instagram-media',
      preClass: 'pre-instagram-media', activeClass: 'instagram-media',
      source: 'https://www.instagram.com/embed.js',
      ready: function () { return Boolean(window.instgrm && window.instgrm.Embeds); },
      process: function () { window.instgrm.Embeds.process(); }
    },
    {
      name: 'bluesky', selector: 'blockquote.pre-bluesky-embed, blockquote.bluesky-embed',
      preClass: 'pre-bluesky-embed', activeClass: 'bluesky-embed',
      source: 'https://embed.bsky.app/static/embed.js',
      ready: function () { return Boolean(window.bluesky && window.bluesky.scan); },
      process: function (container) { window.bluesky.scan(container); }
    }
  ];

  function loadScript(provider) {
    if (provider.ready()) return Promise.resolve();
    if (scripts.has(provider.name)) return scripts.get(provider.name);
    const promise = new Promise(function (resolve, reject) {
      let script = Array.from(document.querySelectorAll('script[src]')).find(function (element) {
        return element.src === provider.source;
      });
      const isNew = !script;
      if (isNew) {
        script = document.createElement('script');
        script.src = provider.source;
        script.async = true;
        script.dataset.snsProvider = provider.name;
      }
      script.addEventListener('load', function () {
        if (provider.ready()) resolve();
        else reject(new Error(provider.name + ' embed API is unavailable'));
      }, { once: true });
      script.addEventListener('error', function () { reject(new Error(provider.name + ' embed script failed to load')); }, { once: true });
      if (isNew) document.body.appendChild(script);
    });
    scripts.set(provider.name, promise);
    return promise;
  }

  function processContainer(container) {
    providers.forEach(function (provider) {
      const blocks = Array.from(container.querySelectorAll(provider.selector)).filter(function (block) { return !prepared.has(block); });
      if (!blocks.length) return;
      blocks.forEach(function (block) {
        prepared.add(block);
        block.classList.remove(provider.preClass);
        block.classList.add(provider.activeClass);
      });
      loadScript(provider).then(function () {
        return provider.process(container);
      }).then(function () {
        if (site) site.requestLayout();
      }).catch(function (error) {
        // Preserve the original blockquote and its link if an external service fails.
        // A later language change or visibility entry may retry without duplicate scripts.
        blocks.forEach(function (block) { prepared.delete(block); });
        scripts.delete(provider.name);
        document.querySelectorAll('script[src]').forEach(function (script) {
          if (script.dataset.snsProvider === provider.name) script.remove();
        });
        console.warn(error.message);
      });
    });
  }

  let observer = null;
  const containers = Array.from(document.querySelectorAll('.sns-post'));
  if ('IntersectionObserver' in window) {
    observer = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        processContainer(entry.target);
      });
    }, { rootMargin: '0px', threshold: 0.1 });
    containers.forEach(function (container) { observer.observe(container); });
  } else {
    containers.forEach(processContainer);
  }
  if (site) site.subscribe(function () {
    if (!observer) containers.forEach(processContainer);
    else containers.forEach(function (container) { observer.unobserve(container); observer.observe(container); });
  });
})(window, document);
