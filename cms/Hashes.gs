/** Pure V8 hashing for disposable CMS cache keys. No Apps Script service calls. */
function cmsUtf8Bytes_(text) {
  var bytes = [], value = String(text);
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      var next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00; i++; }
      else code = 0xfffd;
    } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 63), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

function cmsHashWords_(bytes) {
  if (!bytes || typeof bytes === 'string' || !Number.isSafeInteger(bytes.length) || bytes.length < 0) throw new Error('Hash input must be a byte array.');
  var length = bytes.length, words = new Array(Math.ceil((length + 9) / 64) * 16).fill(0);
  for (var i = 0; i < length; i++) words[i >>> 2] |= (bytes[i] & 255) << (24 - (i & 3) * 8);
  words[length >>> 2] |= 0x80 << (24 - (length & 3) * 8);
  // Append the big-endian 64-bit bit length, without JavaScript's 32-bit truncation.
  words[words.length - 2] = Math.floor(length / 0x20000000) >>> 0;
  words[words.length - 1] = (length * 8) >>> 0;
  return words;
}
function cmsHashHexWords_(words) { return words.map(function(word) { return ('00000000' + (word >>> 0).toString(16)).slice(-8); }).join(''); }
function cmsHashRotateRight_(word, bits) { return (word >>> bits) | (word << (32 - bits)); }

function cmsSha1Hex_(bytes) {
  var words = cmsHashWords_(bytes), schedule = new Array(80);
  var hash = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  for (var block = 0; block < words.length; block += 16) {
    var a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4];
    for (var round = 0; round < 80; round++) {
      if (round < 16) schedule[round] = words[block + round];
      else { var expanded = schedule[round - 3] ^ schedule[round - 8] ^ schedule[round - 14] ^ schedule[round - 16]; schedule[round] = (expanded << 1) | (expanded >>> 31); }
      var functionValue, constant;
      if (round < 20) { functionValue = (b & c) | (~b & d); constant = 0x5a827999; }
      else if (round < 40) { functionValue = b ^ c ^ d; constant = 0x6ed9eba1; }
      else if (round < 60) { functionValue = (b & c) | (b & d) | (c & d); constant = 0x8f1bbcdc; }
      else { functionValue = b ^ c ^ d; constant = 0xca62c1d6; }
      var next = (((a << 5) | (a >>> 27)) + functionValue + e + constant + schedule[round]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0; hash[4] = (hash[4] + e) >>> 0;
  }
  return cmsHashHexWords_(hash);
}

var CMS_SHA256_ROUNDS_ = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function cmsSha256Hex_(bytes) {
  var words = cmsHashWords_(bytes), schedule = new Array(64), constants = CMS_SHA256_ROUNDS_, rotate = cmsHashRotateRight_;
  var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (var block = 0; block < words.length; block += 16) {
    for (var round = 0; round < 64; round++) {
      if (round < 16) schedule[round] = words[block + round];
      else {
        var first = schedule[round - 15], second = schedule[round - 2];
        var low = rotate(first, 7) ^ rotate(first, 18) ^ (first >>> 3);
        var high = rotate(second, 17) ^ rotate(second, 19) ^ (second >>> 10);
        schedule[round] = (schedule[round - 16] + low + schedule[round - 7] + high) >>> 0;
      }
    }
    var a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
    for (var round = 0; round < 64; round++) {
      var upper = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      var lower = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      var carry = (h + upper + ((e & f) ^ (~e & g)) + constants[round] + schedule[round]) >>> 0;
      var mixed = (lower + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + carry) >>> 0; d = c; c = b; b = a; a = (carry + mixed) >>> 0;
    }
    var updated = [a, b, c, d, e, f, g, h];
    for (var index = 0; index < 8; index++) hash[index] = (hash[index] + updated[index]) >>> 0;
  }
  return cmsHashHexWords_(hash);
}
