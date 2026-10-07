'use strict';
// Exercise the actual page DOM and deferred scripts in a minimal browser model.
// This is state/geometry QA; actual font rendering and screenshots are browser QA.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.style = {};
    (attrs.style || '').split(';').forEach(declaration => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return;
      const name = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.style[name] = declaration.slice(colon + 1).trim();
    });
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
      toggle: (name, force) => {
        const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name); else classes.delete(name);
        return add;
      }
    };
    this.dataset = {};
    this.height = 110;
    this.textContent = '';
  }
  get id() { return this.getAttribute('id'); }
  get className() { return this.getAttribute('class') || ''; }
  get src() { return this._src ? new URL(this._src, this.env.window.location.href).href : ''; }
  set src(value) { this._src = value; this.attributes.src = value; }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'src') this._src = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { this.children.push(child); child.parentElement = this; child.env = this.env; return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  contains(child) { while (child) { if (child === this) return true; child = child.parentElement; } return false; }
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ callback, once: options && options.once });
  }
  dispatch(type, extra = {}) {
    const event = { target: this, key: null, preventDefault() { this.defaultPrevented = true; }, ...extra };
    const listeners = this.listeners.get(type) || [];
    listeners.slice().forEach(listener => listener.callback(event));
    this.listeners.set(type, listeners.filter(listener => !listener.once));
    return event;
  }
  focus() { this.env.document.activeElement = this; }
  querySelectorAll(selector) { return findAll(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get clientHeight() {
    if (this.id === 'normal_header') return this.env.metrics.headerHeight;
    if (this.id === 'sidebar') return this.env.metrics.sidebarHeight;
    if (this.id === 'mobile-menu-content') return this.env.metrics.menuContentHeight;
    if (this.classList.contains('posts')) return this.env.metrics.mainHeight;
    if (this.tagName === 'FOOTER') return 350;
    return 40;
  }
  getBoundingClientRect() {
    const m = this.env.metrics;
    if (this.id === 'normal_header') {
      const height = m.headerRectHeight === undefined ? m.headerHeight : m.headerRectHeight;
      return { top: 0, bottom: height, height };
    }
    if (this.classList.contains('posts')) return { top: m.mainTop, bottom: m.mainTop + m.mainHeight, height: m.mainHeight };
    if (this.id === 'sidebar') return { top: this.style.top ? Number.parseFloat(this.style.top) : m.sidebarTop, height: m.sidebarHeight };
    if (this.tagName === 'IMG') return { top: Number.parseFloat(this.style.top) || 0, height: this.style.height && this.style.height !== 'auto' ? Number.parseFloat(this.style.height) : m.logoHeight };
    return { top: 0, bottom: this.clientHeight, height: this.clientHeight };
  }
}
function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
function matches(element, selector) {
  selector = selector.trim();
  const nth = selector.match(/:nth-child\((\d+)\)/);
  if (nth) {
    if (!element.parentElement || element.parentElement.children.indexOf(element) + 1 !== Number(nth[1])) return false;
    selector = selector.replace(nth[0], '');
  }
  const attr = selector.match(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/);
  if (attr) {
    if (element.getAttribute(attr[1]) === null || (attr[2] && element.getAttribute(attr[1]) !== attr[2])) return false;
    selector = selector.replace(attr[0], '');
  }
  const id = selector.match(/#([\w-]+)/);
  if (id && element.id !== id[1]) return false;
  const classes = Array.from(selector.matchAll(/\.([\w-]+)/g), match => match[1]);
  if (classes.some(name => !element.classList.contains(name))) return false;
  const tag = selector.match(/^[\w-]+/);
  return !tag || tag[0].toUpperCase() === element.tagName;
}
function findAll(element, selector) {
  const alternatives = selector.split(',');
  return descendants(element).filter(child => alternatives.some(alternative => {
    const parts = alternative.trim().split(/\s+/);
    const direct = parts.includes('>');
    if (direct) {
      const chain = alternative.split('>').map(part => part.trim());
      let current = child;
      for (let index = chain.length - 1; index >= 0; index--) {
        if (!current || !matches(current, chain[index])) return false;
        current = current.parentElement;
      }
      return true;
    }
    if (!matches(child, parts.at(-1))) return false;
    let ancestor = child.parentElement;
    for (let index = parts.length - 2; index >= 0; index--) {
      while (ancestor && !matches(ancestor, parts[index])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  }));
}
function parseHtml(html) {
  const document = new Element('document');
  const stack = [document];
  const voidTags = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g)) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      const closing = token.match(/^<\/([^\s>]+)/)[1].toUpperCase();
      const index = stack.findLastIndex(element => element.tagName === closing);
      if (index > 0) stack.length = index;
      continue;
    }
    const tag = token.match(/^<([^\s/>]+)/)[1];
    const attrs = {};
    const attributeText = token.slice(tag.length + 1, -1);
    for (const attr of attributeText.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[attr[1]] = (attr[2] ?? attr[3] ?? attr[4] ?? '').replaceAll('&amp;', '&');
    }
    const element = new Element(tag, attrs);
    if (attrs.src) element._src = attrs.src;
    stack.at(-1).appendChild(element);
    if (!voidTags.has(element.tagName)) stack.push(element);
  }
  document.getElementById = id => descendants(document).find(element => element.id === id) || null;
  document.getElementsByClassName = names => descendants(document).filter(element => names.split(/\s+/).every(name => element.classList.contains(name)));
  document.documentElement = document.querySelector('html') || new Element('html');
  document.body = document.querySelector('body') || document.documentElement;
  document.readyState = 'interactive';
  document.createElement = tag => { const element = new Element(tag); element.env = document.env; return element; };
  return document;
}
function createBrowser(page, options = {}) {
  const html = page.includes('<html') ? page : fs.readFileSync(path.join(root, page), 'utf8');
  const document = parseHtml(html);
  const eventTarget = new Element('window');
  let location = new URL(options.url || 'https://ponnhide.github.io/yachielab-preview/' + (page.endsWith('.html') ? page : 'blank.html') + '?lang=EN');
  const frames = new Map();
  const observers = [];
  let id = 0;
  const env = {
    document, observers, frames, preloadSources: [], reloads: 0,
    metrics: { headerHeight: 192, mainTop: 192, mainHeight: 5000, sidebarHeight: 320, sidebarTop: 248, logoHeight: 110, menuContentHeight: 580 }
  };
  const window = {
    innerWidth: options.width || 1280, innerHeight: 900, scrollY: 0,
    get location() { return location; },
    history: { replaceState(_state, _title, url) { location = new URL(url, location); } },
    getComputedStyle(element) { return { display: element.style.display || (['SECTION', 'DIV', 'P', 'BLOCKQUOTE'].includes(element.tagName) ? 'block' : 'inline') }; },
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(frame) { frames.delete(frame); },
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    dispatch: eventTarget.dispatch.bind(eventTarget),
    matchMedia(query) { return { matches: query.includes('reduced-motion') ? Boolean(options.reduceMotion) : window.innerWidth <= 600, addEventListener() {} }; },
    IntersectionObserver: class {
      constructor(callback, config) { this.callback = callback; this.config = config; this.targets = new Set(); observers.push(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      enter(target) { this.callback([{ isIntersecting: true, target }]); }
    }
  };
  location.reload = () => { env.reloads++; };
  env.window = window;
  document.env = env;
  descendants(document).forEach(element => { element.env = env; });
  class Image { set src(value) { env.preloadSources.push(value); } }
  env.context = vm.createContext({ window, document, URL, URLSearchParams, Image, console, setTimeout, clearTimeout, Promise });
  env.run = name => vm.runInContext(fs.readFileSync(path.join(root, 'js', name), 'utf8'), env.context, { filename: name });
  env.runSource = (source, name) => vm.runInContext(source, env.context, { filename: name });
  env.flush = timestamp => { const callbacks = Array.from(frames.values()); frames.clear(); callbacks.forEach(callback => callback(timestamp || 0)); };
  env.completeAnimation = () => { for (let time = 0; time <= 400; time += 20) env.flush(time); };
  env.element = id => document.getElementById(id);
  return env;
}

module.exports = { createBrowser, descendants };
