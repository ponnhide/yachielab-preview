'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { createBrowser: createBrowserFixture } = require('./browser-harness.cjs');

function measureLogoStack(browser, stack) {
  stack.getBoundingClientRect = () => {
    const height = stack.style.height && stack.style.height !== 'auto' ? Number.parseFloat(stack.style.height) : browser.metrics.logoHeight;
    const top = Number.parseFloat(stack.style.top) || 0;
    return {top, bottom: top + height, height};
  };
}
function createBrowser(page, options) {
  const browser = createBrowserFixture(page, options);
  const prepareElement = element => {
    element.style.setProperty = (name, value) => { element.style[name] = String(value); };
    const originalRectangle = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = () => {
      if (element.classList.contains('logo-stack')) {
        const height = element.style.height && element.style.height !== 'auto' ? Number.parseFloat(element.style.height) : browser.metrics.logoHeight;
        const top = Number.parseFloat(element.style.top) || 0;
        return {top, bottom: top + height, height};
      }
      if (element.classList.contains('logo-control')) {
        let stack = element.parentElement;
        while (stack && !stack.classList.contains('logo-stack')) stack = stack.parentElement;
        if (stack) {
          const isOsaka = element.getAttribute('data-affiliation') === 'Osaka';
          const top = stack.getBoundingClientRect().top + (isOsaka ? 213.41425 : 0) / 343.41425 * browser.metrics.logoHeight;
          const height = (isOsaka ? 130 : 129) / 343.41425 * browser.metrics.logoHeight;
          return {top, bottom: top + height, height};
        }
      }
      return originalRectangle();
    };
    element.replaceChild = (replacement, original) => {
      replacement.remove();
      const index = element.children.indexOf(original);
      assert(index >= 0);
      element.children[index] = replacement;
      replacement.parentElement = element;
      replacement.env = element.env;
      original.parentElement = null;
      return original;
    };
    element.replaceWith = replacement => element.parentElement.replaceChild(replacement, element);
    element.insertBefore = (replacement, before) => {
      replacement.remove();
      const index = before ? element.children.indexOf(before) : element.children.length;
      assert(index >= 0);
      element.children.splice(index, 0, replacement);
      replacement.parentElement = element;
      replacement.env = element.env;
      return replacement;
    };
    return element;
  };
  const walk = element => { prepareElement(element); element.children.forEach(walk); };
  walk(browser.document);
  const makeElement = browser.document.createElement;
  browser.document.createElement = tag => prepareElement(makeElement(tag));
  const computedStyle = browser.window.getComputedStyle;
  browser.window.getComputedStyle = element => ({
    ...computedStyle(element),
    getPropertyValue(name) {
      let owner = element;
      while (owner) {
        if (owner.style[name] !== undefined) return String(owner.style[name]);
        const source = owner.getAttribute('style') || '';
        const match = source.match(new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+)'));
        if (match) return match[1];
        owner = owner.parentElement;
      }
      return '';
    }
  });
  return browser;
}
function controlledLogo(browser, id) {
  const section = browser.element(id);
  return section && (section.querySelector('.logo-stack') || section.querySelector('img'));
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// Public page content and URI behavior, independent of implementation internals.
test('language changes preserve the selected affiliation in one click without reload', () => {
  const browser = createBrowser('index.html');
  browser.run('common.js');
  browser.run('index.js');
  browser.flush();
  browser.element('JA').dispatch('click');
  browser.flush();
  assert.equal(browser.window.location.search, '?lang=JA');
  assert.equal(browser.reloads, 0);
  assert.equal(browser.document.documentElement.lang, 'ja');
  assert.notEqual(browser.element('frontlogo').style.display, 'none');
  if (browser.element('frontlogo2')) assert.equal(browser.element('frontlogo2').style.display, 'none');
  const label = browser.element('main_research_EN');
  assert.equal(label.querySelector('.English').style.display, 'none');
  assert.notEqual(label.querySelector('.Japanese').style.display, 'none');
  assert.match(browser.element('main_pplV_EN').querySelector('a').getAttribute('href'), /lang=JA&affil=UBC/);
  assert.match(browser.element('main_pplO_EN').querySelector('a').getAttribute('href'), /lang=JA&affil=Osaka/);
});

test('homepage ignores legacy lab selection; unknown language falls back to English', () => {
  const explicit = createBrowser('index.html', { url: 'https://ponnhide.github.io/yachielab-preview/?lang=JA&affil=UBC' });
  explicit.run('common.js');
  assertLabs(explicit, true, true);
  assert.notEqual(explicit.element('frontlogo').style.display, 'none');
  const invalid = createBrowser('research.html', { url: 'https://ponnhide.github.io/yachielab-preview/research.html?lang=XX' });
  invalid.run('common.js');
  assert.equal(invalid.document.documentElement.lang, 'en');
  assert.equal(invalid.window.YachieSite.getState().language, 'EN');
});

test('both People labs default on and Chinese Osaka sections are not lost', () => {
  const browser = createBrowser('people.html');
  browser.run('common.js');
  browser.element('JA').dispatch('click');
  assertLabs(browser, true, true);
  browser.window.YachieSite.toggleAffiliation('UBC');
  browser.element('ZH').dispatch('click');
  assert.notEqual(browser.element('frontlogo').style.display, 'none');
  if (browser.element('frontlogo2')) assert.equal(browser.element('frontlogo2').style.display, 'none');
  const osakaChinese = browser.document.querySelectorAll('.Osaka.Chinese');
  assert.ok(osakaChinese.length > 0);
  osakaChinese.forEach(element => assert.notEqual(element.style.display, 'none'));
  assert.equal(browser.element('mobileZH').getAttribute('aria-pressed'), 'true');
});

test('HTML navigation parameters preserve unrelated query keys, hashes and external/download destinations', () => {
  const browser = createBrowser('research.html');
  const link = browser.document.createElement('a');
  link.setAttribute('href', './contact.html?campaign=lab&lang=EN#address');
  browser.document.body.appendChild(link);
  const outside = browser.document.createElement('a');
  outside.setAttribute('href', 'https://www.addgene.org/Nozomu_Yachie/');
  browser.document.body.appendChild(outside);
  const download = browser.document.createElement('a');
  download.setAttribute('href', './pdf/example.pdf');
  browser.document.body.appendChild(download);
  browser.run('common.js');
  browser.element('ZH').dispatch('click');
  assert.equal(link.getAttribute('href'), './contact.html?campaign=lab&lang=ZH#address');
  assert.equal(outside.getAttribute('href'), 'https://www.addgene.org/Nozomu_Yachie/');
  assert.equal(download.getAttribute('href'), './pdf/example.pdf');
});

test('missing template regions and excluded pages do not throw or expose legacy globals', () => {
  const blank = createBrowser('<html><body><section class="English">Text</section></body></html>');
  ['common.js', 'index.js', 'mobile_menu.js', 'news.js'].forEach(name => blank.run(name));
  blank.flush();
  ['LANG', 'vw', 'EN', 'sleep', 'setJA', 'intersection'].forEach(name => assert.equal(vm.runInContext('typeof ' + name, blank.context), 'undefined'));
  const excluded = createBrowser('yuka.html');
  excluded.run('common.js');
  excluded.run('mobile_menu.js');
  excluded.flush();
});

test('logo crop matches header boundary and never stretches below its original height', () => {
  const browser = createBrowser('research.html');
  browser.run('common.js');
  browser.flush();
  const geometry = browser.window.YachieSite.calculateInteriorGeometry;
  const metrics = { mainTop: 110, mainBottom: 5110, headerHeight: 192, viewportWidth: 1280, logoHeight: 110, sidebarHeight: 320, sidebarTop: 248, language: 'EN' };
  assert.equal(geometry(metrics).frontHeight, 81.2);
  assert.equal(geometry({ ...metrics, mainTop: -100 }).frontHeight, 0);
  assert.equal(geometry({ ...metrics, mainTop: 190 }).frontHeight, null);
  assert.equal(geometry({ ...metrics, mainTop: 192 }).fixed, false);
  browser.metrics.mainTop = 110;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(controlledLogo(browser, 'frontlogo').style.height, '81.2px');
  assert.equal(controlledLogo(browser, 'backlogo').getBoundingClientRect().height, 110);
});

test('footer retreat is language-specific and a sudden Home fully restores logo/sidebar positions', () => {
  const browser = createBrowser('research.html');
  browser.run('common.js');
  browser.flush();
  browser.metrics.mainTop = -4500; // Main bottom=500, EN retreat=500-(320*2)=-140.
  browser.window.dispatch('scroll');
  browser.flush();
  const front = controlledLogo(browser, 'frontlogo');
  const back = controlledLogo(browser, 'backlogo');
  assert.equal(front.style.top, '-140px');
  assert.equal(back.style.top, '-140px');
  assert.equal(browser.element('sidebar').style.top, '108px');
  browser.element('JA').dispatch('click');
  browser.flush();
  assert.equal(front.style.top, '-44px');
  browser.metrics.mainTop = 192;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.top, '0px');
  assert.equal(back.style.top, '0px');
  assert.equal(front.style.height, 'auto');
  assert.equal(browser.element('sidebar').style.top, '248px');
  assert.equal(browser.frames.size, 0, 'No delayed stale geometry remains');
});

