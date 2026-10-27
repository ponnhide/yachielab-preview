/** Unified workbook controls. All content writes go through the preview guard. */
var UNIFIED_WORKBOOK_ID_ = '1LI4jAHL-3825jNSIznGX3cp3r7Bad-_DTiH9Pcq53j8';

function cmsUnifiedBook_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== UNIFIED_WORKBOOK_ID_) throw new Error('この操作は統合CMSのSheet専用です。');
  return book;
}

function cmsUnifiedOnOpen_() {
  cmsUnifiedBook_();
  SpreadsheetApp.getUi().createMenu('Website')
    .addItem('Update preview from current sheet', 'cmsPreviewAction')
    .addItem('Publish entire preview to production', 'cmsProductionAction')
    .addToUi();
}

function cmsPreviewAction() {
  var book = cmsUnifiedBook_(), name = book.getActiveSheet().getName();
  if (name === '公開状況' || name === 'item list' || name === 'parameters' || /^_cms/.test(name)) {
    SpreadsheetApp.getUi().alert('Update preview from current sheet', '更新するコンテンツのタブ（例：research、software）を開いてから実行してください。', SpreadsheetApp.getUi().ButtonSet.OK);
    return {changed: false, skipped: true};
  }
  if (!PropertiesService.getScriptProperties().getProperty('PREVIEW_GITHUB_TOKEN')) {
    SpreadsheetApp.getUi().alert('Preview setup required', 'この統合CMSのApps Scriptに、preview専用のPREVIEW_GITHUB_TOKENを設定してください。既存Sheetとは別のプロジェクトです。', SpreadsheetApp.getUi().ButtonSet.OK);
    return {changed: false, configured: false};
  }
  var result = update_webpage();
  cmsUnifiedShowStatus_('preview');
  return result;
}

/** Called while cmsRun_ still holds its script lock. A Git save is not a deployed preview. */
function cmsUnifiedPreviewSaved_(result) {
  if (!result || !/^[a-f0-9]{40}$/.test(result.commit || '')) return;
  try {
    var book = cmsUnifiedBook_(), status = book.getSheetByName('公開状況');
    var record = {commit: result.commit, savedAt: new Date().toISOString(), page: book.getActiveSheet().getName(), deploymentVerified: false};
    PropertiesService.getScriptProperties().setProperty('UNIFIED_PREVIEW_SAVE', JSON.stringify(record));
    if (status) {
      status.getRange('B7').setValue('GitHub保存済み（公開完了は未確認）');
      status.getRange('B8').setValue(record.commit);
      status.getRange('B9').setValue(record.savedAt);
      status.getRange('B10').setValue(record.page);
    }
  } catch (error) {
    console.warn('Preview saved; the optional publication-status display could not be updated.');
  }
}
