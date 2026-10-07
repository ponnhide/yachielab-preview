/** Private source ownership/validators. Never publish this table or its URLs. */
var CMS_ASSET_REGISTRY_SHEET_ = '_cms_assets';
var CMS_ASSET_REGISTRY_COLUMNS_ = ['SourceKey', 'Identity', 'SourceURL', 'Path', 'BlobSHA', 'ETag', 'LastModified', 'SourceModifiedAt', 'CheckedAt', 'RecordHash'];

function cmsAssetStats_() {
  var context = cmsContext_();
  if (!context.assetStats) context.assetStats = {};
  ['checked', 'downloaded', 'notModified', 'staged', 'registryReads', 'registryWrites', 'registryErrors'].forEach(function(key) {
    if (typeof context.assetStats[key] !== 'number') context.assetStats[key] = 0;
  });
  return context.assetStats;
}

function cmsAssetSource_(value) {
  var drive = value.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)(?:[/?#]|$)/i);
  if (drive) return {identity: 'drive:' + drive[1], sourceUrl: value, driveId: drive[1]};
  var match = value.match(/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i);
  if (!match) return null;
  var host = match[2].toLowerCase(), query = match[4] || '';
  var dropbox = /^(?:www\.|dl\.)?dropbox\.com$|^dl\.dropboxusercontent\.com$/.test(host);
  if (dropbox) query = query.split('&').filter(function(part) {
    var key; try { key = decodeURIComponent(part.split('=')[0]); } catch (error) { key = part.split('=')[0]; }
    return key !== 'dl' && key !== 'raw';
  }).filter(function(part) { return part !== ''; }).join('&');
  // Keep authorization/signature query values and their ordering intact.
  var canonical = match[1].toLowerCase() + '://' + host + (match[3] || '/') + (query ? '?' + query : '');
  return {identity: 'http:' + canonical, sourceUrl: canonical, downloadUrl: dropbox ? canonical + (query ? '&' : '?') + 'dl=1' : canonical};
}

function cmsAssetKey_(identity) { return cmsCacheHash_(identity); }
function cmsAssetRecordCells_(record) {
  return [record.key, record.identity, record.sourceUrl, record.path, record.sha, record.etag || '', record.lastModified || '', record.sourceModifiedAt || '', record.checkedAt];
}
function cmsAssetRecordHash_(record) { return cmsCacheHash_(JSON.stringify(cmsAssetRecordCells_(record))); }

function cmsAssetRegistry_() {
  var context = cmsContext_(), stats = cmsAssetStats_();
  if (context.assetRegistry) return context.assetRegistry;
  var store = context.assetRegistry = {records: {}, staged: {}, prepared: {}, owners: {}, sheet: null, oldCells: null, oldRows: 0, reset: false};
  try {
    store.sheet = context.spreadsheet.getSheetByName(CMS_ASSET_REGISTRY_SHEET_);
    if (!store.sheet) return store;
    if (typeof store.sheet.getLastRow === 'function' && store.sheet.getLastRow() > 5001) throw new Error('Asset registry exceeds its capacity.');
    var range = store.sheet.getDataRange();
    context.sheetReads = (context.sheetReads || 0) + 1; stats.registryReads++;
    var values = typeof range.getValues === 'function' ? range.getValues() : range.getDisplayValues();
    store.oldCells = values; store.oldRows = values.length;
    if (!values.length || values[0].slice(0, CMS_ASSET_REGISTRY_COLUMNS_.length).join('\x00') !== CMS_ASSET_REGISTRY_COLUMNS_.join('\x00')) throw new Error('Asset registry schema is invalid.');
    values.slice(1).forEach(function(cells) {
      if (!cells.some(function(value) { return value !== '' && value !== null; })) return;
      var record = {key: String(cells[0] || ''), identity: String(cells[1] || ''), sourceUrl: String(cells[2] || ''), path: String(cells[3] || ''), sha: String(cells[4] || ''),
        etag: String(cells[5] || ''), lastModified: String(cells[6] || ''), sourceModifiedAt: String(cells[7] || ''), checkedAt: cells[8] instanceof Date ? cells[8].toISOString() : String(cells[8] || '')};
      var source = cmsAssetSource_(record.sourceUrl);
      var valid = source && source.identity === record.identity && record.key === cmsAssetKey_(record.identity) && /^[a-f0-9]{40}$/.test(record.sha) &&
        previewWritablePath_(record.path) && /^(?:img|pdf)\//.test(record.path) && record.path.indexOf('--' + record.key.slice(0, 12) + '.') !== -1 &&
        Number.isFinite(Date.parse(record.checkedAt)) && !/[\r\n]/.test(record.etag + record.lastModified) &&
        cells.slice(0, 9).every(function(value) { return String(value || '').length < 40000; }) && cmsAssetRecordHash_(record) === String(cells[9] || '');
      if (!valid || store.records[record.key] || (store.owners[record.path] && store.owners[record.path] !== record.key)) { stats.registryErrors++; return; }
      store.records[record.key] = record; store.owners[record.path] = record.key;
    });
  } catch (error) { store.records = {}; store.owners = {}; store.reset = true; stats.registryErrors++; }
  return store;
}

function cmsAssetsCommit_(result) {
  if (!result || typeof result.changed !== 'boolean') throw new Error('Asset registry requires a successful publish result.');
  var context = cmsContext_(), store = context.assetRegistry;
  if (!store) { result.assetsSaved = true; return result; }
  var stats = cmsAssetStats_();
  try {
    var records = Object.assign({}, store.records);
    Object.keys(store.staged).forEach(function(key) {
      var record = store.staged[key];
      // Validators belong to actual published bytes, never an optimistic upload.
      if (result.assetShas && result.assetShas[record.path] === record.sha) records[key] = record;
    });
    var list = Object.keys(records).sort().map(function(key) { var record = records[key]; return cmsAssetRecordCells_(record).concat([cmsAssetRecordHash_(record)]); });
    if (list.length > 5000) throw new Error('Asset registry exceeds its capacity.');
    if (!list.length && !store.sheet) { result.assetsSaved = true; return result; }
    var cells = [CMS_ASSET_REGISTRY_COLUMNS_.slice()].concat(list);
    if (!store.reset && store.oldCells && JSON.stringify(cells) === JSON.stringify(store.oldCells)) { result.assetsSaved = true; return result; }
    var created = false, spreadsheet = context.spreadsheet;
    if (!store.sheet) {
      var active = typeof spreadsheet.getActiveSheet === 'function' ? spreadsheet.getActiveSheet() : null;
      try {
        store.sheet = typeof spreadsheet.getNumSheets === 'function' ? spreadsheet.insertSheet(CMS_ASSET_REGISTRY_SHEET_, spreadsheet.getNumSheets()) : spreadsheet.insertSheet(CMS_ASSET_REGISTRY_SHEET_);
        created = true;
      } finally { if (active && typeof spreadsheet.setActiveSheet === 'function') spreadsheet.setActiveSheet(active); }
    }
    if (store.reset && typeof store.sheet.clearContents === 'function') store.sheet.clearContents();
    var count = store.reset ? cells.length : Math.max(cells.length, store.oldRows);
    while (cells.length < count) cells.push(CMS_ASSET_REGISTRY_COLUMNS_.map(function() { return ''; }));
    if (typeof store.sheet.getMaxRows === 'function' && store.sheet.getMaxRows() < count) store.sheet.insertRowsAfter(store.sheet.getMaxRows(), count - store.sheet.getMaxRows());
    if (typeof store.sheet.getMaxColumns === 'function' && store.sheet.getMaxColumns() < CMS_ASSET_REGISTRY_COLUMNS_.length) store.sheet.insertColumnsAfter(store.sheet.getMaxColumns(), CMS_ASSET_REGISTRY_COLUMNS_.length - store.sheet.getMaxColumns());
    store.sheet.getRange(1, 1, count, CMS_ASSET_REGISTRY_COLUMNS_.length).setValues(cells); stats.registryWrites++;
    if (created && typeof store.sheet.setFrozenRows === 'function') store.sheet.setFrozenRows(1);
    result.assetsSaved = true;
  } catch (error) {
    stats.registryErrors++; result.assetsSaved = false;
    result.assetWarning = 'Website published; private asset registry could not be saved. The next update will check sources again.';
    if (typeof console !== 'undefined' && console.warn) console.warn(result.assetWarning);
  }
  return result;
}
