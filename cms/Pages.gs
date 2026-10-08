/** Explicit page enrollment. Ordinary updates never enroll unrelated tabs. */
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
    // A registration formula or restricted cell remains user-owned.
    if (!cell.getDataValidation()) return cell;
  }
  throw new Error('No unrestricted empty cell in item list column E.');
}

function cmsCreatePageTab_(name, title) {
  cmsAssertPageName_(name, true);
  title = String(title || name).trim();
  if (!title || title.length > 200 || /[\x00-\x1f\x7f]/.test(title)) throw new Error('Page title must be 1–200 characters without control characters.');
  CMS_CONTEXT_ = null;
  var context = cmsContext_(), book = context.spreadsheet, lower = name.toLowerCase();
  if (book.getSheets().some(function(sheet) { return sheet.getName().toLowerCase() === lower; }) ||
      context.pages.some(function(page) { return page.toLowerCase() === lower; })) throw new Error('A tab or registered page already uses this name: ' + name);
  var entries = cmsGithubSnapshot_().entries;
  if (Object.keys(entries).some(function(path) { return path.toLowerCase() === lower + '.html'; })) throw new Error('A public HTML file already uses this name: ' + name);
  var template = book.getSheetByName('template'), registry = book.getSheetByName('item list');
  if (!template || !registry) throw new Error('The content template or page registry is missing.');
  var header = template.getRange(1, 1, 1, 3).getDisplayValues()[0];
  if (header.join(',') !== 'Lab,Language,Function' || !context.parameters.H1 || context.parameters.H1.indexOf('/* Title') !== 3) throw new Error('The content template or H1 parameter definition is incompatible.');
  var options = cmsSheetRows_('item list').values.slice(1);
  if (!options.some(function(row) { return row[0] === 'All'; }) || !options.some(function(row) { return row[1] === 'Common'; })) throw new Error('The template requires All and Common dropdown choices.');
  var cell = cmsNewPageRegistrationCell_(registry), copy;
  try {
    // Native copy retains formulas, validation, formatting, and column widths.
    copy = template.copyTo(book);
    copy.setName(name).showSheet();
    copy.getRange(2, 1, 1, 3).setValues([['All', 'Common', 'H1']]);
    copy.getRange(3, 1, 1, 3).clearContent();
    // Literal text, including an initial '=', must never execute as a formula.
    copy.getRange(2, 4).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(title).build());
    if (cell.getValue() !== '' || cell.getFormula() || cell.getDataValidation()) throw new Error('The registration cell changed while the tab was being created.');
    cell.setValue(name); // Other independent lists on this row remain untouched.
    SpreadsheetApp.flush();
    book.setActiveSheet(copy);
    return {name: name, sheetId: copy.getSheetId(), url: PREVIEW_SITE_URL + '/' + name + '.html'};
  } catch (error) {
    if (copy) throw new Error('The new tab was kept for recovery. Check item list column E before updating it. ' + error.message);
    throw error;
  } finally { CMS_CONTEXT_ = null; }
}

function create_page() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== PREVIEW_SPREADSHEET_ID) throw new Error('Page creation is restricted to the preview workbook.');
  var ui = SpreadsheetApp.getUi();
  // UI prompts suspend execution; acquire the lock only after both close.
  var namePrompt = ui.prompt('Create a new page', 'URL name, for example seminars. Use lowercase letters, numbers, hyphens or underscores.', ui.ButtonSet.OK_CANCEL);
  if (namePrompt.getSelectedButton() !== ui.Button.OK) return;
  var name = String(namePrompt.getResponseText()).trim();
  cmsAssertPageName_(name, true);
  var titlePrompt = ui.prompt('Page title', 'Initial heading. You can edit it later in cell D2. Leave empty to use the URL name.', ui.ButtonSet.OK_CANCEL);
  if (titlePrompt.getSelectedButton() !== ui.Button.OK) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another preview update is running. Try again after it finishes.');
  var result;
  try { result = cmsCreatePageTab_(name, titlePrompt.getResponseText()); }
  finally { lock.releaseLock(); }
  ui.alert('Page tab created', 'Edit the new tab, then choose Update the current page. The first update generates its HTML and the checked Pages workflow publishes it.\n\nURL after successful publication: ' + result.url, ui.ButtonSet.OK);
  return result;
}
