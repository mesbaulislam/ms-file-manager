/* tests/functional-test.js - drives the REAL app code (all 4 JS files) in Node
 * with a stub DOM + stub DeviceStorage, pressing keys through the app's own
 * keydown router. Asserts screen flow, menus, dialogs, search, zip, copy.
 * Run: node tests/functional-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name);
  else {
    fails++;
    console.log('FAIL ' + name + (extra ? ' :: ' + extra : ''));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- stub DOM ---------- */
const TAG = { 'dlg-input': 'INPUT', 'search-input': 'INPUT' };
const els = {};
function makeEl(id) {
  const cls = new Set();
  const el = {
    id,
    tagName: TAG[id] || 'DIV',
    _html: '',
    _text: '',
    value: '',
    scrollTop: 0,
    clientHeight: 262,
    offsetTop: 0,
    offsetHeight: 44,
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
    },
    style: {},
    _listeners: {},
    addEventListener(t, fn) {
      (this._listeners[t] = this._listeners[t] || []).push(fn);
    },
    focus() {
      document.activeElement = el;
    },
    blur() {
      if (document.activeElement === el) document.activeElement = null;
    },
    setSelectionRange() {},
    scrollIntoView() {},
    get children() {
      return [];
    },
    querySelector() {
      return makeEl(id + '?');
    },
    querySelectorAll() {
      return [];
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
    },
  });
  Object.defineProperty(el, 'textContent', {
    get() {
      return this._text;
    },
    set(v) {
      this._text = String(v);
    },
  });
  return el;
}
const docListeners = {};
global.document = {
  activeElement: null,
  hidden: false,
  getElementById(id) {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  },
  addEventListener(t, fn) {
    (docListeners[t] = docListeners[t] || []).push(fn);
  },
  dispatchEvent() {},
};
global.window = global;
global.window.close = () => {};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
};
global.URL.createObjectURL = () => 'blob:fake';
global.URL.revokeObjectURL = () => {};
global.FileReader = function () {
  this.onload = null;
  this.onerror = null;
  this.result = null;
};
global.FileReader.prototype.readAsArrayBuffer = function () {
  const self = this;
  setTimeout(() => {
    try {
      const buf = fs.readFileSync('/tmp/msfm-zips/t1.zip');
      self.result = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
      if (self.onload) self.onload();
    } catch (e) {
      if (self.onerror) self.onerror();
    }
  }, 5);
};
global.FileReader.prototype.readAsText = function () {
  const self = this;
  setTimeout(() => {
    self.result = 'fake text content';
    if (self.onload) self.onload();
  }, 5);
};

/* ---------- stub DeviceStorage (simulates Energizer E241S, KaiOS 2.5.3.2:
 *  enumerate() returns names with a leading '/' and a 'sdcard1/' volume
 *  prefix on the internal stores. get/addNamed/delete require the VERBATIM
 *  name (exact match), like the real device. ---------- */
const D = 86400000;
const NOW = Date.now();
const FAKE = {
  pictures: [
    { name: '/sdcard1/DCIM/Camera/IMG_001.jpg', size: 2203441, date: NOW - D },
    { name: '/sdcard1/DCIM/Camera/IMG_002.jpg', size: 1887436, date: NOW - D },
    { name: '/sdcard1/DCIM/Screenshots/shot1.png', size: 875520, date: NOW - 2 * D },
    { name: '/sdcard1/DCIM/notes.txt', size: 120, date: NOW - 3 * D },
    { name: '/sdcard1/Pictures/photo.jpg', size: 1258291, date: NOW - 4 * D },
  ],
  videos: [{ name: '/sdcard1/Videos/VID_001.mp4', size: 13107200, date: NOW - 2 * D }],
  music: [{ name: '/sdcard1/Music/song.mp3', size: 4194304, date: NOW - 5 * D }],
  sdcard: [
    { name: '/Download/app.zip', size: 364, date: NOW - D },
    { name: '/Download/song2.mp3', size: 5242880, date: NOW - 6 * D },
    { name: '/Documents/readme.txt', size: 2048, date: NOW - 7 * D },
  ],
};
const written = {}; // 'store|name' -> size (files created via addNamed)
function findSize(sname, name) {
  for (const f of FAKE[sname] || []) if (f.name === name) return f.size;
  const k = sname + '|' + name;
  return k in written ? written[k] : null;
}
function FakeStorage(sname) {
  this._name = sname;
}
FakeStorage.prototype.enumerate = function () {
  const files = FAKE[this._name] || [];
  let i = 0;
  const cursor = {};
  function fire() {
    const f = files[i];
    cursor.result = f ? { name: f.name, size: f.size, lastModifiedDate: new Date(f.date) } : null;
    if (cursor.onsuccess) cursor.onsuccess();
  }
  cursor.continue = function () {
    i++;
    setTimeout(fire, 2);
  };
  setTimeout(fire, 2);
  return cursor;
};
FakeStorage.prototype.get = function (name) {
  const self = this;
  const req = {};
  setTimeout(() => {
    const s = findSize(self._name, name);
    req.result = s === null ? null : { size: s };
    if (req.onsuccess) req.onsuccess();
  }, 2);
  return req;
};
FakeStorage.prototype.addNamed = function (blob, name) {
  const self = this;
  const req = {};
  setTimeout(() => {
    written[self._name + '|' + name] = blob && blob.size ? blob.size : 0;
    if (req.onsuccess) req.onsuccess();
  }, 2);
  return req;
};
FakeStorage.prototype.delete = function (name) {
  const self = this;
  const req = {};
  setTimeout(() => {
    delete written[self._name + '|' + name];
    if (req.onsuccess) req.onsuccess();
  }, 2);
  return req;
};
Object.defineProperty(globalThis, 'navigator', {
  value: { getDeviceStorage: (n) => new FakeStorage(n) },
  configurable: true,
  writable: true,
});

