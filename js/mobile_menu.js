/** Mobile menu: one synchronous target state and a cancelable animation. */
(function (window, document) {
  'use strict';
  const site = window.YachieSite;
  const menu = document.getElementById('mobile-menu');
  const icon = document.getElementById('menu-icon');
  const content = document.getElementById('mobile-menu-content');
  if (!site || !menu || !icon || !content) return;
  const header = document.getElementById('mobile_header');
  const logo = document.querySelector('#mobile_header img');
  const originalLogoDisplay = logo ? logo.style.display : '';
  let opened = false;
  let animationFrame = null;
  let animationToken = 0;
  let currentHeight = 0;
  const duration = 220;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function menuHeight() { return content.clientHeight + window.innerWidth * 0.1; }
  function updateChrome() {
    icon.classList.toggle('open', opened);
    icon.setAttribute('aria-expanded', String(opened));
    menu.setAttribute('aria-hidden', String(!opened));
    if (header) header.style.background = opened ? '#FFFFFF00' : '#FFFFFFEF';
    if (logo) {
      logo.style.display = opened ? 'none' : originalLogoDisplay;
      if (site.isHomePage) logo.style.opacity = opened ? '' : '0';
    }
  }

  function animate(target, immediate) {
    animationToken += 1;
    const token = animationToken;
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    const startHeight = currentHeight;
    let startTime = null;
    function frame(timestamp) {
      if (token !== animationToken) return;
      if (startTime === null) startTime = timestamp;
      const progress = immediate || reducedMotion.matches ? 1 : Math.min(1, (timestamp - startTime) / duration);
      currentHeight = startHeight + (target - startHeight) * progress;
      menu.style.height = currentHeight + 'px';
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(frame);
      } else {
        animationFrame = null;
        if (!opened) {
          menu.style.visibility = 'hidden';
          if (!site.isMobile()) menu.style.display = '';
        }
      }
    }
    if (immediate) frame(0);
    else animationFrame = window.requestAnimationFrame(frame);
  }

  function setOpen(value, immediate) {
    opened = Boolean(value) && site.isMobile();
    updateChrome();
    if (opened) {
      menu.style.visibility = 'visible';
      menu.style.display = 'flex';
    }
    animate(opened ? menuHeight() : 0, immediate);
  }

  // The old inline onclick and asynchronous loop each owned the icon state.
  icon.removeAttribute('onclick');
  icon.setAttribute('aria-controls', 'mobile-menu');
  icon.setAttribute('aria-label', 'Menu');
  site.bindButton(icon, function () { setOpen(!opened); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && opened) { setOpen(false); icon.focus(); }
  });
  site.subscribe(function () { if (opened) animate(menuHeight(), true); });
  window.addEventListener('resize', function () {
    if (!site.isMobile()) setOpen(false, true);
    else if (opened) animate(menuHeight(), true);
  });
  window.addEventListener('orientationchange', function () {
    if (opened) animate(menuHeight(), true);
  });
  setOpen(false, true);
})(window, document);