test('homepage hover uses correct matching assets and pauses/restores animation without toggling races', () => {
  const browser = createBrowser('index.html');
  browser.run('common.js');
  browser.run('index.js');
  const control = browser.element('main_research_EN');
  const image = browser.element('main_research_img');
  control.dispatch('mouseenter');
  control.dispatch('mouseenter');
  assert.match(new URL(image.src).pathname, /H_2r\.png$/);
  assert.equal(image.style.animationPlayState, 'paused');
  assert.equal(browser.document.querySelector('footer').style.zIndex, '22');
  control.dispatch('mouseleave');
  assert.match(new URL(image.src).pathname, /H_1r\.png$/);
  assert.equal(image.style.animationPlayState, 'running');
  assert.equal(browser.document.querySelector('footer').style.zIndex, '18');
  assert.ok(browser.preloadSources.some(source => new URL(source).pathname.endsWith('/H_2r.png')));
  assert.ok(!browser.preloadSources.some(source => source.includes('/HH_2r.png')));
});

test('mobile rapid toggles reverse their target immediately and leave no competing animations', () => {
  const browser = createBrowser('contact.html', { width: 390 });
  browser.run('common.js');
  browser.run('mobile_menu.js');
  browser.flush(0);
  const icon = browser.element('menu-icon');
  const menu = browser.element('mobile-menu');
  icon.dispatch('click');
  assert.equal(icon.getAttribute('aria-expanded'), 'true');
  browser.flush(10);
  browser.flush(30);
  icon.dispatch('click');
  assert.equal(icon.getAttribute('aria-expanded'), 'false');
  browser.completeAnimation();
  assert.equal(menu.style.height, '0px');
  assert.equal(menu.style.visibility, 'hidden');
  assert.equal(icon.classList.contains('open'), false);
  icon.dispatch('click');
  browser.completeAnimation();
  assert.equal(menu.style.height, '619px');
  assert.equal(menu.style.visibility, 'visible');
  browser.document.dispatch('keydown', { key: 'Escape' });
  browser.completeAnimation();
  assert.equal(menu.style.visibility, 'hidden');
  assert.equal(browser.document.activeElement, icon);
});

