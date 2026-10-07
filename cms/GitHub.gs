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

function cmsPublish_(files, message) {
  if (!files.length && !cmsContext_().pendingAssets.length) return {changed: false};
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
