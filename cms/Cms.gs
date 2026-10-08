// Menu actions are the only workbook entrypoints. All writes require the preview guard.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Custom menu')
    .addItem('Update the current page', 'update_webpage')
    .addToUi();
}

function cmsRun_(work, command) {
  var started = Date.now();
  command = command || 'update';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another preview update is running. Try again after it finishes.');
  try {
    CMS_CONTEXT_ = null;
    var context = cmsContext_();
    cmsGithubSnapshot_();
    var result = work(context);
    try { if (typeof cmsAssetsCommit_ === 'function') cmsAssetsCommit_(result); }
    catch (assetRegistryError) {
      result.assetsSaved = false;
      context.assetStats = context.assetStats || {};
      context.assetStats.registryErrors = (context.assetStats.registryErrors || 0) + 1;
      console.warn('CMS publication completed; asset registry save failed. The next update will check sources again.');
    }
    try { cmsCacheCommit_(result); }
    catch (cacheError) {
      context.cacheStats = context.cacheStats || {};
      context.cacheStats.cacheWriteErrors = (context.cacheStats.cacheWriteErrors || 0) + 1;
      result.cacheSaved = false;
      result.cacheWarning = 'Render cache could not be saved; the next update will regenerate it.';
      console.warn('CMS publication completed; optional render cache save failed.');
    }
    var stats = context.cacheStats || {};
    var assetStats = context.assetStats || {};
    var metrics = {
      command: command, rowsRendered: stats.rowsRendered || 0, rowsReused: stats.rowsReused || 0,
      pagesSkipped: stats.pagesSkipped || 0, fragmentsSkipped: stats.fragmentsSkipped || 0,
      sheetReads: context.sheetReads || 0, githubReads: context.githubReads || 0, githubWrites: context.githubWrites || 0,
      pagesChanged: result.pages || 0, assetsChanged: result.assets || 0,
      assetsChecked: assetStats.checked || 0, assetsDownloaded: assetStats.downloaded || 0,
      assetsNotModified: assetStats.notModified || 0, assetRegistryErrors: assetStats.registryErrors || 0,
      pdfLinksPreserved: (context.assetWarnings || []).length,
      cacheReadErrors: stats.cacheReadErrors || 0, cacheWriteErrors: stats.cacheWriteErrors || 0,
      elapsedMs: Date.now() - started
    };
    result.metrics = metrics;
    console.info('CMS metrics: ' + JSON.stringify(metrics));
    var status = result.changed ? 'Preview updated: ' + (result.pages || 0) + ' page(s).' : 'No changes to publish.';
    if (result.cacheSaved === false) status += ' Cache save failed; next update will regenerate.';
    if (result.assetsSaved === false) status += ' Asset registry save failed; next update will check sources again.';
    if (result.registrationSaved === false) status += ' Page registration is pending. Run Update the current page again.';
    if (metrics.pdfLinksPreserved) status += ' ' + metrics.pdfLinksPreserved + ' PDF link(s) kept; not re-fetched.';
    var summary = ' Generated ' + metrics.rowsRendered + ', reused ' + metrics.rowsReused + ' rows; skipped ' + metrics.pagesSkipped + ' pages; ' + (metrics.elapsedMs / 1000).toFixed(1) + 's.';
    // A UI notification failure must not turn a successful publication into a failure.
    try { context.spreadsheet.toast(status + summary, 'Website CMS', 8); }
    catch (toastError) { console.warn('CMS publication completed; notification could not be shown.'); }
    return result;
  } catch (error) {
    console.error('CMS update failed (' + command + ').');
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function update_webpage() {
  return cmsRun_(function(context) { return cmsUpdateTab_(context.spreadsheet.getActiveSheet().getName()); }, 'update_webpage');
}

function rebuild_current_page() {
  return cmsRun_(function(context) {
    context.forceRegenerate = true;
    return cmsUpdateTab_(context.spreadsheet.getActiveSheet().getName());
  }, 'rebuild_current_page');
}

function refresh_current_data() {
  return cmsRun_(function(context) {
    context.refreshData = true;
    return cmsUpdateTab_(context.spreadsheet.getActiveSheet().getName());
  }, 'refresh_current_data');
}

function refresh_current_assets() {
  return cmsRun_(function(context) {
    context.refreshAssets = true;
    return cmsUpdateTab_(context.spreadsheet.getActiveSheet().getName());
  }, 'refresh_current_assets');
}

function update_all_webpages() {
  return cmsRun_(function(context) {
    var files = context.pages.map(function(name) { return cmsRenderPage_(name); }).filter(function(file) { return !!file; });
    return cmsPublish_(files, 'Update all registered preview pages from Google Sheets');
  }, 'update_all_webpages');
}

function update_shared_components() {
  return cmsRun_(function(context) {
    var shared = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'};
    var fragments = {};
    Object.keys(shared).forEach(function(name) { fragments[name] = cmsRenderRows_(name); });
    context.newPageSharedFragments = fragments;
    var changes = Object.keys(shared).map(function(component) { return {selector: shared[component], fragment: fragments[component]}; });
    var files = cmsSharedPages_().map(function(name) {
      return context.pages.indexOf(name) !== -1 && !cmsGithubSnapshot_().entries[name + '.html'] ?
        cmsCreatePage_(name) : cmsReplaceFragments_(name, changes);
    }).filter(function(file) { return !!file; });
    return cmsPublish_(files, 'Update all preview shared components from Google Sheets');
  }, 'update_shared_components');
}

function cmsSharedPages_() {
  return cmsContext_().pages.concat(['index']).filter(function(name, index, names) { return names.indexOf(name) === index; });
}

function cmsUpdateTab_(name) {
  var context = cmsContext_();
  if (context.pages.indexOf(name) !== -1) {
    if (typeof cmsClearPendingPageRegistration_ === 'function') cmsClearPendingPageRegistration_(name);
    var page = cmsRenderPage_(name);
    return cmsPublish_(page ? [page] : [], 'Update preview page: ' + name);
  }
  var shared = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'};
  if (!shared[name]) return cmsUpdateNewTab_(name);
  var fragment = cmsRenderRows_(name);
  context.newPageSharedFragments = {};
  context.newPageSharedFragments[name] = fragment;
  var files = cmsSharedPages_().map(function(page) {
    return context.pages.indexOf(page) !== -1 && !cmsGithubSnapshot_().entries[page + '.html'] ?
      cmsCreatePage_(page) : cmsReplaceFragment_(page, shared[name], fragment);
  }).filter(function(file) { return !!file; });
  return cmsPublish_(files, 'Update preview shared component: ' + name);
}

function cmsRenderRows_(name) {
  return cmsCacheRenderRows_(name);
}

function cmsRenderPage_(name) {
  if (!cmsGithubSnapshot_().entries[name + '.html']) return cmsCreatePage_(name);
  return cmsReplaceFragment_(name, '.posts', cmsRenderRows_(name));
}

function cmsReplaceFragment_(name, selector, fragment) {
  return cmsReplaceFragments_(name, [{selector: selector, fragment: fragment}]);
}

function cmsReplaceFragments_(name, changes) {
  var force = cmsContext_().forceRegenerate;
  var needed = changes.filter(function(change) { return force || !cmsCacheCanSkipFragment_(name, change.selector, change.fragment); });
  if (!needed.length) {
    var context = cmsContext_();
    context.cacheStats = context.cacheStats || {};
    context.cacheStats.pagesSkipped = (context.cacheStats.pagesSkipped || 0) + 1;
    return null;
  }
  var file = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, name + '.html', BRANCH);
  if (!file || !file.content) throw new Error('Missing page template: ' + name + '.html');
  var original = Utilities.newBlob(Utilities.base64Decode(file.content)).getDataAsString('UTF-8');
  var $ = Cheerio.load(original);
  $('body').attr('data-page', name);
  needed.forEach(function(change) {
    if ($(change.selector).length !== 1) throw new Error('Template must contain exactly one ' + change.selector + ': ' + name);
    $(change.selector).empty().append(change.fragment);
  });
  if (needed.some(function(change) { return change.selector === '.posts'; }) && $('head meta[name="cms-generated-page"][content="true"]').length) {
    cmsUpdateGeneratedPageMetadata_($, name);
  }
  // Keep the original doctype and html attributes; legacy pages intentionally use quirks mode.
  var opening = original.match(/<html\b[^>]*>/i);
  var doctype = original.match(/^\s*(<!doctype[^>]*>)/i);
  var html = (doctype ? doctype[1] + '\n' : '') + (opening ? opening[0] : '<html>') + '\n' + $('html').html() + '</html>';
  var rendered = {path: name + '.html', html: html, expectedSha: file.sha};
  // Even unchanged selectors need the new full-page SHA when another selector changed.
  changes.forEach(function(change) { cmsCacheStagePage_(rendered, change.selector, change.fragment); });
  return rendered;
}

function cmsCreatePage_(name) {
  if (typeof cmsAssertPageName_ === 'function') cmsAssertPageName_(name, false);
  else if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid page name.');
  var context = cmsContext_();
  if (context.pages.indexOf(name) === -1) throw new Error('This tab is intentionally outside the website updater: ' + name);
  if (cmsGithubSnapshot_().entries[name + '.html']) throw new Error('Page already exists: ' + name);
  // Validate the registered source before collecting shared content or assets.
  cmsSheetRows_(name);
  if (!context.newPageTemplate) {
    var template = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, 'blank.html', BRANCH);
    if (!template || !template.content) throw new Error('Missing blank.html template.');
    context.newPageTemplate = Utilities.newBlob(Utilities.base64Decode(template.content)).getDataAsString('UTF-8');
  }
  var blank = context.newPageTemplate, $ = Cheerio.load(blank);
  var components = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'};
  var selectors = Object.keys(components).map(function(key) { return components[key]; }).concat(['.posts']);
  selectors.forEach(function(selector) {
    if ($(selector).length !== 1) throw new Error('New-page template must contain exactly one ' + selector + '.');
  });
  $('body').attr('data-page', name);
  var shared = context.newPageSharedFragments || (context.newPageSharedFragments = {});
  Object.keys(components).forEach(function(component) {
    if (!Object.prototype.hasOwnProperty.call(shared, component)) shared[component] = cmsRenderRows_(component);
    $(components[component]).empty().append(shared[component]);
  });
  var fragment = cmsRenderRows_(name);
  $('.posts').empty().append(fragment);
  selectors.forEach(function(selector) {
    if ($(selector).length !== 1) throw new Error('New-page output must contain exactly one ' + selector + '.');
  });
  if (!$('head meta[name="cms-generated-page"]').length) $('head').append('<meta name="cms-generated-page">');
  $('head meta[name="cms-generated-page"]').attr('content', 'true');
  cmsUpdateGeneratedPageMetadata_($, name);
  var opening = blank.match(/<html\b[^>]*>/i), doctype = blank.match(/^\s*(<!doctype[^>]*>)/i);
  var file = {path: name + '.html', expectedAbsent: true, html: (doctype ? doctype[1] + '\n' : '') + (opening ? opening[0] : '<html>') + '\n' + $('html').html() + '</html>'};
  cmsCacheStagePage_(file, '.posts', fragment);
  Object.keys(components).forEach(function(component) { cmsCacheStagePage_(file, components[component], shared[component]); });
  return file;
}