test('mobile language controls share state and resizing changes mode without reload', () => {
  const browser = createBrowser('index.html', { width: 390 });
  browser.run('common.js');
  browser.run('index.js');
  browser.run('mobile_menu.js');
  browser.element('mobileJA').dispatch('keydown', { key: 'Enter' });
  assert.equal(browser.window.YachieSite.getState().language, 'JA');
  assert.equal(browser.element('JA').getAttribute('aria-pressed'), 'true');
  browser.element('menu-icon').dispatch('click');
  browser.completeAnimation();
  browser.window.innerWidth = 1280;
  browser.window.dispatch('resize');
  browser.completeAnimation();
  assert.equal(browser.element('mobile-menu').style.display, '');
  assert.equal(browser.element('mobile-menu').style.visibility, 'hidden');
  assert.equal(browser.reloads, 0);
  assert.equal(browser.document.querySelector('aside').style.display, 'flex', 'The homepage with .posts retains its existing desktop setup');
  assert.equal(browser.element('menu-icon').getAttribute('onclick'), null);
});

test('lazy Twitter processing loads one script for multiple visibility batches and does not duplicate a block', async () => {
  const browser = createBrowser('news.html');
  browser.document.querySelectorAll('script[src]').filter(script => /widgets\.js|embed\.js/.test(script.src)).forEach(script => script.remove());
  browser.run('common.js');
  browser.run('news.js');
  const observer = browser.observers[0];
  const containers = browser.document.querySelectorAll('.sns-post').filter(container => container.querySelector('blockquote.pre-twitter-tweet'));
  assert.ok(containers.length > 2);
  observer.enter(containers[0]);
  observer.enter(containers[0]);
  observer.enter(containers[1]);
  let calls = 0;
  browser.window.twttr = { widgets: { load(container) { calls++; assert.ok(containers.includes(container)); } } };
  const scripts = browser.document.querySelectorAll('script[src]').filter(script => script.src === 'https://platform.twitter.com/widgets.js');
  assert.equal(scripts.length, 1);
  scripts[0].dispatch('load');
  await tick();
  assert.equal(calls, 2);
  observer.enter(containers[2]);
  await tick();
  assert.equal(calls, 3);
  assert.equal(browser.document.querySelectorAll('script[src]').filter(script => script.src === 'https://platform.twitter.com/widgets.js').length, 1);
});

test('Bluesky uses one official script and its scan API for both raw Sheet embeds', async () => {
  const browser = createBrowser('news.html');
  browser.document.querySelectorAll('script[src]').filter(script => /embed\.js/.test(script.src)).forEach(script => script.remove());
  browser.run('common.js');
  browser.run('news.js');
  const observer = browser.observers[0];
  const containers = browser.document.querySelectorAll('.sns-post').filter(container => container.querySelector('blockquote.bluesky-embed'));
  assert.equal(containers.length, 2);
  observer.enter(containers[0]);
  observer.enter(containers[1]);
  let scans = 0;
  browser.window.bluesky = { scan(container) { scans++; assert.ok(container.querySelector('[data-bluesky-uri]')); } };
  const scripts = browser.document.querySelectorAll('script[src]').filter(script => script.src === 'https://embed.bsky.app/static/embed.js');
  assert.equal(scripts.length, 1);
  scripts[0].dispatch('load');
  await tick();
  assert.equal(scans, 2);
});

test('a failed external provider keeps the source link and can retry with a fresh owned script', async () => {
  const browser = createBrowser('news.html');
  browser.context.console = { warn() {}, log() {} };
  browser.document.querySelectorAll('script[src]').filter(script => /widgets\.js|embed\.js/.test(script.src)).forEach(script => script.remove());
  browser.run('common.js');
  browser.run('news.js');
  const observer = browser.observers[0];
  const container = browser.document.querySelectorAll('.sns-post').find(element => element.querySelector('blockquote.pre-twitter-tweet'));
  const source = container.querySelector('a').getAttribute('href');
  observer.enter(container);
  let script = browser.document.querySelectorAll('script[src]').find(element => element.src === 'https://platform.twitter.com/widgets.js');
  script.dispatch('error');
  await tick();
  assert.equal(container.querySelector('a').getAttribute('href'), source);
  assert.equal(browser.document.querySelectorAll('script[src]').filter(element => element.src === 'https://platform.twitter.com/widgets.js').length, 0);
  observer.enter(container);
  script = browser.document.querySelectorAll('script[src]').find(element => element.src === 'https://platform.twitter.com/widgets.js');
  assert.ok(script);
  let calls = 0;
  browser.window.twttr = { widgets: { load() { calls++; } } };
  script.dispatch('load');
  await tick();
  assert.equal(calls, 1);
});


