/** Only this module can request a production release. It cannot write production Git files. */
var CMS_RELEASE_PREVIEW_ = 'ponnhide/yachielab-preview';
var CMS_RELEASE_PRODUCTION_ = 'yachielab/yachielab.github.io';
var CMS_RELEASE_WORKFLOW_ = 'production-release.yml';
var CMS_PREVIEW_URL_ = 'https://ponnhide.github.io/yachielab-preview/';

function cmsReleaseProperties_() { return PropertiesService.getScriptProperties(); }
function cmsReleaseRead_(name) {
  var value = cmsReleaseProperties_().getProperty(name);
  return value ? JSON.parse(value) : null;
}
function cmsReleaseApi_(repo, endpoint, method, payload) {
  method = method || 'get';
  var preview = repo === CMS_RELEASE_PREVIEW_, production = repo === CMS_RELEASE_PRODUCTION_;
  var allowedRead = /^\/actions\/runs\/\d+(?:\/attempts\/\d+\/jobs\?per_page=100)?$/.test(endpoint) ||
    /^\/actions\/workflows\/(?:checks\.yml|production-release\.yml)(?:\/runs\?(?:head_sha=[a-f0-9]{40}&)?per_page=30)?$/.test(endpoint);
  var dispatch = production && method === 'post' && endpoint === '/actions/workflows/' + CMS_RELEASE_WORKFLOW_ + '/dispatches';
  if ((!preview && !production) || !(method === 'get' && allowedRead || dispatch)) throw new Error('許可されていない公開APIです。');
  if (dispatch) {
    var inputs = payload && payload.inputs;
    if (payload.ref !== 'main' || !inputs || !/^[a-f0-9]{40}$/.test(inputs.preview_commit) || !/^\d+$/.test(inputs.preview_run_id) ||
        !/^[A-Za-z0-9-]{1,80}$/.test(inputs.request_id) || ['true','false'].indexOf(inputs.dry_run) === -1 ||
        Object.keys(inputs).sort().join(',') !== 'dry_run,preview_commit,preview_run_id,request_id') throw new Error('公開要求が不正です。');
  }
  var token = cmsReleaseProperties_().getProperty(production ? 'PRODUCTION_GITHUB_TOKEN' : 'PREVIEW_GITHUB_TOKEN');
  if (dispatch && !token) throw new Error('PRODUCTION_GITHUB_TOKENを統合CMSのスクリプトプロパティに設定してください。');
  var headers = {Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if (token) headers.Authorization = 'Bearer ' + token;
  var options = {method:method,headers:headers,muteHttpExceptions:true,followRedirects:false};
  if (payload) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
  var response = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + endpoint, options);
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    var error = new Error('GitHub公開API: HTTP ' + code + '。トークンの対象リポジトリ・有効期限・権限を確認してください。');
    error.httpStatus = code; throw error;
  }
  return code === 204 ? {} : JSON.parse(response.getContentText());
}
function cmsReleaseMarker_(base) {
  if ([CMS_PREVIEW_URL_, 'https://yachie-lab.org/'].indexOf(base) === -1) throw new Error('Unknown public site.');
  var response = UrlFetchApp.fetch(base + 'release.json?cms_check=' + Date.now(), {muteHttpExceptions:true,followRedirects:false,headers:{'Cache-Control':'no-cache'}});
  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() !== 200) throw new Error('公開サイトの版を確認できません。時間をおいて再実行してください。');
  return JSON.parse(response.getContentText());
}
function cmsReleaseValidateMarker_(marker) {
  if (!marker || marker.schema !== 1 || marker.repository !== CMS_RELEASE_PREVIEW_ || marker.branch !== 'codex/preview' ||
      !/^[a-f0-9]{40}$/.test(marker.commit || '') || !/^\d+$/.test(String(marker.runId || '')) ||
      !Number.isInteger(marker.runAttempt) || marker.runAttempt < 1 || !/^[a-f0-9]{64}$/.test(marker.contentHash || '')) throw new Error('このプレビューには公開検証情報がありません。プレビューを更新してください。');
}
function cmsReleaseValidateRun_(marker, run, jobs) {
  cmsReleaseValidateMarker_(marker);
  if (String(run.id) !== String(marker.runId) || run.head_sha !== marker.commit || run.head_branch !== 'codex/preview' ||
      run.event !== 'push' || run.path !== '.github/workflows/checks.yml' || run.status !== 'completed' || run.conclusion !== 'success' ||
      run.run_attempt !== marker.runAttempt || !run.repository || run.repository.full_name !== CMS_RELEASE_PREVIEW_ ||
      !run.head_repository || run.head_repository.full_name !== CMS_RELEASE_PREVIEW_) throw new Error('この版のプレビュー公開成功を確認できません。');
  var deploy = (jobs.jobs || []).filter(function(job) { return job.name === 'Deploy checked preview'; });
  if (deploy.length !== 1 || deploy[0].conclusion !== 'success') throw new Error('プレビューの配信がまだ成功していません。');
}
function cmsReleaseCandidate_() {
  var initialization = cmsReleaseRead_('UNIFIED_INITIALIZE_STATE');
  if (initialization && !initialization.complete) throw new Error('統合Sheetの初回生成がまだ完了していません。');
  var saved = cmsReleaseRead_('UNIFIED_PREVIEW_SAVE');
  if (!saved) throw new Error('統合Sheetから先に「Update preview from current sheet」を実行してください。');
  var marker = cmsReleaseMarker_(CMS_PREVIEW_URL_);
  cmsReleaseValidateMarker_(marker);
  if (marker.commit !== saved.commit) throw new Error('最後に保存した変更は、まだプレビューへ公開されていません。プレビュー公開の完了を待ってください。');
  var base = '/actions/runs/' + marker.runId;
  cmsReleaseValidateRun_(marker, cmsReleaseApi_(CMS_RELEASE_PREVIEW_, base),
    cmsReleaseApi_(CMS_RELEASE_PREVIEW_, base + '/attempts/' + marker.runAttempt + '/jobs?per_page=100'));
  return marker;
}
function cmsReleaseCell_(cell, value) {
  var sheet = cmsUnifiedBook_().getSheetByName('公開状況');
  if (sheet) sheet.getRange(cell).setValue(value);
}
function cmsReleasePending_(record) {
  if (!record || record.finished) return null;
  var runs = cmsReleaseApi_(CMS_RELEASE_PRODUCTION_, '/actions/workflows/' + CMS_RELEASE_WORKFLOW_ + '/runs?per_page=30').workflow_runs || [];
  var match = runs.filter(function(run) { return run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.display_title === 'Production ' + record.requestId; });
  if (!match.length) return {done:false,message:'GitHubへの公開要求を確認中です。重複送信を防ぐため再送はしません。',url:''};
  var run = match[0], url = 'https://github.com/' + CMS_RELEASE_PRODUCTION_ + '/actions/runs/' + run.id;
  if (run.status !== 'completed') return {done:false,message:record.dryRun ? '本番公開の接続テスト中（公開なし）' : '本番公開の検証・配信中',url:url};
  if (run.conclusion !== 'success') {
    record.finished = true; record.conclusion = run.conclusion;
    cmsReleaseProperties_().setProperty('UNIFIED_PRODUCTION_REQUEST', JSON.stringify(record));
    return {done:true,message:'本番処理は ' + run.conclusion + ' で終了しました。実行ログを確認してください。',url:url};
  }
  if (record.dryRun) {
    record.finished = true; record.conclusion = 'validated';
    cmsReleaseProperties_().setProperty('UNIFIED_PRODUCTION_REQUEST', JSON.stringify(record));
    cmsReleaseCell_('B12', '接続テスト成功（本番未公開）');
    return {done:true,message:'接続テスト成功。本番サイトは更新していません。',url:url};
  }
  var live = cmsReleaseMarker_('https://yachie-lab.org/');
  if (!live || live.environment !== 'production' || live.commit !== record.commit || live.requestId !== record.requestId) return {done:false,message:'GitHub公開成功。配信先への反映を確認中です。',url:url};
  record.finished = true; record.conclusion = 'published';
  cmsReleaseProperties_().setProperty('UNIFIED_PRODUCTION_REQUEST', JSON.stringify(record));
  cmsReleaseCell_('B13', record.commit); cmsReleaseCell_('B12', '本番公開完了');
  return {done:true,message:'本番公開完了：' + record.commit.slice(0,12),url:'https://yachie-lab.org/?release=' + record.commit};
}
function cmsReleaseStart_(candidate, dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('別の更新が実行中です。完了後に再実行してください。');
  try {
    var pending = cmsReleasePending_(cmsReleaseRead_('UNIFIED_PRODUCTION_REQUEST'));
    if (pending && !pending.done) throw new Error(pending.message);
    var current = cmsReleaseCandidate_();
    if (current.commit !== candidate.commit || String(current.runId) !== String(candidate.runId)) throw new Error('確認中にプレビューが更新されました。新しい版を確認してから再実行してください。');
    var record = {requestId:Utilities.getUuid(),commit:current.commit,runId:String(current.runId),requestedAt:new Date().toISOString(),dryRun:!!dryRun,finished:false};
    // Save before dispatch: a timed-out response must not cause an automatic duplicate publish.
    cmsReleaseProperties_().setProperty('UNIFIED_PRODUCTION_REQUEST', JSON.stringify(record));
    try {
      cmsReleaseApi_(CMS_RELEASE_PRODUCTION_, '/actions/workflows/' + CMS_RELEASE_WORKFLOW_ + '/dispatches','post',
        {ref:'main',inputs:{preview_commit:record.commit,preview_run_id:record.runId,request_id:record.requestId,dry_run:dryRun?'true':'false'}});
    } catch (error) {
      if (error.httpStatus >= 400 && error.httpStatus < 500) {
        record.finished = true; record.conclusion = 'rejected';
        cmsReleaseProperties_().setProperty('UNIFIED_PRODUCTION_REQUEST', JSON.stringify(record));
      }
      throw error;
    }
    cmsReleaseCell_('B12', dryRun ? '本番接続テスト中（公開なし）' : '本番公開要求済み（配信中）');
    return record;
  } finally { lock.releaseLock(); }
}
function cmsProductionAction() {
  cmsUnifiedBook_();
  var ui = SpreadsheetApp.getUi();
  try {
    if (!cmsReleaseProperties_().getProperty('PRODUCTION_GITHUB_TOKEN')) throw new Error('統合CMSのスクリプトプロパティにPRODUCTION_GITHUB_TOKENを設定してください。本番リポジトリのみを対象に、Actions: Read and writeが必要です。');
    var pending = cmsReleasePending_(cmsReleaseRead_('UNIFIED_PRODUCTION_REQUEST'));
    if (pending && !pending.done) return cmsUnifiedShowStatus_('production');
    var candidate = cmsReleaseCandidate_();
    var answer = ui.alert('Publish entire preview to production',
      'Have you reviewed the preview site?\n' + CMS_PREVIEW_URL_ + '\n\nVersion to publish: ' + candidate.commit +
      '\nPreview run: ' + candidate.runId + '\n\nThis publishes the entire preview site, including changes on other pages, not just the current sheet.\nSheet edits that have not been deployed to preview are excluded.\n\nPublish this version to production?', ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return {published:false,cancelled:true};
    var record = cmsReleaseStart_(candidate, false); cmsUnifiedShowStatus_('production'); return record;
  } catch (error) { ui.alert('Unable to publish to production', error.message, ui.ButtonSet.OK); return {published:false,error:error.message}; }
}
/** Editor-only setup check. Does not add a third Sheet menu action or deploy production. */
function cmsValidateProductionConnection() {
  cmsUnifiedBook_();
  var existing = cmsReleaseRead_('UNIFIED_PRODUCTION_REQUEST');
  if (existing && existing.dryRun && !existing.finished) {
    var progress = cmsReleasePending_(existing);
    console.info('CMS production validation: ' + JSON.stringify(progress));
    return progress;
  }
  var candidate = cmsReleaseCandidate_();
  if (existing && existing.dryRun && existing.conclusion === 'validated' && existing.commit === candidate.commit) {
    return {done:true,message:'接続テスト成功（本番未公開）'};
  }
  var record = cmsReleaseStart_(candidate, true);
  console.info('CMS production validation requested: ' + record.requestId);
  return record;
}
function cmsUnifiedPoll(kind) {
  cmsUnifiedBook_();
  try {
    if (kind === 'production') return cmsReleasePending_(cmsReleaseRead_('UNIFIED_PRODUCTION_REQUEST')) || {done:true,message:'本番公開要求はありません。'};
    var saved = cmsReleaseRead_('UNIFIED_PREVIEW_SAVE');
    if (!saved) return {done:true,message:'統合Sheetからプレビューを更新してください。'};
    var marker = cmsReleaseMarker_(CMS_PREVIEW_URL_);
    if (marker && marker.commit === saved.commit) {
      var candidate = cmsReleaseCandidate_();
      cmsReleaseCell_('B7','プレビュー公開完了（本番公開可能）');
      return {done:true,message:'プレビュー公開完了：' + candidate.commit.slice(0,12),url:CMS_PREVIEW_URL_ + '?release=' + candidate.commit};
    }
    var runs = cmsReleaseApi_(CMS_RELEASE_PREVIEW_,'/actions/workflows/checks.yml/runs?head_sha=' + saved.commit + '&per_page=30').workflow_runs || [];
    var run = runs.filter(function(item) { return item.head_sha === saved.commit && item.event === 'push' && item.head_branch === 'codex/preview'; })[0];
    if (run && run.status === 'completed' && run.conclusion !== 'success') {
      cmsReleaseCell_('B7','プレビュー公開失敗：' + run.conclusion);
      return {done:true,message:'プレビュー公開失敗：' + run.conclusion,url:'https://github.com/' + CMS_RELEASE_PREVIEW_ + '/actions/runs/' + run.id};
    }
    return {done:false,message:'GitHub保存済み。検証とプレビュー公開を待っています。'};
  } catch (error) { return {done:false,message:error.message}; }
}
function cmsUnifiedShowStatus_(kind) {
  if (['preview','production'].indexOf(kind) === -1) throw new Error('Unknown status.');
  var status = cmsUnifiedPoll(kind), ui = SpreadsheetApp.getUi();
  var message = status.message + (status.url ? '\n\n' + status.url : '');
  if (!status.done) message += '\n\n公開処理はGitHubで継続しています。プレビューの配信完了後に本番公開してください。次回の更新操作でも公開状況を再確認します。';
  if (kind === 'preview' && !status.url) message += '\n\n' + CMS_PREVIEW_URL_;
  // Native dialogs remain readable when the embedded Apps Script panel is unavailable.
  ui.alert('Website publication status',message,ui.ButtonSet.OK);
  return status;
}

/** First migration only. Persist each page before continuing in a later execution. */
function cmsInitializeUnifiedPreview() {
  cmsUnifiedBook_();
  if (!cmsReleaseProperties_().getProperty('PREVIEW_GITHUB_TOKEN')) throw new Error('PREVIEW_GITHUB_TOKENが必要です。');
  var lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(1000)) throw new Error('初回生成は既に実行中です。');
  try {
    var started = Date.now(), state = cmsReleaseRead_('UNIFIED_INITIALIZE_STATE');
    if (!state) {
      CMS_CONTEXT_ = null;
      state = {pages:cmsContext_().pages.slice(),next:0,complete:false};
      cmsReleaseProperties_().setProperty('UNIFIED_INITIALIZE_STATE',JSON.stringify(state));
    }
    while (!state.complete) {
      var page = state.pages[state.next], result;
      if (state.next < state.pages.length) {
        result = cmsRun_(function() { return cmsUpdateTab_(page); }, 'initialize:' + page);
      } else {
        result = update_shared_components();
      }
      // Advance only after GitHub publication and cache persistence have returned.
      state.next++;
      state.complete = state.next > state.pages.length;
      cmsReleaseProperties_().setProperty('UNIFIED_INITIALIZE_STATE',JSON.stringify(state));
      console.info('CMS initialization: ' + JSON.stringify({completed:state.next,total:state.pages.length + 1,complete:state.complete}));
      if (!state.complete && Date.now() - started >= 90000) break;
    }
    // Editor-only setup functions have no spreadsheet UI context.
    if (!state.complete) cmsReleaseCell_('B7','初回生成中：' + state.next + '/' + (state.pages.length + 1) + '（保存済み・次回実行で続行）');
    return {complete:state.complete,completed:state.next,total:state.pages.length + 1};
  } finally { lock.releaseLock(); }
}