function cmsUpdateGeneratedPageMetadata_($, name) {
  var title = '';
  $('.posts h1').each(function(index, element) {
    if (!title) title = $(element).text().trim();
  });
  if (title) {
    if (!$('head title').length) $('head').append('<title></title>');
    $('head title').text(title);
    if (!$('head meta[property="og:title"]').length) $('head').append('<meta property="og:title">');
    $('head meta[property="og:title"]').attr('content', title);
    if (!$('head meta[name="twitter:title"], head meta[property="twitter:title"]').length) $('head').append('<meta name="twitter:title">');
    $('head meta[name="twitter:title"], head meta[property="twitter:title"]').attr('content', title);
  }
  if (!$('head meta[property="og:url"]').length) $('head').append('<meta property="og:url">');
  $('head meta[property="og:url"]').attr('content', PREVIEW_SITE_URL + '/' + name + '.html');
}

function addNewpage() {
  return cmsRun_(function(context) {
    var entries = cmsGithubSnapshot_().entries;
    var files = context.pages.filter(function(name) { return !entries[name + '.html']; }).map(function(name) { return cmsCreatePage_(name); });
    return cmsPublish_(files, 'Add missing registered preview pages');
  }, 'addNewpage');
}

// Retained menu name compatibility. This never touches the production repository.
function makeNewpage() { return addNewpage(); }