test('a fractional header boundary stays in normal flow at scroll zero despite clientHeight rounding', () => {
  const browser = createBrowser('research.html');
  browser.metrics.headerHeight = 192; // Integer clientHeight reported by the browser.
  browser.metrics.headerRectHeight = 191.9957;
  browser.metrics.mainTop = 191.9957; // Fractional layout pixels share the same boundary.
  browser.run('common.js');
  browser.flush();
  const front = controlledLogo(browser, 'frontlogo');
  const back = controlledLogo(browser, 'backlogo');
  assert.equal(front.style.position, 'relative');
  assert.equal(back.style.position, 'relative');
  assert.equal(front.style.height, 'auto');
  browser.metrics.mainTop = 191.5;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.position, 'fixed');
  assert.equal(back.style.position, 'fixed');
});


function installSplitLogos(browser) {
  const stacks = {};
  for (const id of ['frontlogo', 'backlogo', 'frontlogo2', 'backlogo2']) {
    const section = browser.element(id);
    // The current Sheet removes the deprecated second pair. Older page fixtures
    // may still contain it; both shapes must exercise the same stable pair.
    if (!section && id.endsWith('2')) continue;
    assert.ok(section, 'Missing required header logo region: ' + id);
    section.querySelectorAll('img, .logo-stack').forEach(element => element.remove());
    const anchor = section.querySelector('a') || section;
    const stack = browser.document.createElement('span');
    stack.classList.add('logo-stack');
    stack.style.width = '268.8px';
    const canvas = browser.document.createElement('span');
    canvas.classList.add('logo-canvas');
    canvas.style.aspectRatio = '772 / 315';
    for (const [name, top, height] of [['ubc', '0px', '44.9181347px'], ['osaka', '64.4145078px', '45.2668394px']]) {
      const image = browser.document.createElement('img');
      image.classList.add('logo-part-' + name);
      image.style.position = 'absolute';
      image.style.top = top;
      image.style.height = height;
      image.style.width = '268.8px';
      canvas.appendChild(image);
    }
    stack.appendChild(canvas);
    anchor.appendChild(stack);
    measureLogoStack(browser, stack);
    stacks[id] = stack;
  }
  return stacks;
}

test('split artwork crops only the outer wrapper and preserves both child SVG positions and width', () => {
  const browser = createBrowser('research.html');
  const stacks = installSplitLogos(browser);
  const children = Object.values(stacks).flatMap(stack => stack.querySelectorAll('img'));
  const before = children.map(image => ({...image.style}));
  browser.run('common.js');
  browser.flush();
  assert.equal(stacks.frontlogo.style.position, 'relative');
  browser.metrics.mainTop = 110;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(stacks.frontlogo.style.height, '81.2px');
  assert.equal(stacks.frontlogo.style.position, 'fixed');
  assert.equal(stacks.backlogo.getBoundingClientRect().height, 110);
  assert.equal(stacks.backlogo.style.height, undefined);
  assert.equal(stacks.frontlogo.style.width, '268.8px');
  assert.deepEqual(children.map(image => ({...image.style})), before);
  assert.equal(stacks.frontlogo.style.objectPosition, undefined, 'Object-fit cropping belongs only to the legacy img path');
});

test('split logo scroll, Home, affiliation and language changes use the latest geometry without touching child artwork', () => {
  const browser = createBrowser('research.html');
  const stacks = installSplitLogos(browser);
  const before = Object.values(stacks).flatMap(stack => stack.querySelectorAll('img')).map(image => ({...image.style}));
  browser.run('common.js');
  browser.flush();
  browser.metrics.mainTop = -4500;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(stacks.frontlogo.style.top, '-140px');
  assert.equal(stacks.frontlogo.style.height, '0px');
  browser.element('JA').dispatch('click');
  browser.flush();
  assert.equal(stacks.frontlogo.style.top, '-44px');
  // Rapidly queued actions must draw the newest Home/Osaka state in one frame.
  browser.metrics.mainTop = 192;
  browser.window.dispatch('scroll');
  browser.window.YachieSite.toggleAffiliation('UBC');
  browser.element('ZH').dispatch('click');
  browser.flush();
  for (const id of ['frontlogo', 'backlogo']) {
    assert.equal(stacks[id].style.position, 'relative');
    assert.equal(stacks[id].style.top, '0px');
  }
  assert.equal(stacks.frontlogo.style.height, 'auto');
  assert.notEqual(browser.element('frontlogo').style.display, 'none');
  if (browser.element('frontlogo2')) assert.equal(browser.element('frontlogo2').style.display, 'none');
  browser.window.YachieSite.toggleAffiliation('Osaka');
  browser.flush();
  assert.equal(stacks.frontlogo.style.top, '0px');
  assert.equal(stacks.frontlogo.style.height, 'auto');
  assert.equal(browser.frames.size, 0);
  assert.deepEqual(Object.values(stacks).flatMap(stack => stack.querySelectorAll('img')).map(image => ({...image.style})), before);
});

test('legacy excluded page upgrades only its header DOM and preserves the page body', () => {
  const browser = createBrowser('yuka.html', {url: 'https://ponnhide.github.io/yachielab-preview/yuka.html?lang=ZH&affil=Osaka'});
  assert.equal(browser.document.querySelector('.logo-stack'), null);
  browser.run('common.js');
  browser.flush();
  const front = controlledLogo(browser, 'frontlogo');
  const back = controlledLogo(browser, 'backlogo');
  assert.equal(front.classList.contains('logo-stack'), true);
  assert.equal(front.querySelectorAll('.logo-control').length, 2);
  assert.equal(browser.element('frontlogo').parentElement.id, 'head-title');
  browser.metrics.mainTop = 110;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.height, '81.2px');
  assert.equal(front.style.objectPosition, undefined);
  assert.equal(back.getBoundingClientRect().height, 110);
  browser.metrics.mainTop = 192;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.height, 'auto');
  assert.equal(front.style.top, '0px');
});


