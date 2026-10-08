// Read the workbook once per execution. No service calls run at global initialization.
var CMS_CONTEXT_ = null;
var PubRepDict = null;
var PreElement = 'START';
var PostElement = 'END';
var MDLINKREG = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

function cmsContext_() {
  if (CMS_CONTEXT_) return CMS_CONTEXT_;
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== PREVIEW_SPREADSHEET_ID) {
    throw new Error('This CMS is restricted to the preview workbook.');
  }
  var context = {spreadsheet: spreadsheet, sheets: {}, assets: {}, pendingAssets: [], refreshAssets: false};
  CMS_CONTEXT_ = context;
  context.parameters = {};
  cmsSheetRows_('parameters').values.slice(1).forEach(function(row) {
    var name = String(row[0] || '').trim();
    if (!name) return;
    context.parameters[name] = ['Lab', 'Language', 'Function'].concat(row.slice(1).map(function(value) {
      return String(value || '').replace(/ \(.+\)/, '').trim();
    }));
  });
  context.pages = getIndependentPages();
  Object.defineProperty(context, 'journals', {enumerable: true, get: function() { return get_publications(); }});
  Object.defineProperty(context, 'members', {enumerable: true, get: function() { return getMembers(); }});
  return context;
}

function cmsSheetRows_(name) {
  var context = CMS_CONTEXT_ || cmsContext_();
  if (context.sheets[name]) return context.sheets[name];
  var sheet = context.spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('Missing CMS tab: ' + name);
  var range = sheet.getDataRange();
  context.sheetReads = (context.sheetReads || 0) + 1;
  return context.sheets[name] = {sheet: sheet, values: range.getDisplayValues(), rich: range.getRichTextValues()};
}

function getIndependentPages() {
  var context = CMS_CONTEXT_;
  if (!context) return cmsContext_().pages;
  var seen = {};
  return cmsSheetRows_('item list').values.slice(1).map(function(row) {
    return String(row[4] || '').trim();
  }).filter(function(name) {
    if (!name || seen[name]) return false;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid page name in item list.');
    if (typeof cmsAssertPageName_ === 'function') cmsAssertPageName_(name, false);
    seen[name] = true;
    return true;
  });
}

function get_publications() {
  if (!CMS_CONTEXT_) return cmsContext_().journals;
  if (CMS_CONTEXT_._journals) return CMS_CONTEXT_._journals;
  var journals = {};
  cmsSheetRows_('item list').values.slice(1).forEach(function(row) {
    if (row[8] && row[9]) journals[row[8]] = row[9];
  });
  return CMS_CONTEXT_._journals = journals;
}

function getMembers() {
  if (!CMS_CONTEXT_) return cmsContext_().members;
  var context = CMS_CONTEXT_;
  if (context._members) return context._members;
  var aliases = [];
  ['people', 'alumni'].forEach(function(name) {
    cmsSheetRows_(name).values.slice(1).forEach(function(row) {
      var kind = row[2];
      if (kind !== 'Member') return; // Preserve the current site's active-member highlighting policy.
      var headers = context.parameters[kind] || [];
      var index = headers.indexOf('/* Name in publication');
      var value = String(row[index] || '');
      if (value && value.indexOf('/*') !== 0) aliases = aliases.concat(value.split(/,\s*/));
    });
  });
  return context._members = aliases.filter(function(value, index, list) { return value && list.indexOf(value) === index; });
}
