/** Shared site state, language controls, link parameters and desktop geometry.
 * Classic deferred script; load this before page-specific scripts. No build step.
 */
(function (window, document) {
  'use strict';
  if (window.YachieSite) return;

  const languages = { EN: 'English', JA: 'Japanese', ZH: 'Chinese' };
  const mobileWidth = 600;
  const homePage = Boolean(document.getElementById('main_menu'));
  const originalDisplay = new WeakMap();
  const subscribers = new Set();
  const elements = Array.from(document.querySelectorAll('.English, .Japanese, .Chinese, .Common'));
  const initialUrl = new URL(window.location.href);
  const initialAffiliation = initialUrl.searchParams.get('affil');
  const state = {
    language: languages[initialUrl.searchParams.get('lang')] ? initialUrl.searchParams.get('lang') : 'EN',
    affiliation: initialAffiliation === 'Osaka' ? 'Osaka' : 'UBC',
    hasAffiliation: initialAffiliation === 'Osaka' || initialAffiliation === 'UBC'
  };

  elements.forEach(function (element) {
    const display = window.getComputedStyle(element).display;
    originalDisplay.set(element, display === 'none' ? 'block' : display);
  });

  function isMobile() { return window.innerWidth <= mobileWidth; }
  function getState() { return Object.assign({}, state); }
  function subscribe(callback) {
    subscribers.add(callback);
    return function () { subscribers.delete(callback); };
  }
  function setStyle(element, styles) {
    if (!element) return;
    Object.keys(styles).forEach(function (name) { element.style[name] = styles[name]; });
  }

  function updateLink(link, affiliation) {
    const href = link && link.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return;
    let url;
    try { url = new URL(href, window.location.href); } catch (_) { return; }
    if (url.origin !== window.location.origin || !(/\.html$/i.test(url.pathname) || /\/$/.test(url.pathname))) return;
    url.searchParams.set('lang', state.language);
    if (affiliation) url.searchParams.set('affil', affiliation);
    // Preserve relative paths (including project Pages paths), other query keys and hashes.
    if (/^(https?:)?\/\//i.test(href)) {
      link.setAttribute('href', url.href);
    } else {
      const path = href.split(/[?#]/)[0];
      link.setAttribute('href', path + url.search + url.hash);
    }
  }

  function updateLinks() {
    document.querySelectorAll('a[href]').forEach(function (link) { updateLink(link); });
    ['EN', 'JA', 'ZH'].forEach(function (language) {
      ['pplV_', 'mpplV_'].forEach(function (prefix) {
        const control = document.getElementById(prefix + language);
        if (control) updateLink(control.querySelector('a'), 'UBC');
      });
      ['pplO_', 'mpplO_'].forEach(function (prefix) {
        const control = document.getElementById(prefix + language);
        if (control) updateLink(control.querySelector('a'), 'Osaka');
      });
    });
    ['main_pplV_EN', 'main_pplO_EN'].forEach(function (id, index) {
      const control = document.getElementById(id);
      if (control) updateLink(control.querySelector('a'), index === 0 ? 'UBC' : 'Osaka');
    });
  }

  function paintLanguageButtons() {
    Object.keys(languages).forEach(function (language) {
      const selected = language === state.language;
      const desktop = document.getElementById(language);
      const mobile = document.getElementById('mobile' + language);
      setStyle(desktop, {
        fontWeight: selected ? (language === 'EN' ? '700' : '600') : (language === 'EN' ? '300' : '100'),
        backgroundColor: selected ? '#CD853F' : '#888888'
      });
      setStyle(mobile, {
        fontWeight: selected ? (language === 'EN' ? '700' : '600') : (language === 'EN' ? '300' : '100'),
        color: selected ? '#CD853F' : '#BBBBBB'
      });
      [desktop, mobile].forEach(function (control) {
        if (control) control.setAttribute('aria-pressed', String(selected));
      });
    });
  }

  function renderLanguage() {
    elements.forEach(function (element) {
      const classes = element.classList;
      const hasLanguage = Object.values(languages).some(function (name) { return classes.contains(name); });
      const hasAffiliation = classes.contains('UBC') || classes.contains('Osaka');
      const languageMatches = !hasLanguage || classes.contains(languages[state.language]);
      const affiliationMatches = !hasAffiliation || classes.contains('All') || classes.contains(state.affiliation);
      element.style.display = languageMatches && affiliationMatches ? originalDisplay.get(element) : 'none';
    });
    document.documentElement.lang = { EN: 'en', JA: 'ja', ZH: 'zh' }[state.language];
    paintLanguageButtons();
    updateLinks();
    const url = new URL(window.location.href);
    url.searchParams.set('lang', state.language);
    if (state.hasAffiliation) url.searchParams.set('affil', state.affiliation);
    window.history.replaceState(null, '', url);
    subscribers.forEach(function (callback) { callback(getState()); });
    requestLayout();
  }

  function setLanguage(language) {
    if (!languages[language]) return;
    state.language = language;
    // The homepage historically defaults Japanese visitors to Osaka. Apply before
    // painting instead of reloading before the requested language reached the URL.
    if (homePage && language === 'JA' && !state.hasAffiliation) {
      state.affiliation = 'Osaka';
      state.hasAffiliation = true;
    }
    renderLanguage();
  }

  function setAffiliation(affiliation) {
    if (affiliation !== 'UBC' && affiliation !== 'Osaka') return;
    state.affiliation = affiliation;
    state.hasAffiliation = true;
    renderLanguage();
  }

  function bindButton(control, handler) {
    if (!control) return;
    control.setAttribute('role', 'button');
    control.setAttribute('tabindex', '0');
    control.addEventListener('click', handler);
    control.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handler(event);
      }
    });
  }

  const header = document.getElementById('normal_header');
  const main = document.querySelector('.posts');
  const aside = document.querySelector('aside');
  const sidebar = document.getElementById('sidebar');
  const languageBar = document.getElementById('languages');
  const container = document.getElementById('container');
  const footer = document.querySelector('footer');
  const originalLanguageSize = languageBar ? { width: languageBar.style.width, height: languageBar.style.height } : null;
  const originalSidebarTop = sidebar ? sidebar.style.top : '';
  const originalContainerPosition = container ? container.style.backgroundPosition : '';
  const originalFooterPosition = footer ? footer.style.backgroundPosition : '';
  let sidebarHomeTop = null;
  let layoutFrame = null;
  let recalculateSidebar = true;

  /** Keep the original crop and language-dependent footer retreat constants.
   * The white SVG is cropped from the bottom; the teal SVG underneath stays whole.
   */
  function calculateInteriorGeometry(metrics) {
    const fixed = metrics.mainTop < metrics.headerHeight;
    const margin = Math.min(metrics.viewportWidth, 1920) * 0.0225;
    const retreat = fixed ? Math.min(0, metrics.mainBottom - metrics.sidebarHeight * (metrics.language === 'JA' ? 1.7 : 2)) : 0;
    return {
      fixed: fixed,
      logoTop: retreat,
      sidebarTop: metrics.sidebarTop + retreat,
      frontHeight: fixed && metrics.mainTop - margin < metrics.logoHeight ? Math.max(0, metrics.mainTop - margin) : null
    };
  }

  function resetLogo(front, back) {
    [front, back].forEach(function (element) {
      setStyle(element, { position: 'relative', top: '0px', left: '0px' });
    });
    setStyle(front, { height: 'auto' });
  }

  function layout() {
    layoutFrame = null;
    if (aside) aside.style.display = isMobile() ? 'none' : 'flex';
    if (!main || !header) return;
    const mainRect = main.getBoundingClientRect();
    // clientHeight rounds CSS pixels. At scroll zero it can exceed the actual
    // boundary by a fraction and incorrectly pull both logo images out of flow.
    const measuredHeaderHeight = header.getBoundingClientRect().height;
    const headerHeight = Number.isFinite(measuredHeaderHeight) && measuredHeaderHeight > 0
      ? measuredHeaderHeight : header.clientHeight;
    if (languageBar) {
      const fixed = !isMobile() && mainRect.top < headerHeight * (homePage ? 2 / 3 : 0.64);
      setStyle(languageBar, {
        position: fixed ? 'fixed' : 'relative',
        top: '0px',
        right: fixed ? 'max(0px, calc((100% - 1920px) / 2))' : '0px',
        zIndex: homePage ? '20' : '3',
        background: '#FFFFFF00',
        width: originalLanguageSize.width,
        height: originalLanguageSize.height
      });
      if (!homePage) {
        ['EN', 'JA'].forEach(function (id) {
          setStyle(document.getElementById(id), {
            marginRight: mainRect.top < 0 && !isMobile() ? '0px' : '1px',
            borderRight: mainRect.top < 0 && !isMobile() ? '1px solid #FFFFFF' : '0px solid #FFFFFF'
          });
        });
      }
    }
    if (homePage) return; // Homepage logo scroll code was inactive in the original.

    const front = document.querySelector(state.affiliation === 'Osaka' ? '#frontlogo2 img' : '#frontlogo img') || document.querySelector('#frontlogo img');
    const back = document.querySelector(state.affiliation === 'Osaka' ? '#backlogo2 img' : '#backlogo img') || document.querySelector('#backlogo img');
    if (isMobile()) {
      resetLogo(front, back);
      if (sidebar) sidebar.style.top = originalSidebarTop;
      recalculateSidebar = true;
      return;
    }
    if (sidebar && recalculateSidebar) {
      sidebar.style.top = originalSidebarTop;
      sidebarHomeTop = sidebar.getBoundingClientRect().top;
      recalculateSidebar = false;
    }
    if (front && back) {
      const geometry = calculateInteriorGeometry({
        mainTop: mainRect.top, mainBottom: mainRect.bottom, headerHeight: headerHeight,
        viewportWidth: window.innerWidth, logoHeight: back.getBoundingClientRect().height || back.height,
        sidebarHeight: sidebar ? sidebar.clientHeight : 0, sidebarTop: sidebarHomeTop || 0,
        language: state.language
      });
      [front, back].forEach(function (element) {
        setStyle(element, {
          position: geometry.fixed ? 'fixed' : 'relative',
          top: geometry.logoTop + 'px',
          left: geometry.fixed ? 'max(0px, calc((100% - 1920px) / 2))' : '0px'
        });
      });
      setStyle(front, { objectPosition: 'top', height: geometry.frontHeight === null ? 'auto' : geometry.frontHeight + 'px' });
      if (sidebar) sidebar.style.top = geometry.sidebarTop + 'px';
    }
    if (container) {
      container.style.backgroundPosition = mainRect.top > 0
        ? 'top calc(' + (-2 * (headerHeight - mainRect.top)) + 'px) right 50%'
        : originalContainerPosition;
    }
    if (footer && footer.clientHeight > 0) {
      const overlap = -mainRect.top + window.innerHeight - main.clientHeight;
      const shift = overlap * (Math.min(1920, window.innerWidth) - footer.clientHeight) / footer.clientHeight;
      footer.style.backgroundPosition = overlap > 0
        ? 'bottom calc(' + shift + 'px - calc(min(1920px, 100vw) - ' + footer.clientHeight + 'px)) right 50%'
        : originalFooterPosition;
    }
  }

  function requestLayout(recalculate) {
    if (recalculate === true) recalculateSidebar = true;
    if (layoutFrame !== null) return;
    layoutFrame = window.requestAnimationFrame(layout);
  }

  window.YachieSite = Object.freeze({
    isHomePage: homePage, isMobile: isMobile, getState: getState,
    setLanguage: setLanguage, setAffiliation: setAffiliation,
    subscribe: subscribe, updateLink: updateLink, bindButton: bindButton,
    requestLayout: requestLayout, calculateInteriorGeometry: calculateInteriorGeometry
  });

  Object.keys(languages).forEach(function (language) {
    bindButton(document.getElementById(language), function () { setLanguage(language); });
    bindButton(document.getElementById('mobile' + language), function () { setLanguage(language); });
  });
  ['EN', 'JA'].forEach(function (id) {
    setStyle(document.getElementById(id), { marginRight: '1px', borderRight: '0px solid #FFFFFF' });
  });
  window.addEventListener('scroll', function () { requestLayout(); }, { passive: true });
  window.addEventListener('resize', function () { requestLayout(true); });
  window.addEventListener('orientationchange', function () { requestLayout(true); });
  window.addEventListener('load', function () { requestLayout(true); });
  window.addEventListener('popstate', function () {
    const url = new URL(window.location.href);
    state.hasAffiliation = /^(UBC|Osaka)$/.test(url.searchParams.get('affil') || '');
    state.affiliation = url.searchParams.get('affil') === 'Osaka' ? 'Osaka' : 'UBC';
    setLanguage(url.searchParams.get('lang') || 'EN');
  });
  document.querySelectorAll('#normal_header img').forEach(function (image) {
    image.addEventListener('load', function () { requestLayout(true); });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestLayout(true); });
  if ('ResizeObserver' in window) {
    const contentObserver = new window.ResizeObserver(function () { requestLayout(); });
    [main, sidebar, header].filter(Boolean).forEach(function (element) { contentObserver.observe(element); });
  }
  setLanguage(state.language);
})(window, document);
