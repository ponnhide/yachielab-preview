'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const runtime = vm.createContext({}); // No Utilities, Buffer, TextEncoder or network globals.
vm.runInContext(fs.readFileSync(path.join(root, 'cms/Hashes.gs'), 'utf8'), runtime, { filename: 'Hashes.gs' });
const utf8 = text => Array.from(runtime.cmsUtf8Bytes_(text));
const oracle = (algorithm, bytes) => crypto.createHash(algorithm).update(Buffer.from(bytes)).digest('hex');
function compare(bytes) {
  assert.equal(runtime.cmsSha1Hex_(bytes), oracle('sha1', bytes));
  assert.equal(runtime.cmsSha256Hex_(bytes), oracle('sha256', bytes));
}

test('UTF-8 and both hashes match Node for empty, ASCII, Japanese, emoji and NUL', () => {
  for (const text of ['', 'abc', 'The quick brown fox jumps over the lazy dog', '日本語の研究室', '🧬😀𠮷', '\0a\0日本語\0']) {
    assert.deepEqual(utf8(text), Array.from(Buffer.from(text, 'utf8')));
    compare(utf8(text));
  }
});

test('lone high/low surrogates become U+FFFD without losing adjacent text', () => {
  for (const text of ['\ud800', '\udfff', '\ud800A', 'A\udfffB', '\ud800\ud800', '\udfff\ud800', '\ud800\udc00', '\udbff\udfff']) {
    assert.deepEqual(utf8(text), Array.from(Buffer.from(text, 'utf8')));
    compare(utf8(text));
  }
  assert.deepEqual(utf8('\ud800'), [239, 191, 189]);
});

test('all UTF-8 length boundaries and representative Unicode ranges match the platform encoder', () => {
  for (const point of [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff, 0x10000, 0x10ffff]) {
    const text = String.fromCodePoint(point);
    assert.deepEqual(utf8(text), Array.from(Buffer.from(text, 'utf8')));
  }
  let seed = 0x12345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const text = Array.from({length: 2048}, () => String.fromCharCode(random() & 0xffff)).join('');
  assert.deepEqual(utf8(text), Array.from(Buffer.from(text, 'utf8')));
  compare(utf8(text));
});

test('SHA padding boundaries around one and multiple 512-bit blocks match Node', () => {
  for (const length of [0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 255, 256, 257, 511, 512, 513]) {
    compare(Array.from({length}, (_, index) => (index * 193 + length) & 255));
  }
});

test('all byte values, signed Apps Script bytes and Uint8Array inputs hash identically', () => {
  const unsigned = Array.from({length: 256}, (_, index) => index);
  compare(unsigned);
  compare(new Uint8Array(unsigned));
  const signed = unsigned.map(value => value > 127 ? value - 256 : value);
  assert.equal(runtime.cmsSha1Hex_(signed), oracle('sha1', unsigned));
  assert.equal(runtime.cmsSha256Hex_(signed), oracle('sha256', unsigned));
  assert.equal(unsigned.length, 256, 'Hashing must not append padding to the caller input');
});

test('deterministic random binary payloads span many blocks and match both independent digests', () => {
  let seed = 0x89abcdef;
  for (let sample = 0; sample < 64; sample++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const length = seed % 8193;
    const data = Array.from({length}, () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 24; });
    compare(data);
  }
});

test('long Unicode text and standard million-a vectors preserve repeated multi-block state', () => {
  compare(utf8('日本語🧬\ud800abcdefghijklmnopqrstuvwxyz\n'.repeat(3000)));
  const million = Array(1000000).fill(97);
  assert.equal(runtime.cmsSha1Hex_(million), '34aa973cd4c4daa4f61eeb2bdbad27316534016f');
  assert.equal(runtime.cmsSha256Hex_(million), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('Git blob SHA-1 prefixes the actual UTF-8 byte length rather than UTF-16 string length', () => {
  for (const text of ['', 'abc', '日本語🧬', '\ud800']) {
    const bytes = utf8(text), header = utf8('blob ' + bytes.length + '\0');
    const expected = crypto.createHash('sha1').update(Buffer.from('blob ' + Buffer.byteLength(text, 'utf8') + '\0')).update(Buffer.from(text, 'utf8')).digest('hex');
    assert.equal(runtime.cmsSha1Hex_(header.concat(bytes)), expected);
  }
});
