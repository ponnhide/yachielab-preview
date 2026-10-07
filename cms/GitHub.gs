// Publish a coherent set of generated HTML/asset changes in one commit.
function cmsGithub_(endpoint, method, payload, allowMissing) {
  var options = {method: method || 'get', muteHttpExceptions: true, contentType: 'application/json'};
  if (payload) options.payload = JSON.stringify(payload);
  var response = previewFetch_('https://api.github.com/repos/' + PREVIEW_REPOSITORY + '/' + endpoint, options);
  if (allowMissing && response.getResponseCode() === 404) return null;
  return JSON.parse(response.getContentText());
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
  var settings = cmsSiteSettings_();
  var snapshot = cmsGithubSnapshot_();
  var current = cmsGithub_('git/ref/heads/' + PREVIEW_BRANCH).object.sha;
  if (current !== snapshot.head) throw new Error('Preview branch changed during rendering. Run the update again.');
  var seen = {};
  var entries = files.map(function(file) {
    if (!previewWritablePath_(file.path) || !/\.html$/.test(file.path) || seen[file.path]) throw new Error('Invalid generated file path.');
    seen[file.path] = true;
    var actual = snapshot.entries[file.path];
    if (file.expectedSha && (!actual || actual.sha !== file.expectedSha)) throw new Error('Page changed during rendering: ' + file.path);
    return {path: file.path, mode: '100644', type: 'blob', content: previewPrepareHtml_(file.html)};
  });
  entries.push({path: 'site-settings.json', mode: '100644', type: 'blob', content: JSON.stringify(settings, null, 2) + '\n'});
  cmsContext_().pendingAssets.forEach(function(asset) {
    var blob = cmsGithub_('git/blobs', 'post', {content: asset.content, encoding: 'base64'});
    entries.push({path: asset.path, mode: '100644', type: 'blob', sha: blob.sha});
  });
  var tree = cmsGithub_('git/trees', 'post', {base_tree: snapshot.tree, tree: entries});
  if (tree.sha === snapshot.tree) return {changed: false, commit: snapshot.head};
  var commit = cmsGithub_('git/commits', 'post', {message: message || 'Update preview website from Google Sheets', tree: tree.sha, parents: [snapshot.head]});
  cmsGithub_('git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: commit.sha, force: false});
  return {changed: true, commit: commit.sha, pages: files.length, assets: cmsContext_().pendingAssets.length};
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
