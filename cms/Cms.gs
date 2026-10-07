// Menu actions are the only workbook entrypoints. All writes require the preview guard.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Custom menu')
    .addItem('Update the current page', 'update_webpage')
    .addItem('Update shared components', 'update_shared_components')
    .addItem('Update all registered pages', 'update_all_webpages')
    .addItem('Refresh linked assets on current page', 'refresh_current_assets')
    .addItem('Add missing registered pages', 'addNewpage')
    .addToUi();
}

function cmsRun_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another preview update is running. Try again after it finishes.');
  try {
    CMS_CONTEXT_ = null;
    var context = cmsContext_();
    cmsGithubSnapshot_();
    var result = work(context);
    context.spreadsheet.toast(result.changed ? 'Preview updated: ' + result.pages + ' page(s).' : 'No changes to publish.', 'Website CMS', 6);
    return result;
  } catch (error) {
    console.error('Preview update failed: ' + error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function update_webpage() {
  return cmsRun_(function(context) { return cmsUpdateTab_(context.spreadsheet.getActiveSheet().getName(), false); });
}

function refresh_current_assets() {
  return cmsRun_(function(context) {
    context.refreshAssets = true;
    return cmsUpdateTab_(context.spreadsheet.getActiveSheet().getName(), false);
  });
}

function update_all_webpages() {
  return cmsRun_(function(context) {
    var files = context.pages.map(function(name) { return cmsRenderPage_(name); });
    return cmsPublish_(files, 'Update all registered preview pages from Google Sheets');
  });
}

function update_shared_components() {
  return cmsRun_(function(context) {
    var shared = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'};
    var fragments = {};
    Object.keys(shared).forEach(function(name) { fragments[name] = cmsRenderRows_(name); });
    var files = context.pages.concat(['index']).map(function(name) {
      var file = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, name + '.html', BRANCH);
      if (!file || !file.content) throw new Error('Missing page template: ' + name);
      var original = Utilities.newBlob(Utilities.base64Decode(file.content)).getDataAsString('UTF-8');
      var $ = Cheerio.load(original);
      $('body').attr('data-page', name);
      Object.keys(shared).forEach(function(component) {
        if ($(shared[component]).length !== 1) throw new Error('Missing shared target: ' + component + ' in ' + name);
        $(shared[component]).empty().append(fragments[component]);
      });
      var opening = original.match(/<html\b[^>]*>/i);
      var doctype = original.match(/^\s*(<!doctype[^>]*>)/i);
      return {path: name + '.html', expectedSha: file.sha, html: (doctype ? doctype[1] + '\n' : '') + (opening ? opening[0] : '<html>') + '\n' + $('html').html() + '</html>'};
    });
    return cmsPublish_(files, 'Update all preview shared components from Google Sheets');
  });
}

function cmsUpdateTab_(name) {
  var context = cmsContext_();
  if (context.pages.indexOf(name) !== -1) return cmsPublish_([cmsRenderPage_(name)], 'Update preview page: ' + name);
  var shared = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'};
  if (!shared[name]) throw new Error('This tab is intentionally outside the website updater: ' + name);
  var fragment = cmsRenderRows_(name);
  var files = context.pages.concat(['index']).map(function(page) {
    return cmsReplaceFragment_(page, shared[name], fragment);
  });
  return cmsPublish_(files, 'Update preview shared component: ' + name);
}

function cmsRenderRows_(name) {
  var rows = cmsSheetRows_(name);
  var independent = cmsContext_().pages.indexOf(name) !== -1;
  var html = '';
  for (var i = 1; i < rows.values.length; i++) {
    var row = rows.values[i];
    if (independent && !row[0]) break; // Page tabs use blank Lab as their explicit content terminator.
    if (!independent && !row[2]) continue; // Shared components contain intentional blank Lab wrapper rows.
    PreElement = i === 1 ? 'START' : rows.values[i - 1];
    PostElement = i + 1 >= rows.values.length || !rows.values[i + 1][0] ? 'END' : rows.values[i + 1];
    try {
      html += appendSingle(row.slice(), rows.rich[i]);
    } catch (error) {
      throw new Error(name + '!row ' + (i + 1) + ': ' + error.message);
    }
  }
  return html;
}

function cmsRenderPage_(name) {
  return cmsReplaceFragment_(name, '.posts', cmsRenderRows_(name));
}

function cmsReplaceFragment_(name, selector, fragment) {
  var file = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, name + '.html', BRANCH);
  if (!file || !file.content) throw new Error('Missing page template: ' + name + '.html');
  var original = Utilities.newBlob(Utilities.base64Decode(file.content)).getDataAsString('UTF-8');
  var $ = Cheerio.load(original);
  $('body').attr('data-page', name);
  if ($(selector).length !== 1) throw new Error('Template must contain exactly one ' + selector + ': ' + name);
  $(selector).empty().append(fragment);
  // Keep the original doctype and html attributes; legacy pages intentionally use quirks mode.
  var opening = original.match(/<html\b[^>]*>/i);
  var doctype = original.match(/^\s*(<!doctype[^>]*>)/i);
  var html = (doctype ? doctype[1] + '\n' : '') + (opening ? opening[0] : '<html>') + '\n' + $('html').html() + '</html>';
  return {path: name + '.html', html: html, expectedSha: file.sha};
}

function addNewpage() {
  return cmsRun_(function(context) {
    var template = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, 'blank.html', BRANCH);
    if (!template) throw new Error('Missing blank.html template.');
    var blank = Utilities.newBlob(Utilities.base64Decode(template.content)).getDataAsString('UTF-8');
    var entries = cmsGithubSnapshot_().entries;
    var files = context.pages.filter(function(name) { return !entries[name + '.html']; }).map(function(name) {
      var $ = Cheerio.load(blank);
      $('body').attr('data-page', name);
      ['header', 'footer', 'sidebar', 'mobilemenu'].forEach(function(component) {
        var selector = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'}[component];
        if ($(selector).length !== 1) throw new Error('New-page template is incomplete: ' + selector);
        $(selector).empty().append(cmsRenderRows_(component));
      });
      $('.posts').empty().append(cmsRenderRows_(name));
      return {path: name + '.html', html: '<html>\n' + $('html').html() + '</html>'};
    });
    return cmsPublish_(files, 'Add missing registered preview pages');
  });
}

// Retained menu name compatibility. This never touches the production repository.
function makeNewpage() { return addNewpage(); }
