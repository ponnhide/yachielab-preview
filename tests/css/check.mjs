import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cssRoot = path.join(root, 'css');
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
const imports = text => [...stripComments(text).matchAll(/@import\s+url\(["']([^"']+)["']\)\s*;/g)].map(match => match[1]);
const visited = new Set();

function expand(relative, ancestors = []) {
  const filename = path.resolve(cssRoot, relative);
  assert(filename.startsWith(cssRoot + path.sep), `CSS import escaped css/: ${relative}`);
  assert(!ancestors.includes(filename), `Circular CSS import: ${relative}`);
  assert(fs.existsSync(filename), `Missing CSS import: ${relative}`);
  visited.add(filename);
  let text = stripComments(fs.readFileSync(filename, 'utf8'));
  text = text.replace(/@import\s+url\(["']([^"']+)["']\)\s*;/g, (_, target) => expand(path.relative(cssRoot, path.resolve(path.dirname(filename), target)), [...ancestors, filename]));
  let balance = 0;
  for (const character of text) {
    if (character === '{') balance++;
    if (character === '}') balance--;
    assert(balance >= 0, `Unbalanced CSS block: ${relative}`);
  }
  assert.equal(balance, 0, `Unbalanced CSS block: ${relative}`);
  return text;
}

// Stable URLs are required by the saved HTML, including pages outside the CMS registry.
const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));
const entrypoints = new Set();
for (const name of htmlFiles) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  for (const match of html.matchAll(/href=["']\.\/css\/([^"']+\.css)["']/g)) entrypoints.add(match[1]);
}
// Every new page inherits this skeleton, independent of its eventual name.
const blankHtml = fs.readFileSync(path.join(root, 'blank.html'), 'utf8');
assert(!/href=["']\.\/css\/(?:pages\/)?contact\.css["']/.test(blankHtml), 'Generic pages must not inherit Contact iframe dimensions');
const { createBrowser } = createRequire(import.meta.url)('../js/browser-harness.cjs');
const blank = createBrowser(blankHtml, { url: 'https://ponnhide.github.io/yachielab-preview/new_page.html?lang=JA&affil=UBC' });
for (const selector of ['.posts', '#normal_header', 'footer', 'aside', '#mobile-menu']) {
  assert.equal(blank.document.querySelectorAll(selector).length, 1, `Generic template needs exactly one ${selector}`);
}
const scripts = blank.document.querySelectorAll('script[src]');
const newsScript = scripts.filter(script => script.getAttribute('src') === './js/news.js');
assert.equal(newsScript.length, 1, 'Generic Post rows require the SNS controller');
assert.notEqual(newsScript[0].getAttribute('defer'), null, 'SNS controller must run after the page markup');
const commonScriptIndex = scripts.findIndex(script => script.getAttribute('src') === './js/common.js');
assert(commonScriptIndex >= 0 && commonScriptIndex < scripts.indexOf(newsScript[0]), 'Common state must initialize before SNS subscriptions');
// Loading the controller on an ordinary new page must not contact SNS providers.
let notifyLanguage;
blank.window.YachieSite = { subscribe(callback) { notifyLanguage = callback; } };
const scriptSources = scripts.map(script => script.getAttribute('src'));
blank.run('news.js');
notifyLanguage();
assert.deepEqual(blank.document.querySelectorAll('script[src]').map(script => script.getAttribute('src')), scriptSources, 'No widgets means no external provider scripts');
assert(blank.observers.every(observer => observer.targets.size === 0), 'An ordinary page has no SNS visibility targets');

for (const filename of entrypoints) expand(filename);
for (const legacy of ['common_01222024.css', 'index_new.css', 'joinus.css', 'resources.css']) {
  assert.deepEqual(imports(fs.readFileSync(path.join(cssRoot, legacy), 'utf8')), [`./legacy/${legacy}`]);
  expand(legacy);
}
assert.deepEqual(imports(fs.readFileSync(path.join(cssRoot, 'common.css'), 'utf8')), ['./base.css', './layout.css', './components.css', './responsive.css']);

const common = expand('common.css');
const compact = common.replace(/\s+/g, '');
// The boundary effect needs an independently cropped foreground and a full-size background.
assert(compact.includes('#frontlogoimg,#backlogoimg,#frontlogo2img,#backlogo2img,'));
assert(compact.includes('#frontlogo.logo-stack,#backlogo.logo-stack,#frontlogo2.logo-stack,#backlogo2.logo-stack{'));
assert(compact.includes('object-fit:cover;object-position:top;'));
assert(compact.includes('width:clamp(35px,calc(25vw-clamp(5px,4vw,4vw)),400px);'));
assert(compact.includes('#backlogo,#backlogo2{width:100%;margin-top:0;position:absolute;z-index:1;'));
// Read the actual CSS geometry: increasing the artwork gap must move Osaka
// and grow the canvas without scaling either SVG or changing horizontal layout.
const stackRule = common.match(/^\.logo-stack\s*\{([^}]+)\}/m)[1];
const extraGap = Number(stackRule.match(/--header-logo-extra-gap:\s*([\d.]+)\s*;/)[1]);
const canvasRule = common.match(/\.logo-stack\s+\.logo-canvas\s*\{([^}]+)\}/)[1];
const ubcRule = common.match(/#normal_header\s+\.logo-stack\s+\.logo-canvas\s*>\s*\.logo-control\s*\{([^}]+)\}/)[1];
const osakaRule = common.match(/#normal_header\s+\.logo-stack\s+\.logo-canvas\s*>\s*\.logo-osaka\s*\{([^}]+)\}/)[1];
const paddingExpression = canvasRule.match(/padding-bottom:\s*([^;]+);/)[1];
const topExpression = osakaRule.match(/top:\s*([^;]+);/)[1];
function calculateGeometry(expression, percentBase) {
  const numeric = expression
    .replace(/var\(--header-logo-extra-gap\)/g, String(extraGap))
    .replace(/calc\(/g, '(')
    .replace(/100%/g, String(percentBase));
  assert(/^[\d.\s()+*/-]+$/.test(numeric), `Unexpected logo geometry expression: ${expression}`);
  return Function(`"use strict"; return (${numeric});`)();
}
function nearlyEqual(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}
const originalGap = 185.0048 - 128.1763;
nearlyEqual(extraGap, originalGap / 2, 'Extra gap uses half the original drawn-artwork gap');
for (const width of [35, 268.8, 400]) {
  const canvasHeight = calculateGeometry(paddingExpression, width);
  const osakaTop = calculateGeometry(topExpression, canvasHeight);
  nearlyEqual(canvasHeight, width * 343.41425 / 772, 'Canvas grows at its original width');
  nearlyEqual(osakaTop, width * 213.41425 / 772, 'Only the Osaka vertical offset changes');
  nearlyEqual(calculateGeometry(ubcRule.match(/height:\s*([^;]+);/)[1], canvasHeight), width * 129 / 772, 'UBC button preserves the SVG height');
  nearlyEqual(calculateGeometry(osakaRule.match(/height:\s*([^;]+);/)[1], canvasHeight), width * 130 / 772, 'Osaka button preserves the SVG height');
  const upperDrawnBottom = 128.1763 * width / 772;
  const lowerDrawnTop = osakaTop + (185.0048 - 185) * width / 772;
  nearlyEqual(lowerDrawnTop - upperDrawnBottom, 1.5 * originalGap * width / 772, 'Drawn gap is exactly 1.5 times the original');
}
assert(compact.includes('#normal_header.logo-stack.logo-canvas>.logo-control>img{display:block;position:static;width:100%;height:100%;'), 'SVGs fill the buttons without a second positioning transform');
assert(compact.includes('.logo-control{appearance:none;display:block;border:0;border-radius:0;padding:0;margin:0;'), 'Native button chrome must not change artwork geometry');
assert(compact.includes('#backlogo.logo-stack,#backlogo2.logo-stack{clip-path:inset(100%00);}'), 'Hide the rear layer before the controller synchronizes complementary clipping');
assert(compact.includes('opacity:var(--lab-logo-active-opacity,1);'));
assert(compact.includes('opacity:var(--lab-logo-inactive-opacity,0.5);'));
assert(compact.includes('transition:opacityvar(--lab-logo-transition-duration,300ms)ease;'));
assert(compact.includes('@media(prefers-reduced-motion:reduce){.logo-control>img{transition-duration:0ms!important;}'));
for (const [filename, viewBox] of [
  ['header-ubc-white.svg', '0 0 772 129'], ['header-ubc-teal.svg', '0 0 772 129'],
  ['header-osaka-white.svg', '0 185 772 130'], ['header-osaka-teal.svg', '0 185 772 130']
]) {
  assert(fs.readFileSync(path.join(root, 'img', filename), 'utf8').includes(`viewBox="${viewBox}"`), `Gap tuning must not change SVG coordinates: ${filename}`);
}

assert(common.includes('@media screen and (max-width: 600px)'));
assert(compact.includes('#normal_header{display:none;}'));
assert(compact.includes('#foot-snslogo{height:20%!important;'));
assert(compact.includes('[data-page="summercamp_2026"]main,[data-page="summercamp_2026"]main.posts{box-sizing:border-box;}'));

const content = expand('content.css');
assert(!content.includes('content-fit'), 'Invalid legacy content-fit must not return');
const contact = expand('contact.css');
assert(contact.includes('height: 400px;') && contact.includes('height: 300px;'));
const embed = expand('xmimic.css');
assert(embed.includes('.x-embed, .x-embed * { box-sizing: border-box; }'));
assert(!/^\*\s*\{/m.test(embed), 'Component CSS must not resize the entire document');
for (const selector of ['.btn-follow', '.btn-x', '.reply-cta a', '.sr-only']) {
  assert(!new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s:{]`, 'm').test(embed), `Unscoped embed selector: ${selector}`);
}

// Moving a stylesheet must preserve every local asset URL, including legacy direct links.
let localAssetCount = 0;
for (const filename of visited) {
  const text = stripComments(fs.readFileSync(filename, 'utf8'));
  for (const match of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const target = match[1];
    if (!target || /^(https?:|data:|#)/.test(target) || target.endsWith('.css')) continue;
    const resolved = path.resolve(path.dirname(filename), target);
    assert(fs.existsSync(resolved), `Moved CSS has a broken asset URL: ${path.relative(root, filename)} -> ${target}`);
    localAssetCount++;
  }
}
console.log(`CSS checks passed: ${htmlFiles.length} HTML files, ${entrypoints.size} entrypoints, ${visited.size} stylesheets, ${localAssetCount} local asset references.`);
