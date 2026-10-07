const fs = require('node:fs');
const vm = require('node:vm');
const { createBrowser, descendants } = require('./browser-harness.cjs');
const baseline = process.argv[2];
if (!baseline) throw new Error('Usage: node tests/js/compare-baseline.cjs /path/to/baseline');
const names = fs.readdirSync(baseline).filter(name => name.endsWith('.html'));
const changes = [];
let compared = 0;
const originalErrors = [];
for (const file of names) {
  for (const width of [390, 1280]) {
    for (const language of ['EN', 'JA', 'ZH']) {
      for (const affiliation of ['UBC', 'Osaka']) {
        const html = fs.readFileSync(baseline + '/' + file, 'utf8');
        const url = 'https://ponnhide.github.io/yachielab-preview/' + file + '?lang=' + language + '&affil=' + affiliation;
        const old = createBrowser(html, { width, url });
        const fresh = createBrowser(html, { width, url });
        old.context.console = { log() {}, warn() {} };
        old.context.location = old.window.location;
        old.context.navigator = { userAgent: 'Chrome' };
        const home = file === 'index.html';
        let originalError = null;
        try {
          old.runSource(fs.readFileSync(baseline + '/js/' + (home ? 'index.js' : 'common.js'), 'utf8'), 'original.js');
          old.runSource(fs.readFileSync(baseline + '/js/mobile_menu.js', 'utf8'), 'original-mobile.js');
        } catch (error) { originalError = error.message; }
        fresh.run('common.js');
        if (home) fresh.run('index.js');
        fresh.run('mobile_menu.js');
        fresh.flush();
        if (originalError) { originalErrors.push({ file, width, language, affiliation, error: originalError }); continue; }
        const oldElements = descendants(old.document);
        const newElements = descendants(fresh.document);
        const differences = [];
        oldElements.forEach((element, index) => {
          if (!element.classList.contains('English') && !element.classList.contains('Japanese') && !element.classList.contains('Chinese') && !element.classList.contains('Common')) return;
          const oldDisplay = old.window.getComputedStyle(element).display;
          const newDisplay = fresh.window.getComputedStyle(newElements[index]).display;
          if (oldDisplay !== newDisplay) differences.push({ index, tag: element.tagName, id: element.id, classes: element.attributes.class, oldDisplay, newDisplay });
        });
        compared++;
        if (differences.length) changes.push({ file, width, language, affiliation, differences });
      }
    }
  }
}
console.log(JSON.stringify({ compared, changes, originalErrors }, null, 2));
if (changes.length) process.exitCode = 1;
