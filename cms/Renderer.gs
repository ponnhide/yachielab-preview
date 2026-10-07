/** Sheets rows -> the existing site component DOM. No network or Sheet reads here. */
function rendererClasses_(adict) {
  return sheetAttribute_(sheetValue_(adict, 'Lab') + ' ' + sheetValue_(adict, 'Language').replace(/,/g, ''));
}

function rendererId_(adict) {
  var id = sheetValue_(adict, '/* ID');
  return id ? ' id="' + sheetAttribute_(id) + '"' : '';
}

function rendererImageStyleAttributes_(adict) {
  // The site controller changes the foreground SVG height every scroll frame.
  // Important image dimensions would prevent that white/teal clipping effect.
  var id = sheetValue_(adict, '/* ID');
  var ordinary = /^(?:frontlogo2?|backlogo2?)$|^mobile-/.test(id) ? ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'object-fit', 'object-position'] : [];
  return sheetStyleAttributes_(sheetImageStyle_(adict), '', ordinary);
}

function rendererMarkdown_(text) {
  text = sheetString_(text);
  var links = text.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || [];
  links.forEach(function (link) {
    var url = link.match(/\]\((https?:\/\/[^)]+)\)/)[1];
    if (url.indexOf('www.dropbox.com') >= 0) text = text.replace(url, uploadImg(url));
  });
  return new showdown.Converter().makeHtml(text);
}

function rendererRichText_(value, rich) {
  var text = sheetString_(value);
  var atMarkup = function (string) { return string.replace(/\\@\\/g, '<img src="./img/at.gif" style="vertical-align: middle; height: 1em;" alt="[at]">'); };
  if (!text || text.trim().indexOf('/*') === 0 || !rich || typeof rich.getRuns !== 'function') return atMarkup(text);
  var runs = rich.getRuns();
  if (!runs || !runs.length) return atMarkup(text);
  var formatted = runs.map(function (run) {
    var original = sheetString_(run.getText());
    var trailing = (original.match(/ +$/) || [''])[0];
    var content = original.slice(0, original.length - trailing.length);
    var style = run.getTextStyle();
    var color = '';
    try {
      var foreground = style.getForegroundColorObject();
      color = foreground ? foreground.asRgbColor().asHexString() : '';
    } catch (error) { /* Theme colors and unset rich-text colors need no inline span. */ }
    if (color && color.toLowerCase() !== '#000000') content = '<span style="color:' + sheetAttribute_(color) + '">' + content + '</span>';
    if (style.isBold()) content = '**' + content + '**';
    if (style.isItalic()) content = '*' + content + '*';
    return content + trailing;
  }).join('');
  return atMarkup(formatted);
}

function appendSingle(row, richrow) {
  var functionName = sheetString_(row[2]);
  if (!functionName || functionName === 'Pass') return '';
  var header = cmsContext_().parameters[functionName];
  if (!header) throw new Error('Unknown row function: ' + functionName);
  if (header[0] !== 'Lab') header = ['Lab', 'Language', 'Function'].concat(header);
  var richKeys = ['/* Text', '/* Name', '/* Related info', '/* Biosketch', '/* Former affiliation', '/* Start date', '/* End date', '/* Current position'];
  var adict = {};
  header.forEach(function (key, index) {
    key = sheetString_(key).replace(/ \(.+\)/, '');
    if (!key) return;
    var value = row[index] === undefined || row[index] === null ? (key.indexOf('/*') === 0 ? key : '') : sheetString_(row[index]);
    adict[key] = richKeys.indexOf(key) >= 0 ? rendererRichText_(value, richrow && richrow[index]) : value;
  });
  var renderers = { H1: appendH1, H2: appendH2, H3: appendH3, Member: appendMember, Content: appendContent, Publication: appendPublication,
    'Publication (custom)': appendCustomPublication, Post: appendPost, News: appendNews, div: appendDivStart, '/div': appendDivEnd, Alumni: appendAlumni };
  if (!renderers[functionName]) throw new Error('Unsupported row function: ' + functionName);
  return renderers[functionName](adict);
}

function appendH(adict, level) {
  return '<h' + level + ' class="page_title ' + rendererClasses_(adict) + '"' + rendererId_(adict) +
    sheetStyleAttributes_(sheetValue_(adict, '/* Style')) + '>' + sheetValue_(adict, '/* Title') + '</h' + level + '>';
}
function appendH1(adict) { return appendH(adict, '1'); }
function appendH2(adict) { return appendH(adict, '2'); }
function appendH3(adict) { return appendH(adict, '3'); }

