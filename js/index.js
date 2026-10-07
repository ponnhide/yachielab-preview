/** Homepage image highlights. Language and navigation live in common.js. */
(function (window, document) {
  'use strict';
  const site = window.YachieSite;
  if (!site || !site.isHomePage) return;
  function assetUrl(value) {
    if (window.YachieAssets) return window.YachieAssets.versionUrl(value);
    return typeof site.assetUrl === 'function' ? site.assetUrl(value) : value;
  }
  const footer = document.querySelector('footer');
  const highlights = [
    ['main_research_EN', 'H_1r', 'H_2r'],
    ['main_news_EN', 'M_1r', 'M_2r'],
    ['main_pplV_EN', 'D_1r', 'D_2r'],
    ['main_pplO_EN', 'J_1r', 'J_2r'],
    ['main_publications_EN', 'F_1r', 'F_2r'],
    ['main_joinus_EN', 'L_1r', 'L_2r'],
    ['main_resources_EN', 'N_1r', 'N_2r']
  ].map(function (entry) {
    return {
      control: document.getElementById(entry[0]),
      image: document.getElementById(entry[0].replace('_EN', '_img')),
      normalName: entry[1], highlightedName: entry[2], active: false
    };
  }).filter(function (entry) { return entry.control && entry.image; });

  function renderHighlights() {
    const anyActive = highlights.some(function (entry) { return entry.active; });
    highlights.forEach(function (entry) {
      const filename = entry.active ? entry.highlightedName : entry.normalName;
      entry.image.src = assetUrl(entry.image.src.replace(/[^/]+\.png(?=([?#].*)?$)/, filename + '.png'));
      entry.image.style.animationPlayState = entry.active ? 'paused' : 'running';
      entry.image.style.zIndex = entry.active ? '21' : '0';
      entry.control.style.zIndex = anyActive ? '23' : '19';
    });
    if (footer) footer.style.zIndex = anyActive ? '22' : '18';
  }

  highlights.forEach(function (entry) {
    entry.control.addEventListener('mouseenter', function () { entry.active = true; renderHighlights(); });
    entry.control.addEventListener('mouseleave', function () { entry.active = false; renderHighlights(); });
    entry.control.addEventListener('focusin', function () { entry.active = true; renderHighlights(); });
    entry.control.addEventListener('focusout', function (event) {
      if (!entry.control.contains(event.relatedTarget)) { entry.active = false; renderHighlights(); }
    });
    const preload = new Image();
    preload.src = assetUrl(entry.image.src.replace(entry.normalName + '.png', entry.highlightedName + '.png'));
  });
  ['FF_1_cropped.png', 'FF_2_cropped.png'].forEach(function (filename) {
    const image = new Image();
    image.src = assetUrl(new URL('./img/' + filename, window.location.href).href);
  });
  document.querySelectorAll('#sidebar > section').forEach(function (section, index) {
    if (index < 3) {
      const label = section.querySelector('p');
      if (label) label.textContent = '\u00a0';
    }
  });
})(window, document);
