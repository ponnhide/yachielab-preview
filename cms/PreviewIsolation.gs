// Guard for the separate, container-bound preview CMS. No credentials belong here.
const PREVIEW_SPREADSHEET_ID = '1TRYhl0WmqhEykYCvFtZzJG4J17YChKiqausAxT8iwHk';
const PREVIEW_REPOSITORY = 'ponnhide/yachielab-preview';
const PREVIEW_BRANCH = 'codex/preview';
const PREVIEW_SITE_URL = 'https://ponnhide.github.io/yachielab-preview';

function previewPrepareHtml_(html) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, function(script) {
    return /googletagmanager\.com\/gtag\/|gtag\(['"]config['"]/.test(script) ? '' : script;
  });
  html = html.replace(/https?:\/\/(?:www\.)?yachie-lab\.org(?=\/|[\s"'<>)]|$)/g, PREVIEW_SITE_URL);
  html = html.replace(/href="\.\.\/joinus\.html"/g, 'href="./joinus.html"');
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
  var target = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\/([^?]*)(?:\?(.*))?$/);
  if (!target || target[1] !== PREVIEW_REPOSITORY || REPO_NAME !== PREVIEW_REPOSITORY || BRANCH !== PREVIEW_BRANCH) {
    throw new Error('Preview CMS: unexpected repository or branch; request blocked.');
  }
  if (!GITHUB_TOKEN) {
    throw new Error('Set PREVIEW_GITHUB_TOKEN in this project\'s Script Properties first.');
  }
  var request = Object.assign({}, options || {});
  var method = String(request.method || 'get').toLowerCase();
  if (method === 'get') {
    var ref = /(?:^|&)ref=([^&]*)/.exec(target[3] || '');
    if (ref && decodeURIComponent(ref[1]) !== PREVIEW_BRANCH) {
      throw new Error('Preview CMS: reading another branch is blocked.');
    }
    if (!ref) url += (url.indexOf('?') === -1 ? '?' : '&') + 'ref=' + encodeURIComponent(PREVIEW_BRANCH);
  } else if (method === 'put') {
    var payload = JSON.parse(request.payload);
    if (payload.branch !== PREVIEW_BRANCH || !/^(?:(?:img|pdf)\/[^?]+|[^/]+\.html)$/.test(target[2])) {
      throw new Error('Preview CMS: unexpected write branch or path; request blocked.');
    }
    if (/\.html$/.test(target[2])) {
      var html = Utilities.newBlob(Utilities.base64Decode(payload.content)).getDataAsString('UTF-8');
      payload.content = Utilities.base64Encode(previewPrepareHtml_(html), Utilities.Charset.UTF_8);
      request.payload = JSON.stringify(payload);
    }
  } else {
    throw new Error('Preview CMS: unsupported GitHub method; request blocked.');
  }
  request.headers = Object.assign({}, request.headers || {}, {Authorization: 'token ' + GITHUB_TOKEN});
  var response = UrlFetchApp.fetch(url, request);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    if (!(method === 'get' && status === 404)) {
      throw new Error('Preview GitHub request failed with HTTP ' + status + '.');
    }
  }
  return response;
}