function logoControl(browser, layer, affiliation) {
  return controlledLogo(browser, layer).querySelector('.logo-control[data-affiliation="' + affiliation + '"]');
}
function mobileLogoControl(browser, affiliation) {
  const element = browser.element(affiliation === 'UBC' ? 'mobile-ubc-lab' : 'mobile-osaka-lab');
  return element.getAttribute('data-affiliation') ? element : element.querySelector('.logo-control');
}

function assertLabs(browser, ubc, osaka) {
  const state = browser.window.YachieSite.getState();
  assert.equal(state.affiliations.UBC, ubc);
  assert.equal(state.affiliations.Osaka, osaka);
  for (const [lab, active] of [['UBC', ubc], ['Osaka', osaka]]) {
    for (const control of browser.document.querySelectorAll('.logo-control[data-affiliation="' + lab + '"]')) {
      assert.equal(control.getAttribute('aria-pressed'), String(active));
      assert.match(control.getAttribute('aria-label'), /^Show .+ lab content$/);
    }
  }
}

function assertBodyLabs(browser, ubc, osaka) {
  const language = {EN: 'English', JA: 'Japanese', ZH: 'Chinese'}[browser.window.YachieSite.getState().language];
  for (const [lab, active] of [['UBC', ubc], ['Osaka', osaka]]) {
    const rows = browser.document.querySelectorAll('.posts .' + lab).filter(row => !row.classList.contains('All'));
    assert(rows.length > 0);
    rows.forEach(row => {
      const hasLanguage = ['English', 'Japanese', 'Chinese'].some(name => row.classList.contains(name));
      assert.equal(row.style.display !== 'none', active && (!hasLanguage || row.classList.contains(language)));
    });
  }
}

test('every page starts with both labs on except explicitly named People entries, regardless of language', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pages = fs.readdirSync(path.resolve(__dirname, '../..')).filter(name => name.endsWith('.html'));
  for (const page of pages) for (const language of ['EN', 'JA', 'ZH']) for (const affiliation of [null, 'UBC', 'Osaka', 'unknown']) {
    const url = new URL('https://ponnhide.github.io/yachielab-preview/' + page);
    url.searchParams.set('lang', language);
    if (affiliation) url.searchParams.set('affil', affiliation);
    const browser = createBrowser(page, {url: url.href});
    browser.run('common.js');
    browser.flush();
    const selected = page === 'people.html' && ['UBC', 'Osaka'].includes(affiliation) ? affiliation : null;
    assertLabs(browser, !selected || selected === 'UBC', !selected || selected === 'Osaka');
    assert.equal(browser.window.location.searchParams.get('affil'), selected);
    assert.equal(browser.window.location.pathname, url.pathname);
    browser.window.YachieSite.setLanguage(language === 'JA' ? 'EN' : 'JA');
    assertLabs(browser, !selected || selected === 'UBC', !selected || selected === 'Osaka');
  }
});

test('desktop and mobile controls keep at least one lab on and switch only when disabling the last active lab', () => {
  for (const page of ['index.html', 'joinus.html', 'people.html', 'cms-new-page-demo.html', 'contact.html', 'yuka.html']) {
    for (const width of [1280, 390]) {
      const browser = createBrowser(page, {width});
      browser.run('common.js');
      browser.flush();
      const check = (ubc, osaka) => {
        assertLabs(browser, ubc, osaka);
        if (['joinus.html', 'people.html', 'cms-new-page-demo.html'].includes(page)) assertBodyLabs(browser, ubc, osaka);
      };
      check(true, true);
      for (const [lab, ubc, osaka] of [
        ['UBC', false, true], ['Osaka', true, false], ['UBC', false, true],
        ['UBC', true, true], ['Osaka', true, false], ['Osaka', true, true]
      ]) {
        const control = width <= 600 ? mobileLogoControl(browser, lab) : logoControl(browser, 'frontlogo', lab);
        control.dispatch('click');
        browser.flush();
        check(ubc, osaka);
        browser.window.YachieSite.setLanguage('JA');
        browser.flush();
        check(ubc, osaka);
        browser.window.dispatch('resize');
        browser.flush();
        check(ubc, osaka);
      }
      assert.equal(browser.reloads, 0);
    }
  }
});

test('People Osaka and UBC start with the named lab and both controls remain independent afterward', () => {
  for (const selected of ['UBC', 'Osaka']) {
    const other = selected === 'UBC' ? 'Osaka' : 'UBC';
    const browser = createBrowser('people.html', {url: 'https://ponnhide.github.io/yachielab-preview/people.html?lang=EN&affil=' + selected});
    browser.run('common.js');
    assertLabs(browser, selected === 'UBC', selected === 'Osaka');
    assertBodyLabs(browser, selected === 'UBC', selected === 'Osaka');
    logoControl(browser, 'frontlogo', selected).dispatch('click');
    assertLabs(browser, other === 'UBC', other === 'Osaka');
    assertBodyLabs(browser, other === 'UBC', other === 'Osaka');
    logoControl(browser, 'frontlogo', other).dispatch('click');
    assertLabs(browser, selected === 'UBC', selected === 'Osaka');
    assertBodyLabs(browser, selected === 'UBC', selected === 'Osaka');
    logoControl(browser, 'frontlogo', other).dispatch('click');
    assertLabs(browser, true, true);
    assertBodyLabs(browser, true, true);
    logoControl(browser, 'frontlogo', selected).dispatch('click');
    assertLabs(browser, other === 'UBC', other === 'Osaka');
    assertBodyLabs(browser, other === 'UBC', other === 'Osaka');
  }
});

