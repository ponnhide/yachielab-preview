'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname, '../../cms/Pages.gs'), 'utf8');
const SITE = 'https://ponnhide.github.io/yachielab-preview', ID = 987654321;
function blobSha(content) { const bytes = Buffer.from(content); return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex'); }
function normalized(html) { return 'preview:' + html + '<!--versioned-->'; }

function fixture(options = {}) {
  const state = {events: [], writes: [], registrationAttempts: [], published: [], rendered: [], props: {...options.props}, propertyCalls: [], warnings: [], failRegistration: Boolean(options.registrationFailure), failRegistrationColumns: new Set(options.registrationFailureColumns || []), failFlush: Boolean(options.flushFailure)};
  state.registryRows = Array.from({length: 12}, (_, index) => ['Affiliation ' + index, 'Language ' + index, 'Project ' + index, '', '', 'Common ' + index, '', '', 'Journal ' + index, 'Replacement ' + index]);
  state.registryRows[0][3] = 'Sheet'; state.registryRows[0][4] = 'Page';
  for (const [column, names] of [[4, options.registrySheetNames || ['research', 'contact']], [5, options.registryPageNames || ['research', 'contact']]]) {
    names.forEach((name, index) => {state.registryRows[index + 1][column - 1] = name;});
  }
  state.sourceRows = options.rows || [['Lab', 'Language', 'Function', 'Parameter1'], ['All', 'Common', 'H1', 'New page'], ['', '', '', '=parameter-placeholder']];
  const formulaRows = {4: new Set(options.sheetFormulaRows || []), 5: new Set(options.formulaRows || [])};
  const validationRows = {4: new Set(options.sheetValidationRows || []), 5: new Set(options.validationRows || [])};
  let sourceName = options.name || 'fresh', sourceId = options.id ?? ID;
  const source = {getName: () => sourceName, getSheetId: () => sourceId, setName(name) { sourceName = name; return source; }, getMaxRows: () => state.sourceRows.length,
    getDataRange: () => ({getDisplayValues: () => state.sourceRows, getValues: () => state.sourceRows, getRichTextValues: () => state.sourceRows.map(row => row.map(() => null))}),
    getRange(row, column, height = 1, width = 1) { return {getDisplayValues: () => Array.from({length: height}, (_, i) => Array.from({length: width}, (_, j) => state.sourceRows[row + i - 1]?.[column + j - 1] || ''))}; }
  };
  const registry = {getName: () => 'item list', getSheetId: () => 891529442, getMaxRows: () => state.registryRows.length,
    getRange(row, column, height = 1, width = 1) {
      assert([4, 5].includes(column), 'Enrollment may address only independent Sheet/Page columns'); assert.equal(width, 1);
      return {getValues: () => Array.from({length: height}, (_, i) => [state.registryRows[row + i - 1]?.[column - 1] || '']),
        getDisplayValues: () => Array.from({length: height}, (_, i) => [state.registryRows[row + i - 1]?.[column - 1] || '']),
        getFormulas: () => Array.from({length: height}, (_, i) => [formulaRows[column].has(row + i) ? '=empty()' : '']),
        getValue: () => state.registryRows[row - 1]?.[column - 1] || '', getFormula: () => formulaRows[column].has(row) ? '=empty()' : '',
        getDataValidation: () => validationRows[column].has(row) ? {criteria: 'restricted'} : null,
        setValue(value) {state.events.push('register'); state.registrationAttempts.push({row, column, value}); if (state.failRegistration || state.failRegistrationColumns.has(column)) throw Error('Registry write failed'); state.registryRows[row - 1][column - 1] = value; state.writes.push({row, column, value});}
      };
    }
  };
  const extraSheets = (options.tabs || []).map((name, index) => ({getName: () => name, getSheetId: () => ID + index + 1}));
  const book = {getId: () => 'preview', getSheets: () => [source, registry, ...extraSheets], getSheetByName: name => [source, registry, ...extraSheets].find(sheet => sheet.getName() === name) || null, getActiveSheet: () => source};
  const context = {spreadsheet: book, pages: options.pages || ['research', 'contact'], parameters: {H1: ['Lab', 'Language', 'Function', '/* Title']}, sheets: {}, pendingAssets: []};
  const entries = options.entries || {'research.html': {type: 'blob', sha: 'a'.repeat(40)}, 'contact.html': {type: 'blob', sha: 'b'.repeat(40)}};
  const properties = {
    getProperty(key) {assert.match(key, /^CMS_PENDING_PAGE_\d+$/); state.propertyCalls.push(['get', key]); return state.props[key] || null;},
    setProperty(key, value) {assert.match(key, /^CMS_PENDING_PAGE_\d+$/); state.propertyCalls.push(['set', key]); state.events.push('intent'); if (options.intentFailure) throw Error('Intent storage failed'); state.props[key] = value; return properties;},
    deleteProperty(key) {assert.match(key, /^CMS_PENDING_PAGE_\d+$/); state.propertyCalls.push(['delete', key]); if (options.deleteFailure) throw Error('Intent cleanup failed'); delete state.props[key]; return properties;},
    getProperties() {throw Error('Credential enumeration is forbidden');}
  };
  const sandbox = {PREVIEW_SPREADSHEET_ID: 'preview', PREVIEW_SITE_URL: SITE, CMS_CONTEXT_: context,
    SpreadsheetApp: {getActiveSpreadsheet: () => book, flush() {state.events.push('flush'); if (state.failFlush) throw Error('Flush failed');}},
    PropertiesService: {getScriptProperties: () => properties},
    console: {warn: message => state.warnings.push(message), error: message => state.warnings.push(message), info() {}},
    cmsContext_: () => context, cmsGithubSnapshot_: () => ({entries}), cmsSiteSettings_() {state.events.push('settings'); return {};},
    cmsSheetRows_(name) { if (name === 'item list') return {sheet: registry, values: state.registryRows}; if (name === sourceName) return {sheet: source, values: state.sourceRows}; throw Error('Missing CMS tab: ' + name); },
    previewPrepareHtml_: html => 'preview:' + html,
    cmsVersionAssetHtml_: html => html + '<!--versioned-->', cmsGitBlobSha_: blobSha,
    cmsCreatePage_(name) {state.events.push('render-new'); state.rendered.push(name); assert(context.pages.includes(name), 'New tabs must render as independent pages'); if (options.renderFailure) throw Error('Render failed'); if (options.renameDuringRendering) source.setName('renamed'); return {path: name + '.html', expectedAbsent: true, html: '<html><body>' + (options.html || 'New content') + '</body></html>'};},
    cmsRenderPage_(name) {state.events.push('render-existing'); state.rendered.push(name); assert(context.pages.includes(name)); return {path: name + '.html', expectedSha: entries[name + '.html'].sha, html: '<html><body>Updated content</body></html>'};},
    cmsPublish_(files) {state.events.push('publish'); state.published.push(files); if (options.renameDuringPublication) source.setName('renamed'); if (options.publishFailure) throw Error('Publish failed'); const pageShas = {}; for (const file of files) {const sha = blobSha(normalized(file.html)); pageShas[file.path] = sha; entries[file.path] = {type: 'blob', sha};} return {changed: true, pages: files.length, assets: 0, commit: 'c'.repeat(40), pageShas};}
  };
  vm.createContext(sandbox); vm.runInContext(code, sandbox, {filename: 'Pages.gs'});
  state.run = sandbox; state.context = context; state.source = source; state.entries = entries; return state;
}

test('a new content tab publishes once, then enrolls its independent Page and Sheet cells', () => {
  const state = fixture(), before = structuredClone(state.registryRows), result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(state.published.length, 1); assert.equal(state.published[0][0].path, 'fresh.html');
  assert.equal(state.published[0][0].expectedAbsent, true); assert.equal(state.writes.length, 2); before[3][4] = 'fresh'; before[3][3] = 'fresh';
  assert.deepEqual(state.writes.map(write => write.column), [5, 4], 'Register Page first so a partial Sheet failure remains recoverable');
  assert.deepEqual(state.registryRows, before); assert(state.events.indexOf('intent') < state.events.indexOf('publish'));
  assert(state.events.indexOf('publish') < state.events.indexOf('register')); assert.equal(state.props['CMS_PENDING_PAGE_' + ID], undefined);
  assert(state.propertyCalls.every(([, key]) => key === 'CMS_PENDING_PAGE_' + ID));
});

test('pending intent stores the exact normalized and asset-versioned page blob SHA', () => {
  const state = fixture({publishFailure: true}); assert.throws(() => state.run.cmsUpdateNewTab_('fresh'), /Publish failed/);
  const intent = JSON.parse(state.props['CMS_PENDING_PAGE_' + ID]), file = state.published[0][0];
  assert.equal(intent.sheetId, ID); assert.equal(intent.name, 'fresh'); assert.equal(intent.sha, blobSha(normalized(file.html)));
  assert.equal(state.writes.length, 0); assert.deepEqual(state.context.pages, ['research', 'contact']);
});

test('existing excluded or renamed registered/shared tabs are not mistaken for newly added sheets', () => {
  for (const id of [2115798030, 0, 1892986748, 1230099545]) {
    const state = fixture({id}); assert.throws(() => state.run.cmsUpdateNewTab_('fresh'));
    assert.equal(state.rendered.length, 0); assert.equal(state.published.length, 0); assert.equal(state.writes.length, 0); assert.equal(state.propertyCalls.filter(call => call[0] === 'set').length, 0);
  }
});

test('unsafe, reserved, duplicate-tab, registered and existing-HTML names do not enroll', () => {
  const cases = [
    ...['index', 'blank', '404', 'header', 'template', '_cms_cache', 'name_old', '../x', 'fresh.html', 'UpperCase'].map(name => ({name})),
    {tabs: ['FRESH']}, {pages: ['Fresh']}, {entries: {'fresh.html': {type: 'blob', sha: 'd'.repeat(40)}}}, {entries: {'FRESH.html': {type: 'blob', sha: 'd'.repeat(40)}}}
  ];
  for (const options of cases) {const state = fixture(options); assert.throws(() => state.run.cmsUpdateNewTab_(options.name || 'fresh')); assert.equal(state.rendered.length, 0); assert.equal(state.published.length, 0); assert.equal(state.writes.length, 0);}
});

test('blank or non-content source tabs fail before rendering, intent creation and registration', () => {
  for (const rows of [[], [['']], [['Lab', 'Language', 'Wrong'], ['All', 'Common', 'H1']], [['Lab', 'Language', 'Function']], [['Lab', 'Language', 'Function'], ['', 'Common', 'H1']], [['Lab', 'Language', 'Function'], ['All', 'Common', '']]]) {
    const state = fixture({rows}); assert.throws(() => state.run.cmsUpdateNewTab_('fresh'));
    assert.equal(state.rendered.length, 0); assert.equal(state.published.length, 0); assert.equal(state.writes.length, 0); assert.equal(state.propertyCalls.filter(call => call[0] === 'set').length, 0);
  }
});

test('render and intent-storage failures leave the source unregistered and restore context', () => {
  for (const options of [{renderFailure: true}, {intentFailure: true}]) {
    const state = fixture(options); assert.throws(() => state.run.cmsUpdateNewTab_('fresh'));
    assert.equal(state.writes.length, 0); assert.equal(state.published.length, 0); assert.deepEqual(state.context.pages, ['research', 'contact']);
  }
  const rendered = fixture({renderFailure: true}); assert.throws(() => rendered.run.cmsUpdateNewTab_('fresh')); assert.equal(rendered.propertyCalls.filter(call => call[0] === 'set').length, 0);
});

test('a registry write failure reports the completed publication and preserves recovery intent', () => {
  const state = fixture({registrationFailure: true}), result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(result.registrationSaved, false); assert.equal(state.published.length, 1); assert.equal(state.writes.length, 0);
  assert(state.props['CMS_PENDING_PAGE_' + ID]); assert.deepEqual(state.context.pages, ['research', 'contact']);
});

test('matching same-sheet pending intent repairs enrollment and then updates the latest content', () => {
  const sha = 'd'.repeat(40), key = 'CMS_PENDING_PAGE_' + ID;
  const state = fixture({entries: {'fresh.html': {type: 'blob', sha}}, props: {[key]: JSON.stringify({sheetId: ID, name: 'fresh', sha})}});
  const result = state.run.cmsUpdateNewTab_('fresh'); assert.equal(result.changed, true); assert.equal(state.writes.length, 2);
  assert.equal(state.rendered.length, 1); assert.equal(state.published[0][0].expectedAbsent, undefined); assert.equal(state.published[0][0].expectedSha, sha);
  assert(state.events.indexOf('register') < state.events.indexOf('render-existing')); assert.equal(state.props[key], undefined);
});

test('pending ownership cannot adopt another sheet, slug, case path or changed HTML', () => {
  const sha = 'd'.repeat(40), key = 'CMS_PENDING_PAGE_' + ID;
  const cases = [
    {sheetId: ID + 1, name: 'fresh', sha}, {sheetId: ID, name: 'other', sha}, {sheetId: ID, name: 'fresh', sha: 'e'.repeat(40)},
    null, 'malformed'
  ];
  for (const intent of cases) {
    const value = intent === 'malformed' ? 'not-json' : intent ? JSON.stringify(intent) : undefined;
    const state = fixture({entries: {'fresh.html': {type: 'blob', sha}}, props: value ? {[key]: value} : {}});
    assert.throws(() => state.run.cmsUpdateNewTab_('fresh')); assert.equal(state.writes.length, 0); assert.equal(state.rendered.length, 0); assert.equal(state.published.length, 0);
  }
  const uppercase = fixture({entries: {'FRESH.html': {type: 'blob', sha}}, props: {[key]: JSON.stringify({sheetId: ID, name: 'fresh', sha})}});
  assert.throws(() => uppercase.run.cmsUpdateNewTab_('fresh')); assert.equal(uppercase.writes.length, 0);
});

test('a failed earlier attempt with no HTML can create a fresh page on retry', () => {
  const key = 'CMS_PENDING_PAGE_' + ID, state = fixture({props: {[key]: JSON.stringify({sheetId: ID, name: 'fresh', sha: 'd'.repeat(40)})}});
  state.run.cmsUpdateNewTab_('fresh'); assert.equal(state.published[0][0].expectedAbsent, true); assert.equal(state.writes.length, 2); assert.equal(state.props[key], undefined);
});

test('renaming a tab with a pending publication cannot create a second URL or overwrite its ownership record', () => {
  const key = 'CMS_PENDING_PAGE_' + ID, intent = JSON.stringify({sheetId: ID, name: 'original-name', sha: 'd'.repeat(40)});
  const state = fixture({props: {[key]: intent}});
  assert.throws(() => state.run.cmsUpdateNewTab_('fresh'), /Restore its original name/);
  assert.equal(state.rendered.length, 0); assert.equal(state.published.length, 0); assert.equal(state.writes.length, 0);
  assert.equal(state.props[key], intent);
});

test('registration skips formula and validated cells independently and preserves every other list cell', () => {
  const state = fixture({formulaRows: [4], validationRows: [5], sheetFormulaRows: [4, 5], sheetValidationRows: [6]}), before = structuredClone(state.registryRows);
  state.run.cmsUpdateNewTab_('fresh'); assert.deepEqual(state.writes, [{row: 6, column: 5, value: 'fresh'}, {row: 7, column: 4, value: 'fresh'}]);
  before[5][4] = 'fresh'; before[6][3] = 'fresh'; assert.deepEqual(state.registryRows, before);
});

test('renaming the source during publication retains successful result and prevents stale E registration', () => {
  const state = fixture({renameDuringPublication: true}), result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(result.registrationSaved, false); assert.equal(state.writes.length, 0); assert(state.props['CMS_PENDING_PAGE_' + ID]);
});

test('renaming the source before publication stops before pending intent and remote writes', () => {
  const state = fixture({renameDuringRendering: true});
  assert.throws(() => state.run.cmsUpdateNewTab_('fresh'), /source tab changed/);
  assert.equal(state.published.length, 0); assert.equal(state.writes.length, 0);
  assert.equal(state.propertyCalls.filter(call => call[0] === 'set').length, 0); assert.deepEqual(state.context.pages, ['research', 'contact']);
});

test('a cleanup failure cannot turn completed publication and registration into a failed update', () => {
  const state = fixture({deleteFailure: true}), result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(result.registrationSaved, true); assert.equal(state.writes.length, 2); assert.equal(state.registryRows[3][4], 'fresh'); assert.equal(state.registryRows[3][3], 'fresh');
});

test('different Sheet and Page list lengths append independently without replacing existing names', () => {
  const state = fixture({registrySheetNames: ['research', 'contact', 'header', 'footer', 'joinus'], registryPageNames: ['research', 'contact']}), before = structuredClone(state.registryRows);
  state.run.cmsUpdateNewTab_('fresh'); assert.deepEqual(state.writes, [{row: 4, column: 5, value: 'fresh'}, {row: 7, column: 4, value: 'fresh'}]);
  before[3][4] = 'fresh'; before[6][3] = 'fresh'; assert.deepEqual(state.registryRows, before);
});

test('an existing exact name in either independent list is reused without duplicate writes', () => {
  for (const options of [
    {registrySheetNames: ['research', 'fresh', 'contact']},
    {registryPageNames: ['research', 'contact', 'fresh']},
    {registrySheetNames: ['research', 'fresh'], registryPageNames: ['fresh', 'contact']}
  ]) {
    const state = fixture(options), before = structuredClone(state.registryRows);
    state.run.cmsEnsurePageRegistrationLists_('fresh', state.context.spreadsheet.getSheetByName('item list'));
    const expectedMissing = [4, 5].filter(column => !before.some(row => row[column - 1] === 'fresh'));
    assert.deepEqual(state.writes.map(write => write.column).sort(), expectedMissing);
    for (const column of [4, 5]) assert.equal(state.registryRows.filter(row => row[column - 1] === 'fresh').length, 1);
    state.run.cmsEnsurePageRegistrationLists_('fresh', state.context.spreadsheet.getSheetByName('item list'));
    assert.equal(state.writes.length, expectedMissing.length, 'Retry must not add duplicate list entries');
    for (let row = 0; row < before.length; row++) for (let column = 0; column < before[row].length; column++) {
      if (before[row][column] !== '' || ![3, 4].includes(column)) assert.equal(state.registryRows[row][column], before[row][column]);
    }
  }
});

test('case-only names in either list conflict before either registration cell is written', () => {
  for (const options of [{registrySheetNames: ['research', 'Fresh']}, {registryPageNames: ['research', 'Fresh']}]) {
    const state = fixture(options);
    assert.equal(typeof state.run.cmsEnsurePageRegistrationLists_, 'function');
    assert.throws(() => state.run.cmsEnsurePageRegistrationLists_('fresh', state.context.spreadsheet.getSheetByName('item list')));
    assert.equal(state.writes.length, 0);
  }
});

test('both missing entries are preflighted before writing if either list has no unrestricted free cell', () => {
  for (const column of [4, 5]) {
    const options = column === 4 ? {sheetValidationRows: Array.from({length: 9}, (_, index) => index + 4)} : {validationRows: Array.from({length: 9}, (_, index) => index + 4)};
    const state = fixture(options), before = structuredClone(state.registryRows);
    assert.equal(typeof state.run.cmsEnsurePageRegistrationLists_, 'function');
    assert.throws(() => state.run.cmsEnsurePageRegistrationLists_('fresh', state.context.spreadsheet.getSheetByName('item list')));
    assert.equal(state.registrationAttempts.length, 0); assert.deepEqual(state.registryRows, before);
  }
});

test('a partial Sheet write failure retains Page registration and retries only the missing Sheet cell', () => {
  const key = 'CMS_PENDING_PAGE_' + ID, state = fixture({registrationFailureColumns: [4]});
  const result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(result.registrationSaved, false);
  assert.deepEqual(state.writes, [{row: 4, column: 5, value: 'fresh'}]); assert(state.props[key]);
  state.failRegistrationColumns.clear();
  state.run.cmsRepairPageRegistration_('fresh', result);
  assert.equal(result.registrationSaved, true); assert.equal(state.props[key], undefined);
  assert.deepEqual(state.writes, [{row: 4, column: 5, value: 'fresh'}, {row: 4, column: 4, value: 'fresh'}]);
  state.run.cmsRepairPageRegistration_('fresh', result);
  assert.equal(state.writes.length, 2);
});

test('normal registered-page repair backfills Sheet membership after an unchanged publication', () => {
  const state = fixture({pages: ['research', 'contact', 'fresh'], registryPageNames: ['research', 'contact', 'fresh']}), before = structuredClone(state.registryRows);
  const result = {changed: false, pages: 0, assets: 0};
  state.run.cmsRepairPageRegistration_('fresh', result);
  assert.equal(result.changed, false); assert.equal(result.registrationSaved, true);
  assert.equal(state.published.length, 0); assert.equal(state.rendered.length, 0);
  assert.deepEqual(state.writes, [{row: 4, column: 4, value: 'fresh'}]); before[3][3] = 'fresh'; assert.deepEqual(state.registryRows, before);
});

test('Page write failure preserves an existing Sheet entry and stops before any second write', () => {
  const state = fixture({registrySheetNames: ['research', 'fresh', 'contact'], registrationFailureColumns: [5]}), before = structuredClone(state.registryRows);
  const result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(result.registrationSaved, false);
  assert.deepEqual(state.registrationAttempts.map(write => write.column), [5]);
  assert.equal(state.writes.length, 0); assert.deepEqual(state.registryRows, before);
  assert(state.props['CMS_PENDING_PAGE_' + ID]);
});

test('a flush failure retains recovery intent until both list entries are confirmed without duplicates', () => {
  const key = 'CMS_PENDING_PAGE_' + ID, state = fixture({flushFailure: true});
  const result = state.run.cmsUpdateNewTab_('fresh');
  assert.equal(result.changed, true); assert.equal(result.registrationSaved, false);
  assert.equal(state.writes.length, 2); assert(state.props[key]);
  state.failFlush = false; state.run.cmsRepairPageRegistration_('fresh', result);
  assert.equal(result.registrationSaved, true); assert.equal(state.props[key], undefined);
  assert.equal(state.writes.length, 2);
  assert(state.events.lastIndexOf('flush') >= state.events.lastIndexOf('register'));
});
