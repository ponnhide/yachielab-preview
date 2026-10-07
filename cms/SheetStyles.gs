/** Explicit CMS style authority; generated layout defaults keep normal priority. */
function sheetString_(value) {
  return value === undefined || value === null ? '' : String(value);
}

function sheetValue_(adict, key) {
  var value = sheetString_(adict[key]);
  return value.trim().indexOf('/*') === 0 ? '' : value;
}

function sheetAttribute_(value) {
  return sheetString_(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sheetDeclarations_(css) {
  var declarations = [], buffer = '', quote = '', depth = 0, escaped = false;
  var text = sheetString_(css).replace(/\/\*[\s\S]*?\*\//g, '');
  for (var i = 0; i < text.length; i++) {
    var character = text[i];
    if (escaped) { buffer += character; escaped = false; continue; }
    if (character === '\\') { buffer += character; escaped = true; continue; }
    if (quote) {
      buffer += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; buffer += character; continue; }
    if (character === '(') depth++;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === ';' && depth === 0) { declarations.push(buffer); buffer = ''; }
    else buffer += character;
  }
  if (buffer.trim()) declarations.push(buffer);
  return declarations.map(function (declaration) {
    var colon = declaration.indexOf(':');
    if (colon < 1) return null;
    var property = declaration.slice(0, colon).trim().toLowerCase();
    var value = declaration.slice(colon + 1).trim().replace(/\s*!\s*important\s*$/i, '').trim();
    if (!/^[-a-z]+$/.test(property) || !value || /[{}<>]/.test(value)) return null;
    // Sheet authors sometimes use the invalid flex-between alias.
    if (property === 'justify-content' && value === 'flex-between') value = 'space-between';
    return { property: property, value: value };
  }).filter(function (declaration) { return declaration !== null; });
}

function sheetPromotableProperty_(property) {
  return /^(color|background|background-color|font|font-family|font-size|font-weight|font-style|font-variant|font-stretch|line-height|letter-spacing|word-spacing|text-align|text-decoration|text-indent|text-transform|white-space|word-break|overflow-wrap|vertical-align|width|height|min-width|max-width|min-height|max-height|object-fit|object-position|aspect-ratio|float|clear|margin(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|padding(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|gap|row-gap|column-gap|justify-content|align-items|align-content|align-self|justify-items|justify-self|flex-direction|flex-wrap|flex|flex-basis|flex-grow|flex-shrink|border(?:-(?:width|style|color|radius|top|right|bottom|left))?|border-(?:top|right|bottom|left)-(?:width|style|color)|border-(?:top-left|top-right|bottom-left|bottom-right)-radius|box-shadow)$/.test(property);
}

function sheetExplicitStyle_(css, ordinaryProperties) {
  ordinaryProperties = ordinaryProperties || [];
  var properties = [], style = '';
  sheetDeclarations_(css).forEach(function (declaration) {
    var promoted = sheetPromotableProperty_(declaration.property) && ordinaryProperties.indexOf(declaration.property) < 0;
    style += declaration.property + ': ' + declaration.value + (promoted ? ' !important' : '') + ';';
    if (promoted && properties.indexOf(declaration.property) < 0) properties.push(declaration.property);
  });
  return { style: style, properties: properties };
}

function sheetStyleAttributes_(css, defaults, ordinaryProperties) {
  var explicit = sheetExplicitStyle_(css, ordinaryProperties);
  var style = sheetString_(defaults) + explicit.style;
  var attributes = style ? ' style="' + sheetAttribute_(style) + '"' : '';
  if (explicit.properties.length) attributes += ' data-sheet-style="' + explicit.properties.join(' ') + '"';
  return attributes;
}

function sheetImageStyle_(adict) {
  var style = '';
  ['width', 'height'].forEach(function (dimension) {
    var value = sheetValue_(adict, '/* img ' + dimension);
    if (value) style += dimension + ': ' + (/^\d+(?:\.\d+)?$/.test(value) ? value + 'px' : value) + ';';
  });
  return style + sheetValue_(adict, '/* img style');
}

function sheetMargins_(adict) {
  var style = '';
  ['top', 'bottom'].forEach(function (direction) {
    var value = sheetValue_(adict, '/* Margin ' + direction);
    if (value) style += 'margin-' + direction + ': ' + (/^-?\d+(?:\.\d+)?$/.test(value) ? value + 'px' : value) + ';';
  });
  return style + sheetValue_(adict, '/* Style');
}
