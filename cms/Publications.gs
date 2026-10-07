/** Publication fetching, MEDLINE parsing and citation markup. */
function publicationFetchText_(url, label) {
  for (var attempt = 0; attempt < 3; attempt++) {
    Utilities.sleep(350);
    var response;
    try { response = previewFetch_(url, { muteHttpExceptions: true }); }
    catch (error) {
      if (attempt === 2) throw new Error(label + ' request failed after 3 attempts');
      Utilities.sleep(700 * (attempt + 1));
      continue;
    }
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return response.getContentText();
    if ((status === 429 || status >= 500) && attempt < 2) { Utilities.sleep(700 * (attempt + 1)); continue; }
    throw new Error(label + ' request failed (HTTP ' + status + ')');
  }
  throw new Error(label + ' request failed');
}

function publicationMedline_(text) {
  var bibliography = {}, currentKey = '';
  sheetString_(text).split(/\r?\n/).forEach(function (line) {
    var match = line.match(/^([A-Z0-9]{2,4})\s*-\s?(.*)$/);
    if (match) {
      currentKey = match[1];
      var value = match[2].trim();
      if (bibliography[currentKey] === undefined) bibliography[currentKey] = value;
      else if (Array.isArray(bibliography[currentKey])) bibliography[currentKey].push(value);
      else bibliography[currentKey] = [bibliography[currentKey], value];
    } else if (currentKey && line.trim()) {
      var previous = bibliography[currentKey];
      if (Array.isArray(previous)) previous[previous.length - 1] += ' ' + line.trim();
      else bibliography[currentKey] += ' ' + line.trim();
    }
  });
  if (bibliography.AU && !Array.isArray(bibliography.AU)) bibliography.AU = [bibliography.AU];
  return bibliography;
}

function pmid_bibdict(url) {
  var id = (sheetString_(url).match(/[?&]id=([^&]+)/) || [])[1];
  var cache = CacheService.getScriptCache();
  var cacheKey = id ? 'pubmed-medline:v1:' + id : '';
  var text = cacheKey ? cache.get(cacheKey) : null;
  if (!text) {
    text = publicationFetchText_(url, 'PubMed');
    var parsed = publicationMedline_(text);
    if (!parsed.PMID || !parsed.TI) throw new Error('PubMed returned no valid MEDLINE citation');
    // Script Cache has a per-item size limit. Large abstracts can be rendered without caching.
    if (cacheKey && text.length < 30000) {
      try { cache.put(cacheKey, text, 21600); }
      catch (error) { /* Optional cache quota must not prevent a valid citation from rendering. */ }
    }
    return parsed;
  }
  return publicationMedline_(text);
}

function biorxiv_bibdict(url) {
  var data;
  try { data = JSON.parse(publicationFetchText_(url, 'bioRxiv')); }
  catch (error) { throw new Error('bioRxiv returned no valid citation'); }
  var article = data.collection && data.collection[0];
  if (!article || !article.title) throw new Error('bioRxiv returned no valid citation');
  return { AU: sheetString_(article.authors).split(';').map(function (author) { return author.trim().replace(/[.,]/g, ''); }).filter(function (author) { return !!author; }), TI: article.title };
}

function publicationList_(value) {
  return sheetString_(value).split(/,\s*/).map(function (entry) { return entry.trim(); }).filter(function (entry) { return !!entry; });
}

function publicationAuthors_(authors, members, equal, corresponding, compactNames) {
  authors = Array.isArray(authors) ? authors : (authors ? [sheetString_(authors)] : []);
  var normalize = function (name) { return compactNames ? sheetString_(name).replace(/[.\s]/g, '') : sheetString_(name); };
  var normalizedMembers = (members || []).map(normalize);
  var rendered = authors.map(function (original) {
    var author = compactNames ? sheetString_(original).replace(/\./g, '') : sheetString_(original);
    if ((corresponding || []).indexOf(author) >= 0) author += '*';
    if ((equal || []).indexOf(compactNames ? sheetString_(original).replace(/\./g, '') : sheetString_(original)) >= 0) author += '+';
    return normalizedMembers.indexOf(normalize(original)) >= 0 ? '<span class="member">' + author + '</span>' : author;
  });
  if (rendered.length < 2) return rendered.join('');
  return rendered.slice(0, -1).join(', ') + ' & ' + rendered[rendered.length - 1];
}