test('direct setters prevent both labs being off while common and dual-lab rows remain visible', () => {
  const browser = createBrowser('research.html');
  const sections = {};
  for (const names of [['UBC'], ['Osaka'], ['All'], ['UBC', 'Osaka'], ['All', 'UBC']]) {
    const section = browser.document.createElement('section');
    names.forEach(name => section.classList.add(name));
    section.style.display = 'flex';
    browser.document.querySelector('.posts').appendChild(section);
    sections[names.join(' ')] = section;
  }
  const hidden = browser.document.createElement('section');
  hidden.classList.add('All');
  hidden.style.display = 'none';
  browser.document.body.appendChild(hidden);
  browser.run('common.js');
  for (const [lab, enabled, ubc, osaka] of [
    ['UBC', true, true, true], ['UBC', false, false, true],
    ['Osaka', false, true, false], ['Osaka', false, true, false],
    ['UBC', false, false, true], ['UBC', false, false, true],
    ['UBC', true, true, true], ['Osaka', false, true, false]
  ]) {
    browser.window.YachieSite.setAffiliationEnabled(lab, enabled);
    assertLabs(browser, ubc, osaka);
    for (const [name, row] of Object.entries(sections)) {
      const visible = name.includes('All') || name.includes('UBC') && ubc || name.includes('Osaka') && osaka;
      assert.equal(row.style.display, visible ? 'flex' : 'none');
    }
    assert.equal(hidden.style.display, 'none');
  }
  const snapshot = browser.window.YachieSite.getState();
  snapshot.affiliations.UBC = false;
  assertLabs(browser, true, false);
});

test('logo clicks preserve the current location while navigation resets labs and retains explicit People destinations', () => {
  const browser = createBrowser('contact.html', {url: 'https://ponnhide.github.io/yachielab-preview/contact.html?lang=ZH&affil=UBC&campaign=lab#address'});
  const links = {};
  for (const [name, href] of Object.entries({ordinary:'./research.html?affil=UBC&campaign=link#project', general:'./people.html', ubc:'./people.html?affil=UBC', osaka:'./people.html?affil=Osaka'})) {
    const link = browser.document.createElement('a');
    link.setAttribute('href', href);
    browser.document.body.appendChild(link);
    links[name] = link;
  }
  browser.run('common.js');
  browser.flush();
  assert.notEqual(controlledLogo(browser, 'frontlogo').parentElement.tagName, 'A');
  const click = logoControl(browser, 'frontlogo', 'Osaka').dispatch('click');
  assert.equal(click.defaultPrevented, true);
  browser.flush();
  assertLabs(browser, true, false);
  assert.equal(browser.window.location.pathname, '/yachielab-preview/contact.html');
  assert.equal(browser.window.location.hash, '#address');
  assert.equal(browser.window.location.searchParams.get('campaign'), 'lab');
  assert.equal(browser.window.location.searchParams.get('affil'), null);
  assert.equal(links.ordinary.getAttribute('href'), './research.html?campaign=link&lang=ZH#project');
  assert.equal(links.general.getAttribute('href'), './people.html?lang=ZH');
  assert.equal(links.ubc.getAttribute('href'), './people.html?affil=UBC&lang=ZH');
  assert.equal(links.osaka.getAttribute('href'), './people.html?affil=Osaka&lang=ZH');
  assert.equal(logoControl(browser, 'frontlogo', 'Osaka').listeners.has('keydown'), false);
});

test('returning to a page restores its entry defaults and does not preserve another visit’s toggles', () => {
  for (const [page, query, ubc, osaka] of [['joinus.html', '?lang=JA&affil=UBC', true, true], ['people.html', '?lang=EN&affil=Osaka', false, true]]) {
    const browser = createBrowser(page, {url: 'https://ponnhide.github.io/yachielab-preview/' + page + query});
    browser.run('common.js');
    browser.window.YachieSite.setAffiliationEnabled('UBC', false);
    browser.window.YachieSite.setAffiliationEnabled('Osaka', false);
    assertLabs(browser, true, false);
    browser.window.dispatch('popstate');
    assertLabs(browser, ubc, osaka);
    assertBodyLabs(browser, ubc, osaka);
  }
});

test('Sheet settings arriving after interaction preserve each independent toggle on every page type', async () => {
  for (const page of ['index.html', 'contact.html', 'joinus.html']) {
    const browser = createBrowser(page);
    let resolveSettings;
    browser.window.fetch = () => new Promise(resolve => { resolveSettings = resolve; });
    browser.run('common.js');
    browser.window.YachieSite.toggleAffiliation('UBC');
    browser.window.YachieSite.setLanguage('JA');
    resolveSettings({ok:true, json:() => Promise.resolve({logoActiveOpacity:0.85, logoInactiveOpacity:0.2, logoTransitionMs:725})});
    await tick();
    browser.flush();
    assertLabs(browser, false, true);
    browser.document.querySelectorAll('.logo-control[data-affiliation]').forEach(control => {
      assert.equal(control.style['--lab-logo-active-opacity'], '0.85');
      assert.equal(control.style['--lab-logo-inactive-opacity'], '0.2');
      assert.equal(control.style['--lab-logo-transition-duration'], '725ms');
    });
  }
});

