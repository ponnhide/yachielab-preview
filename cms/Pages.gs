/** Normal update also enrolls a newly added content tab. Existing exclusions stay explicit. */
// Preview tab IDs present when single-action enrollment was introduced.
// Registered/shared tabs use their normal routes. A renamed legacy tab is
// never mistaken for a newly added page; native copies receive fresh IDs.
var CMS_PREEXISTING_SHEET_IDS_ = [
  891529442, 1383008879, 1892986748, 1270575022, 79350886, 588600951,
  645887040, 1208649566, 1190999410, 1497198979, 38769922, 253840139,
  143130958, 827644563, 1588263365, 497949789, 1546463026, 1758026765,
  482430529, 1944633353, 1987003837, 1230099545, 0, 1941032681,
  2131379417, 773628871, 961509489, 1517576547, 2065146884, 2115798030,
  676106234, 1171229402, 202586212, 1581970876, 638901759, 861727411,
  1141366659, 464460364, 1015195737, 1412691921, 950727283
];

function cmsAssertPageName_(name, creating) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Page name must be a flat ASCII name, at most 64 characters.');
  var reserved = ['index', 'blank', '404', 'template', 'parameters', 'header', 'footer', 'sidebar', 'mobilemenu', 'test', 'task'];
  var lower = name.toLowerCase();
  if (reserved.indexOf(lower) >= 0 || /^_cms/.test(lower) || /_old$/.test(lower)) throw new Error('This name is reserved for a template or CMS component: ' + name);
  if (creating && !/^[a-z][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Use lowercase letters, numbers, hyphens or underscores; start with a letter.');
  return name;
}

function cmsNewPageRegistrationCell_(sheet) {
  var size = Math.max(0, sheet.getMaxRows() - 1);
  if (!size) throw new Error('No free page registration cell in item list column E.');
  var range = sheet.getRange(2, 5, size, 1), values = range.getValues(), formulas = range.getFormulas();
  for (var i = 0; i < size; i++) {
    if (values[i][0] !== '' || formulas[i][0]) continue;
    var cell = sheet.getRange(i + 2, 5);
    if (!cell.getDataValidation()) return cell;
  }
  throw new Error('No unrestricted empty cell in item list column E.');
}

function cmsAssertNewPageSource_(name, sheet) {
  var book = cmsContext_().spreadsheet;
  var current = book.getSheetByName(name);
  if (!current || current.getSheetId() !== sheet.getSheetId() || sheet.getName() !== name) throw new Error('The source tab changed during the update. Restore its name and run Update again.');
}

function cmsCompletePageRegistration_(name, sheet, properties, key) {
  cmsAssertNewPageSource_(name, sheet);
  var registry = cmsContext_().spreadsheet.getSheetByName('item list');
  if (!registry) throw new Error('The page registry is missing.');
  var cell = cmsNewPageRegistrationCell_(registry);
  if (cell.getValue() !== '' || cell.getFormula() || cell.getDataValidation()) throw new Error('The page registration cell changed during the update.');
  cell.setValue(name); // Independent lists in other columns remain untouched.
  SpreadsheetApp.flush();
  try { properties.deleteProperty(key); }
  catch (error) { console.warn('Optional page registration cleanup will retry on the next update.'); }
}

function cmsClearPendingPageRegistration_(name) {
  // Successful enrollment is also finalized after an ambiguous Sheet/flush failure.
  try {
    var sheet = cmsContext_().spreadsheet.getSheetByName(name);
    if (!sheet) return;
    var properties = PropertiesService.getScriptProperties(), key = 'CMS_PENDING_PAGE_' + sheet.getSheetId();
    if (properties.getProperty(key)) properties.deleteProperty(key);
  } catch (error) { console.warn('Optional page registration cleanup will retry on the next update.'); }
}

function cmsUpdateNewTab_(name) {
  var context = cmsContext_(), book = context.spreadsheet, sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Missing CMS tab: ' + name);
  if (CMS_PREEXISTING_SHEET_IDS_.indexOf(sheet.getSheetId()) !== -1) throw new Error('This existing tab is intentionally outside the website updater: ' + name);
  cmsAssertPageName_(name, true);
  var lower = name.toLowerCase();
  if (context.pages.some(function(page) { return page.toLowerCase() === lower; }) ||
      book.getSheets().some(function(tab) { return tab.getSheetId() !== sheet.getSheetId() && tab.getName().toLowerCase() === lower; })) throw new Error('A tab or registered page already uses this name: ' + name);
  var rows = cmsSheetRows_(name).values;
  var header = (rows[0] || []).slice(0, 3).map(function(value) { return String(value).trim(); });
  var first = rows[1] || [];
  if (header.join(',') !== 'Lab,Language,Function' || !String(first[0] || '').trim() || !first[2]) throw new Error('Use the content layout: copy the template tab, rename it, enter the content, then choose Update the current page.');
  var snapshot = cmsGithubSnapshot_(), entries = snapshot.entries;
  var existing = Object.keys(entries).filter(function(path) { return path.toLowerCase() === lower + '.html'; })[0];
  var properties = PropertiesService.getScriptProperties(), key = 'CMS_PENDING_PAGE_' + sheet.getSheetId();
  var text = properties.getProperty(key), pending = null;
  if (text) {
    try { pending = JSON.parse(text); } catch (error) { throw new Error('Invalid pending page registration.'); }
    if (!pending || pending.sheetId !== sheet.getSheetId() || pending.name !== name || !/^[a-f0-9]{40}$/.test(pending.sha || '')) throw new Error('A different or invalid page registration is pending for this tab. Restore its original name before updating.');
  }
  if (existing) {
    // A marker in an unrelated public page is not proof that this tab owns it.
    if (entries[existing].type !== 'blob' || existing !== name + '.html' || !pending || pending.sheetId !== sheet.getSheetId() ||
        pending.name !== name || !/^[a-f0-9]{40}$/.test(pending.sha || '') || pending.sha !== entries[existing].sha) throw new Error('A public HTML file already uses this unregistered page name: ' + name);
    cmsCompletePageRegistration_(name, sheet, properties, key);
    context.pages.push(name);
    var updated = cmsRenderPage_(name);
    return cmsPublish_(updated ? [updated] : [], 'Update preview page: ' + name);
  }
  context.pages.push(name); // Rendering/cache rules must treat this as an independent page.
  var result;
  try {
    var file = cmsCreatePage_(name);
    cmsSiteSettings_(); // Validate all source settings before recording an enrollment intent.
    var sha = cmsGitBlobSha_(cmsVersionAssetHtml_(previewPrepareHtml_(file.html)));
    cmsAssertNewPageSource_(name, sheet);
    properties.setProperty(key, JSON.stringify({sheetId: sheet.getSheetId(), name: name, sha: sha}));
    result = cmsPublish_([file], 'Create preview page: ' + name);
  } catch (error) {
    context.pages = context.pages.filter(function(page) { return page !== name; });
    throw error;
  }
  try {
    if (!result.pageShas || result.pageShas[name + '.html'] !== sha) throw new Error('Published page verification failed.');
    cmsCompletePageRegistration_(name, sheet, properties, key);
    result.registrationSaved = true;
  } catch (error) {
    result.registrationSaved = false;
    context.pages = context.pages.filter(function(page) { return page !== name; });
    console.warn('Page published; its registration will be completed by the next Update.');
  }
  return result;
}
