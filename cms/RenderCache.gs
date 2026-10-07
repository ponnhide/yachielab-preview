/** Disposable render cache. Source tabs remain authoritative; no cache writes
 * happen until the complete GitHub publish has succeeded (including no-change).
 * Bump this version after changing Renderer, SheetStyles, Showdown or HTML normalization.
 */
var CMS_CACHE_RENDERER_VERSION_ = '2026-10-08.2';
var CMS_CACHE_SHEET_ = '_cms_cache';
var CMS_CACHE_TTL_MS_ = 6 * 60 * 60 * 1000;
var CMS_CACHE_CELL_LIMIT_ = 40000;
var CMS_CACHE_MAX_RECORDS_ = 3000;
var CMS_CACHE_COLUMNS_ = ['Type', 'Key', 'Source', 'SourceId', 'Row', 'Fingerprint', 'RendererVersion', 'GeneratedAt', 'HTML', 'Dependencies', 'SHA'];

function cmsGitBlobSha_(content) {
  var bytes = typeof content === 'string' ? cmsUtf8Bytes_(content) : Array.prototype.slice.call(content || []);
  return cmsSha1Hex_(cmsUtf8Bytes_('blob ' + bytes.length + '\x00').concat(bytes));
}

function cmsCacheHash_(text) {
  return cmsSha256Hex_(cmsUtf8Bytes_(String(text)));
}

function cmsCacheCanonical_(value) {
  if (Array.isArray(value)) return '[' + value.map(cmsCacheCanonical_).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + cmsCacheCanonical_(value[key]);
  }).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
}

function cmsCacheStats_(context) {
  if (!context.cacheStats) context.cacheStats = {};
  ['rowsRendered', 'rowsReused', 'pagesSkipped', 'fragmentsSkipped', 'rowsUncached', 'cacheReadErrors', 'cacheWriteErrors', 'corruptRecords'].forEach(function(key) {
    if (typeof context.cacheStats[key] !== 'number') context.cacheStats[key] = 0;
  });
  return context.cacheStats;
}

function cmsCacheRowKey_(sourceId, fingerprint) { return 'row:' + encodeURIComponent(sourceId) + ':' + fingerprint; }
function cmsCachePageKey_(page, selector) { return 'page:' + encodeURIComponent(page) + ':' + encodeURIComponent(selector); }