function publicationRelated_(value) {
  var text = sheetString_(value);
  if (!text || text.trim().indexOf('/*') === 0) return '';
  return '\n' + rendererMarkdown_(text).replace('<p>', "<p class='supinfo'>");
}

function publicationImageLayout_(imageStyle) {
  var widthStyle = '', imageOnlyStyle = '';
  sheetDeclarations_(imageStyle || '').forEach(function (declaration) {
    var css = declaration.property + ': ' + declaration.value + ';';
    // Percentages and clamp() widths are relative to the entire paper row,
    // rather than to the default 20% thumbnail column inside that row.
    if (declaration.property === 'width') widthStyle += css;
    else imageOnlyStyle += css;
  });
  return { widthStyle: widthStyle, imageStyle: imageOnlyStyle };
}

function publicationWrap_(body, image, style, equal, corresponding, related, affil, lang, id, imageStyle) {
  if (equal.length) body += '\n<p class="info">+Equally contributed</p>';
  if (corresponding.length) body += '\n<p class="info">*Corresponding authors</p>';
  body += publicationRelated_(related);
  var imageLayout = publicationImageLayout_(imageStyle);
  var html = '<section class="paper ' + sheetAttribute_(affil + ' ' + lang) + '" id="' + sheetAttribute_(id) + '"' +
    (image && imageLayout.widthStyle ? ' data-sheet-image-width="true"' : '') + sheetStyleAttributes_(style) + '>\n';
  html += '<section class="paper_txt_' + (image ? 'w' : 'wo') + '_photo">' + body + '\n</section>\n';
  if (image) html += '<section class="paper_photo"' + sheetStyleAttributes_(imageLayout.widthStyle) + '>\n<img class="personal_img" src="' + sheetAttribute_(image) + '" alt="paper_img"' + sheetStyleAttributes_(imageLayout.imageStyle) + '>\n</section>\n';
  return html + '</section>\n';
}

