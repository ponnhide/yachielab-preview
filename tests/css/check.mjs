import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const osakaRule = common.match(/#normal_header\s+\.logo-stack\s+\.logo-canvas\s+\.logo-osaka\s*\{([^}]+)\}/)[1];
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
  const upperDrawnBottom = 128.1763 * width / 772;
  const lowerDrawnTop = osakaTop + (185.0048 - 185) * width / 772;
  nearlyEqual(lowerDrawnTop - upperDrawnBottom, 1.5 * originalGap * width / 772, 'Drawn gap is exactly 1.5 times the original');
}
assert(compact.includes('#normal_header.logo-stack.logo-canvasimg{display:block;position:absolute;width:100%;height:auto;'), 'Both SVGs retain their original dimensions');
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