function cmsCacheDependencies_(html) {
  var text = typeof previewPrepareHtml_ === 'function' ? previewPrepareHtml_(html) : html;
  text = String(text).replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'").replace(/&amp;/g, '&');
  var paths = {};
  function add(value) {
    value = String(value || '').trim().split(/[?#]/)[0];
    var site = typeof PREVIEW_SITE_URL === 'string' ? PREVIEW_SITE_URL : '';
    if (site && value.indexOf(site + '/') === 0) value = value.slice(site.length + 1);
    try { value = decodeURIComponent(value); } catch (error) { return; }
    value = value.replace(/^\.\//, '').replace(/^\//, '');
    if (/^(?:img|img_new|pdf)\//.test(value) && !/(?:^|\/)\.\.(?:\/|$)|[\\\x00-\x1f]/.test(value)) paths[value] = true;
  }
  var match;
  var attributes = /\b(src|href|poster|srcset)\s*=\s*(["'])([\s\S]*?)\2/gi;
  while ((match = attributes.exec(text))) {
    if (match[1].toLowerCase() === 'srcset') match[3].split(',').forEach(function(value) { add(value.trim().split(/\s+\d/)[0]); });
    else add(match[3]);
  }
  var styles = /url\(\s*(["']?)([^)]*?)\1\s*\)/gi;
  while ((match = styles.exec(text))) add(match[2]);
  return Object.keys(paths).sort();
}

function cmsCachePendingSha_(context, path) {
  var pending = context.pendingAssets.filter(function(asset) { return asset.path === path; })[0];
  if (!pending) return '';
  if (!context.cacheAssetShas) context.cacheAssetShas = {};
  var cached = context.cacheAssetShas[path];
  if (!cached || cached.content !== pending.content) {
    cached = context.cacheAssetShas[path] = {content: pending.content, sha: cmsGitBlobSha_(Utilities.base64Decode(pending.content))};
  }
  return cached.sha;
}

function cmsCacheAssetSha_(context, path, result) {
  if (result && result.assetShas && result.assetShas[path]) return result.assetShas[path];
  var pending = cmsCachePendingSha_(context, path);
  if (pending) return pending;
  var entry = cmsGithubSnapshot_().entries[path];
  return entry && entry.type === 'blob' ? entry.sha : '';
}

function cmsCacheManifest_(context, html, result) {
  return cmsCacheDependencies_(html).map(function(path) { return {path: path, sha: cmsCacheAssetSha_(context, path, result)}; });
}

function cmsCacheValidManifest_(html, dependencies) {
  if (!Array.isArray(dependencies)) return false;
  var paths = cmsCacheDependencies_(html);
  if (paths.length !== dependencies.length) return false;
  return dependencies.every(function(dependency, index) {
    return dependency && dependency.path === paths[index] && /^[a-f0-9]{40}$/.test(dependency.sha || '');
  });
}

function cmsCacheParse_(cells) {
  var record = {
    type: String(cells[0] || ''), key: String(cells[1] || ''), source: String(cells[2] || ''), sourceId: String(cells[3] || ''),
    row: Number(cells[4] || 0), fingerprint: String(cells[5] || ''), version: String(cells[6] || ''),
    generatedAt: cells[7] instanceof Date ? cells[7].toISOString() : String(cells[7] || ''), html: String(cells[8] || ''), sha: String(cells[10] || '')
  };
  if (!record.source || !record.version || !/^[a-f0-9]{64}$/.test(record.fingerprint) || !/^[a-f0-9]{40}$/.test(record.sha)) return null;
  var timestamp = Date.parse(record.generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000) return null;
  try { record.dependencies = JSON.parse(String(cells[9] || '[]')); } catch (error) { return null; }
  if (record.type === 'row') {
    if (!record.sourceId || !Number.isInteger(record.row) || record.row < 2 || record.key !== cmsCacheRowKey_(record.sourceId, record.fingerprint)) return null;
    if (record.html.length > CMS_CACHE_CELL_LIMIT_ || cmsGitBlobSha_(record.html) !== record.sha || !cmsCacheValidManifest_(record.html, record.dependencies)) return null;
  } else if (record.type === 'page') {
    if (!record.sourceId || record.key !== cmsCachePageKey_(record.source, record.sourceId) || record.html !== '' || !Array.isArray(record.dependencies) || record.dependencies.length) return null;
  } else return null;
  return record;
}

function cmsCacheCells_(record) {
  return [record.type, record.key, record.source, record.sourceId, record.row || '', record.fingerprint, record.version,
    record.generatedAt, record.html, JSON.stringify(record.dependencies || []), record.sha];
}

function cmsCacheStore_() {
  var context = cmsContext_();
  cmsCacheStats_(context);
  if (context.renderCache) return context.renderCache;
  var cache = context.renderCache = {records: {}, stagedRows: {}, stagedPages: {}, sources: {}, oldCells: null, oldRows: 0, reset: false, sheet: null};
  try {
    cache.sheet = context.spreadsheet.getSheetByName(CMS_CACHE_SHEET_);
    if (!cache.sheet) return cache;
    cache.oldRows = typeof cache.sheet.getLastRow === 'function' ? cache.sheet.getLastRow() : 0;
    if (cache.oldRows > CMS_CACHE_MAX_RECORDS_ * 4 + 1) throw new Error('Cache table is too large');
    var range = cache.sheet.getDataRange();
    context.sheetReads = (context.sheetReads || 0) + 1;
    var values = typeof range.getValues === 'function' ? range.getValues() : range.getDisplayValues();
    cache.oldRows = values.length;
    cache.oldCells = values;
    if (!values.length || values[0].slice(0, CMS_CACHE_COLUMNS_.length).join('\x00') !== CMS_CACHE_COLUMNS_.join('\x00')) throw new Error('Cache schema is invalid');
    values.slice(1).forEach(function(cells) {
      if (!cells.some(function(value) { return value !== '' && value !== null; })) return;
      var record = cmsCacheParse_(cells);
      if (!record || cache.records[record.key]) { context.cacheStats.corruptRecords++; return; }
      cache.records[record.key] = record;
    });
  } catch (error) {
    cache.records = {};
    cache.reset = true;
    context.cacheStats.cacheReadErrors++;
  }
  return cache;
}

function cmsCacheRich_(value) {
  if (!value || typeof value.getRuns !== 'function') return null;
  return value.getRuns().map(function(run) {
    var style = run.getTextStyle(), color = '';
    try { var foreground = style.getForegroundColorObject(); color = foreground ? foreground.asRgbColor().asHexString() : ''; }
    catch (error) { /* Match the renderer's treatment of unset/theme foregrounds. */ }
    return {text: run.getText(), bold: !!style.isBold(), italic: !!style.isItalic(), color: color};
  });
}

function cmsCacheFingerprint_(context, sourceId, row, richrow) {
  var name = String(row[2] || ''), parameters = context.parameters[name] || null;
  var header = parameters || [];
  if (header[0] !== 'Lab') header = ['Lab', 'Language', 'Function'].concat(header);
  // Keep this list aligned with appendSingle: only these cells consume native
  // rich-text formatting. Other cells still participate through display values.
  var richKeys = ['/* Text', '/* Name', '/* Related info', '/* Biosketch', '/* Former affiliation', '/* Start date', '/* End date', '/* Current position'];
  var rich = {};
  header.forEach(function(key, index) {
    key = String(key || '').replace(/ \(.+\)/, '');
    var text = String(row[index] || '');
    // rendererRichText_ never reads native formatting for empty/placeholders.
    // These are common in citation rows; avoid a service call per unused cell.
    if (richKeys.indexOf(key) >= 0 && text && text.trim().indexOf('/*') !== 0) rich[index] = cmsCacheRich_(richrow && richrow[index]);
  });
  var input = {version: CMS_CACHE_RENDERER_VERSION_, source: sourceId, row: row, rich: rich, parameters: parameters};
  // Check linked source assets before deciding whether the row HTML is reusable.
  // A stable Sheet URL can point to new bytes without any cell edit.
  if (typeof cmsAssetRowFingerprint_ === 'function') {
    var alumniHeading = name === 'Alumni' && Object.keys(rich).some(function(index) {
      return String(header[index]).replace(/ \(.+\)/, '') === '/* Name' && (rich[index] || []).some(function(run) { return run.bold; });
    });
    input.assets = cmsAssetRowFingerprint_(row, parameters, {alumniHeading: alumniHeading});
  }
  if (name === 'Publication') {
    input.members = (context.members || []).slice().sort();
    input.journals = context.journals || {};
  }
  if (name === 'Alumni') { input.previous = PreElement; input.next = PostElement; }
  return cmsCacheHash_(cmsCacheCanonical_(input));
}

// Old row HTML is safe to reuse only while the last successfully published
// fragment still belongs to the current page blob. This also prevents rollback
// when GitHub succeeds but saving the refreshed Sheet cache fails.
function cmsCacheSourceState_(context, cache, name) {
  var selectors = {header: '#normal_header', footer: 'footer', sidebar: 'aside', mobilemenu: '#mobile-menu'};
  var independent = context.pages.indexOf(name) !== -1;
  var pages = independent ? [name] : context.pages.concat(['index']);
  var selector = independent ? '.posts' : selectors[name];
  var entries, reusable = !!selector, changed = false;
  pages.forEach(function(page) {
    var record = cache.records[cmsCachePageKey_(page, selector)];
    // A first seed cannot reuse rows anyway. Avoid repository reads until there
    // is successfully published cache state whose SHA needs verification.
    if (!record) { reusable = false; return; }
    if (!entries) entries = cmsGithubSnapshot_().entries;
    var entry = entries[page + '.html'];
    if (record.version !== CMS_CACHE_RENDERER_VERSION_ || !entry || entry.type !== 'blob' || record.sha !== entry.sha) reusable = false;
    if (!entry || entry.type !== 'blob' || record.sha !== entry.sha) changed = true;
  });
  return {reusable: reusable, refreshData: changed || !!context.cacheStats.cacheReadErrors};
}

function cmsCacheRenderRows_(name) {
  if (name === CMS_CACHE_SHEET_) throw new Error('The performance cache is not a website content tab.');
  var context = cmsContext_(), cache = cmsCacheStore_(), rows = cmsSheetRows_(name);
  var sourceId = String(context.spreadsheet.getId()) + ':' + (typeof rows.sheet.getSheetId === 'function' ? rows.sheet.getSheetId() : name);
  var source = cache.sources[sourceId] || (cache.sources[sourceId] = {name: name, keys: {}});
  var independent = context.pages.indexOf(name) !== -1, html = '';
  var sourceState = cmsCacheSourceState_(context, cache, name);
  for (var index = 1; index < rows.values.length; index++) {
    var row = rows.values[index], kind = String(row[2] || '');
    if (independent && !row[0]) break;
    if (!independent && !row[2]) continue;
    PreElement = index === 1 ? 'START' : rows.values[index - 1];
    PostElement = index + 1 >= rows.values.length || !rows.values[index + 1][0] ? 'END' : rows.values[index + 1];
    try {
      if (!kind || kind === 'Pass') { html += appendSingle(row.slice(), rows.rich[index]); continue; }
      var fingerprint = cmsCacheFingerprint_(context, sourceId, row, rows.rich[index]);
      var key = cmsCacheRowKey_(sourceId, fingerprint);
      var record = cache.stagedRows[key] || cache.records[key];
      var timed = kind === 'Publication' || /https:\/\/drive\.google\.com\//i.test(cmsCacheCanonical_(row));
      var forced = context.refreshAssets || context.forceRegenerate || (context.refreshData && kind === 'Publication');
      var reusable = sourceState.reusable && !forced && record && record.type === 'row' && record.version === CMS_CACHE_RENDERER_VERSION_ &&
        (!timed || Date.now() - Date.parse(record.generatedAt) < CMS_CACHE_TTL_MS_) && record.dependencies.every(function(dependency) {
          return cmsCacheAssetSha_(context, dependency.path) === dependency.sha;
        });
      if (reusable) {
        context.cacheStats.rowsReused++;
        record = Object.assign({}, record, {source: name, row: index + 1});
      } else {
        var oldRefreshData = context.refreshData;
        var rendered;
        try {
          if (kind === 'Publication' && sourceState.refreshData) context.refreshData = true;
          rendered = appendSingle(row.slice(), rows.rich[index]);
        } finally { context.refreshData = oldRefreshData; }
        context.cacheStats.rowsRendered++;
        if (typeof cmsVersionAssetHtml_ === 'function') rendered = cmsVersionAssetHtml_(rendered);
        record = {type: 'row', key: key, source: name, sourceId: sourceId, row: index + 1, fingerprint: fingerprint,
          version: CMS_CACHE_RENDERER_VERSION_, generatedAt: new Date().toISOString(), html: rendered,
          dependencies: cmsCacheManifest_(context, rendered), sha: cmsGitBlobSha_(rendered)};
      }
      html += record.html;
      if (record.html.length <= CMS_CACHE_CELL_LIMIT_ && JSON.stringify(record.dependencies).length <= CMS_CACHE_CELL_LIMIT_) {
        source.keys[key] = true;
        cache.stagedRows[key] = record;
      } else context.cacheStats.rowsUncached++;
    } catch (error) { throw new Error(name + '!row ' + (index + 1) + ': ' + error.message); }
  }
  return html;
}

function cmsCacheCanSkipFragment_(pageName, selector, fragment) {
  var context = cmsContext_(), cache = cmsCacheStore_();
  if (context.forceRegenerate) return false;
  var record = cache.records[cmsCachePageKey_(pageName, selector)];
  var entry = cmsGithubSnapshot_().entries[pageName + '.html'];
  var match = record && record.type === 'page' && record.version === CMS_CACHE_RENDERER_VERSION_ && entry && entry.type === 'blob' &&
    record.sha === entry.sha && record.fingerprint === cmsCacheHash_(String(fragment));
  if (match) context.cacheStats.fragmentsSkipped++;
  return !!match;
}

function cmsCacheStagePage_(file, selector, fragment) {
  if (!file || !/^[a-zA-Z0-9_-]+\.html$/.test(file.path)) throw new Error('Invalid page cache target.');
  var cache = cmsCacheStore_(), pageName = file.path.slice(0, -5);
  var key = cmsCachePageKey_(pageName, selector);
  cache.stagedPages[key] = {type: 'page', key: key, source: pageName, sourceId: selector, row: 0,
    fingerprint: cmsCacheHash_(String(fragment)), version: CMS_CACHE_RENDERER_VERSION_, generatedAt: new Date().toISOString(),
    html: '', dependencies: [], sha: '', file: file};
}

function cmsCacheCommit_(result) {
  var context = cmsContext_(), stats = cmsCacheStats_(context), cache = context.renderCache;
  if (!result || typeof result.changed !== 'boolean') throw new Error('Performance cache requires a successful publish result.');
  if (!cache) { result.cacheSaved = true; return result; }
  try {
    var records = {};
    Object.keys(cache.records).forEach(function(key) {
      var record = cache.records[key], source = cache.sources[record.sourceId];
      if (record.type !== 'row' || !source || source.keys[key]) records[key] = record;
    });
    Object.keys(cache.stagedRows).forEach(function(key) {
      var record = Object.assign({}, cache.stagedRows[key]);
      record.dependencies = cmsCacheManifest_(context, record.html, result);
      if (cmsCacheValidManifest_(record.html, record.dependencies)) records[key] = record;
      else { delete records[key]; stats.rowsUncached++; }
    });
    Object.keys(cache.stagedPages).forEach(function(key) {
      var staged = cache.stagedPages[key], path = staged.file.path;
      // Publisher reports the SHA after preview HTML normalization. Never record
      // an optimistic pre-publish SHA as successfully deployed state.
      var sha = result.pageShas && result.pageShas[path];
      if (!sha && result.changed === false) {
        var existing = cmsGithubSnapshot_().entries[path];
        sha = existing && existing.sha;
      }
      var publishedHtml = typeof previewPrepareHtml_ === 'function' ? previewPrepareHtml_(staged.file.html) : staged.file.html;
      if (typeof cmsVersionAssetHtml_ === 'function') publishedHtml = cmsVersionAssetHtml_(publishedHtml);
      if (!/^[a-f0-9]{40}$/.test(sha || '') || cmsGitBlobSha_(publishedHtml) !== sha) { delete records[key]; return; }
      var record = Object.assign({}, staged, {sha: sha});
      delete record.file;
      records[key] = record;
    });
    var list = Object.keys(records).map(function(key) { return records[key]; });
    if (list.length > CMS_CACHE_MAX_RECORDS_) {
      list.sort(function(first, second) { return Date.parse(second.generatedAt) - Date.parse(first.generatedAt); });
      list = list.slice(0, CMS_CACHE_MAX_RECORDS_);
    }
    list.sort(function(first, second) { return first.type.localeCompare(second.type) || first.source.localeCompare(second.source) || first.row - second.row || first.key.localeCompare(second.key); });
    var cells = [CMS_CACHE_COLUMNS_.slice()].concat(list.map(cmsCacheCells_));
    if (!cache.reset && cache.oldCells && cmsCacheCanonical_(cache.oldCells) === cmsCacheCanonical_(cells)) { result.cacheSaved = true; return result; }
    var created = false;
    if (!cache.sheet) {
      var spreadsheet = context.spreadsheet;
      var activeSheet = typeof spreadsheet.getActiveSheet === 'function' ? spreadsheet.getActiveSheet() : null;
      try {
        cache.sheet = typeof spreadsheet.getNumSheets === 'function' ?
          spreadsheet.insertSheet(CMS_CACHE_SHEET_, spreadsheet.getNumSheets()) : spreadsheet.insertSheet(CMS_CACHE_SHEET_);
        created = true;
      } finally {
        // insertSheet selects its new tab. Keep the user's content tab active.
        if (activeSheet && typeof spreadsheet.setActiveSheet === 'function') spreadsheet.setActiveSheet(activeSheet);
      }
    }
    if (cache.reset && typeof cache.sheet.clearContents === 'function') cache.sheet.clearContents();
    var count = cache.reset ? cells.length : Math.max(cells.length, cache.oldRows);
    while (cells.length < count) cells.push(CMS_CACHE_COLUMNS_.map(function() { return ''; }));
    if (typeof cache.sheet.getMaxRows === 'function' && cache.sheet.getMaxRows() < count) cache.sheet.insertRowsAfter(cache.sheet.getMaxRows(), count - cache.sheet.getMaxRows());
    if (typeof cache.sheet.getMaxColumns === 'function' && cache.sheet.getMaxColumns() < CMS_CACHE_COLUMNS_.length) cache.sheet.insertColumnsAfter(cache.sheet.getMaxColumns(), CMS_CACHE_COLUMNS_.length - cache.sheet.getMaxColumns());
    cache.sheet.getRange(1, 1, count, CMS_CACHE_COLUMNS_.length).setValues(cells);
    if (created) {
      if (typeof cache.sheet.setFrozenRows === 'function') cache.sheet.setFrozenRows(1);
      var header = cache.sheet.getRange(1, 1, 1, CMS_CACHE_COLUMNS_.length);
      if (typeof header.setBackground === 'function') header.setBackground('#f1f3f4');
    }
    result.cacheSaved = true;
  } catch (error) {
    stats.cacheWriteErrors++;
    result.cacheSaved = false;
    result.cacheWarning = 'Website published; performance cache could not be saved. The next update will regenerate affected rows.';
    if (typeof console !== 'undefined' && console.warn) console.warn(result.cacheWarning);
  }
  return result;
}
