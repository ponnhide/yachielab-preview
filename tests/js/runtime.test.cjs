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
  browser.document.querySelectorAll('.logo-stack').forEach(stack => measureLogoStack(browser, stack));
  return browser;
}
function controlledLogo(browser, id) {
  const section = browser.element(id);
  return section && (section.querySelector('.logo-stack') || section.querySelector('img'));
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// Public page content and URI behavior, independent of implementation internals.
test('homepage Japanese is applied in one click, with its Osaka default and no reload', () => {
  const browser = createBrowser('index.html');
  browser.run('common.js');
  browser.run('index.js');
  browser.flush();
  browser.element('JA').dispatch('click');
  browser.flush();
  assert.equal(browser.window.location.search, '?lang=JA&affil=Osaka');
  assert.equal(browser.reloads, 0);
  assert.equal(browser.document.documentElement.lang, 'ja');
  assert.equal(browser.element('frontlogo').style.display, 'none');
  assert.notEqual(browser.element('frontlogo2').style.display, 'none');
  const label = browser.element('main_research_EN');
  assert.equal(label.querySelector('.English').style.display, 'none');
  assert.notEqual(label.querySelector('.Japanese').style.display, 'none');
  assert.match(browser.element('main_pplV_EN').querySelector('a').getAttribute('href'), /lang=JA&affil=UBC/);
  assert.match(browser.element('main_pplO_EN').querySelector('a').getAttribute('href'), /lang=JA&affil=Osaka/);
});

test('explicit UBC remains selected for Japanese homepage; unknown language falls back to English', () => {
  const explicit = createBrowser('index.html', { url: 'https://ponnhide.github.io/yachielab-preview/?lang=JA&affil=UBC' });
  explicit.run('common.js');
  assert.equal(explicit.window.YachieSite.getState().affiliation, 'UBC');
  assert.notEqual(explicit.element('frontlogo').style.display, 'none');
  const invalid = createBrowser('research.html', { url: 'https://ponnhide.github.io/yachielab-preview/research.html?lang=XX' });
  invalid.run('common.js');
  assert.equal(invalid.document.documentElement.lang, 'en');
  assert.equal(invalid.window.YachieSite.getState().language, 'EN');
});

test('interior default remains UBC and Chinese Osaka sections are not lost', () => {
  const browser = createBrowser('people.html');
  browser.run('common.js');
  browser.element('JA').dispatch('click');
  assert.equal(browser.window.YachieSite.getState().affiliation, 'UBC');
  browser.window.YachieSite.setAffiliation('Osaka');
  browser.element('ZH').dispatch('click');
  assert.equal(browser.element('frontlogo').style.display, 'none');
  assert.notEqual(browser.element('frontlogo2').style.display, 'none');
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
  assert.match(image.src, /H_2r\.png$/);
  assert.equal(image.style.animationPlayState, 'paused');
  assert.equal(browser.document.querySelector('footer').style.zIndex, '22');
  control.dispatch('mouseleave');
  assert.match(image.src, /H_1r\.png$/);
  assert.equal(image.style.animationPlayState, 'running');
  assert.equal(browser.document.querySelector('footer').style.zIndex, '18');
  assert.ok(browser.preloadSources.some(source => source.endsWith('/H_2r.png')));
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
  assert.equal(browser.document.querySelector('aside').style.display, 'flex');
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
  browser.window.YachieSite.setAffiliation('Osaka');
  browser.element('ZH').dispatch('click');
  browser.flush();
  for (const id of ['frontlogo2', 'backlogo2']) {
    assert.equal(stacks[id].style.position, 'relative');
    assert.equal(stacks[id].style.top, '0px');
  }
  assert.equal(stacks.frontlogo2.style.height, 'auto');
  assert.equal(browser.element('frontlogo').style.display, 'none');
  assert.notEqual(browser.element('frontlogo2').style.display, 'none');
  browser.window.YachieSite.setAffiliation('UBC');
  browser.flush();
  assert.equal(stacks.frontlogo.style.top, '0px');
  assert.equal(stacks.frontlogo.style.height, 'auto');
  assert.equal(browser.frames.size, 0);
  assert.deepEqual(Object.values(stacks).flatMap(stack => stack.querySelectorAll('img')).map(image => ({...image.style})), before);
});

test('legacy single-image markup remains a working fallback on an excluded page and missing Osaka logo IDs', () => {
  const browser = createBrowser('yuka.html', {url: 'https://ponnhide.github.io/yachielab-preview/yuka.html?lang=ZH&affil=Osaka'});
  assert.equal(browser.document.querySelector('.logo-stack'), null);
  browser.run('common.js');
  browser.flush();
  const front = controlledLogo(browser, 'frontlogo');
  const back = controlledLogo(browser, 'backlogo');
  assert.equal(front.tagName, 'IMG');
  browser.metrics.mainTop = 110;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.height, '81.2px');
  assert.equal(front.style.objectPosition, 'top');
  assert.equal(back.getBoundingClientRect().height, 110);
  browser.metrics.mainTop = 192;
  browser.window.dispatch('scroll');
  browser.flush();
  assert.equal(front.style.height, 'auto');
  assert.equal(front.style.top, '0px');
});
