/* archive.js - minimal ZIP listing + extraction for KaiOS. ES5 only.
 *
 * Pure JavaScript, no dependencies. Supports:
 *   - method 0 (stored) and method 8 (deflated) via a small built-in inflater
 *   - directory entries, UTF-8 file names, nested paths
 * Refuses (with a reason, never silently):
 *   - path traversal (../), absolute paths, drive letters
 *   - zip64, multi-disk, encrypted entries, unknown methods
 *   - oversized archives (caps below; the E241S has 512 MB RAM)
 *
 * Security: extraction targets are always joined UNDER a caller-chosen
 * destination prefix, after safeName() validation.
 */
var Archive = (function () {
  var MAX_LIST_ENTRIES = 500;
  var MAX_SINGLE_UNCOMPRESSED = 64 * 1024 * 1024; /* 64 MB per file */
  var SIG_EOCD = [0x50, 0x4b, 0x05, 0x06];
  var SIG_CENTRAL = [0x50, 0x4b, 0x01, 0x02];
  var SIG_LOCAL = [0x50, 0x4b, 0x03, 0x04];

  /* ---------------- DEFLATE inflater ---------------- */
  var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function BitReader(buf, pos) {
    this.buf = buf;
    this.pos = pos || 0;
    this.bitbuf = 0;
    this.bitcnt = 0;
  }
  BitReader.prototype.get = function (n) {
    var b = this.bitbuf, c = this.bitcnt, buf = this.buf, p = this.pos;
    while (c < n) {
      if (p >= buf.length) throw { zip: 'truncated' };
      b |= buf[p++] << c;
      c += 8;
    }
    var v = b & ((1 << n) - 1);
    this.bitbuf = b >>> n;
    this.bitcnt = c - n;
    this.pos = p;
    return v;
  };
  BitReader.prototype.align = function () {
    this.bitbuf = 0;
    this.bitcnt = 0;
  };

  function Huffman(lengths) {
    var n = lengths.length, i, l;
    var maxLen = 0;
    for (i = 0; i < n; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
    var count = new Array(maxLen + 1);
    for (i = 0; i <= maxLen; i++) count[i] = 0;
    for (i = 0; i < n; i++) if (lengths[i] > 0) count[lengths[i]]++;
    var offs = new Array(maxLen + 1);
    offs[1] = 0;
    for (i = 2; i <= maxLen; i++) offs[i] = offs[i - 1] + count[i - 1];
    var symbols = new Array(n);
    var next = offs.slice(0);
    for (i = 0; i < n; i++) {
      l = lengths[i];
      if (l > 0) symbols[next[l]++] = i;
    }
    var first = new Array(maxLen + 1);
    var code = 0;
    for (i = 1; i <= maxLen; i++) {
      first[i] = code;
      code = (code + count[i]) << 1;
    }
    this.count = count;
    this.offs = offs;
    this.symbols = symbols;
    this.first = first;
    this.maxLen = maxLen;
  }
  Huffman.prototype.decode = function (br) {
    var code = 0, len;
    var first = this.first, count = this.count, offs = this.offs, symbols = this.symbols;
    for (len = 1; len <= this.maxLen; len++) {
      code = (code << 1) | br.get(1);
      if (code - first[len] < count[len]) {
        return symbols[offs[len] + (code - first[len])];
      }
    }
    throw { zip: 'bad huffman code' };
  };

  var fixedLit = null, fixedDist = null;
  function fixedTables() {
    if (fixedLit) return;
    var ll = new Array(288), i;
    for (i = 0; i < 144; i++) ll[i] = 8;
    for (i = 144; i < 256; i++) ll[i] = 9;
    for (i = 256; i < 280; i++) ll[i] = 7;
    for (i = 280; i < 288; i++) ll[i] = 8;
    var dl = new Array(32);
    for (i = 0; i < 32; i++) dl[i] = 5;
    fixedLit = new Huffman(ll);
    fixedDist = new Huffman(dl);
  }

  function readDynamic(br) {
    var HLIT = br.get(5) + 257;
    var HDIST = br.get(5) + 1;
    var HCLEN = br.get(4) + 4;
    var clLens = new Array(19), i, j;
    for (i = 0; i < 19; i++) clLens[i] = 0;
    for (i = 0; i < HCLEN; i++) clLens[CL_ORDER[i]] = br.get(3);
    var clHuff = new Huffman(clLens);
    var total = HLIT + HDIST;
    var lens = new Array(total);
    var li = 0;
    while (li < total) {
      var s = clHuff.decode(br);
      if (s <= 15) {
        lens[li++] = s;
      } else if (s === 16) {
        var rep = 3 + br.get(2);
        var prev = li > 0 ? lens[li - 1] : 0;
        for (j = 0; j < rep; j++) lens[li++] = prev;
      } else if (s === 17) {
        var repz = 3 + br.get(3);
        for (j = 0; j < repz; j++) lens[li++] = 0;
      } else {
        var repz2 = 11 + br.get(7);
        for (j = 0; j < repz2; j++) lens[li++] = 0;
      }
      if (li > total) throw { zip: 'bad dynamic lengths' };
    }
    return {
      lit: new Huffman(lens.slice(0, HLIT)),
      dist: new Huffman(lens.slice(HLIT))
    };
  }

  /* Inflate raw deflate data. Returns {ok, bytes} or {ok:false, reason}. */
  function inflateRaw(buf, pos, outLen) {
    try {
      if (outLen > MAX_SINGLE_UNCOMPRESSED) return { ok: false, reason: 'too-big' };
      fixedTables();
      var br = new BitReader(buf, pos);
      var out = new Uint8Array(outLen);
      var op = 0;
      var isFinal = false;
      while (!isFinal) {
        isFinal = br.get(1) === 1;
        var type = br.get(2);
        if (type === 0) {
          br.align();
          var len = br.get(16);
          var nlen = br.get(16);
          if ((len ^ 0xffff) !== nlen) throw { zip: 'bad stored block' };
          for (var i = 0; i < len; i++) {
            if (br.pos >= buf.length || op >= outLen) throw { zip: 'truncated' };
            out[op++] = buf[br.pos++];
          }
        } else if (type === 1 || type === 2) {
          var litH, distH;
          if (type === 1) {
            litH = fixedLit;
            distH = fixedDist;
          } else {
            var t = readDynamic(br);
            litH = t.lit;
            distH = t.dist;
          }
          for (;;) {
            var sym = litH.decode(br);
            if (sym < 256) {
              if (op >= outLen) throw { zip: 'overflow' };
              out[op++] = sym;
            } else if (sym === 256) {
              break;
            } else {
              var li = sym - 257;
              if (li < 0 || li > 28) throw { zip: 'bad length' };
              var length = LEN_BASE[li] + br.get(LEN_EXTRA[li]);
              var dsym = distH.decode(br);
              if (dsym < 0 || dsym > 29) throw { zip: 'bad distance' };
              var dist = DIST_BASE[dsym] + br.get(DIST_EXTRA[dsym]);
              if (dist < 1 || dist > op) throw { zip: 'bad distance' };
              for (var k = 0; k < length; k++) {
                if (op >= outLen) throw { zip: 'overflow' };
                out[op] = out[op - dist];
                op++;
              }
            }
          }
        } else {
          throw { zip: 'bad block type' };
        }
      }
      if (op !== outLen) return { ok: false, reason: 'size-mismatch' };
      return { ok: true, bytes: out };
    } catch (e) {
      var r = (e && e.zip) ? e.zip : 'inflate-error';
      return { ok: false, reason: r };
    }
  }

  /* ---------------- ZIP parsing ---------------- */
  function u16(b, p) {
    return b[p] | (b[p + 1] << 8);
  }
  function u32(b, p) {
    return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  }

  function decodeUtf8(bytes) {
    var s = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 0x80) {
        s += String.fromCharCode(c);
      } else if ((c & 0xe0) === 0xc0) {
        var c2 = bytes[i++] & 0x3f;
        s += String.fromCharCode(((c & 0x1f) << 6) | c2);
      } else if ((c & 0xf0) === 0xe0) {
        var d2 = bytes[i++] & 0x3f, d3 = bytes[i++] & 0x3f;
        s += String.fromCharCode(((c & 0x0f) << 12) | (d2 << 6) | d3);
      } else {
        var e2 = bytes[i++] & 0x3f, e3 = bytes[i++] & 0x3f, e4 = bytes[i++] & 0x3f;
        var cp = ((c & 0x07) << 18) | (e2 << 12) | (e3 << 6) | e4;
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        if (i > bytes.length) break;
      }
    }
    return s;
  }

  function dosDateTime(date, time) {
    try {
      var sec = (time & 0x1f) * 2;
      var min = (time >> 5) & 0x3f;
      var hr = (time >> 11) & 0x1f;
      var day = date & 0x1f;
      var mon = ((date >> 5) & 0x0f) - 1;
      var yr = ((date >> 9) & 0x7f) + 1980;
      return new Date(yr, mon, day, hr, min, sec).getTime();
    } catch (e) {
      return 0;
    }
  }

  function findEOCD(u8) {
    var n = u8.length;
    var start = Math.max(0, n - 65557);
    for (var i = n - 22; i >= start; i--) {
      if (u8[i] === SIG_EOCD[0] && u8[i+1] === SIG_EOCD[1] &&
          u8[i+2] === SIG_EOCD[2] && u8[i+3] === SIG_EOCD[3]) {
        return i;
      }
    }
    return -1;
  }

  /* List entries. Returns {ok, entries} or {ok:false, reason}. */
  function listEntries(u8) {
    try {
      var eo = findEOCD(u8);
      if (eo < 0) return { ok: false, reason: 'not-a-zip' };
      var cdCount = u16(u8, eo + 10);
      var cdOff = u32(u8, eo + 16);
      if (cdOff >= u8.length) return { ok: false, reason: 'bad-central-dir' };
      var entries = [];
      var p = cdOff;
      for (var i = 0; i < cdCount; i++) {
        if (p + 46 > u8.length) return { ok: false, reason: 'truncated' };
        if (u8[p] !== SIG_CENTRAL[0] || u8[p+1] !== SIG_CENTRAL[1] ||
            u8[p+2] !== SIG_CENTRAL[2] || u8[p+3] !== SIG_CENTRAL[3]) {
          return { ok: false, reason: 'bad-central-dir' };
        }
        var flags = u16(u8, p + 8);
        var method = u16(u8, p + 10);
        var mtime = u16(u8, p + 12);
        var mdate = u16(u8, p + 14);
        var compSize = u32(u8, p + 20);
        var uncompSize = u32(u8, p + 24);
        var nameLen = u16(u8, p + 28);
        var extraLen = u16(u8, p + 30);
        var commentLen = u16(u8, p + 32);
        var localOff = u32(u8, p + 42);
        var nameBytes = new Uint8Array(u8.buffer, u8.byteOffset + p + 46, nameLen);
        var rawName = '';
        for (var q = 0; q < nameBytes.length; q++) rawName += String.fromCharCode(nameBytes[q]);
        var name = (flags & 0x0800) ? decodeUtf8(nameBytes) : rawName;
        var isDir = name.charAt(name.length - 1) === '/';
        var unsupported = null;
        if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOff === 0xffffffff) {
          unsupported = 'zip64';
        } else if (flags & 0x0001) {
          unsupported = 'encrypted';
        } else if (method !== 0 && method !== 8 && !isDir) {
          unsupported = 'method-' + method;
        }
        entries.push({
          name: name,
          safe: safeName(name),
          isDir: isDir,
          method: method,
          compSize: compSize,
          uncompSize: uncompSize,
          localOff: localOff,
          date: dosDateTime(mdate, mtime),
          unsupported: unsupported
        });
        p += 46 + nameLen + extraLen + commentLen;
        if (entries.length >= MAX_LIST_ENTRIES) break;
      }
      return { ok: true, entries: entries, truncated: cdCount > entries.length };
    } catch (e) {
      return { ok: false, reason: 'parse-error' };
    }
  }

  /* Validate + normalize an archive-internal path. Null when unsafe. */
  function safeName(name) {
    if (!name) return null;
    var n = String(name).replace(/\\/g, '/');
    if (n.charAt(0) === '/') return null;
    if (/^[A-Za-z]:/.test(n)) return null;
    var parts = n.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (s === '..') return null;
      if (s === '' || s === '.') continue;
      out.push(s);
    }
    if (!out.length) return null;
    return out.join('/');
  }

  /* Extract one entry's bytes. Returns {ok, bytes} or {ok:false, reason}. */
  function extractEntry(u8, entry) {
    try {
      if (!entry || entry.isDir) return { ok: false, reason: 'is-dir' };
      if (entry.unsupported) return { ok: false, reason: entry.unsupported };
      if (!entry.safe) return { ok: false, reason: 'unsafe-path' };
      if (entry.uncompSize > MAX_SINGLE_UNCOMPRESSED) return { ok: false, reason: 'too-big' };
      var p = entry.localOff;
      if (p + 30 > u8.length) return { ok: false, reason: 'truncated' };
      if (u8[p] !== SIG_LOCAL[0] || u8[p+1] !== SIG_LOCAL[1] ||
          u8[p+2] !== SIG_LOCAL[2] || u8[p+3] !== SIG_LOCAL[3]) {
        return { ok: false, reason: 'bad-local-header' };
      }
      var nameLen = u16(u8, p + 26);
      var extraLen = u16(u8, p + 28);
      var dataOff = p + 30 + nameLen + extraLen;
      if (dataOff + entry.compSize > u8.length) return { ok: false, reason: 'truncated' };
      if (entry.method === 0) {
        var out = new Uint8Array(entry.compSize);
        for (var i = 0; i < entry.compSize; i++) out[i] = u8[dataOff + i];
        return { ok: true, bytes: out };
      }
      return inflateRaw(u8, dataOff, entry.uncompSize);
    } catch (e) {
      return { ok: false, reason: 'extract-error' };
    }
  }

  function isZipName(name) {
    return /\.zip$/i.test(name || '');
  }

  return {
    listEntries: listEntries,
    extractEntry: extractEntry,
    safeName: safeName,
    isZipName: isZipName,
    inflateRaw: inflateRaw,
    MAX_LIST_ENTRIES: MAX_LIST_ENTRIES,
    MAX_SINGLE_UNCOMPRESSED: MAX_SINGLE_UNCOMPRESSED
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Archive;
}