/* ---------- load the real app code ---------- */
for (const f of ['filesystem.js', 'operations.js', 'archive.js', 'app.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  (0, eval)(code); // eslint-disable-line
}
const $ = (id) => document.getElementById(id);
const visible = (id) => !$('scr-' + id).classList.contains('hidden');
const html = (id) => $(id).innerHTML;

let keyHandler = null;
function key(k) {
  try {
    keyHandler({ key: k, preventDefault() {} });
  } catch (e) {
    fails++;
    console.log('FAIL exception on key ' + k + ' :: ' + (e && e.stack));
  }
}

(async () => {
  // fire DOMContentLoaded -> App.init()
  for (const fn of docListeners['DOMContentLoaded'] || []) fn();
  keyHandler = (docListeners['keydown'] || [])[0];
  check('keydown router registered', !!keyHandler);
  await sleep(120);

  /* --- home --- */
  check('home visible after init', visible('home'));
  check('home has storage cards', html('scr-home').includes('Internal Storage') && html('scr-home').includes('SD Card'));
  check('home has 6 categories', (html('scr-home').match(/cat-tile/g) || []).length === 6);
  check('home has quick rows', html('scr-home').includes('Recent Files') && html('scr-home').includes('Settings'));
  check('home softkeys Menu/Open/empty', $('sk-l').textContent === 'Menu' && $('sk-c').textContent === 'Open' && $('sk-r').textContent === '');
  check('internal stats hidden (no invented numbers)', html('scr-home').includes('Tap to browse'));

  /* --- browse internal --- */
  key('Enter');
  await sleep(150);
  check('browse visible', visible('browse'));
  check('browse lists DCIM', html('browse-list').includes('DCIM'));
  check('volume prefix hidden (no sdcard1 folder)', !html('browse-list').includes('sdcard1'));
  check('browse softkeys Menu/Open/Option', $('sk-l').textContent === 'Menu' && $('sk-c').textContent === 'Open' && $('sk-r').textContent === 'Option');
  check('toRaw maps display->raw (pictures)', FS.toRaw('pictures', 'DCIM/Camera/IMG_001.jpg') === '/sdcard1/DCIM/Camera/IMG_001.jpg');
  check('browse lists Music/Pictures/Videos folders', html('browse-list').includes('Music') && html('browse-list').includes('Pictures'));

  /* --- drill into DCIM --- */
  key('Enter');
  await sleep(150);
  check('DCIM shows Camera + Screenshots', html('browse-list').includes('Camera') && html('browse-list').includes('Screenshots'));
  check('DCIM shows notes.txt with size', html('browse-list').includes('notes.txt') && html('browse-list').includes('120 B'));

  /* --- file options menu (Right softkey "Option") --- */
  key('ArrowDown');
  key('ArrowDown'); // focus notes.txt (folders: Camera, Screenshots)
  key('SoftRight');
  await sleep(60);
  check('menu overlay opens', !$('menu-ov').classList.contains('hidden'));
  check('menu has File Options items', html('menu-list').includes('Rename') && html('menu-list').includes('Delete') && html('menu-list').includes('Properties'));
  key('Backspace');
  await sleep(60);
  check('menu closes on Back', $('menu-ov').classList.contains('hidden'));

  /* --- app menu (Left softkey "Menu") --- */
  key('SoftLeft');
  await sleep(60);
  check('app menu opens', !$('menu-ov').classList.contains('hidden'));
  check('app menu has New folder/Sort/Exit', html('menu-list').includes('New folder') && html('menu-list').includes('Sort by') && html('menu-list').includes('Exit'));
  key('Backspace');
  await sleep(60);
  check('app menu closes on Back', $('menu-ov').classList.contains('hidden'));

  /* --- properties --- */
  key('SoftRight');
  await sleep(60);
  for (let i = 0; i < 5; i++) key('ArrowDown'); // Open, Rename, Copy, Move, Delete, (sep skipped), Properties
  key('Enter');
  await sleep(120);
  check('props screen visible', visible('props'));
  check('props shows name + size', html('props-body').includes('notes.txt') && html('props-body').includes('120'));
  check('props shows location', html('props-body').includes('Internal'));
  key('Backspace');
  await sleep(120);
  check('back returns to browse', visible('browse'));

  /* --- copy flow -> picker --- */
  key('SoftRight');
  await sleep(60);
  key('ArrowDown');
  key('ArrowDown'); // Copy
  key('Enter');
  await sleep(200);
  check('picker visible', visible('picker'));
  check('picker defaults to Pictures store', html('picker-crumb').includes('Pictures'));
  check('picker softkeys Cancel/Select', $('sk-l').textContent === 'Cancel' && $('sk-r').textContent === 'Select');
  key('SoftRight'); // Select -> copy notes.txt into pictures/
  await sleep(400);
  check('copy succeeded', $('toast').textContent.includes('Copied'));
  check('busy hidden after copy', $('busy-ov').classList.contains('hidden'));
  check('back on browse after copy', visible('browse'));

  /* --- rename folder flow --- */
  key('ArrowUp');
  key('ArrowUp'); // focus Camera folder
  key('SoftRight');
  await sleep(60);
  key('ArrowDown'); // Rename
  key('Enter');
  await sleep(150);
  check('rename prompt opens', !$('dlg-ov').classList.contains('hidden'));
  $('dlg-input').value = 'Camera2';
  await sleep(80); // let the prompt focus the input (50ms timer)
  key('Enter'); // accepts via dlgKey (inInput)
  await sleep(400);
  check('rename completed', $('toast').textContent.includes('Renamed'));
  check('busy hidden after rename', $('busy-ov').classList.contains('hidden'));

  /* --- search --- */
  // back to home: browseUp twice (DCIM -> root -> home)
  key('Backspace');
  await sleep(150);
  key('Backspace');
  await sleep(150);
  check('back at home', visible('home'));
  for (let i = 0; i < 8; i++) key('ArrowDown'); // focus q-search (tile zone jumps +3)
  key('Enter');
  await sleep(200);
  check('search screen visible', visible('search'));
  $('search-input').value = 'img';
  // simulate Enter in input
  document.activeElement = $('search-input');
  key('Enter');
  await sleep(400);
  check('search finds IMG files', html('search-list').includes('IMG_001.jpg'));
  check('search shows result count', $('search-hint').textContent.includes('result'));

  /* --- zip view --- */
  // home -> sdcard -> Download -> app.zip
  key('Backspace');
  await sleep(150);
  key('ArrowDown'); // stor-sdcard... focus may be anywhere; go home first via direct nav:
  // (simpler: use keyboard from home top)
  for (let i = 0; i < 12; i++) key('ArrowUp');
  key('ArrowDown'); // index 1 = SD Card
  key('Enter');
  await sleep(200);
  check('sdcard browse', visible('browse') && html('browse-list').includes('Download'));
  check('toRaw maps display->raw (sdcard)', FS.toRaw('sdcard', 'Download/app.zip') === '/Download/app.zip');
  key('ArrowDown'); // Download (folders: Documents, Download)
  key('Enter');
  await sleep(150);
  check('Download lists app.zip', html('browse-list').includes('app.zip'));
  key('Enter'); // open app.zip -> real zip bytes via FileReader stub
  await sleep(400);
  check('zip view visible', visible('zip'));
  check('zip lists entries', html('zip-list').includes('hello.txt') || html('zip-list').includes('readme.txt'));
  check('zip softkeys Menu/Open/Option', $('sk-l').textContent === 'Menu' && $('sk-c').textContent === 'Open' && $('sk-r').textContent === 'Option');

  /* --- extract focused file --- */
  for (let i = 0; i < 4; i++) key('ArrowDown'); // focus hello.txt (3 folders + empty.txt first)
  key('Enter'); // file mini-menu
  await sleep(80);
  key('Enter'); // Extract
  await sleep(200);
  check('extract opens picker', visible('picker'));
  key('SoftRight'); // Select destination
  await sleep(600);
  check('extract succeeded', $('toast').textContent.includes('Extracted 1 file'));
  check('busy hidden after extract', $('busy-ov').classList.contains('hidden'));

  /* --- settings --- */
  key('Backspace'); // zip -> browse (Download)
  await sleep(150);
  key('Backspace'); // browse: Download -> sdcard root
  await sleep(150);
  key('Backspace'); // browse root -> home
  await sleep(150);
  // navigate home -> q-settings (index 11; 9 downs: tile zone jumps +3)
  for (let i = 0; i < 12; i++) key('ArrowUp');
  for (let i = 0; i < 9; i++) key('ArrowDown');
  key('Enter');
  await sleep(150);
  check('settings visible', visible('settings'));
  check('settings rows', html('settings-list').includes('Show Hidden Files') && html('settings-list').includes('Default Sort'));
  const before = JSON.parse(store['msfm.settings.v1'] || '{}').sort;
  key('ArrowDown');
  key('Enter'); // cycle sort
  await sleep(60);
  const after = JSON.parse(store['msfm.settings.v1'] || '{}').sort;
  check('settings persist + cycle', before !== after, before + ' -> ' + after);

  console.log(fails === 0 ? '\nALL FUNCTIONAL TESTS PASSED' : '\n' + fails + ' TEST(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.log('FATAL ' + (e && e.stack));
  process.exit(1);
});