test('white crop and teal exclusion remain synchronized through scroll, Home, resize and affiliation changes', () => {
  const browser = createBrowser('research.html');
  browser.run('common.js');
  browser.flush();
  const front = controlledLogo(browser, 'frontlogo');
  const back = controlledLogo(browser, 'backlogo');
  assert.equal(back.style.clipPath, 'inset(110px 0px 0px)');
  browser.metrics.mainTop = 110;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.height, '81.2px');
  assert.equal(back.style.clipPath, 'inset(81.2px 0px 0px)', 'Teal must be removed everywhere the translucent white layer exists');
  browser.window.YachieSite.toggleAffiliation('UBC');
  browser.flush();
  assert.equal(back.style.clipPath, 'inset(81.2px 0px 0px)');
  browser.metrics.mainTop = -100;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.height, '0px');
  assert.equal(back.style.clipPath, 'inset(0px 0px 0px)');
  browser.metrics.mainTop = 192;
  browser.metrics.logoHeight = 130;
  browser.window.dispatch('resize');
  browser.flush();
  assert.equal(front.style.height, 'auto');
  assert.equal(back.style.clipPath, 'inset(130px 0px 0px)');
  assert.equal(front.style.top, '0px');
});

test('a lab has one keyboard stop across its visible white and teal layers, with focus following the visible layer', () => {
  const browser = createBrowser('research.html');
  browser.run('common.js');
  browser.flush();
  const frontUbc = logoControl(browser, 'frontlogo', 'UBC');
  const backUbc = logoControl(browser, 'backlogo', 'UBC');
  assert.equal(frontUbc.getAttribute('tabindex'), '0');
  assert.equal(backUbc.getAttribute('tabindex'), '-1');
  assert.equal(backUbc.getAttribute('aria-hidden'), 'true');
  frontUbc.focus();
  browser.metrics.mainTop = -1;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(frontUbc.getAttribute('tabindex'), '-1');
  assert.equal(backUbc.getAttribute('tabindex'), '0');
  assert.equal(backUbc.getAttribute('aria-hidden'), 'false');
  assert.equal(browser.document.activeElement, backUbc);
  for (const id of ['frontlogo2', 'backlogo2']) {
    const element = browser.element(id);
    if (element) element.querySelectorAll('.logo-control').forEach(control => assert.equal(control.getAttribute('tabindex'), '-1'));
  }
});

test('validated head custom properties reach every desktop and mobile controller', () => {
  const browser = createBrowser('research.html');
  browser.element('head').setAttribute('style', '--lab-logo-active-opacity:.9;--lab-logo-inactive-opacity:.25;--lab-logo-transition-duration:.45s;');
  browser.run('common.js');
  browser.flush();
  browser.document.querySelectorAll('.logo-stack, .logo-control[data-affiliation]').forEach(element => {
    assert.equal(element.style['--lab-logo-active-opacity'], '0.9');
    assert.equal(element.style['--lab-logo-inactive-opacity'], '0.25');
    assert.equal(element.style['--lab-logo-transition-duration'], '450ms');
  });
  const invalid = createBrowser('research.html');
  invalid.element('head').setAttribute('style', '--lab-logo-active-opacity:2;--lab-logo-inactive-opacity:bad;--lab-logo-transition-duration:10001ms;');
  invalid.run('common.js');
  const control = logoControl(invalid, 'frontlogo', 'UBC');
  assert.equal(control.style['--lab-logo-active-opacity'], '1');
  assert.equal(control.style['--lab-logo-inactive-opacity'], '0.5');
  assert.equal(control.style['--lab-logo-transition-duration'], '300ms');
});

test('same-origin settings JSON updates all controllers without changing the selected page or lab', async () => {
  const browser = createBrowser('contact.html', {url: 'https://ponnhide.github.io/yachielab-preview/contact.html?lang=JA'});
  const requests = [];
  browser.window.fetch = (url, options) => {
    requests.push({url, options});
    return Promise.resolve({ok: true, json: () => Promise.resolve({logoActiveOpacity: 0.85, logoInactiveOpacity: 0.2, logoTransitionMs: 725})});
  };
  browser.run('common.js');
  await tick();
  browser.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://ponnhide.github.io/yachielab-preview/site-settings.json');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(browser.window.location.pathname, '/yachielab-preview/contact.html');
  assert.equal(browser.window.location.searchParams.get('affil'), null);
  browser.document.querySelectorAll('.logo-control[data-affiliation]').forEach(control => {
    assert.equal(control.style['--lab-logo-active-opacity'], '0.85');
    assert.equal(control.style['--lab-logo-inactive-opacity'], '0.2');
    assert.equal(control.style['--lab-logo-transition-duration'], '725ms');
  });
});

