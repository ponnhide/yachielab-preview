import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modules = ['showdown.gs', 'SheetStyles.gs', 'Renderer.gs', 'Publications.gs'];
let checks = 0;
function check(name, callback) {
  callback(); checks++;
  console.log(`PASS ${name}`);
}
function setup(overrides = {}) {
  const calls = [], sleeps = [], cache = new Map(), cacheReads = [], cacheWrites = [], cacheRemovals = [], uploads = [];
  let reads = 0;
  const parameters = {
    H1: ['Lab', 'Language', 'Function', '/* Title', '/* ID', '/* Style'],
    Content: ['Lab', 'Language', 'Function', '/* Text', '/* img url', '/* img width', '/* img height', '/* insta filter', '/* img style', '/* img hyperlink', '/* ID', '/* Style'],
    Member: ['Lab', 'Language', 'Function', '/* Name', '/* Personal links', '/* Position', '/* Start Date', '/* End Date', '/* Name in publication', '/* Photo url', '/* insta filter', '/* Biosketch', '/* Project', '/* E-mail', '/* Hobby or fun fact', '/* Twitter', '/* Others', '/* Margin top', '/* Margin bottom', '/* ID'],
  };
  const context = { parameters, members: ['Lab A'], journals: { 'Long journal': 'Journal' }, refreshData: false, refreshAssets: false, forceRegenerate: false };
  const sandbox = {
    console: { log() { throw new Error('Renderer must not log raw row values'); } },
    cmsContext_: () => { reads++; return context; },
    PreElement: 'START', PostElement: 'END', PubRepDict: {}, MDLINKREG: /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    uploadImg: url => { uploads.push(url); return './img/' + new URL(url).pathname.split('/').pop(); },
    Utilities: { sleep: milliseconds => sleeps.push(milliseconds) },
    CacheService: { getScriptCache: () => ({ get: key => { cacheReads.push(key); return cache.get(key) || null; }, remove: key => { cacheRemovals.push(key); cache.delete(key); }, put: (key, value, ttl) => { assert.equal(ttl, 21600); cacheWrites.push({key, value, ttl}); cache.set(key, value); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    previewFetch_: (url, options) => { calls.push({ url, options }); return { getResponseCode: () => 200, getContentText: () => 'PMID- 123\nTI  - A title - with a hyphen\n      continued title\nAU  - Lab A\nJT  - Long journal\nVI  - 2\nDP  - 2026 Oct\n' }; },
    ...overrides,
  };
  const runtime = vm.createContext(sandbox);
  for (const filename of modules) vm.runInContext(fs.readFileSync(path.join(root, 'cms', filename), 'utf8'), runtime, { filename });
  return { runtime, context, calls, sleeps, cache, cacheReads, cacheWrites, cacheRemovals, uploads, reads: () => reads };
}

check('Explicit Sheet values win; motion and generated layout keep normal priority', () => {
  const { runtime: r } = setup();
  const attributes = r.sheetStyleAttributes_('font-family:"Custom", sans-serif; height:42%; display:none!important; z-index:99 ! important; transform:scale(2)!important;', 'display:flex;');
  assert(attributes.includes('font-family: &quot;Custom&quot;, sans-serif !important;'));
  assert(attributes.includes('height: 42% !important;'));
  assert(attributes.includes('display:flex;'));
  assert(attributes.includes('display: none;z-index: 99;transform: scale(2);'));
  assert(attributes.includes('data-sheet-style="font-family height"'));
  assert(!/display: none !important|z-index: 99 !important|transform: scale\(2\) !important/.test(attributes));
});
check('Style parser keeps quoted semicolons and parentheses intact', () => {
  const { runtime: r } = setup();
  const result = r.sheetExplicitStyle_('background: url("data:image/svg+xml;a;b"); width:calc(100% - 2px); margin-bottom:0;');
  assert(result.style.includes('url("data:image/svg+xml;a;b") !important;'));
  assert(result.style.includes('width: calc(100% - 2px) !important;'));
  assert.equal(result.properties.join(' '), 'background width margin-bottom');
});
check('Header mapping handles numeric cells and missing optional values without Sheet reads', () => {
  const { runtime: r, reads } = setup();
  assert.equal(r.appendSingle(['All', 'Common', 'H1', 2026], []), '<h1 class="page_title All Common">2026</h1>');
  assert.equal(r.appendSingle(['All', 'Common', 'Pass'], []), '');
  assert.equal(reads(), 1, 'Pass rows need no renderer context or Sheet reads.');
  assert.throws(() => r.appendSingle(['All', 'Common', 'Unknown'], []), /Unknown row function/);
});
check('Rich text preserves bold/color runs and converts the email marker', () => {
  const { runtime: r } = setup();
  const rich = { getRuns: () => [{ getText: () => 'Name ', getTextStyle: () => ({ isBold: () => true, isItalic: () => false, getForegroundColorObject: () => ({ asRgbColor: () => ({ asHexString: () => '#ff0000' }) }) }) }] };
  assert.equal(r.rendererRichText_('Name ', rich), '**<span style="color:#ff0000">Name</span>** ');
  assert(r.rendererRichText_('name\\@\\example.org', null).includes('alt="[at]"'));
});
check('Showdown renders localized PDF links with spaced local filenames as anchors instead of visible versioned Markdown', () => {
  const destination = './pdf/Graduate application guidelines.pdf?download=1&v=abcdef123456#page=2';
  const { runtime: r } = setup({ uploadImg: () => destination });
  for (const label of ['Application guidelines', '募集要項', '申请指南']) {
    const html = r.rendererMarkdown_('[' + label + '](https://www.dropbox.com/x/guidelines.pdf?dl=0)');
    const href = (html.match(/<a href="([^"]+)"/) || [])[1];
    assert(href, 'Real Showdown must render a clickable link in each language');
    assert.equal(href.replace(/&amp;/g, '&'), './pdf/Graduate%20application%20guidelines.pdf?download=1&v=abcdef123456#page=2');
    assert.equal(html.replace(/<[^>]+>/g, '').trim(), label, 'Neither the Markdown destination nor version query belongs in visible prose');
  }
});
check('Markdown asset space encoding preserves existing percent escapes, query values, anchors and literal replacement text', () => {
  const destination = './pdf/already%20encoded and raw.pdf?key=a%20b&literal=$&#page%202';
  const { runtime: r } = setup({ uploadImg: () => destination });
  const html = r.rendererMarkdown_('[PDF](https://www.dropbox.com/x/paper.pdf?dl=0)');
  const href = (html.match(/<a href="([^"]+)"/) || [])[1];
  assert.equal(href.replace(/&amp;/g, '&'), './pdf/already%20encoded%20and%20raw.pdf?key=a%20b&literal=$&#page%202');
  assert(!html.includes('%2520')); assert(!html.includes('dropbox.com'));
  const ordinary = setup();
  assert.equal(ordinary.runtime.rendererMarkdown_('[External](https://example.org/paper%20one.pdf?x=1#page=2)'), '<p><a href="https://example.org/paper%20one.pdf?x=1#page=2">External</a></p>');
  assert.equal(ordinary.uploads.length, 0);
});
check('Content image dimensions and explicit custom style render on the correct nodes', () => {
  const { runtime: r } = setup();
  const html = r.appendSingle(['All', 'Common', 'Content', 'Text', 'https://example.org/photo.png', 80, 'auto', '/* insta filter', 'object-fit:contain;', '', 'photo', 'color:red;'], []);
  assert(html.includes('width: 80px !important;height: auto !important;object-fit: contain !important;'));
  assert(html.includes('data-sheet-style="width height object-fit"'));
  assert(html.includes('id="photo" style="color: red !important;" data-sheet-style="color"'));
});
check('Header pair presets produce independent lab buttons without a home-link wrapper', () => {
  const { runtime: r, uploads } = setup();
  for (const id of ['frontlogo', 'frontlogo2', 'backlogo', 'backlogo2']) {
    for (const [filename, variant] of [['two_logos_on_white_on_black.svg', 'white'], ['two_logos_teal_on_white.svg', 'teal']]) {
      const html = r.appendSingle(['All', 'Common', 'Content', '', 'https://example.org/' + filename + '?dl=0', '', '', '', '', './index.html', id, 'z-index:2;'], []);
      assert(html.includes('class="logo-stack content_img"'));
      assert(html.includes('class="logo-canvas"'));
      assert(html.includes('./img/header-ubc-' + variant + '.svg'));
      assert(html.includes('./img/header-osaka-' + variant + '.svg'));
      assert.equal((html.match(/<img /g) || []).length, 2);
      assert.equal((html.match(/<button type="button"/g) || []).length, 2);
      assert(html.includes('class="logo-control logo-ubc" data-affiliation="UBC"'));
      assert(html.includes('class="logo-control logo-osaka" data-affiliation="Osaka"'));
      assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2);
      assert.equal((html.match(/aria-label="Show [^"]+ lab content"/g) || []).length, 2);
      assert(!html.includes('<a '));
      assert(!/<img[^>]*class="logo-/.test(html));
      assert(!html.includes(filename));
    }
  }
  assert.equal(uploads.length, 0);
  const custom = r.appendSingle(['All', 'Common', 'Content', '', 'https://example.org/custom.svg', '', '', '', '', '', 'frontlogo', ''], []);
  assert(!custom.includes('logo-stack'));
  assert(custom.includes('custom.svg'));
  const ordinary = r.appendSingle(['All', 'Common', 'Content', '', 'https://example.org/two_logos_teal_on_white.svg', '', '', '', '', '', 'photo', ''], []);
  assert(!ordinary.includes('logo-stack'));
});
check('Mobile lab buttons preserve Sheet image sizing without replacing home or institution links', () => {
  const { runtime: r, uploads } = setup();
  for (const [id, affiliation, filename] of [['mobile-ubc-lab', 'UBC', 'header-ubc-white.svg'], ['mobile-osaka-lab', 'Osaka', 'header-osaka-white.svg']]) {
    const html = r.appendSingle(['All', 'Common', 'Content', '', './img/' + filename, 'clamp(140px, 65vw, 300px)', 'auto', '', 'margin:0;float:none;', './index.html', id, 'margin:0;margin-bottom:12px;'], []);
    assert(html.includes('data-affiliation="' + affiliation + '"'));
    assert(html.includes('width: clamp(140px, 65vw, 300px);height: auto;'));
    assert(html.includes('margin-bottom: 12px !important;'));
    assert(!html.includes('<a '));
    assert.equal((html.match(/<img /g) || []).length, 1);
  }
  assert.equal(uploads.length, 0);
  const home = r.appendSingle(['All', 'Common', 'Content', '', 'https://example.org/home.svg', '', '', '', '', './index.html', 'mobile-yachielablogo', ''], []);
  assert(home.includes('<a href="./index.html">'));
  assert(!home.includes('data-affiliation'));
  const institution = r.appendSingle(['All', 'Common', 'Content', '', 'https://example.org/ubc.svg', '', '', '', '', 'https://www.ubc.ca/', 'mobile-ubclogo', ''], []);
  assert(institution.includes('<a href="https://www.ubc.ca/">'));
  assert(!institution.includes('data-affiliation'));
});
check('Header logo dimensions remain changeable by the clipping controller', () => {
  const { runtime: r } = setup();
  const attributes = r.rendererImageStyleAttributes_({ '/* ID': 'frontlogo', '/* img width': '400px', '/* img height': '100px', '/* img style': 'margin-top:12px;' });
  assert(attributes.includes('width: 400px;height: 100px;'));
  assert(!attributes.includes('height: 100px !important'));
  assert(attributes.includes('data-sheet-style="margin-top"'));
});
check('Member IDs and single-line Others fields survive rendering', () => {
  const { runtime: r } = setup();
  const adict = { Lab: 'UBC', Language: 'Common', '/* Name': 'Person', '/* Position': 'Researcher', '/* Others': 'Award winner\nGithub: <a href="https://example.org/a:b">profile</a>', '/* ID': 'person-id' };
  const html = r.appendMember(adict);
  assert(html.includes('class="member UBC Common" id="person-id"'));
  assert(html.includes('<span class="key">Award winner</span>'));
  assert(html.includes('<a href="https://example.org/a:b">profile</a>'));
  assert(!html.includes('undefined'));
});
check('Alumni IDs and final section closure are emitted', () => {
  const { runtime: r } = setup();
  r.PreElement = ['All', 'Common', 'H1']; r.PostElement = 'END';
  const html = r.appendAlumni({ Lab: 'All', Language: 'Common', '/* Name': 'Name', '/* ID': 'alumni-id' });
  assert(html.includes('class="grid-container alumni All Common" id="alumni-id"'));
  assert(html.endsWith('</section>'));
});
check('Bluesky snippets remove provider scripts and use pre-embed lifecycle classes', () => {
  const { runtime: r } = setup();
  const html = r.appendPost({ Lab: 'All', Language: 'Common', '/* Link': '<blockquote class="bluesky-embed" data-bluesky-uri="at://record"><a href="https://bsky.app/profile/test/post/id">post</a></blockquote><script async src="https://embed.bsky.app/static/embed.js"></script>' });
  assert(html.includes('class="pre-bluesky-embed"'));
  assert(!html.includes('<script'));
  assert(r.appendPost({ Lab: 'All', Language: 'Common', '/* Link': 'https://bsky,app/profile/test/post/id' }).includes('https://bsky.app/'));
});
check('News markup retains locale classes, optional images and valid paragraphs', () => {
  const { runtime: r } = setup();
  const html = r.appendNews({ Lab: 'Osaka', Language: 'Chinese', '/* Name': 'Lab', '/* Date': 2026, '/* Text': '**News**', '/* img url2': 'https://example.org/photo.png' });
  assert(html.includes('class="x-embed Osaka Chinese"'));
  assert(html.includes('<p><strong>News</strong></p>'));
  assert(!html.includes('<p><p>'));
  assert(html.includes('class="media-grid is-1"'));
  assert(html.includes('<span>2026</span>'));
});
check('MEDLINE preserves multiline hyphenated titles, caches only valid results and renders absent PG gracefully', () => {
  const { runtime: r, calls, sleeps } = setup();
  const first = r.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?id=123');
  const second = r.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?id=123');
  assert.equal(first.TI, 'A title - with a hyphen continued title');
  assert.equal(first.AU.length, 1);
  assert.equal(second.TI, first.TI);
  assert.equal(calls.length, 1); assert.deepEqual(sleeps, [350]);
  const html = r.pmid_html(first, ['Lab A'], '123', '', '', '', '', [], [], '', 'All', 'Common', 'pub');
  assert(html.includes('2, 2026')); assert(!html.includes('undefined')); assert(!html.includes(' & <span'));
});
check('Forced data refresh bypasses old PubMed cache and saves only validated fresh metadata', () => {
  let requests = 0;
  const fresh = 'PMID- 123\nTI  - Fresh title\nAU  - Lab A\n';
  const state = setup({ previewFetch_: () => { requests++; return {getResponseCode: () => 200, getContentText: () => fresh}; } });
  const key = 'pubmed-medline:v1:123';
  state.cache.set(key, 'PMID- 123\nTI  - Previous title\n');
  state.context.refreshData = true;
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Fresh title');
  assert.equal(requests, 1);
  assert.deepEqual(state.cacheReads, []);
  assert.deepEqual(state.cacheWrites, [{key, value: fresh, ttl: 21600}]);
  assert.equal(state.cache.get(key), fresh);
  assert.deepEqual(state.cacheRemovals, [key]);
});
check('A successful force refresh with cache.put failure cannot roll the next normal render back', () => {
  let requests = 0;
  const fresh = 'PMID- 123\nTI  - Fresh title after failed put\n';
  const state = setup({previewFetch_: () => { requests++; return {getResponseCode: () => 200, getContentText: () => fresh}; }});
  const key = 'pubmed-medline:v1:123';
  state.cache.set(key, 'PMID- 123\nTI  - Previous title\n');
  state.runtime.CacheService = {getScriptCache: () => ({
    get: name => { state.cacheReads.push(name); return state.cache.get(name) || null; },
    remove: name => { state.cacheRemovals.push(name); state.cache.delete(name); },
    put: () => { throw new Error('cache quota'); },
  })};
  state.context.refreshData = true;
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Fresh title after failed put');
  assert.equal(state.cache.has(key), false);
  assert.deepEqual(state.cacheRemovals, [key, key]);
  state.context.refreshData = false;
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Fresh title after failed put');
  assert.equal(requests, 2);
  assert.equal(state.cache.has(key), false);
});
check('An oversized validated force refresh evicts old metadata before the next normal render', () => {
  let requests = 0;
  const fresh = 'PMID- 123\nTI  - Fresh large title\nAB  - ' + 'x'.repeat(30000);
  const state = setup({previewFetch_: () => { requests++; return {getResponseCode: () => 200, getContentText: () => fresh}; }});
  const key = 'pubmed-medline:v1:123';
  state.cache.set(key, 'PMID- 123\nTI  - Previous title\n');
  state.context.refreshData = true;
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Fresh large title');
  assert.equal(state.cache.has(key), false);
  assert.deepEqual(state.cacheWrites, []);
  state.context.refreshData = false;
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Fresh large title');
  assert.equal(requests, 2);
  assert.deepEqual(state.cacheWrites, []);
});
check('Forced refresh fails explicitly when old metadata cannot be invalidated', () => {
  const state = setup();
  const key = 'pubmed-medline:v1:123';
  const old = 'PMID- 123\nTI  - Previous title\n';
  state.cache.set(key, old);
  state.runtime.CacheService = {getScriptCache: () => ({
    get: () => { throw new Error('Forced refresh must not read the cache'); },
    remove: () => { throw new Error('cache removal unavailable'); },
    put: () => { throw new Error('Must not publish/cache after failed invalidation'); },
  })};
  state.context.refreshData = true;
  assert.throws(() => state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123'), /cache could not be cleared for forced refresh/);
  assert.equal(state.cache.get(key), old);
  assert.deepEqual(state.cacheWrites, []);
});
check('Normal rendering, HTML rebuild and asset refresh reuse valid metadata without forcing new data', () => {
  const state = setup();
  state.cache.set('pubmed-medline:v1:123', 'PMID- 123\nTI  - Cached title\n');
  for (const flags of [{refreshData: false}, {refreshData: undefined}, {forceRegenerate: true}, {refreshAssets: true}]) {
    Object.assign(state.context, flags);
    assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Cached title');
  }
  assert.equal(state.calls.length, 0);
  assert.equal(state.cacheReads.length, 4);
  assert.equal(state.cacheWrites.length, 0);
});
check('Failed forced refresh never reads or returns the old citation and never caches the failure', () => {
  const old = 'PMID- 123\nTI  - Previous valid title\n';
  for (const [status, text] of [[503, 'error'], [200, '<html>not MEDLINE</html>'], [200, 'PMID- 999\nTI  - Wrong article\n']]) {
    let requests = 0;
    const state = setup({ previewFetch_: () => { requests++; return {getResponseCode: () => status, getContentText: () => text}; } });
    state.cache.set('pubmed-medline:v1:123', old);
    state.context.refreshData = true;
    assert.throws(() => state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123'), /PubMed/);
    assert.deepEqual(state.cacheReads, []);
    assert.deepEqual(state.cacheWrites, []);
    assert.equal(state.cache.get('pubmed-medline:v1:123'), old, 'Failure must not overwrite the last validated entry');
    assert.equal(requests, status === 503 ? 3 : 1);
  }
});
check('Corrupt or mismatched cached records fall back to the source instead of rendering mixed metadata', () => {
  for (const cached of ['<html>broken cache</html>', 'PMID- 999\nTI  - Wrong article\n', 'PMID- 123\nTI  - First\nPMID- 999\nTI  - Second\n']) {
    const state = setup();
    state.cache.set('pubmed-medline:v1:123', cached);
    const parsed = state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123');
    assert.equal(parsed.PMID, '123');
    assert.equal(parsed.TI, 'A title - with a hyphen continued title');
    assert.equal(state.calls.length, 1);
    assert.equal(state.cacheReads.length, 1);
    assert.equal(state.cacheWrites.length, 1);
  }
});
check('Fresh MEDLINE requires one matching PMID and one nonempty title before it can be cached', () => {
  for (const text of ['PMID- 999\nTI  - Wrong article\n', 'PMID- 123\nTI  - First\nPMID- 999\nTI  - Second\n', 'PMID- 123\nTI  - First\nPMID- 123\nTI  - Duplicate record\n', 'PMID- invalid\nTI  - Title\n', 'PMID- 123\nTI  - \n']) {
    const state = setup({ previewFetch_: () => ({getResponseCode: () => 200, getContentText: () => text}) });
    assert.throws(() => state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123'), /PubMed/);
    assert.equal(state.cache.size, 0);
    assert.equal(state.cacheWrites.length, 0);
  }
});
check('Optional cache failures and oversized abstracts cannot prevent valid citations from rendering', () => {
  for (const CacheService of [
    {getScriptCache: () => { throw new Error('cache service unavailable'); }},
    {getScriptCache: () => ({get: () => { throw new Error('cache read failed'); }, remove: () => { throw new Error('cache removal failed'); }, put: () => { throw new Error('cache quota'); }})},
  ]) {
    const state = setup({CacheService});
    assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').PMID, '123');
    assert.equal(state.calls.length, 1);
  }
  const large = 'PMID- 123\nTI  - Title\nAB  - ' + 'x'.repeat(30000);
  const state = setup({ previewFetch_: () => ({getResponseCode: () => 200, getContentText: () => large}) });
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123').TI, 'Title');
  assert.equal(state.cacheWrites.length, 0);
});
check('PubMed cache keys normalize equivalent numeric IDs and reject malformed query IDs before I/O', () => {
  const state = setup();
  state.cache.set('pubmed-medline:v1:123', 'PMID- 123\nTI  - Cached matched title\n');
  assert.equal(state.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=%30%30%31%32%33').TI, 'Cached matched title');
  assert.deepEqual(state.cacheReads, ['pubmed-medline:v1:123']);
  assert.equal(state.calls.length, 0);
  for (const id of ['123invalid', '%ZZ']) {
    const invalid = setup();
    assert.throws(() => invalid.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=' + id), /Invalid PubMed citation ID/);
    assert.equal(invalid.calls.length, 0);
    assert.deepEqual(invalid.cacheReads, []);
    assert.deepEqual(invalid.cacheWrites, []);
  }
});
check('HTTP 429 and 5xx retry at most three times; permanent failures do not cache', () => {
  let requests = 0;
  const { runtime: r, cache, sleeps } = setup({ previewFetch_: () => ({ getResponseCode: () => (++requests === 1 ? 429 : 503), getContentText: () => 'error' }) });
  assert.throws(() => r.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=456'), /HTTP 503/);
  assert.equal(requests, 3); assert.equal(cache.size, 0); assert.equal(sleeps.filter(delay => delay === 350).length, 3);
  requests = 0;
  const failed = setup({ previewFetch_: () => { requests++; return { getResponseCode: () => 404, getContentText: () => 'missing' }; } });
  assert.throws(() => failed.runtime.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=789'), /HTTP 404/);
  assert.equal(requests, 1);
});
check('A HTTP 200 error document is rejected and never cached', () => {
  const { runtime: r, cache } = setup({ previewFetch_: () => ({ getResponseCode: () => 200, getContentText: () => '<html>temporarily unavailable</html>' }) });
  assert.throws(() => r.pmid_bibdict('https://eutils.ncbi.nlm.nih.gov/?id=123'), /no valid MEDLINE/);
  assert.equal(cache.size, 0);
});
check('Publication image params, default members, journal names and optional email reach their targets', () => {
  const { runtime: r, calls } = setup({ PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'PUBMED_EMAIL' ? 'test@example.org' : null }) } });
  const html = r.appendPublication({ Lab: 'All', Language: 'Common', '/* Pubmed ID': 123, '/* img url': 'https://example.org/article.png', '/* img width': '50%', '/* img height': '/* img height' });
  assert(html.includes('<a class="JT" href="https://pubmed.ncbi.nlm.nih.gov/123/">Journal</a>'));
  assert(html.includes('<span class="member">Lab A</span>'));
  assert(html.includes('data-sheet-image-width="true"'));
  assert(html.includes('<section class="paper_photo" style="width: 50% !important;" data-sheet-style="width">'));
  assert(html.includes('alt="paper_img">'));
  assert(calls[0].url.includes('email=test%40example.org'));
});
check('Publication clamp width sizes the image column against the paper row; height stays on the image', () => {
  const { runtime: r } = setup();
  const html = r.appendCustomPublication({ Lab: 'All', Language: 'Common', '/* Title': 'Title', '/* Authors': 'Author A',
    '/* img url': 'https://example.org/article.png', '/* img width': 'clamp(60px, 50%, 480px)', '/* img height': 200 });
  assert(html.includes('<section class="paper_photo" style="width: clamp(60px, 50%, 480px) !important;" data-sheet-style="width">'));
  assert(html.includes('alt="paper_img" style="height: 200px !important;" data-sheet-style="height"'));
  assert(!/<img[^>]*style="[^"]*width:/.test(html));
  const css = fs.readFileSync(path.join(root, 'css/pages/publications.css'), 'utf8');
  assert(/\.paper\[data-sheet-image-width\] > \.paper_photo\s*\{[^}]*flex: 0 0 auto;[^}]*max-width: calc\(100% - var\(--paper-image-gap\)\);/.test(css));
  assert(/\.paper\[data-sheet-image-width\] > \.paper_txt_w_photo\s*\{[^}]*flex: 1 1 0%;[^}]*width: auto;[^}]*min-width: 0;/.test(css));
});
check('Placeholder image dimensions retain the default publication DOM and layout', () => {
  const { runtime: r } = setup();
  const html = r.appendPublication({ Lab: 'All', Language: 'Common', '/* Pubmed ID': 123, '/* img url': 'https://example.org/article.png',
    '/* img width': '/* img width (Optional)', '/* img height': '/* img height (Optional)' });
  assert(!html.includes('data-sheet-image-width'));
  assert(html.includes('<section class="paper_photo">'));
  assert(html.includes('alt="paper_img">'));
  const noImage = r.appendCustomPublication({ Lab: 'All', Language: 'Common', '/* Title': 'Title', '/* img width': '50%' });
  assert(!noImage.includes('data-sheet-image-width'));
  assert(noImage.includes('class="paper_txt_wo_photo"'));
});
check('Height-only publication styling keeps the standard column width', () => {
  const { runtime: r } = setup();
  const html = r.appendCustomPublication({ Lab: 'All', Language: 'Common', '/* Title': 'Title', '/* img url': 'https://example.org/article.png', '/* img height': '150px' });
  assert(!html.includes('data-sheet-image-width'));
  assert(html.includes('<section class="paper_photo">'));
  assert(html.includes('alt="paper_img" style="height: 150px !important;" data-sheet-style="height"'));
});
check('bioRxiv and numeric publication widths use the same column sizing contract', () => {
  const { runtime: r } = setup();
  const html = r.biorxiv_html({ AU: ['Author A'], TI: 'Title' }, [], '10.1101/2026.01.01.000001', 'https://example.org/doi', '', './img/article.png', '', [], [], '', 'All', 'Common', 'doi', 'width: 240px;');
  assert(html.includes('<section class="paper_photo" style="width: 240px !important;" data-sheet-style="width">'));
  assert(html.includes('data-sheet-image-width="true"'));
  assert(!/<img[^>]*style="[^"]*width:/.test(html));
});
check('Custom publication accepts blank highlighted authors, missing citation fields and one author', () => {
  const { runtime: r } = setup();
  const html = r.appendCustomPublication({ Lab: 'All', Language: 'Common', '/* Title': 'A title.', '/* Authors': 'Author A', '/* Journal': 'Journal', '/* Year, Date': 2026 });
  assert(!html.includes('undefined')); assert(!html.includes('A title..')); assert(html.includes('2026'));
});

console.log(`CMS renderer checks passed: ${checks}.`);
