// Publish a coherent set of generated HTML/asset changes in one commit.
function cmsGithub_(endpoint, method, payload, allowMissing) {
  var options = {method: method || 'get', muteHttpExceptions: true, contentType: 'application/json'};
  var context = cmsContext_();
  var counter = options.method.toLowerCase() === 'get' ? 'githubReads' : 'githubWrites';
  if (payload) options.payload = JSON.stringify(payload);
  // Identical blob content produces the same SHA. Retrying this POST cannot
  // publish a page or move a branch; other writes must never be retried here.
  var retryBlob = endpoint === 'git/blobs' && options.method.toLowerCase() === 'post' &&
    payload && payload.encoding === 'base64' && typeof payload.content === 'string';
  for (var attempt = 0; attempt < (retryBlob ? 3 : 1); attempt++) {
    context[counter] = (context[counter] || 0) + 1;
    try {
      var response = previewFetch_('https://api.github.com/repos/' + PREVIEW_REPOSITORY + '/' + endpoint, options);
      if (allowMissing && response.getResponseCode() === 404) return null;
      return JSON.parse(response.getContentText());
    } catch (error) {
      if (!retryBlob || attempt === 2 || !/^Preview GitHub request failed with HTTP (500|502|503|504)\.$/.test(String(error && error.message || ''))) throw error;
      Utilities.sleep(attempt === 0 ? 500 : 1500);
    }
  }
}

function cmsGithubSnapshot_() {
  var context = cmsContext_();
  if (context.github) return context.github;
  var head = cmsGithub_('git/ref/heads/' + PREVIEW_BRANCH).object.sha;
  var commit = cmsGithub_('git/commits/' + head);
  var tree = cmsGithub_('git/trees/' + commit.tree.sha + '?recursive=1');
  if (tree.truncated) throw new Error('Repository tree is incomplete; update stopped.');
  var entries = {};
  tree.tree.forEach(function(entry) { entries[entry.path] = entry; });
  return context.github = {head: head, tree: commit.tree.sha, entries: entries};
}

function getGithubFileContent(token, repo, path, branch) {
  if (repo !== PREVIEW_REPOSITORY || branch !== PREVIEW_BRANCH) throw new Error('Invalid preview target.');
  return cmsGithub_('contents/' + path + '?ref=' + encodeURIComponent(branch), 'get', null, true);
}

// Publish only these numeric settings. The Sheet and credentials stay private.
function cmsSiteSettings_() {
  var context = cmsContext_();
  if (context.siteSettings) return context.siteSettings;
  var headRows = cmsSheetRows_('header').values.slice(1).filter(function(row) {
    return row[2] === 'div' && sheetString_(row[4]).trim() === 'head';
  });
  if (headRows.length !== 1) throw new Error('Header must contain exactly one head row for the site settings.');
  var css = sheetString_(headRows[0][5]);
  var properties = {
    '--lab-logo-active-opacity': 'logoActiveOpacity',
    '--lab-logo-inactive-opacity': 'logoInactiveOpacity',
    '--lab-logo-transition-duration': 'logoTransitionMs'
  };
  var settings = {logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300};
  var values = {};
  sheetDeclarations_(css).forEach(function(declaration) {
    if (Object.prototype.hasOwnProperty.call(properties, declaration.property)) values[declaration.property] = declaration.value;
  });
  // The shared CSS parser omits malformed/empty declarations. A named setting
  // must fail explicitly in that case instead of silently using its default.
  var declared = /(?:^|;)\s*(--lab-logo-(?:active-opacity|inactive-opacity|transition-duration))\s*:([^;]*)/gi;
  var match, clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((match = declared.exec(clean))) {
    if (sheetDeclarations_(match[1] + ':' + match[2]).length !== 1 || !Object.prototype.hasOwnProperty.call(values, match[1].toLowerCase())) throw new Error('Invalid header site setting: ' + match[1].toLowerCase());
  }
  Object.keys(properties).forEach(function(property) {
    if (!Object.prototype.hasOwnProperty.call(values, property)) return;
    var value = values[property].trim(), number;
    if (property === '--lab-logo-transition-duration') {
      var duration = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(ms|s)$/i);
      number = duration ? Number(duration[1]) * (duration[2].toLowerCase() === 's' ? 1000 : 1) : NaN;
      if (!Number.isFinite(number) || number < 0 || number > 10000) throw new Error('Invalid header site setting: transition duration must be 0..10000 ms, with ms or s units.');
    } else {
      number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
      if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error('Invalid header site setting: opacity must be a finite number from 0 to 1.');
    }
    settings[properties[property]] = number;
  });
  return context.siteSettings = settings;
}

