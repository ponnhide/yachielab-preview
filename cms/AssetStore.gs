/** Synchronize selected-page sources before HTML cache lookup; preserve old assets. */
function cmsAssetSha_(path) {
  var context = cmsContext_(), pending = (context.pendingAssets || []).filter(function(asset) { return asset.path === path; })[0];
  if (pending) return cmsGitBlobSha_(Utilities.base64Decode(pending.content));
  var entry = cmsGithubSnapshot_().entries[path];
  return entry && entry.type === 'blob' ? entry.sha : '';
}

function cmsAssetUrl_(path, sha) {
  path = String(path || '');
  var match = path.match(/^(?:\.\/|\/)?((?:img|img_new|pdf)\/[^?#]+)(\?[^#]*)?(#.*)?$/);
  if (!match) return path;
  sha = sha || cmsAssetSha_(match[1]);
  var query = (match[2] || '').slice(1).split('&').filter(function(part) { return part && !/^v=/.test(part); });
  if (/^[a-f0-9]{40}$/.test(sha)) query.push('v=' + sha.slice(0, 12));
  return './' + match[1] + (query.length ? '?' + query.join('&') : '') + (match[3] || '');
}

function cmsAssetPath_(name, key) {
  if (/[\\/\x00-\x1f]/.test(name)) throw new Error('Invalid asset filename.');
  var match = name.match(/^(.*)\.(pdf|png|jpe?g|gif|webp|svg|avif)$/i);
  if (!match) return '';
  var stem = match[1].replace(/[^a-zA-Z0-9_. -]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80) || 'asset';
  return (match[2].toLowerCase() === 'pdf' ? 'pdf/' : 'img/') + stem + '--' + key.slice(0, 12) + '.' + match[2].toLowerCase();
}

function cmsAssetHeader_(response, name) {
  var headers = typeof response.getAllHeaders === 'function' ? response.getAllHeaders() : typeof response.getHeaders === 'function' ? response.getHeaders() : {};
  var key = Object.keys(headers).filter(function(key) { return key.toLowerCase() === name.toLowerCase(); })[0];
  var value = key ? headers[key] : '';
  value = String(Array.isArray(value) ? value[0] : value || '');
  // Validators are untrusted HTTP text and will be written into private cells.
  // Never let a malformed header become a spreadsheet formula.
  return value.length < 40000 && !/[\r\n]/.test(value) && !/^\s*[=+@-]/.test(value) ? value : '';
}

function cmsAssetPdfFallback_(value, source, key, name, path, store, reason) {
  var context = cmsContext_(), entries = cmsGithubSnapshot_().entries;
  var owner = store.records[key], owned = entries[path];
  var legacyPath = 'pdf/' + name, legacy = entries[legacyPath];
  context.assetWarnings = context.assetWarnings || [];
  context.assetWarnings.push(reason || 'oversized-pdf-kept');
  var savedPath = owner && owner.identity === source.identity && owner.path === path && owned && owned.type === 'blob' ? path :
    legacy && legacy.type === 'blob' ? legacyPath : '';
  var saved = savedPath && entries[savedPath];
  // This result describes the old published link, not successfully fetched
  // source bytes. Do not stage validators or a fresh ownership record.
  return context.preparedAssets[key] = saved ? {key: 'local:' + savedPath, path: savedPath, sha: saved.sha, url: cmsAssetUrl_(savedPath, saved.sha)} :
    {key: key, path: '', sha: '', url: value};
}

function cmsAssetPrepare_(value) {
  value = String(value || '').trim();
  if (!value || value.indexOf('/*') === 0) return null;
  var local = value.match(/^(?:\.\/)?((?:img|img_new|pdf)\/[^?#]+)(?:[?#]|$)/);
  if (local) return {key: 'local:' + local[1], path: local[1], sha: cmsAssetSha_(local[1]), url: cmsAssetUrl_(value)};
  var source = cmsAssetSource_(value);
  if (!source) return null;
  var key = cmsAssetKey_(source.identity), context = cmsContext_();
  if (context.preparedAssets && context.preparedAssets[key]) return context.preparedAssets[key];
  var file = source.driveId ? DriveApp.getFileById(source.driveId) : null;
  var name;
  try { name = file ? file.getName() : decodeURIComponent(source.sourceUrl.split('?')[0].split('/').pop()); }
  catch (error) { throw new Error('Asset filename could not be decoded.'); }
  var path = cmsAssetPath_(name, key);
  if (!context.preparedAssets) context.preparedAssets = {};
  if (!path) return context.preparedAssets[key] = {key: key, path: '', sha: '', url: value};
  // Publisher PDF download endpoints commonly reject unattended requests. Only
  // Drive/Dropbox PDFs are synchronized; retain existing publisher links with
  // an explicit per-update warning rather than claiming their content is fresh.
  var dropbox = /^https?:\/\/(?:(?:www\.|dl\.)?dropbox\.com|dl\.dropboxusercontent\.com)(?:[/?]|$)/i.test(source.sourceUrl);
  if (!file && /\.pdf$/i.test(name) && !dropbox) {
    var legacyPath = 'pdf/' + name, legacy = cmsGithubSnapshot_().entries[legacyPath];
    context.assetWarnings = context.assetWarnings || [];
    context.assetWarnings.push('publisher-pdf-not-synchronized');
    return context.preparedAssets[key] = legacy && legacy.type === 'blob' ?
      {key: 'local:' + legacyPath, path: legacyPath, sha: legacy.sha, url: cmsAssetUrl_(legacyPath, legacy.sha)} : {key: key, path: '', sha: '', url: value};
  }
  var store = cmsAssetRegistry_(), stats = cmsAssetStats_();
  if (store.owners[path] && store.owners[path] !== key) throw new Error('Asset source ownership collision: ' + path);
  var old = store.records[key], actual = cmsGithubSnapshot_().entries[path];
  var published = old && old.path === path && actual && actual.type === 'blob' && actual.sha === old.sha;
  var record = {key: key, identity: source.identity, sourceUrl: source.sourceUrl, path: path, sha: '', etag: '', lastModified: '', sourceModifiedAt: '', checkedAt: new Date().toISOString()};
  var bytes, unchanged = false, pdf = /\.pdf$/i.test(name), maximum = 16 * 1024 * 1024, pdfResponse; stats.checked++;
  if (pdf && file && typeof file.getSize === 'function') {
    var size = 0;
    try { size = Number(file.getSize()); } catch (sizeError) { /* Fall through to the blob when size metadata is unavailable. */ }
    if (Number.isFinite(size) && size > maximum) return cmsAssetPdfFallback_(value, source, key, name, path, store);
  } else if (pdf && !file) {
    // UrlFetchApp supports GET, but not HEAD. A one-byte Range response exposes
    // total size without downloading the whole PDF when the server supports it.
    var rangeHeaders = {Range: 'bytes=0-0'};
    if (!context.refreshAssets && published) {
      if (old.etag) rangeHeaders['If-None-Match'] = old.etag;
      else if (old.lastModified) rangeHeaders['If-Modified-Since'] = old.lastModified;
    }
    try {
      var probe = previewFetch_(source.downloadUrl, {method: 'get', muteHttpExceptions: true, followRedirects: true, headers: rangeHeaders});
      var probeStatus = probe.getResponseCode();
      if (probeStatus === 304 && published && !context.refreshAssets && (old.etag || old.lastModified)) pdfResponse = probe;
      else if (probeStatus === 206) {
        var range = cmsAssetHeader_(probe, 'Content-Range').match(/^bytes\s+0-0\/(\d+)$/i);
        if (!range || !Number.isFinite(Number(range[1])) || Number(range[1]) < 1) return cmsAssetPdfFallback_(value, source, key, name, path, store, 'pdf-metadata-unavailable');
        if (Number(range[1]) > maximum) return cmsAssetPdfFallback_(value, source, key, name, path, store);
        // Small partial response: the established full GET below retrieves and
        // validates the complete PDF rather than treating a single byte as data.
      } else if (probeStatus === 200) {
        var length = cmsAssetHeader_(probe, 'Content-Length');
        if (/^\d+$/.test(length) && Number(length) > maximum) return cmsAssetPdfFallback_(value, source, key, name, path, store);
        pdfResponse = probe; // Range ignored: reuse this complete response once.
      } else return cmsAssetPdfFallback_(value, source, key, name, path, store, 'pdf-metadata-unavailable');
    } catch (probeError) { return cmsAssetPdfFallback_(value, source, key, name, path, store, 'pdf-metadata-unavailable'); }
  }
  if (file) {
    if (typeof file.getLastUpdated === 'function') {
      var modified = file.getLastUpdated();
      record.sourceModifiedAt = modified && typeof modified.toISOString === 'function' ? modified.toISOString() : String(modified || '');
    }
    if (!context.refreshAssets && published && record.sourceModifiedAt && record.sourceModifiedAt === old.sourceModifiedAt) unchanged = true;
    else { bytes = file.getBlob().getBytes(); stats.downloaded++; }
  } else {
    var headers = {};
    if (!context.refreshAssets && published) {
      if (old.etag) headers['If-None-Match'] = old.etag;
      else if (old.lastModified) headers['If-Modified-Since'] = old.lastModified;
    }
    var response = pdfResponse || previewFetch_(source.downloadUrl, {muteHttpExceptions: true, followRedirects: true, headers: headers});
    var status = response.getResponseCode();
    // A 304 is usable only when the exact validated bytes still exist in GitHub.
    if (status === 304 && (!published || !Object.keys(headers).length)) {
      response = previewFetch_(source.downloadUrl, {muteHttpExceptions: true, followRedirects: true, headers: {}}); status = response.getResponseCode();
    }
    if (status !== 200 && status !== 304) throw new Error('Asset download failed: HTTP ' + status);
    if (status === 304 && (!published || !Object.keys(headers).length)) throw new Error('Asset download returned 304 without validated published bytes.');
    record.etag = cmsAssetHeader_(response, 'ETag') || (status === 304 ? old.etag : '');
    record.lastModified = cmsAssetHeader_(response, 'Last-Modified') || (status === 304 ? old.lastModified : '');
    if (status === 304) unchanged = true;
    else { bytes = response.getBlob().getBytes(); stats.downloaded++; }
  }
  if (unchanged) { record.sha = old.sha; stats.notModified++; }
  else {
    if (pdf && bytes.length > maximum) return cmsAssetPdfFallback_(value, source, key, name, path, store);
    cmsValidateAsset_(name, bytes); record.sha = cmsGitBlobSha_(bytes);
    if (!actual || actual.type !== 'blob' || actual.sha !== record.sha) cmsQueueAsset_(path, Utilities.base64Encode(bytes));
  }
  // CheckedAt is the last persisted verification timestamp. Verification still
  // occurs every execution, but an identical record needs no Sheet rewrite.
  if (published && ['identity', 'sourceUrl', 'path', 'sha', 'etag', 'lastModified', 'sourceModifiedAt'].every(function(field) { return record[field] === old[field]; })) record.checkedAt = old.checkedAt;
  store.staged[key] = record; store.owners[path] = key;
  var prepared = context.preparedAssets[key] = {key: key, path: path, sha: record.sha, url: cmsAssetUrl_(path, record.sha)};
  context.assets[value] = prepared.url;
  return prepared;
}

function uploadImg(value) {
  value = String(value || '').trim();
  if (!value || value.indexOf('/*') === 0) return '';
  var context = cmsContext_();
  if (context.assets[value]) return context.assets[value];
  var prepared = cmsAssetPrepare_(value);
  return context.assets[value] = prepared ? prepared.url : value;
}

function cmsAssetRowValues_(row, parameters, options) {
  var kind = String(row[2] || ''), header = parameters || [], values = {}, sources = [];
  if (!kind || kind === 'Pass') return sources;
  if (header[0] !== 'Lab') header = ['Lab', 'Language', 'Function'].concat(header);
  header.forEach(function(key, index) {
    key = String(key || '').replace(/ \(.+\)/, '');
    var value = String(row[index] || '').trim(); values[key] = value.indexOf('/*') === 0 ? '' : value;
  });
  var direct = {Member: ['/* Photo url'], Alumni: ['/* Photo url'], Content: ['/* img url'], News: ['/* Avatar img url', '/* img url1', '/* img url2'], Publication: ['/* PDF link', '/* img url'], 'Publication (custom)': ['/* PDF link', '/* img url']};
  (direct[kind] || []).forEach(function(key) {
    var value = values[key]; if (!value) return;
    if (kind === 'Alumni' && key === '/* Photo url' &&
        ((typeof PreElement !== 'undefined' && Array.isArray(PreElement) && PreElement[2] === 'H1') ||
         (values['/* Name'] || '').indexOf('**') >= 0 || (options && options.alumniHeading))) return;
    // Composite Sheet presets render managed split logos, not the old source SVG.
    if (kind === 'Content' && /^(?:frontlogo2?|backlogo2?)$/.test(values['/* ID']) && /\/(?:two_logos_on_white_on_black|two_logos_teal_on_white)\.svg(?:[?#]|$)/.test(value)) return;
    sources.push(value);
  });
  var markdown = {Content: ['/* Text'], News: ['/* Text'], Member: ['/* Name', '/* Personal links'], Alumni: ['/* Name', '/* Former affiliation', '/* Current position', '/* Start date', '/* End date'], Publication: ['/* Related info'], 'Publication (custom)': ['/* Related info']};
  (markdown[kind] || []).forEach(function(key) {
    var expression = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g, match;
    while ((match = expression.exec(values[key] || ''))) if (match[1].indexOf('www.dropbox.com') >= 0) sources.push(match[1]);
  });
  return sources.filter(function(value, index) { return sources.indexOf(value) === index; });
}

function cmsAssetsPrepareRow_(row, parameters, options) {
  return cmsAssetRowValues_(row, parameters, options).map(function(value) { return cmsAssetPrepare_(value); }).filter(function(asset) { return asset && asset.path; }).map(function(asset) {
    return {sourceKey: asset.key, path: asset.path, sha: asset.sha};
  }).sort(function(first, second) { return first.sourceKey.localeCompare(second.sourceKey) || first.path.localeCompare(second.path); });
}
function cmsAssetRowFingerprint_(row, parameters, options) { return cmsAssetsPrepareRow_(row, parameters, options); }

function cmsValidateAsset_(name, bytes) {
  if (!bytes.length) throw new Error('Downloaded asset is empty.');
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Asset exceeds the 16 MiB CMS upload limit; add it through GitHub instead.');
  var start = bytes.slice(0, 512).map(function(value) { return String.fromCharCode((value + 256) % 256); }).join('');
  if (/<(?:!doctype\s+html|html|head|body)\b/i.test(start)) throw new Error('Downloaded asset is an HTML page, not an image/PDF: ' + name);
  var signature = bytes.slice(0, 12).map(function(value) { return (value + 256) % 256; });
  var valid = /\.pdf$/i.test(name) ? start.indexOf('%PDF-') === 0 :
    /\.svg$/i.test(name) ? /<svg\b/i.test(Utilities.newBlob(bytes).getDataAsString('UTF-8')) :
    /\.jpe?g$/i.test(name) ? signature[0] === 255 && signature[1] === 216 :
    /\.png$/i.test(name) ? signature.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' :
    /\.gif$/i.test(name) ? /^GIF8[79]a/.test(start) :
    /\.webp$/i.test(name) ? start.indexOf('RIFF') === 0 && start.slice(8, 12) === 'WEBP' :
    /\.avif$/i.test(name) ? start.slice(4, 8) === 'ftyp' && /avif|avis/.test(start.slice(8, 128)) : false;
  if (!valid) throw new Error('Asset bytes do not match the filename: ' + name);
}

function cmsQueueAsset_(path, content) {
  if (!previewWritablePath_(path) || !/^(?:img|pdf)\//.test(path)) throw new Error('Invalid asset path.');
  cmsValidateAsset_(path.slice(path.lastIndexOf('/') + 1), Utilities.base64Decode(content));
  var existing = cmsContext_().pendingAssets.filter(function(asset) { return asset.path === path; })[0];
  if (existing) {
    if (existing.content !== content) throw new Error('Two different assets share the filename: ' + path);
    return;
  }
  cmsContext_().pendingAssets.push({path: path, content: content});
  cmsAssetStats_().staged++;
}