function pmid_html(result, members, pmid, paperUrl, pdf, image, style, equal, corresponding, related, affil, lang, id, imageStyle) {
  var body = '<p class="author">' + publicationAuthors_(result.AU, members, equal, corresponding, false) + '</p>\n<p class="title">' + sheetString_(result.TI) + '</p>\n';
  var year = sheetString_(result.DP).split(' ')[0];
  var details = [sheetString_(result.VI), sheetString_(result.PG), year].filter(function (value) { return !!value; }).join(', ');
  var journal = sheetString_(result.JT || result.TA);
  body += '<p class="info"><a class="JT" href="' + sheetAttribute_(paperUrl || 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/') + '">' + journal + '</a> ' + details +
    ' <a class="PMID" href="https://pubmed.ncbi.nlm.nih.gov/' + sheetAttribute_(pmid) + '/">PubMed</a>' + (pdf ? ' <a class="pdf-link" href="' + sheetAttribute_(pdf) + '">PDF</a>' : '') + '</p>';
  return publicationWrap_(body, image, style, equal || [], corresponding || [], related, affil, lang, id, imageStyle);
}

function biorxiv_html(result, members, identifier, paperUrl, pdf, image, style, equal, corresponding, related, affil, lang, id, imageStyle) {
  var body = '<p class="author">' + publicationAuthors_(result.AU, members, equal, corresponding, true) + '</p>\n<p class="title">' + sheetString_(result.TI) + '</p>\n';
  body += '<p class="info"><a class="JT" href="' + sheetAttribute_(paperUrl) + '">bioRxiv</a> ' + sheetString_(identifier) + (pdf ? ' <a class="pdf-link" href="' + sheetAttribute_(pdf) + '">PDF</a>' : '') + '</p>';
  return publicationWrap_(body, image, style, equal || [], corresponding || [], related, affil, lang, id, imageStyle);
}

function appendPublication(adict) {
  var context = cmsContext_();
  var equal = publicationList_(sheetValue_(adict, '/* Equally contributed authors'));
  var corresponding = publicationList_(sheetValue_(adict, '/* Corresponding authors'));
  var highlighted = sheetValue_(adict, '/* Highlighted authors');
  var members = highlighted ? publicationList_(highlighted) : context.members;
  var pdf = sheetValue_(adict, '/* PDF link'), image = sheetValue_(adict, '/* img url');
  pdf = pdf ? uploadImg(pdf) : ''; image = image ? uploadImg(image) : '';
  var pmid = sheetValue_(adict, '/* Pubmed ID'), url = sheetValue_(adict, '/* Journal link');
  var args = [members, pmid, url, pdf, image, sheetMargins_(adict), equal, corresponding, sheetValue_(adict, '/* Related info'), sheetValue_(adict, 'Lab'), sheetValue_(adict, 'Language').replace(/,/g, ''), sheetValue_(adict, '/* ID'), sheetImageStyle_(adict)];
  if (pmid) {
    if (!/^\d+$/.test(pmid.trim())) throw new Error('Publication row has an invalid PubMed ID');
    var fetchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=' + encodeURIComponent(pmid.trim()) + '&rettype=medline&retmode=text&tool=yachielab_preview_cms';
    var email = PropertiesService.getScriptProperties().getProperty('PUBMED_EMAIL');
    if (email) fetchUrl += '&email=' + encodeURIComponent(email);
    var bibliography = pmid_bibdict(fetchUrl);
    var journals = context.journals || {};
    if (journals[bibliography.JT]) bibliography.JT = journals[bibliography.JT];
    return pmid_html.apply(null, [bibliography].concat(args));
  }
  var identifier = (url.match(/\d+\.\d+\/\d{4}\.\d{2}\.\d{2}\.\d+/) || [])[0];
  if (!identifier) throw new Error('Publication row needs a PubMed ID or a bioRxiv DOI');
  args[1] = identifier;
  return biorxiv_html.apply(null, [biorxiv_bibdict('https://api.biorxiv.org/details/biorxiv/' + identifier)].concat(args));
}

function appendCustomPublication(adict) {
  var authors = sheetValue_(adict, '/* Authors');
  var highlighted = publicationList_(sheetValue_(adict, '/* Highlighted authors'));
  highlighted.forEach(function (member) { authors = authors.replace(member, '<span class="member">' + member + '</span>'); });
  var title = sheetValue_(adict, '/* Title');
  var body = '<p class="author">' + authors + '</p>\n<p class="title">' + title + (/[.!?]$/.test(title) ? '' : '.') + '</p>\n';
  var details = ['/* Vol', '/* Page', '/* Year, Date'].map(function (key) { return sheetValue_(adict, key); }).filter(function (value) { return !!value; }).join(', ');
  var pdf = sheetValue_(adict, '/* PDF link'), image = sheetValue_(adict, '/* img url');
  pdf = pdf ? uploadImg(pdf) : ''; image = image ? uploadImg(image) : '';
  body += '<p class="info"><a class="JT" href="' + sheetAttribute_(sheetValue_(adict, '/* Journal link')) + '">' + sheetValue_(adict, '/* Journal') + ' </a> ' + details + (pdf ? ' <a class="pdf-link" href="' + sheetAttribute_(pdf) + '">PDF</a>' : '') + '</p>';
  return publicationWrap_(body, image, sheetMargins_(adict), publicationList_(sheetValue_(adict, '/* Equally contributed authors')), publicationList_(sheetValue_(adict, '/* Corresponding authors')), sheetValue_(adict, '/* Related info'), sheetValue_(adict, 'Lab'), sheetValue_(adict, 'Language').replace(/,/g, ''), sheetValue_(adict, '/* ID'), sheetImageStyle_(adict));
}
