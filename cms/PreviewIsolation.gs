// Guard for the separate, container-bound preview CMS. No credentials belong here.
const PREVIEW_SPREADSHEET_ID = '1TRYhl0WmqhEykYCvFtZzJG4J17YChKiqausAxT8iwHk';
const PREVIEW_REPOSITORY = 'ponnhide/yachielab-preview';
const PREVIEW_BRANCH = 'codex/preview';
const PREVIEW_SITE_URL = 'https://ponnhide.github.io/yachielab-preview';
const ROOT = '';
const REPO_NAME = PREVIEW_REPOSITORY;
const BRANCH = PREVIEW_BRANCH;
const IMG_PATH = 'img';
const PDF_PATH = 'pdf';
const GITHUB_TOKEN = PropertiesService.getScriptProperties().getProperty('PREVIEW_GITHUB_TOKEN') || '';

function previewWritablePath_(path) {
  return typeof path === 'string' && !/(?:^|\/)\.\.(?:\/|$)|[\\?%\x00-\x1f]/.test(path) && /^(?:(?:site-settings|asset-versions)\.json|[a-zA-Z0-9_-]+\.html|(?:img|pdf)\/[^/]+)$/.test(path);
}

function previewAssetVersionsContent_(content) {
  var manifest;
  try { manifest = JSON.parse(content); } catch (error) { return false; }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.version !== 1 ||
      Object.keys(manifest).sort().join(',') !== 'assets,version' || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) return false;
  var paths = Object.keys(manifest.assets);
  return paths.length <= 10000 && paths.every(function(path) {
    return /^(?:img|img_new|pdf)\/.+/.test(path) && !/[\\?#\x00-\x1f\x7f]/.test(path) &&
      !/(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/.test(path) && typeof manifest.assets[path] === 'string' && /^[a-f0-9]{40}$/.test(manifest.assets[path]);
  });
}

function previewSiteSettingsContent_(content) {
  var settings;
  try { settings = JSON.parse(content); } catch (error) { return false; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  var keys = ['logoActiveOpacity', 'logoInactiveOpacity', 'logoTransitionMs'];
  if (Object.keys(settings).length !== keys.length || !keys.every(function(key) { return Object.prototype.hasOwnProperty.call(settings, key); })) return false;
  return keys.every(function(key) {
    var value = settings[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= (key === 'logoTransitionMs' ? 10000 : 1);
  });
}

function previewPrepareHtml_(html) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, function(script) {
    return /googletagmanager\.com\/gtag\/|gtag\(['"]config['"]|platform\.twitter\.com\/widgets\.js|(?:www\.)?instagram\.com\/embed\.js|embed\.bsky\.app\/static\/embed\.js/.test(script) ? '' : script;
  });
  html = html.replace(/https?:\/\/(?:www\.)?yachie-lab\.org(?=[/?#]|[\s"'<>)]|$)/g, PREVIEW_SITE_URL);
  html = html.replace(/href="\.\.\/joinus\.html"/g, 'href="./joinus.html"');
  html = html.replace(/\.\/img\/Shoma_Matsumoto\.jpg/g, './img/Shoma_Matsumoto.jpeg');
  html = html.replace(/href="\.\/pdf\/https?:\/\/[^"<>]+\/(s41467-022-30588-x\.pdf|s41587-020-0509-0\.pdf|gky890\.pdf)"/g, 'href="./pdf/$1"');
  var addgeneCount = 0;
  html = html.replace(/id="mobile-addgennelogo"/g, function(attribute) { return ++addgeneCount === 1 ? attribute : 'id="mobile-kurosignlogo"'; });
  // index now uses the shared runtime before its homepage-only controller.
  if (/src=["']\.\/js\/index\.js/.test(html) && !/src=["']\.\/js\/common\.js/.test(html)) {
    html = html.replace(/(<script\b[^>]*src=["']\.\/js\/index\.js["'][^>]*>)/i, '<script src="./js/common.js" defer></script>\n  $1');
  }
  if (/src=["']\.\/js\/common\.js/.test(html) && !/src=["']\.\/js\/assets\.js/.test(html)) {
    html = html.replace(/(<script\b[^>]*src=["']\.\/js\/common\.js(?:\?[^"']*)?["'][^>]*>)/i, '<script src="./js/assets.js" defer></script>\n  $1');
  }
  if (!/<meta\s+name=["']robots["']/i.test(html)) {
    html = html.replace(/<head>/i, '<head>\n  <meta name="robots" content="noindex, nofollow">');
  }
  return html;
}

function previewFetch_(url, options) {
  url = String(url);
  if (!/^https?:\/\/api\.github\.com(?=[/:]|$)/i.test(url)) {
    return UrlFetchApp.fetch(url, options);
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== PREVIEW_SPREADSHEET_ID) {
    throw new Error('Preview CMS: unexpected spreadsheet; request blocked.');
  }
  var target = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(.+?)(?:\?(.*))?$/);
  if (!target || target[1] !== PREVIEW_REPOSITORY || REPO_NAME !== PREVIEW_REPOSITORY || BRANCH !== PREVIEW_BRANCH) {
    throw new Error('Preview CMS: unexpected repository or branch; request blocked.');
  }
  var token = PropertiesService.getScriptProperties().getProperty('PREVIEW_GITHUB_TOKEN');
  if (!token) {
    throw new Error('Set PREVIEW_GITHUB_TOKEN in this project\'s Script Properties first.');
  }
  var request = Object.assign({}, options || {});
  var method = String(request.method || 'get').toLowerCase();
  var endpoint = target[2];
  var payload = request.payload ? JSON.parse(request.payload) : null;
  var allowed = false;
  if (method === 'get' && endpoint.indexOf('contents/') === 0) {
    var readPath = decodeURIComponent(endpoint.slice('contents/'.length));
    if (/^(?:\/)|(?:^|\/)\.\.(?:\/|$)|[\\\x00-\x1f]/.test(readPath)) throw new Error('Preview CMS: invalid read path.');
    var ref = /(?:^|&)ref=([^&]*)/.exec(target[3] || '');
    if ((target[3] || '').split('&').filter(function(part) { return part.indexOf('ref=') === 0; }).length > 1) throw new Error('Preview CMS: duplicate ref is blocked.');
    if (ref && decodeURIComponent(ref[1]) !== PREVIEW_BRANCH) throw new Error('Preview CMS: reading another branch is blocked.');
    if (!ref) url += (url.indexOf('?') === -1 ? '?' : '&') + 'ref=' + encodeURIComponent(PREVIEW_BRANCH);
    allowed = true;
  } else if (method === 'get') {
    allowed = endpoint === 'git/ref/heads/' + PREVIEW_BRANCH || /^git\/(?:commits|trees)\/[a-f0-9]{40}$/.test(endpoint);
  } else if (method === 'post' && endpoint === 'git/trees') {
    allowed = !!payload && /^[a-f0-9]{40}$/.test(payload.base_tree) && Array.isArray(payload.tree) && payload.tree.every(function(entry) {
      return previewWritablePath_(entry.path) && entry.mode === '100644' && entry.type === 'blob' &&
        ((typeof entry.content === 'string' && entry.sha === undefined && (/\.html$/.test(entry.path) || (entry.path === 'site-settings.json' && previewSiteSettingsContent_(entry.content)) || (entry.path === 'asset-versions.json' && previewAssetVersionsContent_(entry.content)))) || (/^[a-f0-9]{40}$/.test(entry.sha) && /^(?:img|pdf)\//.test(entry.path) && entry.content === undefined));
    });
    if (allowed) payload.tree.forEach(function(entry) { if (entry.content !== undefined && /\.html$/.test(entry.path)) entry.content = previewPrepareHtml_(entry.content); });
  } else if (method === 'post' && endpoint === 'git/blobs') {
    allowed = !!payload && payload.encoding === 'base64' && typeof payload.content === 'string';
  } else if (method === 'post' && endpoint === 'git/commits') {
    allowed = !!payload && /^[a-f0-9]{40}$/.test(payload.tree) && Array.isArray(payload.parents) && payload.parents.length === 1 && /^[a-f0-9]{40}$/.test(payload.parents[0]);
  } else if (method === 'patch' && endpoint === 'git/refs/heads/' + PREVIEW_BRANCH) {
    allowed = !!payload && Object.keys(payload).every(function(key) { return key === 'sha' || key === 'force'; }) && payload.force === false && /^[a-f0-9]{40}$/.test(payload.sha);
  } else if (method === 'put' && endpoint.indexOf('contents/') === 0) {
    var path = endpoint.slice('contents/'.length);
    allowed = !!payload && payload.branch === PREVIEW_BRANCH && previewWritablePath_(path);
    if (allowed && /\.html$/.test(path)) payload.content = Utilities.base64Encode(previewPrepareHtml_(Utilities.newBlob(Utilities.base64Decode(payload.content)).getDataAsString('UTF-8')), Utilities.Charset.UTF_8);
    if (allowed && path === 'site-settings.json') {
      allowed = typeof payload.content === 'string' && previewSiteSettingsContent_(Utilities.newBlob(Utilities.base64Decode(payload.content)).getDataAsString('UTF-8'));
    }
    if (allowed && path === 'asset-versions.json') {
      allowed = typeof payload.content === 'string' && previewAssetVersionsContent_(Utilities.newBlob(Utilities.base64Decode(payload.content)).getDataAsString('UTF-8'));
    }
  }
  if (!allowed) throw new Error('Preview CMS: unsupported repository operation; request blocked.');
  if (payload) request.payload = JSON.stringify(payload);
  request.muteHttpExceptions = true;
  request.followRedirects = false;
  request.headers = Object.assign({}, request.headers || {}, {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10'});
  var response = UrlFetchApp.fetch(url, request);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    if (!(method === 'get' && status === 404)) {
      throw new Error('Preview GitHub request failed with HTTP ' + status + '.');
    }
  }
  return response;
}