function cmsPublish_(files, message) {
  files = files.filter(function(file) { return !!file; });
  var context = cmsContext_();
  var settings = cmsSiteSettings_();
  var snapshot = cmsGithubSnapshot_();
  var current = cmsGithub_('git/ref/heads/' + PREVIEW_BRANCH).object.sha;
  if (current !== snapshot.head) throw new Error('Preview branch changed during rendering. Run the update again.');
  var seen = {}, entries = [], pageShas = {}, assetShas = {}, repositoryBlobs = {}, pagesChanged = 0, assetsChanged = 0;
  Object.keys(snapshot.entries).forEach(function(path) {
    var entry = snapshot.entries[path];
    if (entry.type !== 'blob') return;
    repositoryBlobs[entry.sha] = true;
    if (/\.html$/.test(path)) pageShas[path] = entry.sha;
    else if (/^(?:img|img_new|pdf)\//.test(path)) assetShas[path] = entry.sha;
  });
  var unchangedPageShas = Object.assign({}, pageShas), unchangedAssetShas = Object.assign({}, assetShas);
  files.forEach(function(file) {
    if (!previewWritablePath_(file.path) || !/\.html$/.test(file.path) || seen[file.path]) throw new Error('Invalid generated file path.');
    seen[file.path] = true;
    var actual = snapshot.entries[file.path];
    if (file.expectedAbsent && actual) throw new Error('A page already exists at the new path: ' + file.path);
    if (file.expectedSha && (!actual || actual.sha !== file.expectedSha)) throw new Error('Page changed during rendering: ' + file.path);
    var content = cmsVersionAssetHtml_(previewPrepareHtml_(file.html)), sha = cmsGitBlobSha_(content);
    pageShas[file.path] = sha;
    if (actual && actual.sha === sha) return;
    entries.push({path: file.path, mode: '100644', type: 'blob', content: content});
    pagesChanged++;
  });
  var settingsContent = JSON.stringify(settings, null, 2) + '\n';
  var settingsSha = cmsGitBlobSha_(settingsContent), existingSettings = snapshot.entries['site-settings.json'];
  if (!existingSettings || existingSettings.sha !== settingsSha) entries.push({path: 'site-settings.json', mode: '100644', type: 'blob', content: settingsContent});
  context.pendingAssets.forEach(function(asset) {
    var computedSha = cmsAssetVersionSha_(asset.path);
    assetShas[asset.path] = computedSha;
    var actual = snapshot.entries[asset.path];
    if (actual && actual.sha === computedSha) return;
    // SHA-only pending entries are permitted only for verified repository bytes.
    // They must never fall through to an upload with no content.
    if (asset.sha !== undefined && (asset.content !== undefined || asset.sha !== computedSha || !repositoryBlobs[computedSha])) throw new Error('Unverified known asset SHA.');
    // A source-specific filename may still refer to bytes already stored under
    // a legacy name. Reuse that Git object while keeping the new path intact.
    var blob = repositoryBlobs[computedSha] ? {sha: computedSha} :
      cmsGithub_('git/blobs', 'post', {content: asset.content, encoding: 'base64'});
    if (blob.sha !== computedSha) throw new Error('Asset blob SHA verification failed. Publication stopped.');
    repositoryBlobs[blob.sha] = true;
    entries.push({path: asset.path, mode: '100644', type: 'blob', sha: blob.sha});
    assetShas[asset.path] = blob.sha;
    assetsChanged++;
  });
  var versionsContent = JSON.stringify(cmsAssetVersionsManifest_(), null, 2) + '\n';
  var versionsSha = cmsGitBlobSha_(versionsContent), existingVersions = snapshot.entries['asset-versions.json'];
  if (!existingVersions || existingVersions.sha !== versionsSha) entries.push({path: 'asset-versions.json', mode: '100644', type: 'blob', content: versionsContent});
  if (!entries.length) return {changed: false, commit: snapshot.head, pages: 0, assets: 0, pageShas: pageShas, assetShas: assetShas};
  var tree = cmsGithub_('git/trees', 'post', {base_tree: snapshot.tree, tree: entries});
  if (tree.sha === snapshot.tree) return {changed: false, commit: snapshot.head, pages: 0, assets: 0, pageShas: unchangedPageShas, assetShas: unchangedAssetShas};
  var commit = cmsGithub_('git/commits', 'post', {message: message || 'Update preview website from Google Sheets', tree: tree.sha, parents: [snapshot.head]});
  // The non-forced ref update is the final concurrency guard, with a fresh
  // lease check immediately before it rather than relying only on rendering time.
  if (cmsGithub_('git/ref/heads/' + PREVIEW_BRANCH).object.sha !== snapshot.head) throw new Error('Preview branch changed before publication. Run the update again.');
  cmsGithub_('git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: commit.sha, force: false});
  return {changed: true, commit: commit.sha, pages: pagesChanged, assets: assetsChanged, pageShas: pageShas, assetShas: assetShas};
}

// Compatibility entrypoints use the same atomic publisher and isolation checks.
function pushToGitHub(token, repo, path, branch, content, sha) {
  if (repo !== PREVIEW_REPOSITORY || branch !== PREVIEW_BRANCH) throw new Error('Invalid preview target.');
  return cmsPublish_([{path: path.replace(/^\//, ''), expectedSha: sha, html: Utilities.newBlob(Utilities.base64Decode(content)).getDataAsString('UTF-8')}]);
}

function uploadGitHub(token, repo, path, branch, content) {
  if (repo !== PREVIEW_REPOSITORY || branch !== PREVIEW_BRANCH || !previewWritablePath_(path)) throw new Error('Invalid preview upload.');
  if (/\.html$/.test(path)) return pushToGitHub(token, repo, path, branch, content);
  cmsQueueAsset_(path, content);
  return true;
}