function appendAlumni(adict) {
  var name = rendererMarkdown_(sheetValue_(adict, '/* Name'));
  var links = sheetValue_(adict, '/* Personal links');
  if (links) name += ' (' + links + ')';
  var fields = ['/* Former affiliation', '/* Current position', '/* Start date', '/* End date'].map(function (key) { return rendererMarkdown_(sheetValue_(adict, key)); });
  var content = '';
  var headerRow = Array.isArray(PreElement) && PreElement[2] === 'H1';
  var sectionId = rendererId_(adict);
  if (headerRow) {
    content = '<section class="grid-container alumni ' + rendererClasses_(adict) + '"' + sectionId + sheetStyleAttributes_(sheetMargins_(adict)) + '>\n';
    content += '<div class="subtitle grid-item grid-row"></div>\n';
    content += '<div class="subtitle grid-item grid-row">' + name + '</div>\n';
  } else if (sheetValue_(adict, '/* Name').indexOf('**') >= 0) {
    content += '<div class="subtitle grid-item grid-row"' + sectionId + '>' + name + '</div>\n<div class="subtitle grid-item grid-row"></div>\n';
  } else {
    var filter = sheetValue_(adict, '/* insta filter');
    content += '<div class="grid-item grid-row personal_photo' + (filter ? ' ' + sheetAttribute_(filter) : '') + '"' + sectionId + '>\n';
    var photo = sheetValue_(adict, '/* Photo url');
    var photoLink = photo ? uploadImg(photo) : '';
    content += photoLink ? '<img class="personal_img" src="' + sheetAttribute_(photoLink) + '" alt="' + sheetAttribute_(sheetValue_(adict, '/* Name in publication').split(',')[0]) + '">\n' : '<div class="noimage"></div>\n';
    content += '</div>\n<div class="grid-item grid-row">' + name + '</div>\n';
  }
  fields.forEach(function (field) { content += '<div class="' + (headerRow || sheetValue_(adict, '/* Name').indexOf('**') >= 0 ? 'subtitle ' : '') + 'grid-item grid-row">' + field + '</div>\n'; });
  // Pass rows intentionally occur within groups. Only close at a blank separator or EOF.
  if (PostElement === 'END' || (Array.isArray(PostElement) && !PostElement[2])) content += '</section>';
  return content;
}

function appendMember(adict) {
  var name = sheetValue_(adict, '/* Name');
  var links = sheetValue_(adict, '/* Personal links');
  if (links) name += ' (' + links + ')';
  var filter = sheetValue_(adict, '/* insta filter');
  var content = '<section class="member ' + rendererClasses_(adict) + '"' + rendererId_(adict) + sheetStyleAttributes_(sheetMargins_(adict)) + '>\n';
  content += '<div class="personal_photo' + (filter ? ' ' + sheetAttribute_(filter) : '') + '">\n';
  var photo = sheetValue_(adict, '/* Photo url');
  var photoLink = photo ? uploadImg(photo) : '';
  content += photoLink ? '<img class="personal_img" src="' + sheetAttribute_(photoLink) + '" alt="' + sheetAttribute_(sheetValue_(adict, '/* Name in publication').split(',')[0]) + '">\n' : '<div class="noimage"></div>\n';
  content += '</div>\n<div class="personal_info">\n';
  content += rendererMarkdown_(name).replace('<p>', '<p class="name">') + '\n';
  content += '<p class="dpos">' + sheetValue_(adict, '/* Position') + '</p>\n<p class="intro">' + sheetValue_(adict, '/* Biosketch') + '</p>\n';
  [['/* Project', 'Project', ''], ['/* Twitter', 'X', 'https://twitter.com/'], ['/* E-mail', 'E-mail', ''], ['/* Hobby or fun fact', 'Hobby or fun fact', '']].forEach(function (attribute) {
    var value = sheetValue_(adict, attribute[0]);
    if (!value) return;
    if (attribute[2]) value = '<a href="' + sheetAttribute_(attribute[2] + value) + '">' + value + '</a>';
    if (attribute[0] === '/* E-mail') value = value.replace('@', '<img src="./img/at.gif" style="vertical-align: middle; height: 1em;" alt="[at]">');
    content += '<p class="attribute"><span class="key">' + attribute[1] + ': </span><span class="value">' + value + '</span></p>\n';
  });
  sheetValue_(adict, '/* Others').split('\n').forEach(function (attribute) {
    if (!attribute.trim()) return;
    var colon = attribute.indexOf(': ');
    content += colon < 0 ? '<p class="attribute"><span class="key">' + attribute + '</span></p>\n' :
      '<p class="attribute"><span class="key">' + attribute.slice(0, colon) + ': </span><span class="value">' + attribute.slice(colon + 2) + '</span></p>\n';
  });
  return content + '</div>\n</section>\n';
}

function appendContent(adict) {
  var content = '<section class="content ' + rendererClasses_(adict) + '" id="' + sheetAttribute_(sheetValue_(adict, '/* ID')) + '"' + sheetStyleAttributes_(sheetValue_(adict, '/* Style')) + '>\n';
  var image = sheetValue_(adict, '/* img url');
  if (image) {
    var imageHtml = rendererLogoPair_(adict, image);
    if (!imageHtml) {
      var imageLink = uploadImg(image), filter = sheetValue_(adict, '/* insta filter');
      imageHtml = '<img src="' + sheetAttribute_(imageLink) + '" alt="content_img"';
      if (filter) imageHtml = '<div class="content_img_div ' + sheetAttribute_(filter) + '"' + rendererImageStyleAttributes_(adict) + '>' + imageHtml + '></div>';
      else imageHtml += rendererImageStyleAttributes_(adict) + ' class="content_img">';
    }
    var hyperlink = sheetValue_(adict, '/* img hyperlink');
    content += (hyperlink ? '<a href="' + sheetAttribute_(hyperlink) + '">' + imageHtml + '</a>' : imageHtml) + '\n';
  }
  var text = sheetValue_(adict, '/* Text');
  if (text) content += rendererMarkdown_(text) + '\n';
  return content + '</section>\n';
}

