// Existing URLs remain stable. Missing assets join the page's atomic commit.
function uploadImg(value) {
  value = String(value || '').trim();
  if (!value || value.indexOf('/*') === 0) return '';
  var context = cmsContext_();
  if (context.assets[value]) return context.assets[value];
  if (/^(?:\.\/)?(?:img|img_new|pdf)\//.test(value)) {
    return context.assets[value] = value.indexOf('./') === 0 ? value : './' + value;
  }
  if (!/^https?:\/\//i.test(value)) return value;
  var drive = value.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/);
  var file = drive ? DriveApp.getFileById(drive[1]) : null;
  var cleanUrl = value.split('#')[0].split('?')[0];
  var fileName = file ? file.getName() : decodeURIComponent(cleanUrl.slice(cleanUrl.lastIndexOf('/') + 1));
  if (!/\.(?:pdf|png|jpe?g|gif|webp|svg|avif)$/i.test(fileName)) return value;
  if (/[\\/\x00-\x1f]/.test(fileName)) throw new Error('Invalid asset filename.');
  var folder = /\.pdf$/i.test(fileName) ? 'pdf' : 'img';
  var path = folder + '/' + fileName;
  var result = './' + path;
  var existing = cmsGithubSnapshot_().entries[path];
  if (existing && !context.refreshAssets) return context.assets[value] = result;
  var blob;
  if (file) {
    blob = file.getBlob();
  } else {
    var download = value.replace(/([?&])dl=0(?=&|$)/, '$1dl=1');
    var response = previewFetch_(download, {muteHttpExceptions: true, followRedirects: true});
    if (response.getResponseCode() !== 200) throw new Error('Asset download failed: HTTP ' + response.getResponseCode());
    blob = response.getBlob();
  }
  var bytes = blob.getBytes();
  cmsValidateAsset_(fileName, bytes);
  var content = Utilities.base64Encode(bytes);
  cmsQueueAsset_(path, content);
  return context.assets[value] = result;
}

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
}
