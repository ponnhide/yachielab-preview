/** Stable public asset versions. Private Drive/Dropbox source identities stay private. */
function cmsPublicAssetPath_(path) {
  return typeof path === 'string' && /^(?:img|img_new|pdf)\/.+/.test(path) &&
    !/[\\?#\x00-\x1f\x7f]/.test(path) && !/(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/.test(path);
}

function cmsAssetVersionMap_() {
  var context = cmsContext_();
  if (!context.publicAssetVersions) {
    var versions = Object.create(null), entries = cmsGithubSnapshot_().entries;
    Object.keys(entries).forEach(function(path) {
      var entry = entries[path];
      if (cmsPublicAssetPath_(path) && entry.type === 'blob' && /^[a-f0-9]{40}$/.test(entry.sha || '')) versions[path] = entry.sha;
    });
    context.publicAssetVersions = versions;
    context.publicAssetHashCache = Object.create(null);
  }
  (context.pendingAssets || []).forEach(function(asset) {
    if (!cmsPublicAssetPath_(asset.path)) return;
    var cached = context.publicAssetHashCache[asset.path];
    if (!cached || cached.content !== asset.content) {
      cached = context.publicAssetHashCache[asset.path] = {content: asset.content, sha: cmsGitBlobSha_(Utilities.base64Decode(asset.content))};
    }
    context.publicAssetVersions[asset.path] = cached.sha;
  });
  return context.publicAssetVersions;
}

function cmsAssetVersionSha_(path) { return cmsAssetVersionMap_()[path] || ''; }

function cmsAssetVersionsManifest_() {
  var versions = cmsAssetVersionMap_(), assets = Object.create(null);
  Object.keys(versions).sort().forEach(function(path) { assets[path] = versions[path]; });
  return {version: 1, assets: assets};
}

function cmsAssetVersionPath_(url) {
  var path = String(url).split(/[?#]/)[0], base = PREVIEW_SITE_URL.replace(/\/$/, '');
  if (/^(?:https?:)?\/\//i.test(path)) {
    var absolute = path.indexOf('//') === 0 ? 'https:' + path : path;
    if (absolute.slice(0, base.length).toLowerCase() !== base.toLowerCase() || absolute[base.length] !== '/') return '';
    path = absolute.slice(base.length + 1);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return '';
  else {
    var basePath = base.replace(/^https?:\/\/[^/]+/i, '');
    if (basePath && path.indexOf(basePath + '/') === 0) path = path.slice(basePath.length + 1);
    else path = path.replace(/^\/+/, '').replace(/^(?:\.\.?\/)+/, '');
  }
  try { path = decodeURIComponent(path); } catch (error) { return ''; }
  return cmsPublicAssetPath_(path) ? path : '';
}

function cmsAssetVersionUrl_(url) {
  var value = String(url), path = cmsAssetVersionPath_(value);
  if (!path) return value;
  var sha = cmsAssetVersionSha_(path);
  if (!/^[a-f0-9]{40}$/.test(sha)) return value;
  var hash = value.indexOf('#'), fragment = hash < 0 ? '' : value.slice(hash);
  var beforeHash = hash < 0 ? value : value.slice(0, hash), query = beforeHash.indexOf('?');
  var address = query < 0 ? beforeHash : beforeHash.slice(0, query);
  var parameters = query < 0 || query === beforeHash.length - 1 ? [] : beforeHash.slice(query + 1).split('&');
  parameters = parameters.filter(function(parameter) {
    var key = parameter.split('=')[0];
    try { key = decodeURIComponent(key); } catch (error) { /* Preserve malformed unrelated query fields. */ }
    return key !== 'v';
  });
  parameters.push('v=' + sha.slice(0, 12));
  return address + '?' + parameters.join('&') + fragment;
}

function cmsAssetDecodeAttribute_(text) {
  return text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f0-9]+);/gi, function(entity) {
    var names = {'&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>'};
    if (names[entity.toLowerCase()]) return names[entity.toLowerCase()];
    var number = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}

function cmsAssetCssUrls_(css) {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(\burl\(\s*)(?:(["'])([\s\S]*?)\2|([^)]*?))(\s*\))/gi, function(match, opening, quote, quoted, bare, closing) {
    if (!opening) return match;
    var url = quote ? quoted : bare.trim(), versioned = cmsAssetVersionUrl_(url);
    if (versioned === url) return match;
    return opening + (quote || '') + versioned + (quote || '') + closing;
  });
}

function cmsAssetSrcset_(srcset) {
  // A data URL may contain commas; the URL token runs to whitespace, not to a comma.
  var output = '', index = 0;
  while (index < srcset.length) {
    var start = index;
    while (index < srcset.length && /[\s,]/.test(srcset[index])) index++;
    output += srcset.slice(start, index);
    start = index;
    while (index < srcset.length && !/\s/.test(srcset[index])) index++;
    var token = srcset.slice(start, index), trailing = (token.match(/,+$/) || [''])[0];
    output += cmsAssetVersionUrl_(trailing ? token.slice(0, -trailing.length) : token) + trailing;
    if (trailing) continue;
    start = index; var depth = 0;
    while (index < srcset.length) {
      if (srcset[index] === '(') depth++;
      if (srcset[index] === ')') depth--;
      if (srcset[index++] === ',' && depth === 0) break;
    }
    output += srcset.slice(start, index);
  }
  return output;
}

function cmsAssetVersionTag_(tag) {
  return tag.replace(/(\s+)([^\s"'<>/=]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi, function(match, space, name, equals, doubleQuoted, singleQuoted, bare) {
    if (!/^(?:src|srcset|poster|href|style)$/i.test(name)) return match;
    var original = doubleQuoted !== undefined ? doubleQuoted : singleQuoted !== undefined ? singleQuoted : bare;
    var value = cmsAssetDecodeAttribute_(original), attribute = name.toLowerCase(), changed;
    if (attribute === 'style') changed = cmsAssetCssUrls_(value);
    else if (attribute === 'srcset') changed = cmsAssetSrcset_(value);
    else if (attribute === 'href' && !/^pdf\//.test(cmsAssetVersionPath_(value))) return match;
    else changed = cmsAssetVersionUrl_(value);
    if (changed === value) return match;
    var quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : '"';
    changed = changed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    changed = quote === '"' ? changed.replace(/"/g, '&quot;') : changed.replace(/'/g, '&#39;');
    return space + name + equals + quote + changed + quote;
  });
}

function cmsVersionAssetHtml_(html) {
  return String(html).replace(/<!--[\s\S]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>|<style\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\s*>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, function(token) {
    if (token.indexOf('<!--') === 0) return token;
    if (/^<script\b/i.test(token)) {
      var scriptOpening = token.match(/^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/)[0];
      return cmsAssetVersionTag_(scriptOpening) + token.slice(scriptOpening.length);
    }
    if (/^<style\b/i.test(token)) {
      var opening = token.match(/^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/)[0], close = token.match(/<\/style\s*>$/i)[0];
      return cmsAssetVersionTag_(opening) + cmsAssetCssUrls_(token.slice(opening.length, -close.length)) + close;
    }
    return cmsAssetVersionTag_(token);
  });
}