function rendererLogoPair_(adict, image) {
  if (!/^(?:frontlogo2?|backlogo2?)$/.test(sheetValue_(adict, '/* ID'))) return '';
  // Preserve existing Sheet inputs as presets, while emitting independent SVGs.
  var filename = sheetString_(image).split(/[?#]/)[0].split('/').pop();
  var variant = filename === 'two_logos_on_white_on_black.svg' ? 'white' :
    filename === 'two_logos_teal_on_white.svg' ? 'teal' : '';
  if (!variant) return '';
  return '<span class="logo-stack content_img"' + rendererImageStyleAttributes_(adict) + '><span class="logo-canvas">' +
    '<img class="logo-ubc" src="./img/header-ubc-' + variant + '.svg" alt="Yachie Lab, University of British Columbia">' +
    '<img class="logo-osaka" src="./img/header-osaka-' + variant + '.svg" alt="Laboratory of Creative Destruction Biology, The University of Osaka">' +
    '</span></span>';
}

function appendPost(adict) {
  var link = sheetValue_(adict, '/* Link');
  // Providers are loaded once by the browser controller, never by a Sheet snippet.
  link = link.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  if (/bsky[,.]app/i.test(link)) {
    link = link.replace(/bsky,app/gi, 'bsky.app').replace(/class=(['"])bluesky-embed\1/g, 'class="pre-bluesky-embed"');
    if (/^https?:\/\/bsky\.app\//i.test(link)) link = '<blockquote class="pre-bluesky-embed"><a href="' + sheetAttribute_(link) + '"></a></blockquote>';
  } else if (/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i.test(link)) {
    link = link.replace(/\/\/x\.com\//i, '//twitter.com/');
    link = '<blockquote class="pre-twitter-tweet"><a href="' + sheetAttribute_(link) + '"></a></blockquote>';
  } else if (/^https?:\/\/(?:www\.)?instagram\.com\//i.test(link)) {
    link = '<blockquote class="pre-instagram-media" data-instgrm-captioned data-instgrm-permalink="' + sheetAttribute_(link.replace(/\/$/, '') + '/?utm_source=ig_embed&utm_campaign=loading') + '" data-instgrm-version="14" style="background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin:1px; max-width:540px; min-width:326px; padding:0; width:calc(100% - 2px);"></blockquote>';
  }
  return '<section class="content sns-post ' + rendererClasses_(adict) + '" id="' + sheetAttribute_(sheetValue_(adict, '/* ID')) + '"' + sheetStyleAttributes_(sheetValue_(adict, '/* Style')) + '>\n' + link + '\n</section>\n';
}

function appendNews(adict) {
  var avatar = sheetValue_(adict, '/* Avatar img url');
  var images = ['/* img url1', '/* img url2'].map(function (key) { var url = sheetValue_(adict, key); return url ? uploadImg(url) : ''; }).filter(function (url) { return !!url; });
  var content = '<div class="x-embed ' + rendererClasses_(adict) + '">\n  <article class="tweet-embed" role="article" aria-label="Tweet">\n    <header class="t-header">\n      <div class="avatar" aria-hidden="true">\n';
  if (avatar) content += '        <img alt="" src="' + sheetAttribute_(uploadImg(avatar)) + '" />\n';
  content += '      </div>\n      <div class="who">\n        <div class="name">' + sheetValue_(adict, '/* Name') + '</div>\n      </div>\n    </header>\n    <div class="t-body">\n';
  // Markdown already emits paragraphs. Avoid invalid nested <p> nodes.
  content += '      ' + rendererMarkdown_(sheetValue_(adict, '/* Text')) + '\n';
  if (images.length) {
    content += '      <div class="media-grid is-' + images.length + '">\n';
    images.forEach(function (image) { content += '        <div class="item"><img alt="" src="' + sheetAttribute_(image) + '"></div>\n'; });
    content += '      </div>\n';
  }
  return content + '    </div>\n    <div class="t-meta">\n      <span>' + sheetValue_(adict, '/* Date') + '</span>\n    </div>\n  </article>\n</div>\n';
}

function appendDivStart(adict) {
  var direction = sheetValue_(adict, '/* Direction') || 'h';
  var defaults = direction === 'h' ? 'display: flex; flex-direction: row; justify-content: flex-start;' : direction === 'v' ? 'display: flex; flex-direction: column; justify-content: flex-start;' : '';
  return '<div class="' + rendererClasses_(adict) + '"' + rendererId_(adict) + sheetStyleAttributes_(sheetValue_(adict, '/* Style'), defaults) + '>\n';
}
function appendDivEnd() { return '</div>\n'; }
