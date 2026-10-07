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
  upgradeLogoMarkup();
  const elements = Array.from(document.querySelectorAll('.English, .Japanese, .Chinese, .Common, .UBC, .Osaka, .All'));
  const authoredPeopleAffiliations = new WeakMap();
  const initialUrl = new URL(window.location.href);
  const initialAffiliation = initialUrl.searchParams.get('affil');
  const state = {
    language: languages[initialUrl.searchParams.get('lang')] ? initialUrl.searchParams.get('lang') : 'EN',
    affiliation: initialAffiliation === 'UBC' || initialAffiliation === 'Osaka' ? initialAffiliation : (initialUrl.searchParams.get('lang') === 'JA' ? 'Osaka' : 'UBC'),
    hasAffiliation: initialAffiliation === 'Osaka' || initialAffiliation === 'UBC'
  };

  elements.forEach(function (element) {
    const display = window.getComputedStyle(element).display;
    const variant = element.classList.contains('UBC') || element.classList.contains('Osaka') ||
      Object.values(languages).some(function (language) { return element.classList.contains(language); });
    originalDisplay.set(element, display === 'none' && variant ? 'block' : display);
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
    if (!authoredPeopleAffiliations.has(link)) {
      const originalAffiliation = url.searchParams.get('affil');
      authoredPeopleAffiliations.set(link, /\/people\.html$/i.test(url.pathname) && /^(UBC|Osaka)$/.test(originalAffiliation || '') ? originalAffiliation : null);
    }
    url.searchParams.set('lang', state.language);
    url.searchParams.set('affil', affiliation || authoredPeopleAffiliations.get(link) || state.affiliation);
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
      const stableLogo = element.id === 'frontlogo' || element.id === 'backlogo';
      const oldDuplicate = element.id === 'frontlogo2' || element.id === 'backlogo2';
      const affiliationMatches = stableLogo || !hasAffiliation || classes.contains('All') || classes.contains(state.affiliation);
      element.style.display = !oldDuplicate && languageMatches && affiliationMatches ? originalDisplay.get(element) : 'none';
    });
    document.documentElement.lang = { EN: 'en', JA: 'ja', ZH: 'zh' }[state.language];
    paintLanguageButtons();
    paintLogoButtons();
    updateLinks();
    const url = new URL(window.location.href);
    url.searchParams.set('lang', state.language);
    url.searchParams.set('affil', state.affiliation);
    window.history.replaceState(null, '', url);
    subscribers.forEach(function (callback) { callback(getState()); });
    requestLayout();
  }

  function setLanguage(language) {
    if (!languages[language]) return;
    state.language = language;
    // Language and affiliation are independent after the initial URL defaults.
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
    if (control.tagName === 'BUTTON') return; // Native buttons already generate keyboard clicks.
    control.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handler(event);
      }
    });
  }


  function makeLogoButton(affiliation, image) {
    const control = document.createElement('button');
    control.type = 'button';
    control.classList.add('logo-control');
    control.classList.add(affiliation === 'UBC' ? 'logo-ubc' : 'logo-osaka');
    control.setAttribute('data-affiliation', affiliation);
    control.setAttribute('aria-label', 'Switch to ' + (affiliation === 'UBC' ? 'UBC' : 'The University of Osaka') + ' lab');
    control.setAttribute('aria-pressed', 'false');
    if (image) control.appendChild(image);
    return control;
  }

  function makeLogoStack(color) {
    const stack = document.createElement('span');
    stack.classList.add('logo-stack');
    stack.classList.add('content_img');
    const canvas = document.createElement('span');
    canvas.classList.add('logo-canvas');
    ['UBC', 'Osaka'].forEach(function (affiliation) {
      const image = document.createElement('img');
      image.src = './img/header-' + affiliation.toLowerCase() + '-' + color + '.svg';
      image.alt = affiliation === 'UBC' ? 'Yachie Laboratory at UBC' : 'Yachie Laboratory at The University of Osaka';
      canvas.appendChild(makeLogoButton(affiliation, image));
    });
    stack.appendChild(canvas);
    return stack;
  }

  function upgradeLogoMarkup() {
    let legacyGeneric = false;
    ['frontlogo', 'backlogo', 'frontlogo2', 'backlogo2'].forEach(function (id) {
      const section = document.getElementById(id);
      if (!section) return;
      let stack = section.querySelector('.logo-stack');
      if (!stack) {
        const image = section.querySelector('img');
        if (!image || !/(?:two_logos_on_white_on_black|two_logos_teal_on_white|white_yachielablogo|teal_yachielablogo)\.svg(?:[?#]|$)/.test(image.src)) return;
        legacyGeneric = legacyGeneric || /(?:white|teal)_yachielablogo\.svg(?:[?#]|$)/.test(image.src);
        Array.from(section.children).forEach(function (child) { child.remove(); });
        stack = makeLogoStack(id.indexOf('front') === 0 ? 'white' : 'teal');
        section.appendChild(stack);
      } else {
        const canvas = stack.querySelector('.logo-canvas');
        if (canvas) Array.from(canvas.querySelectorAll('img')).forEach(function (image) {
          if (image.parentElement !== canvas) return;
          const affiliation = image.classList.contains('logo-ubc') || /header-ubc-/.test(image.src) ? 'UBC' :
            image.classList.contains('logo-osaka') || /header-osaka-/.test(image.src) ? 'Osaka' : null;
          if (!affiliation) return;
          const control = makeLogoButton(affiliation);
          canvas.replaceChild(control, image);
          image.classList.remove('logo-ubc');
          image.classList.remove('logo-osaka');
          control.appendChild(image);
        });
        // Old generated pages wrapped the two labs in a home navigation anchor.
        const anchor = stack.parentElement;
        if (anchor && anchor.tagName === 'A') anchor.replaceWith(stack);
      }
    });
    if (legacyGeneric) {
      const title = document.getElementById('head-title');
      const topMenu = document.getElementById('top-menu');
      ['frontlogo', 'backlogo'].forEach(function (id) {
        const section = document.getElementById(id);
        if (section) {
          section.style.width = '100%';
          if (title) title.insertBefore(section, topMenu && topMenu.parentElement === title ? topMenu : null);
        }
      });
      const languageWrapper = document.getElementById('head-lang-logo');
      if (languageWrapper) languageWrapper.style.justifyContent = 'flex-end';
    }
    const mobileContent = document.getElementById('mobile-menu-content');
    if (mobileContent && !document.getElementById('mobile-lab-switch')) {
      const group = document.createElement('div');
      group.setAttribute('id', 'mobile-lab-switch');
      group.classList.add('mobile-lab-switch');
      ['UBC', 'Osaka'].forEach(function (affiliation) {
        const image = document.createElement('img');
        image.src = './img/header-' + affiliation.toLowerCase() + '-white.svg';
        image.alt = affiliation === 'UBC' ? 'Yachie Laboratory at UBC' : 'Yachie Laboratory at The University of Osaka';
        const control = makeLogoButton(affiliation, image);
        control.setAttribute('id', affiliation === 'UBC' ? 'mobile-ubc-lab' : 'mobile-osaka-lab');
        group.appendChild(control);
      });
      mobileContent.appendChild(group);
    }
  }

  let remoteLogoSettings = null;
  function initialLogoSettings() {
    const element = document.getElementById('head') || document.getElementById('normal_header') || document.documentElement;
    const computed = window.getComputedStyle(element);
    const read = function (property) { return typeof computed.getPropertyValue === 'function' ? computed.getPropertyValue(property).trim() : ''; };
    const opacity = function (value, fallback) {
      const number = Number(value);
      return value !== '' && Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
    };
    const time = read('--lab-logo-transition-duration').match(/^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/);
    const milliseconds = time ? Number(time[1]) * (time[2] === 's' ? 1000 : 1) : NaN;
    return {
      logoActiveOpacity: opacity(read('--lab-logo-active-opacity'), 1),
      logoInactiveOpacity: opacity(read('--lab-logo-inactive-opacity'), 0.5),
      logoTransitionMs: Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 10000 ? milliseconds : 300
    };
  }

  function paintLogoButtons() {
    const settings = remoteLogoSettings || initialLogoSettings();
    const variables = {
      '--lab-logo-active-opacity': String(settings.logoActiveOpacity),
      '--lab-logo-inactive-opacity': String(settings.logoInactiveOpacity),
      '--lab-logo-transition-duration': settings.logoTransitionMs + 'ms'
    };
    document.querySelectorAll('.logo-stack, .logo-control[data-affiliation]').forEach(function (element) {
      Object.keys(variables).forEach(function (property) { element.style.setProperty(property, variables[property]); });
    });
    document.querySelectorAll('.logo-control[data-affiliation]').forEach(function (control) {
      control.setAttribute('aria-pressed', String(control.getAttribute('data-affiliation') === state.affiliation));
      const withinHeader = header && header.contains(control);
      control.setAttribute('tabindex', withinHeader && isMobile() ? '-1' : '0');
    });
  }

  function fetchLogoSettings() {
    if (typeof window.fetch !== 'function') return;
    const url = new URL('./site-settings.json', window.location.href);
    window.fetch(url.href, {credentials: 'same-origin', cache: 'no-store'}).then(function (response) {
      if (!response.ok) throw new Error('Site settings unavailable');
      return response.json();
    }).then(function (settings) {
      const validOpacity = function (value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; };
      if (!settings || !validOpacity(settings.logoActiveOpacity) || !validOpacity(settings.logoInactiveOpacity) ||
          typeof settings.logoTransitionMs !== 'number' || !Number.isFinite(settings.logoTransitionMs) || settings.logoTransitionMs < 0 || settings.logoTransitionMs > 10000) return;
      remoteLogoSettings = settings;
      paintLogoButtons();
      requestLayout();
    }).catch(function () { /* Keep the validated head settings when offline or malformed. */ });
  }

  function syncLogoLayers(front, back, visibleHeight, naturalHeight) {
    if (!front || !back) return;
    visibleHeight = Math.max(0, Math.min(naturalHeight, visibleHeight));
    // Partially transparent white artwork must never stack over teal artwork.
    back.style.clipPath = 'inset(' + visibleHeight + 'px 0px 0px)';
    const chosen = new Map();
    const activeBefore = document.activeElement;
    const setVisible = function (control, visible) {
      const affiliation = control.getAttribute('data-affiliation');
      const focusable = visible && !isMobile() && !chosen.has(affiliation);
      control.setAttribute('tabindex', focusable ? '0' : '-1');
      control.setAttribute('aria-hidden', String(!focusable));
      if (focusable) chosen.set(affiliation, control);
    };
    [front, back].forEach(function (layer, index) {
      const origin = layer.getBoundingClientRect().top;
      layer.querySelectorAll('.logo-control[data-affiliation]').forEach(function (control) {
        const rectangle = control.getBoundingClientRect();
        const top = rectangle.top - origin;
        const bottom = top + rectangle.height;
        setVisible(control, index === 0 ? top < visibleHeight && bottom > 0 : bottom > visibleHeight && top < naturalHeight);
      });
    });
    // Old duplicate pairs stay in the DOM until their Sheet rows are migrated.
    ['frontlogo2', 'backlogo2'].forEach(function (id) {
      const section = document.getElementById(id);
      if (section) section.querySelectorAll('.logo-control[data-affiliation]').forEach(function (control) { setVisible(control, false); });
    });
    if (activeBefore && activeBefore.getAttribute && activeBefore.getAttribute('aria-hidden') === 'true') {
      const replacement = chosen.get(activeBefore.getAttribute('data-affiliation'));
      if (replacement && replacement !== activeBefore) replacement.focus({preventScroll: true});
    }
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

  function logoElement(id) {
    const section = document.getElementById(id);
    // Split artwork uses a full-size internal canvas inside a clipped wrapper.
    // Legacy/excluded pages may still use their original single composite image.
    return section && (section.querySelector('.logo-stack') || section.querySelector('img'));
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
    const front = logoElement('frontlogo');
    const back = logoElement('backlogo');
    const naturalLogoHeight = back ? back.getBoundingClientRect().height || back.height || 0 : 0;
    if (homePage || isMobile()) {
      resetLogo(front, back);
      syncLogoLayers(front, back, naturalLogoHeight, naturalLogoHeight);
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
        viewportWidth: window.innerWidth, logoHeight: back.getBoundingClientRect().height || back.height || 0,
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
      if (front.tagName === 'IMG') front.style.objectPosition = 'top';
      setStyle(front, { height: geometry.frontHeight === null ? 'auto' : geometry.frontHeight + 'px' });
      syncLogoLayers(front, back, geometry.frontHeight === null ? naturalLogoHeight : geometry.frontHeight, naturalLogoHeight);
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
    state.affiliation = state.hasAffiliation ? url.searchParams.get('affil') : (url.searchParams.get('lang') === 'JA' ? 'Osaka' : 'UBC');
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
  document.querySelectorAll('.logo-control[data-affiliation]').forEach(function (control) {
    bindButton(control, function (event) { event.preventDefault(); setAffiliation(control.getAttribute('data-affiliation')); });
  });
  setLanguage(state.language);
  fetchLogoSettings();
})(window, document);