test('invalid or offline settings JSON retains the valid head settings as one complete configuration', async () => {
  const responses = [
    {ok: true, json: () => Promise.resolve({logoActiveOpacity: 0.8, logoInactiveOpacity: 0.1, logoTransitionMs: 10001})},
    {ok: true, json: () => Promise.resolve({logoActiveOpacity: '0.8', logoInactiveOpacity: 0.1, logoTransitionMs: 250})},
    {ok: false},
    null
  ];
  for (const response of responses) {
    const browser = createBrowser('research.html');
    browser.element('head').setAttribute('style', '--lab-logo-active-opacity:.95;--lab-logo-inactive-opacity:.35;--lab-logo-transition-duration:600ms;');
    browser.window.fetch = () => response ? Promise.resolve(response) : Promise.reject(new Error('Offline'));
    browser.run('common.js');
    await tick();
    browser.flush();
    const control = logoControl(browser, 'frontlogo', 'UBC');
    assert.equal(control.style['--lab-logo-active-opacity'], '0.95');
    assert.equal(control.style['--lab-logo-inactive-opacity'], '0.35');
    assert.equal(control.style['--lab-logo-transition-duration'], '600ms');
  }
});

test('legacy mobile menus gain one lab selector group and its choices stay on the current page', () => {
  const browser = createBrowser('yuka.html', {width: 390, url: 'https://ponnhide.github.io/yachielab-preview/yuka.html?lang=JA'});
  const bodyPosts = browser.document.querySelector('.posts');
  const bodyChildren = bodyPosts.children.slice();
  browser.run('common.js');
  browser.run('mobile_menu.js');
  browser.flush();
  assert.deepEqual(bodyPosts.children, bodyChildren, 'Legacy header migration must preserve body nodes');
  assert.equal(browser.document.querySelectorAll('#mobile-lab-switch').length, 1);
  assert.equal(mobileLogoControl(browser, 'Osaka').getAttribute('aria-pressed'), 'true');
  browser.element('menu-icon').dispatch('click');
  browser.completeAnimation();
  mobileLogoControl(browser, 'UBC').dispatch('click');
  browser.flush();
  assert.equal(browser.window.location.pathname, '/yachielab-preview/yuka.html');
  assert.equal(browser.window.location.searchParams.get('affil'), null);
  assert.equal(mobileLogoControl(browser, 'UBC').getAttribute('aria-pressed'), 'false');
  assert.equal(browser.element('mobile-menu').style.visibility, 'visible');
  for (const layer of ['frontlogo', 'backlogo']) {
    assert.equal(logoControl(browser, layer, 'UBC').getAttribute('tabindex'), '-1', 'Hidden desktop header controls are not keyboard targets on mobile');
  }
});


test('homepage without .posts has exactly two visible keyboard stops and keeps the clipped back layer hidden', () => {
  const browser = createBrowser('index.html');
  // Some saved snapshots retain an empty .posts node; the actual homepage
  // can omit it. Remove only fixture DOM nodes to exercise that variant.
  browser.document.querySelectorAll('.posts').forEach(element => element.remove());
  assert.equal(browser.document.querySelector('.posts') === null, true);
  browser.run('common.js');
  browser.flush();
  const assertHomeLayers = height => {
    const front = controlledLogo(browser, 'frontlogo');
    const back = controlledLogo(browser, 'backlogo');
    assert.equal(front.style.position, 'relative');
    assert.equal(front.style.height, 'auto');
    assert.equal(back.style.clipPath, 'inset(' + height + 'px 0px 0px)');
    for (const affiliation of ['UBC', 'Osaka']) {
      assert.equal(logoControl(browser, 'frontlogo', affiliation).getAttribute('tabindex'), '0');
      assert.equal(logoControl(browser, 'frontlogo', affiliation).getAttribute('aria-hidden'), 'false');
      assert.equal(logoControl(browser, 'backlogo', affiliation).getAttribute('tabindex'), '-1');
      assert.equal(logoControl(browser, 'backlogo', affiliation).getAttribute('aria-hidden'), 'true');
    }
    assert.notEqual(browser.document.querySelector('aside').style.display, 'flex');
    assert.notEqual(browser.element('languages').style.position, 'fixed');
  };
  assertHomeLayers(110);
  logoControl(browser, 'frontlogo', 'Osaka').dispatch('click');
  browser.flush();
  assertHomeLayers(110);
  browser.metrics.logoHeight = 130;
  browser.window.dispatch('resize');
  browser.flush();
  assertHomeLayers(130);
  browser.window.dispatch('scroll');
  browser.flush();
  assertHomeLayers(130);
});


test('homepage with its empty .posts retains language sticking and desktop setup without interior logo motion', () => {
  const browser = createBrowser('index.html');
  assert.equal(browser.document.querySelector('.posts') !== null, true);
  browser.run('common.js');
  browser.flush();
  assert.equal(browser.document.querySelector('aside').style.display, 'flex');
  assert.equal(browser.element('languages').style.position, 'relative');
  const front = controlledLogo(browser, 'frontlogo');
  const back = controlledLogo(browser, 'backlogo');
  browser.metrics.mainTop = 80;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(browser.element('languages').style.position, 'fixed');
  assert.equal(front.style.position, 'relative', 'The homepage must not activate the interior logo crop/retreat');
  assert.equal(front.style.height, 'auto');
  assert.equal(front.style.top, '0px');
  assert.equal(back.style.clipPath, 'inset(110px 0px 0px)');
  for (const affiliation of ['UBC', 'Osaka']) {
    assert.equal(logoControl(browser, 'frontlogo', affiliation).getAttribute('tabindex'), '0');
    assert.equal(logoControl(browser, 'backlogo', affiliation).getAttribute('tabindex'), '-1');
  }
  browser.metrics.mainTop = -4500;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.top, '0px');
  assert.equal(front.style.height, 'auto');
});
