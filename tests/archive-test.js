/* archive-test.js - Node test for ../js/archive.js using real zip fixtures.
 * Run: node tests/archive-test.js   (fixtures in /tmp/msfm-zips, see README) */
var fs = require('fs');
var Archive = require('../js/archive.js');

var BASE = '/tmp/msfm-zips/';
var fails = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('PASS ' + name);
  } else {
    fails++;
    console.log('FAIL ' + name + (extra ? ' :: ' + extra : ''));
  }
}
function load(f) {
  var b = fs.readFileSync(BASE + f);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

/* t1: deflated + nested + empty + dir + binary */
(function () {
  var r = Archive.listEntries(load('t1.zip'));
  check('t1 lists ok', r.ok === true, JSON.stringify(r).slice(0, 120));
  var names = {};
  r.entries.forEach(function (e) { names[e.name] = e; });
  check('t1 has hello.txt', !!names['hello.txt']);
  check('t1 has docs/readme.txt', !!names['docs/readme.txt']);
  check('t1 has empty.txt', !!names['empty.txt']);
  check('t1 has photos/ dir', names['photos/'] && names['photos/'].isDir === true);
  check('t1 has bin/data.bin', !!names['bin/data.bin']);

  var u8 = load('t1.zip');
  var hello = Archive.extractEntry(u8, names['hello.txt']);
  check('t1 hello.txt extracts', hello.ok === true, hello.reason);
  var expected = 'Hello KaiOS! '.repeat ? null : null;
  var expStr = '';
  for (var i = 0; i < 500; i++) expStr += 'Hello KaiOS! ';
  var gotStr = '';
  for (var j = 0; j < hello.bytes.length; j++) gotStr += String.fromCharCode(hello.bytes[j]);
  check('t1 hello.txt byte-exact', hello.ok && gotStr === expStr,
    'len=' + (hello.bytes && hello.bytes.length));

  var empty = Archive.extractEntry(u8, names['empty.txt']);
  check('t1 empty.txt extracts to 0 bytes', empty.ok && empty.bytes.length === 0, empty.reason);

  var bin = Archive.extractEntry(u8, names['bin/data.bin']);
  check('t1 data.bin extracts, size=200000',
    bin.ok && bin.bytes.length === 200000, bin.reason + ' len=' + (bin.bytes && bin.bytes.length));

  var readme = Archive.extractEntry(u8, names['docs/readme.txt']);
  var rs = '';
  for (var k = 0; k < readme.bytes.length; k++) rs += String.fromCharCode(readme.bytes[k]);
  check('t1 nested readme content', readme.ok && rs === 'readme content', rs);
})();

/* t2: stored */
(function () {
  var u8 = load('t2.zip');
  var r = Archive.listEntries(u8);
  check('t2 lists ok', r.ok === true);
  var e = r.entries[0];
  check('t2 method is stored', e.method === 0, 'method=' + e.method);
  var x = Archive.extractEntry(u8, e);
  var s = '';
  for (var i = 0; i < x.bytes.length; i++) s += String.fromCharCode(x.bytes[i]);
  var exp = '';
  for (var k = 0; k < 50; k++) exp += 'stored content ';
  check('t2 stored.txt byte-exact', x.ok && s === exp, 'len=' + (x.bytes && x.bytes.length));
})();

/* t3: path traversal must be rejected */
(function () {
  var u8 = load('t3.zip');
  var r = Archive.listEntries(u8);
  check('t3 lists ok', r.ok === true);
  var evil = null, okf = null;
  r.entries.forEach(function (e) {
    if (e.name.indexOf('evil') >= 0) evil = e;
    if (e.name === 'ok.txt') okf = e;
  });
  check('t3 evil entry found', !!evil);
  check('t3 evil safeName is null', evil && evil.safe === null, 'safe=' + (evil && evil.safe));
  var x = Archive.extractEntry(u8, evil);
  check('t3 evil extract refused', x.ok === false && x.reason === 'unsafe-path', x.reason);
  var y = Archive.extractEntry(u8, okf);
  check('t3 ok.txt still extracts', y.ok === true);
})();

/* t4: unicode filename */
(function () {
  var u8 = load('t4.zip');
  var r = Archive.listEntries(u8);
  check('t4 lists ok', r.ok === true);
  var e = r.entries[0];
  check('t4 unicode name decoded', e.name === 'café-日本語.txt', JSON.stringify(e.name));
  var x = Archive.extractEntry(u8, e);
  var s = '';
  for (var i = 0; i < x.bytes.length; i++) s += String.fromCharCode(x.bytes[i]);
  check('t4 content ok', x.ok && s === 'unicode name body', s);
})();

/* t5: not a zip */
(function () {
  var r = Archive.listEntries(load('t5.bin'));
  check('t5 rejected as not-a-zip', r.ok === false && r.reason === 'not-a-zip', r.reason);
})();

/* safeName unit checks */
(function () {
  check('safe absolute rejected', Archive.safeName('/etc/passwd') === null);
  check('safe drive rejected', Archive.safeName('C:\\a.txt') === null);
  check('safe dotdot rejected', Archive.safeName('a/../../b') === null);
  check('safe normalizes', Archive.safeName('a//b/./c.txt') === 'a/b/c.txt');
  check('safe backslash', Archive.safeName('a\\b.txt') === 'a/b.txt');
})();

console.log(fails === 0 ? '\nALL TESTS PASSED' : '\n' + fails + ' TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
