/* app.js - MS File Manager UI: screens, navigation, keypad, search, settings.
 * ES5 only. Central key router; single-focus list model; overlay menus/dialogs.
 */
var App = (function () {
  'use strict';

  /* ================= settings ================= */
  var SET_KEY = 'msfm.settings.v1';
  var settings = { hidden: false, sort: 'name', defStore: 'internal', confirmDelete: true };
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY));
      if (s) {
        if (typeof s.hidden === 'boolean') settings.hidden = s.hidden;
        if (s.sort) settings.sort = s.sort;
        if (s.defStore) settings.defStore = s.defStore;
        if (typeof s.confirmDelete === 'boolean') settings.confirmDelete = s.confirmDelete;
      }
    } catch (e) {}
  }
  function saveSettings() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  /* ================= tiny utils ================= */
  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function icon(id, cls) {
    return '<svg class="' + (cls || '') + '"><use xlink:href="#' + id + '" href="#' + id + '"/></svg>';
  }
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function fmtSize(b) {
    b = b || 0;
    if (b < 1024) return b + ' B';
    var kb = b / 1024;
    if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
    var mb = kb / 1024;
    if (mb < 1024) return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
    return (mb / 1024).toFixed(1) + ' GB';
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
  }
  function fmtDateTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function baseName(p) {
    var i = String(p).lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : String(p);
  }
  function extOf(name) {
    var b = baseName(name);
    var i = b.lastIndexOf('.');
    if (i <= 0) return '';
    return b.slice(i + 1).toLowerCase();
  }

  /* ---- file kinds ---- */
  var KIND_DEFS = [
    { kind: 'image', label: 'Image', icon: 'i-img', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
    { kind: 'video', label: 'Video', icon: 'i-vid', exts: ['mp4', '3gp', 'webm'] },
    { kind: 'audio', label: 'Audio', icon: 'i-aud', exts: ['mp3', 'aac', 'm4a', 'ogg', 'wav'] },
    { kind: 'doc', label: 'Document', icon: 'i-doc', exts: ['txt', 'pdf', 'html', 'htm', 'json', 'xml', 'log'] },
    { kind: 'archive', label: 'Archive', icon: 'i-zip', exts: ['zip'] }
  ];
  var MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', '3gp': 'video/3gpp', webm: 'video/webm',
    mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
    txt: 'text/plain', html: 'text/html', htm: 'text/html', json: 'application/json',
    xml: 'text/xml', log: 'text/plain', pdf: 'application/pdf', zip: 'application/zip'
  };
  var TEXT_EXTS = ['txt', 'html', 'htm', 'json', 'xml', 'log'];
  function kindOf(name) {
    var e = extOf(name);
    for (var i = 0; i < KIND_DEFS.length; i++) {
      var d = KIND_DEFS[i];
      for (var j = 0; j < d.exts.length; j++) {
        if (d.exts[j] === e) {
          return { kind: d.kind, label: d.label + ' (' + e.toUpperCase() + ')', icon: d.icon,
                   mime: MIME[e] || '', text: TEXT_EXTS.indexOf(e) >= 0 };
        }
      }
    }
    return { kind: 'other', label: e ? 'File (.' + e + ')' : 'File',
             icon: 'i-doc', mime: MIME[e] || '', text: false };
  }
  function isHiddenName(name) {
    return baseName(name).charAt(0) === '.';
  }
  function visibleEntries(entries) {
    if (settings.hidden) return entries;
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      if (!isHiddenName(entries[i].name)) out.push(entries[i]);
    }
    return out;
  }

  /* ================= header / softkeys / toast ================= */
  function setHeader(ic, title) {
    var h = $('hdr-ic');
    if (ic === 'back') h.innerHTML = icon('i-back');
    else if (ic === 'search') h.innerHTML = icon('i-search');
    else if (ic === 'folder') h.innerHTML = icon('i-folder');
    else if (ic === 'gear') h.innerHTML = icon('i-gear');
    else h.innerHTML = icon('i-app');
    $('hdr-title').textContent = title;
  }
  function setSoftkeys(l, c, r) {
    $('sk-l').textContent = l || '';
    $('sk-c').textContent = c || '';
    $('sk-r').textContent = r || '';
  }
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.add('hidden');
    }, ms || 2500);
  }

  /* ================= popup menu (screen 4 style) ================= */
  var menuState = null;
  function showMenu(title, items, cb) {
    menuState = { items: items, focus: 0, cb: cb };
    $('menu-title').textContent = title;
    renderMenu();
    $('menu-ov').classList.remove('hidden');
    setSoftkeys('Select', '', 'Back');
  }
  function renderMenu() {
    var h = '';
    for (var i = 0; i < menuState.items.length; i++) {
      var it = menuState.items[i];
      if (it.sep) {
        h += '<div class="mi-sep"></div>';
        continue;
      }
      h += '<div class="mi' + (i === menuState.focus ? ' focused' : '') +
        (it.disabled ? ' disabled' : '') + '">' +
        icon(it.icon || 'i-info') + '<span>' + esc(it.label) + '</span>' +
        (it.disabled && it.why ? '<span class="why">' + esc(it.why) + '</span>' : '') + '</div>';
    }
    $('menu-list').innerHTML = h;
    var rows = $('menu-list').children;
    if (rows[menuState.focus] && rows[menuState.focus].scrollIntoView) {
      /* keep simple: menu is short; nudge scroll */
      $('menu-box').scrollTop = 0;
    }
  }
  function closeMenu(result) {
    $('menu-ov').classList.add('hidden');
    var cb = menuState.cb;
    menuState = null;
    restoreSoftkeys();
    if (cb) cb(result);
  }
  function menuKey(key) {
    var n = menuState.items.length;
    /* skip separators when moving */
    function step(d) {
      var f = menuState.focus;
      for (var k = 0; k < n; k++) {
        f = (f + d + n) % n;
        if (!menuState.items[f].sep) break;
      }
      menuState.focus = f;
      renderMenu();
    }
    if (key === 'ArrowUp') { step(-1); return true; }
    if (key === 'ArrowDown') { step(1); return true; }
    if (key === 'Enter' || key === 'SoftLeft') {
      var it = menuState.items[menuState.focus];
      if (it.disabled) {
        toast(it.why || 'Not available');
        return true;
      }
      closeMenu(menuState.focus);
      return true;
    }
    if (key === 'Backspace' || key === 'SoftRight') {
      closeMenu(-1);
      return true;
    }
    return false;
  }

  /* ================= dialog: confirm / prompt / message ================= */
  var dlgState = null;
  function showConfirm(title, msg, okLabel, danger, cb) {
    /* dangerous confirms default to Cancel so an accidental OK can't destroy */
    dlgState = { mode: 'confirm', focus: danger ? 0 : 1, cb: cb };
    $('dlg-title').textContent = title;
    $('dlg-msg').textContent = msg;
    $('dlg-input').classList.add('hidden');
    renderDlgButtons([{ label: 'Cancel' }, { label: okLabel || 'OK', danger: !!danger }]);
    $('dlg-ov').classList.remove('hidden');
    setSoftkeys('Cancel', '', okLabel || 'OK');
  }
  function showPrompt(title, msg, initial, cb) {
    dlgState = { mode: 'prompt', cb: cb };
    $('dlg-title').textContent = title;
    $('dlg-msg').textContent = msg;
    var inp = $('dlg-input');
    inp.classList.remove('hidden');
    inp.value = initial || '';
    renderDlgButtons([]);
    $('dlg-ov').classList.remove('hidden');
    setSoftkeys('OK', '', 'Cancel');
    setTimeout(function () {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 50);
  }
  function showMessage(title, msg, cb) {
    dlgState = { mode: 'message', cb: cb };
    $('dlg-title').textContent = title;
    $('dlg-msg').textContent = msg;
    $('dlg-input').classList.add('hidden');
    renderDlgButtons([{ label: 'OK' }]);
    $('dlg-ov').classList.remove('hidden');
    setSoftkeys('', '', 'OK');
  }
  function renderDlgButtons(btns) {
    var h = '';
    for (var i = 0; i < btns.length; i++) {
      h += '<div class="dbtn' + (i === dlgState.focus ? ' focused' : '') +
        (btns[i].danger ? ' danger' : '') + '">' + esc(btns[i].label) + '</div>';
    }
    $('dlg-btns').innerHTML = h;
    dlgState.buttons = btns;
  }
  function closeDlg(result, value) {
    $('dlg-ov').classList.add('hidden');
    try {
      $('dlg-input').blur();
    } catch (e) {}
    var cb = dlgState.cb;
    dlgState = null;
    restoreSoftkeys();
    if (cb) cb(result, value);
  }
  function dlgKey(key, inInput) {
    if (dlgState.mode === 'prompt') {
      if (inInput) {
        if (key === 'Enter' || key === 'ArrowUp' || key === 'ArrowDown') {
          var v = $('dlg-input').value;
          closeDlg(true, v);
          return true;
        }
        if (key === 'SoftLeft') {
          closeDlg(true, $('dlg-input').value);
          return true;
        }
        if (key === 'SoftRight') {
          closeDlg(false);
          return true;
        }
        return false; /* let system edit text */
      }
      return false;
    }
    /* confirm / message */
    var n = dlgState.buttons.length;
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      dlgState.focus = (dlgState.focus + n - 1) % n;
      renderDlgButtons(dlgState.buttons);
      syncDlgSoftkeys();
      return true;
    }
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      dlgState.focus = (dlgState.focus + 1) % n;
      renderDlgButtons(dlgState.buttons);
      syncDlgSoftkeys();
      return true;
    }
    if (key === 'Enter') {
      /* focus 0 = negative, last = affirmative */
      closeDlg(dlgState.focus === n - 1);
      return true;
    }
    if (key === 'SoftLeft') {
      closeDlg(false);
      return true;
    }
    if (key === 'SoftRight') {
      closeDlg(true);
      return true;
    }
    if (key === 'Backspace') {
      closeDlg(false);
      return true;
    }
    return false;
  }
  function syncDlgSoftkeys() {
    if (!dlgState || !dlgState.buttons) return;
    var b = dlgState.buttons;
    if (b.length === 2) setSoftkeys(b[0].label, '', b[1].label);
    else if (b.length === 1) setSoftkeys('', '', b[0].label);
  }

  /* ================= busy ================= */
  var busyOn = false;
  function showBusy(msg) {
    busyOn = true;
    $('busy-msg').textContent = msg || 'Working…';
    $('busy-ov').classList.remove('hidden');
  }
  function updateBusy(msg) {
    $('busy-msg').textContent = msg;
  }
  function hideBusy() {
    busyOn = false;
    $('busy-ov').classList.add('hidden');
  }

  /* ================= screen manager ================= */
  var SCREENS = ['home', 'browse', 'props', 'picker', 'search', 'zip', 'settings', 'text'];
  var current = null;
  var stack = [];
  var softkeyMemory = { l: '', c: '', r: '' };
  function rememberSoftkeys() {
    softkeyMemory.l = $('sk-l').textContent;
    softkeyMemory.c = $('sk-c').textContent;
    softkeyMemory.r = $('sk-r').textContent;
  }
  function restoreSoftkeys() {
    setSoftkeys(softkeyMemory.l, softkeyMemory.c, softkeyMemory.r);
  }
  function showScreen(name, data, push) {
    for (var i = 0; i < SCREENS.length; i++) {
      $('scr-' + SCREENS[i]).classList.add('hidden');
    }
    if (push !== false && current) {
      stack.push({ name: current, data: screenData(current) });
    }
    current = name;
    $('scr-' + name).classList.remove('hidden');
    renderScreen(name, data);
    rememberSoftkeys();
  }
  function goBack() {
    var prev = stack.pop();
    if (!prev) return false;
    for (var i = 0; i < SCREENS.length; i++) {
      $('scr-' + SCREENS[i]).classList.add('hidden');
    }
    if (prev.name === 'props') revokeThumb();
    current = prev.name;
    $('scr-' + current).classList.remove('hidden');
    renderScreen(current, prev.data);
    rememberSoftkeys();
    return true;
  }
  function screenData(name) {
    if (name === 'browse') return BW;
    if (name === 'props') return PROP;
    if (name === 'picker') return PK;
    if (name === 'search') return SH;
    if (name === 'zip') return ZIP;
    if (name === 'text') return TX;
    return null;
  }

  /* ================= scan cache ================= */
  var cache = {}; /* sname -> entries[] */
  var SD = { present: false, probed: false };
  var STATS = { internal: null, sdcard: null, internalDone: false, sdcardDone: false };
  function availStores() {
    var out = [];
    for (var i = 0; i < FS.STORES.length; i++) {
      if (FS.storeOk(FS.STORES[i])) out.push(FS.STORES[i]);
    }
    return out;
  }
  function ensureScanned(stores, onProg, cb) {
    var missing = [];
    for (var i = 0; i < stores.length; i++) {
      if (!cache[stores[i]]) missing.push(stores[i]);
    }
    if (!missing.length) {
      cb();
      return;
    }
    showBusy('Scanning storage…');
    var q = missing.slice();
    function next() {
      if (!q.length) {
        hideBusy();
        cb();
        return;
      }
      var sn = q.shift();
      FS.scanStore(sn, 0, function (n) {
        updateBusy('Scanning storage… ' + n);
      }, function (entries) {
        cache[sn] = entries;
        next();
      });
    }
    next();
  }
  function invalidateCache(stores) {
    for (var i = 0; i < stores.length; i++) delete cache[stores[i]];
  }

  /* ================= HOME (screen 1) ================= */
  var HF = { items: [], focus: 0 };
  var CATS = [
    { id: 'images', label: 'Images', icon: 'i-img' },
    { id: 'videos', label: 'Videos', icon: 'i-vid' },
    { id: 'music', label: 'Music', icon: 'i-music' },
    { id: 'documents', label: 'Documents', icon: 'i-doc' },
    { id: 'downloads', label: 'Downloads', icon: 'i-dl' },
    { id: 'archives', label: 'Archives', icon: 'i-zip' }
  ];
  function statLine(which) {
    /* v1.1.0: internal numbers are hidden — the pictures-area freeSpace/
     * usedSpace() returns wrong values on E241S (device-verified 2026-10-12).
     * Only the SD-card stats (verified correct) are shown. */
    if (which === 'internal') return 'Tap to browse';
    if (SD.probed && !SD.present) return 'Not available';
    var s = STATS.sdcard;
    if (s) return fmtSize(s.used) + ' / ' + fmtSize(s.total);
    if (STATS.sdcardDone) return 'Tap to browse';
    return 'Checking…';
  }
  function renderHome() {
    setHeader('app', 'MS File Manager');
    var h = '';
    var cards = [
      { id: 'stor-internal', ic: 'i-phone', name: 'Internal Storage', which: 'internal' },
      { id: 'stor-sdcard', ic: 'i-sd', name: 'SD Card', which: 'sdcard' }
    ];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var s = c.which === 'sdcard' ? STATS.sdcard : null;
      var bar = '';
      if (s && s.total > 0) {
        var pct = Math.min(100, Math.round((s.used / s.total) * 100));
        bar = '<div class="stor-bar"><div class="stor-fill" style="width:' + pct + '%"></div></div>';
      }
      h += '<div class="stor-card" data-id="' + c.id + '">' +
        '<span class="stor-ic">' + icon(c.ic) + '</span>' +
        '<span class="stor-mid"><div class="stor-name">' + c.name + '</div>' +
        '<div class="stor-sub">' + esc(statLine(c.which)) + '</div>' + bar + '</span>' +
        '<span class="stor-chev">' + icon('i-chev') + '</span></div>';
    }
    h += '<div id="cat-grid">';
    for (var k = 0; k < CATS.length; k++) {
      h += '<div class="cat-tile" data-id="cat-' + CATS[k].id + '">' +
        icon(CATS[k].icon) + '<div class="t">' + CATS[k].label + '</div></div>';
    }
    h += '</div>';
    var quick = [
      { id: 'q-recent', ic: 'i-up', t: 'Recent Files' },
      { id: 'q-browse', ic: 'i-folder', t: 'Browse Storage' },
      { id: 'q-search', ic: 'i-search', t: 'Search' },
      { id: 'q-settings', ic: 'i-gear', t: 'Settings' }
    ];
    for (var q = 0; q < quick.length; q++) {
      h += '<div class="qrow" data-id="' + quick[q].id + '">' + icon(quick[q].ic) +
        '<span class="t">' + quick[q].t + '</span>' +
        '<span class="chev">' + icon('i-chev') + '</span></div>';
    }
    $('scr-home').innerHTML = h;
    HF.items = ['stor-internal', 'stor-sdcard',
      'cat-images', 'cat-videos', 'cat-music', 'cat-documents', 'cat-downloads', 'cat-archives',
      'q-recent', 'q-browse', 'q-search', 'q-settings'];
    if (HF.focus >= HF.items.length) HF.focus = 0;
    paintHomeFocus();
    setSoftkeys('Menu', 'Open', '');
    rememberSoftkeys();
  }
  function paintHomeFocus() {
    var nodes = $('scr-home').querySelectorAll('[data-id]');
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].getAttribute('data-id') === HF.items[HF.focus];
      if (on) nodes[i].classList.add('focused');
      else nodes[i].classList.remove('focused');
    }
    var active = $('scr-home').querySelector('[data-id="' + HF.items[HF.focus] + '"]');
    if (active) {
      var sc = $('scr-home');
      var top = active.offsetTop;
      if (top < sc.scrollTop) sc.scrollTop = top;
      else if (top + active.offsetHeight > sc.scrollTop + sc.clientHeight) {
        sc.scrollTop = top + active.offsetHeight - sc.clientHeight;
      }
    }
  }
  function homeActivate() {
    var id = HF.items[HF.focus];
    if (id === 'stor-internal') openBrowseStorage('internal');
    else if (id === 'stor-sdcard') {
      if (SD.probed && !SD.present) toast('SD card not available');
      else openBrowseStorage('sdcard');
    }
    else if (id.indexOf('cat-') === 0) openCategory(id.slice(4));
    else if (id === 'q-recent') openRecent();
    else if (id === 'q-browse') showStorageChoice();
    else if (id === 'q-search') openSearch(null);
    else if (id === 'q-settings') showScreen('settings');
  }
  function showStorageChoice() {
    var items = [
      { label: 'Internal Storage', icon: 'i-phone' },
      { label: 'SD Card', icon: 'i-sd', disabled: SD.probed && !SD.present, why: 'no card' }
    ];
    showMenu('Browse Storage', items, function (i) {
      if (i === 0) openBrowseStorage('internal');
      else if (i === 1) openBrowseStorage('sdcard');
    });
  }
  function homeKey(key) {
    var inTiles = HF.focus >= 2 && HF.focus <= 7;
    if (key === 'ArrowUp') {
      if (inTiles && HF.focus >= 5) HF.focus -= 3;
      else if (HF.focus > 0) HF.focus--;
      paintHomeFocus();
      return true;
    }
    if (key === 'ArrowDown') {
      if (inTiles && HF.focus <= 4) HF.focus += 3;
      else if (HF.focus < HF.items.length - 1) HF.focus++;
      paintHomeFocus();
      return true;
    }
    if (key === 'ArrowLeft') {
      if (inTiles && HF.focus > 2) { HF.focus--; paintHomeFocus(); return true; }
      return false;
    }
    if (key === 'ArrowRight') {
      if (inTiles && HF.focus < 7) { HF.focus++; paintHomeFocus(); return true; }
      return false;
    }
    if (key === 'Enter') {
      homeActivate();
      return true;
    }
    if (key === 'SoftLeft') {
      showAppMenu();
      return true;
    }
    return false; /* Backspace at home: let the system exit */
  }
  function showAbout() {
    showMessage('About',
      'MS File Manager 1.1.0\nby MS Apps by FS\n\nKaiOS apps can only access named storages (Pictures, Videos, Music, SD Card) — full filesystem access is not available on this platform. Hidden files are not exposed to apps. Rename works as copy + verify + delete.');
  }

  /* ================= app menu (Left softkey "Menu") ================= */
  function showAppMenu() {
    var items = [];
    var inBrowse = (current === 'browse' && BW);
    var inSearch = (current === 'search');
    if (inBrowse || inSearch) {
      items.push({ label: 'Sort by: ' + sortLabel(), icon: 'i-check', value: 'sort' });
    }
    if (inBrowse && BW.mode === 'storage') {
      items.push({ label: 'New folder', icon: 'i-folder', value: 'newfolder' });
      items.push({ label: 'Search here', icon: 'i-search', value: 'searchhere' });
    }
    if (inSearch) {
      items.push({ label: 'Scope: ' + (SH.scope === 'here' ? 'This folder' : 'All storage'), icon: 'i-search', value: 'scope' });
      items.push({ label: 'Clear results', icon: 'i-x', value: 'clear' });
      if (SH.results.length) items.push({ label: 'Show in folder', icon: 'i-folder', value: 'infolder' });
    }
    items.push({ label: 'Recent files', icon: 'i-clock', value: 'recent' });
    items.push({ label: 'Search', icon: 'i-search', value: 'search' });
    items.push({ label: 'Settings', icon: 'i-gear', value: 'settings' });
    if (current === 'home') items.push({ label: 'About', icon: 'i-info', value: 'about' });
    items.push({ sep: true });
    items.push({ label: 'Exit', icon: 'i-x', value: 'exit' });
    showMenu('Menu', items, function (i) {
      if (i < 0) return;
      appMenuAction(items[i].value);
    });
  }
  function appMenuAction(v) {
    if (v === 'sort') showSortMenu();
    else if (v === 'newfolder') newFolderHere();
    else if (v === 'searchhere') openSearch(searchHereContext());
    else if (v === 'scope') searchScopeToggle();
    else if (v === 'clear') searchClear();
    else if (v === 'infolder') openContainingFolder(SH.results[SH.focus]);
    else if (v === 'recent') openRecent();
    else if (v === 'search') openSearch(null);
    else if (v === 'settings') showScreen('settings');
    else if (v === 'about') showAbout();
    else if (v === 'exit') { try { window.close(); } catch (e) {} }
  }

  /* "New folder" is create-on-write (KaiOS has no mkdir): the folder appears
   * immediately as a pending row and materializes when a file is
   * copied/moved into it. */
  var pendingFolders = {}; /* key: stores.join('+')+'|'+prefix -> [names] */
  function pendingKey() {
    return BW.stores.join('+') + '|' + BW.prefix;
  }
  function injectPendingFolders() {
    if (!BW || BW.mode !== 'storage') return;
    var key = pendingKey();
    var names = pendingFolders[key];
    if (!names || !names.length) return;
    var real = {};
    var i, j;
    for (i = 0; i < BW.folders.length; i++) real[BW.folders[i].name.toLowerCase()] = true;
    var keep = [];
    for (j = 0; j < names.length; j++) {
      if (real[names[j].toLowerCase()]) continue; /* materialized now */
      keep.push(names[j]);
      BW.folders.push({ name: names[j], count: 0, pending: true });
    }
    pendingFolders[key] = keep;
    BW.folders.sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  function newFolderHere() {
    if (!BW || BW.mode !== 'storage') {
      toast('Open a storage folder first');
      return;
    }
    showPrompt('New folder', 'Enter folder name:', '', function (ok, val) {
      if (!ok) return;
      val = String(val || '').trim();
      if (!val || val.indexOf('/') >= 0 || val === '.' || val === '..') {
        toast('Invalid name');
        return;
      }
      for (var i = 0; i < BW.folders.length; i++) {
        if (BW.folders[i].name.toLowerCase() === val.toLowerCase()) {
          toast('Folder already exists');
          return;
        }
      }
      var key = pendingKey();
      if (!pendingFolders[key]) pendingFolders[key] = [];
      pendingFolders[key].push(val);
      refreshBrowse();
      toast('Copy or move a file here to create it');
    });
  }

  /* ================= BROWSE (screens 2+3) ================= */
  var BW = null;
  /* BW = { mode:'storage'|'recent'|'category', stores:[], prefix:'', title:'',
            entries:[], folders:[], files:[], focus:0, cat:'' } */
  function cmpName(a, b) {
    var x = baseName(a.name).toLowerCase(), y = baseName(b.name).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function sortFiles(files) {
    var arr = files.slice();
    var mode = settings.sort;
    arr.sort(function (a, b) {
      var r = 0;
      if (mode === 'size') r = (b.size - a.size);
      else if (mode === 'date') r = (b.date - a.date);
      else if (mode === 'type') {
        var x = extOf(a.name), y = extOf(b.name);
        r = x < y ? -1 : x > y ? 1 : 0;
      }
      if (r === 0) r = cmpName(a, b);
      return r;
    });
    return arr;
  }
  function catFilter(cat) {
    return function (e) {
      var nm = e.name.toLowerCase();
      if (cat === 'images') return /\.(jpg|jpeg|png|gif|webp)$/.test(nm);
      if (cat === 'videos') return /\.(mp4|3gp|webm)$/.test(nm);
      if (cat === 'music') return /\.(mp3|aac|m4a|ogg|wav)$/.test(nm);
      if (cat === 'documents') return /\.(txt|pdf|html?|json|xml|log)$/.test(nm);
      if (cat === 'downloads') return /(^|\/)download\//.test(nm);
      if (cat === 'archives') return /\.zip$/.test(nm);
      return true;
    };
  }
  function catStores(cat) {
    if (cat === 'images') return ['pictures', 'sdcard'];
    if (cat === 'videos') return ['videos', 'sdcard'];
    if (cat === 'music') return ['music', 'sdcard'];
    return availStores();
  }
  function openBrowseStorage(which) {
    var stores = which === 'sdcard' ? ['sdcard'] : FS.INTERNAL_STORES.slice();
    stores = stores.filter(function (s) { return FS.storeOk(s); });
    BW = { mode: 'storage', stores: stores, prefix: '', title: which === 'sdcard' ? 'SD Card' : 'Internal Storage',
           entries: [], folders: [], files: [], focus: 0, which: which };
    showScreen('browse');
    refreshBrowse();
  }
  function openRecent() {
    BW = { mode: 'recent', stores: availStores(), prefix: '', title: 'Recent Files',
           entries: [], folders: [], files: [], focus: 0 };
    showScreen('browse');
    refreshBrowse();
  }
  function openCategory(cat) {
    var label = '';
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === cat) label = CATS[i].label;
    BW = { mode: 'category', stores: catStores(cat), prefix: '', title: label,
           entries: [], folders: [], files: [], focus: 0, cat: cat };
    showScreen('browse');
    refreshBrowse();
  }
  function refreshBrowse(cb) {
    ensureScanned(BW.stores, null, function () {
      var all = [];
      for (var i = 0; i < BW.stores.length; i++) {
        var ce = cache[BW.stores[i]] || [];
        for (var j = 0; j < ce.length; j++) all.push(ce[j]);
      }
      all = visibleEntries(all);
      if (BW.mode === 'category') {
        var f = catFilter(BW.cat);
        var flt = [];
        for (var k = 0; k < all.length; k++) if (f(all[k])) flt.push(all[k]);
        all = flt;
        BW.folders = [];
        BW.files = sortFiles(all);
      } else if (BW.mode === 'recent') {
        all.sort(function (a, b) { return b.date - a.date; });
        BW.folders = [];
        BW.files = all.slice(0, 60);
      } else {
        var dd = FS.deriveDir(all, BW.prefix);
        dd.folders.sort(function (a, b) {
          var x = a.name.toLowerCase(), y = b.name.toLowerCase();
          return x < y ? -1 : x > y ? 1 : 0;
        });
        BW.folders = dd.folders;
        BW.files = sortFiles(dd.files);
        injectPendingFolders();
      }
      if (BW.focus >= BW.folders.length + BW.files.length) BW.focus = 0;
      renderBrowse();
      if (cb) cb();
    });
  }
  function browseRows() {
    return BW.folders.length + BW.files.length;
  }
  function browseItemAt(i) {
    if (i < BW.folders.length) return { isFolder: true, folder: BW.folders[i] };
    return { isFolder: false, meta: BW.files[i - BW.folders.length] };
  }
  function renderBrowse() {
    var back = BW.mode === 'storage' && BW.prefix ? true : BW.mode !== 'storage';
    setHeader(back ? 'back' : (BW.mode === 'storage' ? 'folder' : 'app'), BW.title);
    var h = '';
    var n = browseRows();
    if (!n) {
      h = '<div class="empty-note">This folder is empty.</div>';
    } else {
      for (var i = 0; i < BW.folders.length; i++) {
        var fo = BW.folders[i];
        h += '<div class="row' + (i === BW.focus ? ' focused' : '') + '">' +
          '<span class="ric">' + icon('i-folder') + '</span>' +
          '<span class="rmid"><div class="rn">' + esc(fo.name) + '</div>' +
          '<div class="rs">' + fo.count + ' items</div></span>' +
          '<span class="rchev">' + icon('i-chev') + '</span></div>';
      }
      for (var j = 0; j < BW.files.length; j++) {
        var m = BW.files[j];
        var kd = kindOf(m.name);
        var idx = BW.folders.length + j;
        h += '<div class="row' + (idx === BW.focus ? ' focused' : '') + '">' +
          '<span class="ric">' + icon(kd.icon) + '</span>' +
          '<span class="rmid"><div class="rn">' + esc(baseName(m.name)) + '</div>' +
          '<div class="rs">' + fmtSize(m.size) + '</div></span>' +
          '<span class="rmeta">' + fmtDate(m.date) + '</span></div>';
      }
    }
    $('browse-list').innerHTML = h;
    ensureRowVisible($('scr-browse'), BW.focus);
    setSoftkeys('Menu', 'Open', 'Option');
    rememberSoftkeys();
  }
  function ensureRowVisible(scroller, idx) {
    var rows = scroller.querySelectorAll('.row');
    if (!rows.length || idx < 0 || idx >= rows.length) return;
    var row = rows[idx];
    var top = row.offsetTop;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + row.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + row.offsetHeight - scroller.clientHeight;
    }
  }
  function browseUp() {
    if (BW.mode !== 'storage' || !BW.prefix) {
      goBack();
      return;
    }
    var p = BW.prefix.slice(0, -1);
    var i = p.lastIndexOf('/');
    BW.prefix = i >= 0 ? p.slice(0, i + 1) : '';
    BW.focus = 0;
    refreshBrowse();
  }
  function browseActivate() {
    if (!browseRows()) return;
    var it = browseItemAt(BW.focus);
    if (it.isFolder) {
      if (BW.mode !== 'storage') return;
      BW.prefix = BW.prefix + it.folder.name + '/';
      BW.focus = 0;
      refreshBrowse();
    } else {
      openFile(it.meta);
    }
  }
  function searchHereContext() {
    if (current === 'browse' && BW && BW.mode === 'storage') {
      return { stores: BW.stores, prefix: BW.prefix };
    }
    return null;
  }
  /* Right softkey "Option": actions for the focused file/folder. */
  function showOptionMenu() {
    if (!browseRows()) {
      toast('No item selected');
      return;
    }
    var it = browseItemAt(BW.focus);
    if (it.isFolder) {
      var fp = BW.prefix + it.folder.name + '/';
      var fitems = [
        { label: 'Open', icon: 'i-open', value: 'open' },
        { label: 'Rename', icon: 'i-edit', value: 'rename' },
        { label: 'Copy', icon: 'i-copy', value: 'copy' },
        { label: 'Move', icon: 'i-move', value: 'move' },
        { label: 'Delete', icon: 'i-trash', value: 'delete' },
        { sep: true },
        { label: 'Properties', icon: 'i-info', value: 'props' }
      ];
      showMenu(it.folder.name, fitems, function (i) {
        if (i < 0) return;
        folderAction(fitems[i].value,
          { isFolder: true, prefix: fp, name: it.folder.name });
      });
    } else {
      showFileMenu(it.meta);
    }
  }
  function sortLabel() {
    return { name: 'Name', size: 'Size', date: 'Date', type: 'Type' }[settings.sort] || 'Name';
  }
  function showSortMenu() {
    var cur = settings.sort;
    var opts = [['name', 'Name'], ['size', 'Size'], ['date', 'Date'], ['type', 'Type']];
    var items = [];
    for (var i = 0; i < opts.length; i++) {
      items.push({ label: (opts[i][0] === cur ? '* ' : '') + opts[i][1], icon: 'i-check', value: opts[i][0] });
    }
    showMenu('Sort by', items, function (i) {
      if (i >= 0) {
        settings.sort = opts[i][0];
        saveSettings();
        refreshBrowse();
      }
    });
  }
  function browseKey(key) {
    var n = browseRows();
    if (key === 'ArrowUp') {
      if (n && BW.focus > 0) { BW.focus--; renderBrowse(); }
      return true;
    }
    if (key === 'ArrowDown') {
      if (n && BW.focus < n - 1) { BW.focus++; renderBrowse(); }
      return true;
    }
    if (key === 'Enter') {
      browseActivate();
      return true;
    }
    if (key === 'SoftLeft') {
      showAppMenu();
      return true;
    }
    if (key === 'SoftRight') {
      showOptionMenu();
      return true;
    }
    if (key === 'Backspace') {
      browseUp();
      return true;
    }
    return false;
  }

  /* ================= file actions ================= */
  function canShare() {
    return typeof MozActivity !== 'undefined';
  }
  function opReason(r) {
    return { self: 'Already in this location', exists: 'File exists', read: 'Cannot read file',
      write: 'Cannot write file', verify: 'Verification failed', partial: 'Some files failed',
      srcdelete: 'Copied, but the original could not be deleted',
      intodescendant: 'Cannot copy a folder into itself' }[r] || 'Failed';
  }
  function afterOpRefresh() {
    if (current === 'browse') refreshBrowse();
    else if (current === 'search') runSearch(true);
    else if (current === 'props') goBack();
  }
  function openFile(meta) {
    var kd = kindOf(meta.name);
    if (kd.kind === 'archive' && Archive.isZipName(meta.name)) {
      openZip(meta);
      return;
    }
    if (kd.text) {
      openText(meta);
      return;
    }
    showBusy('Opening…');
    FS.getBlob(meta.store, meta.name, function (blob) {
      hideBusy();
      if (!blob) {
        toast('Cannot read file');
        return;
      }
      var mime = kd.mime || blob.type || 'application/octet-stream';
      try {
        var act = new MozActivity({ name: 'open', data: { type: mime, blob: blob, filename: null } });
        act.onerror = function () {
          toast('No app can open this file');
        };
      } catch (e) {
        toast('Cannot open file');
      }
    });
  }
  function shareFlow(meta) {
    showBusy('Preparing…');
    FS.getBlob(meta.store, meta.name, function (blob) {
      hideBusy();
      if (!blob) {
        toast('Cannot read file');
        return;
      }
      var kd = kindOf(meta.name);
      try {
        var act = new MozActivity({
          name: 'share',
          data: { type: kd.mime || blob.type || 'application/octet-stream', number: 1,
                  blobs: [blob], filenames: [baseName(meta.name)] }
        });
        act.onerror = function () {
          toast('Share not available');
        };
      } catch (e) {
        toast('Share not available');
      }
    });
  }
  function showFileMenu(meta) {
    var items = [
      { label: 'Open', icon: 'i-open', value: 'open' },
      { label: 'Rename', icon: 'i-edit', value: 'rename' },
      { label: 'Copy', icon: 'i-copy', value: 'copy' },
      { label: 'Move', icon: 'i-move', value: 'move' },
      { label: 'Delete', icon: 'i-trash', value: 'delete' },
      { sep: true },
      { label: 'Properties', icon: 'i-info', value: 'props' }
    ];
    if (canShare()) items.push({ label: 'Share', icon: 'i-share', value: 'share' });
    showMenu('File Options', items, function (i) {
      if (i < 0) return;
      var v = items[i].value;
      if (v === 'open') openFile(meta);
      else if (v === 'rename') renameFlow({ isFolder: false, meta: meta });
      else if (v === 'copy') copyMoveFlow({ isFolder: false, meta: meta }, false);
      else if (v === 'move') copyMoveFlow({ isFolder: false, meta: meta }, true);
      else if (v === 'delete') deleteFlow({ isFolder: false, meta: meta });
      else if (v === 'props') showPropsFile(meta);
      else if (v === 'share') shareFlow(meta);
    });
  }
  function folderAction(v, f) {
    if (v === 'open') {
      if (BW && BW.mode === 'storage') {
        BW.prefix = f.prefix;
        BW.focus = 0;
        refreshBrowse();
      }
    }
    else if (v === 'rename') renameFlow(f);
    else if (v === 'copy') copyMoveFlow(f, false);
    else if (v === 'move') copyMoveFlow(f, true);
    else if (v === 'delete') deleteFlow(f);
    else if (v === 'searchhere') openSearch(searchHereContext());
    else if (v === 'props') {
      var groups = folderGroups(f.prefix);
      var n = 0, gs;
      for (gs = 0; gs < groups.length; gs++) n += groups[gs].files.length;
      showPropsFolder(groups.length ? groups[0].store : 'pictures', f.prefix, f.name, n);
    }
  }

  /* A browsed folder prefix can hold files in several stores (internal mode
   * aggregates pictures+videos+music). Group them per store for ops. */
  function folderGroups(prefix) {
    var groups = [];
    var stores = (BW && BW.stores) || availStores();
    for (var s = 0; s < stores.length; s++) {
      var entries = cache[stores[s]] || [];
      var files = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name.indexOf(prefix) === 0) files.push(entries[i]);
      }
      if (files.length) groups.push({ store: stores[s], files: files });
    }
    return groups;
  }
  function groupStores(groups) {
    var out = [];
    for (var i = 0; i < groups.length; i++) out.push(groups[i].store);
    return out;
  }

  /* ================= rename ================= */
  function renameFlow(item) {
    var curName = item.isFolder ? item.name : baseName(item.meta.name);
    showPrompt('Rename', item.isFolder ? 'Folder name:' : 'File name:', curName, function (ok, val) {
      if (!ok) return;
      val = String(val || '').trim();
      if (!val || val.indexOf('/') >= 0 || val === '.' || val === '..') {
        toast('Invalid name');
        return;
      }
      if (val === curName) return;
      if (item.isFolder) {
        var groups = folderGroups(item.prefix);
        var total = 0, gi;
        for (gi = 0; gi < groups.length; gi++) total += groups[gi].files.length;
        if (!total) {
          toast('Folder is empty');
          return;
        }
        if (total > 300) {
          showMessage('Too many files', 'This folder has ' + total + ' files. Rename is limited to 300 files at a time.');
          return;
        }
        showBusy('Renaming…');
        var rdone = 0;
        (function rstep(g) {
          if (g >= groups.length) {
            hideBusy();
            invalidateCache(groupStores(groups));
            afterOpRefresh();
            toast('Renamed');
            return;
          }
          var gr = groups[g];
          Ops.renameFolder(cache[gr.store] || [], gr.store, item.prefix, val, function (d, t) {
            updateBusy('Renaming… ' + (rdone + d) + '/' + total);
          }, function (ok2) {
            if (!ok2) {
              hideBusy();
              invalidateCache(groupStores(groups));
              afterOpRefresh();
              toast('Rename partially completed');
              return;
            }
            rdone += gr.files.length;
            rstep(g + 1);
          });
        })(0);
      } else {
        var nm = item.meta.name;
        var dir = nm.indexOf('/') >= 0 ? nm.slice(0, nm.lastIndexOf('/') + 1) : '';
        var destName = dir + val;
        FS.exists(item.meta.store, destName, function (taken) {
          function go() {
            showBusy('Renaming…');
            Ops.renameFile(item.meta, val, function (ok2, reason) {
              hideBusy();
              if (ok2) {
                invalidateCache([item.meta.store]);
                afterOpRefresh();
                toast('Renamed');
              } else {
                toast(opReason(reason));
              }
            });
          }
          if (taken) {
            showConfirm('Overwrite?', '"' + val + '" already exists. Replace it?', 'Replace', true, function (yes) {
              if (!yes) return;
              showBusy('Replacing…');
              FS.deleteFile(item.meta.store, destName, function () {
                go();
              });
            });
          } else {
            go();
          }
        });
      }
    });
  }

  /* ================= delete ================= */
  function deleteFlow(item) {
    var label = item.isFolder ? 'folder "' + item.name + '"' : 'file "' + baseName(item.meta.name) + '"';
    function doIt() {
      if (item.isFolder) {
        var groups = folderGroups(item.prefix);
        var total = 0, gi;
        for (gi = 0; gi < groups.length; gi++) total += groups[gi].files.length;
        if (!total) {
          toast('Folder is empty');
          return;
        }
        showBusy('Deleting…');
        var ddone = 0;
        (function dstep(g) {
          if (g >= groups.length) {
            hideBusy();
            invalidateCache(groupStores(groups));
            afterOpRefresh();
            toast('Deleted');
            return;
          }
          var gr = groups[g];
          Ops.deleteFolder(cache[gr.store] || [], gr.store, item.prefix, function (d, t) {
            updateBusy('Deleting… ' + (ddone + d) + '/' + total);
          }, function (ok, done) {
            ddone += done;
            if (!ok) {
              hideBusy();
              invalidateCache(groupStores(groups));
              afterOpRefresh();
              toast('Deleted ' + ddone + ' of ' + total);
              return;
            }
            dstep(g + 1);
          });
        })(0);
      } else {
        showBusy('Deleting…');
        Ops.deleteFile(item.meta, function (ok) {
          hideBusy();
          if (ok) {
            invalidateCache([item.meta.store]);
            afterOpRefresh();
            toast('Deleted');
          } else {
            toast('Delete failed');
          }
        });
      }
    }
    if (settings.confirmDelete) {
      showConfirm('Delete', 'Delete ' + label + '?', 'Delete', true, function (yes) {
        if (yes) doIt();
      });
    } else {
      doIt();
    }
  }

  /* ================= copy / move destination picker (screen 6) ================= */
  var PK = null;
  /* PK = { mode:'copy'|'move'|'extract', src, zipEntries, store, prefix, folders, focus, onSelect } */
  var STORE_LABELS = {
    pictures: 'Pictures · Internal',
    videos: 'Videos · Internal',
    music: 'Music · Internal',
    sdcard: 'SD Card'
  };
  function copyMoveFlow(item, isMove) {
    openPicker({ mode: isMove ? 'move' : 'copy', src: item }, function (destStore, destPrefix) {
      if (item.isFolder) doCopyMoveFolder(item, isMove, destStore, destPrefix);
      else doCopyMoveFile(item.meta, isMove, destStore, destPrefix);
    });
  }
  function openPicker(opts, onSelect) {
    PK = { mode: opts.mode, src: opts.src, zipEntries: opts.zipEntries || null,
           store: null, prefix: '', folders: [], focus: 0, onSelect: onSelect };
    var def = settings.defStore === 'sdcard' && FS.storeOk('sdcard') ? 'sdcard' : 'pictures';
    if (FS.storeOk(def)) {
      PK.store = def;
    }
    showScreen('picker');
    ensureScanned(availStores(), null, function () {
      renderPicker();
    });
    renderPicker();
  }
  function renderPicker() {
    var title = PK.mode === 'move' ? 'Move to' : PK.mode === 'extract' ? 'Extract to' : 'Copy to';
    setHeader('back', title);
    var h = '';
    var crumb;
    if (!PK.store) {
      crumb = 'Choose storage';
      var rows = '';
      var stores = availStores();
      for (var i = 0; i < stores.length; i++) {
        var s = stores[i];
        rows += '<div class="row' + (i === PK.focus ? ' focused' : '') + '">' +
          '<span class="ric">' + icon(s === 'sdcard' ? 'i-sd' : 'i-phone') + '</span>' +
          '<span class="rmid"><div class="rn">' + esc(STORE_LABELS[s] || s) + '</div></span>' +
          '<span class="rchev">' + icon('i-chev') + '</span></div>';
      }
      h = rows;
    } else {
      var all = visibleEntries(cache[PK.store] || []);
      var dd = FS.deriveDir(all, PK.prefix);
      dd.folders.sort(function (a, b) {
        var x = a.name.toLowerCase(), y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      });
      PK.folders = dd.folders;
      crumb = '<b>' + esc(STORE_LABELS[PK.store] || PK.store) + '</b>' +
        (PK.prefix ? ' &gt; ' + esc(PK.prefix) : '');
      var rh = '<div class="row' + (PK.focus === 0 ? ' focused' : '') + '">' +
        '<span class="ric">' + icon('i-plus') + '</span>' +
        '<span class="rmid"><div class="rn">New folder</div>' +
        '<div class="rs">Create here</div></span></div>';
      for (var j = 0; j < PK.folders.length; j++) {
        var fo = PK.folders[j];
        rh += '<div class="row' + (j + 1 === PK.focus ? ' focused' : '') + '">' +
          '<span class="ric">' + icon('i-folder') + '</span>' +
          '<span class="rmid"><div class="rn">' + esc(fo.name) + '</div>' +
          '<div class="rs">' + fo.count + ' items</div></span>' +
          '<span class="rchev">' + icon('i-chev') + '</span></div>';
      }
      if (!PK.folders.length) rh += '<div class="empty-note">Empty folder.<br>Choose Select to use it.</div>';
      h = rh;
    }
    $('picker-crumb').innerHTML = crumb;
    $('picker-list').innerHTML = h;
    ensureRowVisible($('scr-picker'), PK.focus);
    setSoftkeys('Cancel', '', 'Select');
    rememberSoftkeys();
  }
  function pickerRows() {
    if (!PK.store) return availStores().length;
    return 1 + PK.folders.length;
  }
  function pickerActivate() {
    if (!PK.store) {
      var stores = availStores();
      if (PK.focus < stores.length) {
        PK.store = stores[PK.focus];
        PK.prefix = '';
        PK.focus = 0;
        renderPicker();
      }
      return;
    }
    if (PK.focus === 0) {
      showPrompt('New folder', 'Enter folder name:', '', function (ok, val) {
        if (!ok) return;
        val = String(val || '').trim();
        if (!val || val.indexOf('/') >= 0 || val === '.' || val === '..') {
          toast('Invalid name');
          return;
        }
        for (var i = 0; i < PK.folders.length; i++) {
          if (PK.folders[i].name.toLowerCase() === val.toLowerCase()) {
            toast('Folder already exists');
            return;
          }
        }
        PK.prefix = Ops.normPrefix(PK.prefix + val);
        PK.focus = 0;
        renderPicker();
      });
      return;
    }
    var fo = PK.folders[PK.focus - 1];
    if (fo) {
      PK.prefix = Ops.normPrefix(PK.prefix + fo.name);
      PK.focus = 0;
      renderPicker();
    }
  }
  function pickerUp() {
    if (!PK.store || !PK.prefix) {
      if (PK.store && !PK.prefix) {
        PK.store = null;
        PK.focus = 0;
        renderPicker();
        return;
      }
      goBack();
      return;
    }
    var p = PK.prefix.slice(0, -1);
    var i = p.lastIndexOf('/');
    PK.prefix = i >= 0 ? p.slice(0, i + 1) : '';
    PK.focus = 0;
    renderPicker();
  }
  function pickerSelect() {
    if (!PK.store) {
      toast('Choose a storage first');
      return;
    }
    var cb = PK.onSelect;
    var st = PK.store, pf = PK.prefix;
    goBack();
    if (cb) cb(st, pf);
  }
  function pickerKey(key) {
    var n = pickerRows();
    if (key === 'ArrowUp') {
      if (PK.focus > 0) { PK.focus--; renderPicker(); }
      return true;
    }
    if (key === 'ArrowDown') {
      if (PK.focus < n - 1) { PK.focus++; renderPicker(); }
      return true;
    }
    if (key === 'Enter') {
      pickerActivate();
      return true;
    }
    if (key === 'SoftLeft' || key === 'Backspace') {
      if (key === 'SoftLeft') { goBack(); }
      else pickerUp();
      return true;
    }
    if (key === 'SoftRight') {
      pickerSelect();
      return true;
    }
    return false;
  }
  function doCopyMoveFile(srcMeta, isMove, destStore, destPrefix) {
    var destName = Ops.normPrefix(destPrefix) + baseName(srcMeta.name);
    if (srcMeta.store === destStore && srcMeta.name === destName) {
      toast('Already in this location');
      return;
    }
    function proceed() {
      showBusy(isMove ? 'Moving…' : 'Copying…');
      var fn = isMove ? Ops.moveFile : Ops.copyFile;
      fn(srcMeta, destStore, destName, function (ok, reason) {
        hideBusy();
        if (ok) {
          invalidateCache([srcMeta.store, destStore]);
          afterOpRefresh();
          toast(isMove ? 'Moved' : 'Copied');
        } else {
          toast(opReason(reason));
        }
      });
    }
    function checkExists() {
      FS.exists(destStore, destName, function (taken) {
        if (taken) {
          showConfirm('Overwrite?', '"' + baseName(destName) + '" already exists. Replace it?', 'Replace', true, function (yes) {
            if (!yes) return;
            showBusy('Replacing…');
            FS.deleteFile(destStore, destName, function () {
              proceed();
            });
          });
        } else {
          proceed();
        }
      });
    }
    if (srcMeta.size > Ops.LARGE_WARN) {
      showConfirm('Large file', 'This file is ' + fmtSize(srcMeta.size) + '. The phone may run out of memory. Continue?', 'Continue', false, function (yes) {
        if (yes) checkExists();
      });
    } else {
      checkExists();
    }
  }
  function doCopyMoveFolder(item, isMove, destStore, destPrefix) {
    var groups = folderGroups(item.prefix);
    var total = 0, gi;
    for (gi = 0; gi < groups.length; gi++) total += groups[gi].files.length;
    if (!total) {
      toast('Folder is empty');
      return;
    }
    if (total > 300) {
      showMessage('Too many files', 'This folder has ' + total + ' files. Copy is limited to 300 files at a time.');
      return;
    }
    var newPrefix = Ops.normPrefix(destPrefix) + item.name + '/';
    var queue = [];
    for (gi = 0; gi < groups.length; gi++) {
      for (var k = 0; k < groups[gi].files.length; k++) {
        queue.push(groups[gi].files[k].name.slice(item.prefix.length));
      }
    }
    function run(conflicts) {
      function delConflicts(next) {
        if (!conflicts.length) {
          next();
          return;
        }
        showBusy('Replacing…');
        var i = 0;
        (function step() {
          if (i >= conflicts.length) {
            next();
            return;
          }
          FS.deleteFile(destStore, conflicts[i++], function () {
            step();
          });
        })();
      }
      delConflicts(function () {
        showBusy(isMove ? 'Moving…' : 'Copying…');
        var cdone = 0;
        (function cstep(g) {
          if (g >= groups.length) {
            hideBusy();
            var stores = groupStores(groups);
            stores.push(destStore);
            invalidateCache(stores);
            afterOpRefresh();
            toast(isMove ? 'Moved' : 'Copied');
            return;
          }
          var gr = groups[g];
          var fn = isMove ? Ops.moveFolder : Ops.copyFolder;
          fn(cache[gr.store] || [], gr.store, item.prefix, destStore, newPrefix, function (d, t) {
            updateBusy((isMove ? 'Moving… ' : 'Copying… ') + (cdone + d) + '/' + total);
          }, function (ok, done) {
            if (!ok) {
              hideBusy();
              var stores2 = groupStores(groups);
              stores2.push(destStore);
              invalidateCache(stores2);
              afterOpRefresh();
              toast('Done ' + (cdone + done) + ' of ' + total);
              return;
            }
            cdone += done;
            cstep(g + 1);
          });
        })(0);
      });
    }
    /* conflict scan */
    showBusy('Checking…');
    var conflicts = [];
    var i = 0;
    (function step() {
      if (i >= queue.length) {
        hideBusy();
        if (conflicts.length) {
          showConfirm('Overwrite?', conflicts.length + ' file(s) already exist. Replace them?', 'Replace', true, function (yes) {
            if (yes) run(conflicts);
          });
        } else {
          run([]);
        }
        return;
      }
      var dp = newPrefix + queue[i];
      FS.exists(destStore, dp, function (taken) {
        if (taken) conflicts.push(dp);
        i++;
        step();
      });
    })();
  }

  /* ================= properties (screen 5) ================= */
  var PROP = null;
  var thumbURL = null;
  function revokeThumb() {
    if (thumbURL) {
      try {
        URL.revokeObjectURL(thumbURL);
      } catch (e) {}
      thumbURL = null;
    }
  }
  function locLabel(store, path) {
    return (store === 'sdcard' ? 'SD Card' : 'Internal') + ' / ' + path;
  }
  function prow(k, v) {
    return '<div class="prow"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
  }
  function showPropsFile(meta) {
    PROP = { isFolder: false, meta: meta };
    showScreen('props');
  }
  function showPropsFolder(store, prefix, name, count) {
    PROP = { isFolder: true, store: store, prefix: prefix, name: name, count: count };
    showScreen('props');
  }
  function renderProps() {
    setHeader('back', 'File Properties');
    var h = '';
    if (PROP.isFolder) {
      h += '<div class="prop-ic">' + icon('i-folder') + '</div>';
      h += prow('Name', PROP.name);
      h += prow('Type', 'Folder');
      h += prow('Items', PROP.count + ' items');
      h += prow('Location', locLabel(PROP.store, PROP.prefix));
      h += prow('Access', 'Read/Write');
    } else {
      var kd = kindOf(PROP.meta.name);
      if (kd.kind === 'image') h += '<img id="prop-thumb" class="prop-thumb" alt="">';
      else h += '<div class="prop-ic">' + icon(kd.icon) + '</div>';
      h += prow('Name', baseName(PROP.meta.name));
      h += prow('Type', kd.label);
      h += prow('Size', fmtSize(PROP.meta.size) + ' (' + PROP.meta.size + ' bytes)');
      h += prow('Modified', fmtDateTime(PROP.meta.date));
      h += prow('Location', locLabel(PROP.meta.store, PROP.meta.name));
      h += prow('Access', 'Read/Write');
    }
    $('props-body').innerHTML = h;
    if (!PROP.isFolder && kindOf(PROP.meta.name).kind === 'image') {
      FS.getBlob(PROP.meta.store, PROP.meta.name, function (blob) {
        if (!blob || !PROP || PROP.isFolder) return;
        try {
          revokeThumb();
          thumbURL = URL.createObjectURL(blob);
          var im = $('prop-thumb');
          if (im) im.src = thumbURL;
        } catch (e) {}
      });
    }
    setSoftkeys('', '', 'Back');
    rememberSoftkeys();
  }
  function propsKey(key) {
    if (key === 'Backspace' || key === 'SoftRight') {
      goBack();
      return true;
    }
    return false;
  }

  /* ================= text viewer ================= */
  var TX = null;
  function openText(meta) {
    if (meta.size > 200 * 1024) {
      toast('File too large to preview');
      return;
    }
    showBusy('Opening…');
    FS.getBlob(meta.store, meta.name, function (blob) {
      hideBusy();
      if (!blob) {
        toast('Cannot read file');
        return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        TX = { meta: meta, text: String(fr.result || '') };
        showScreen('text');
      };
      fr.onerror = function () {
        toast('Cannot read file');
      };
      try {
        fr.readAsText(blob);
      } catch (e) {
        toast('Cannot read file');
      }
    });
  }
  function renderText() {
    setHeader('back', baseName(TX.meta.name));
    $('text-body').textContent = TX.text || '(empty file)';
    $('scr-text').scrollTop = 0;
    setSoftkeys('', '', 'Back');
    rememberSoftkeys();
  }
  function textKey(key) {
    if (key === 'ArrowUp') {
      $('scr-text').scrollTop -= 60;
      return true;
    }
    if (key === 'ArrowDown') {
      $('scr-text').scrollTop += 60;
      return true;
    }
    if (key === 'Backspace' || key === 'SoftRight') {
      goBack();
      return true;
    }
    return false;
  }

  /* ================= search (screen 7) ================= */
  var SH = null;
  function freshSearch() {
    return { query: '', results: [], focus: 0, scope: 'all',
             hereStores: [], herePrefix: '', searching: false, cancel: false };
  }
  function openSearch(ctx) {
    SH = freshSearch();
    if (ctx) {
      SH.scope = 'here';
      SH.hereStores = ctx.stores;
      SH.herePrefix = ctx.prefix;
    }
    showScreen('search');
    setTimeout(function () {
      var inp = $('search-input');
      inp.value = '';
      inp.focus();
    }, 60);
  }
  function renderSearch() {
    setHeader('search', 'Search Files');
    var hint = '';
    if (SH.searching) hint = 'Searching… (Back cancels)';
    else if (!SH.query) hint = SH.scope === 'here' ? 'Searching this folder' : 'Searching all storage';
    else if (!SH.results.length) hint = 'No files found';
    else hint = SH.results.length + ' result' + (SH.results.length === 1 ? '' : 's') +
      (SH.scope === 'here' ? ' · this folder' : ' · all storage');
    $('search-hint').textContent = hint;
    var h = '';
    for (var i = 0; i < SH.results.length; i++) {
      var m = SH.results[i];
      var kd = kindOf(m.name);
      h += '<div class="row' + (i === SH.focus ? ' focused' : '') + '">' +
        '<span class="ric">' + icon(kd.icon) + '</span>' +
        '<span class="rmid"><div class="rn">' + esc(baseName(m.name)) + '</div>' +
        '<div class="rs">' + fmtSize(m.size) + ' · ' + esc(locLabel(m.store, m.name)) + '</div></span>' +
        '<span class="rmeta">' + fmtDate(m.date) + '</span></div>';
    }
    $('search-list').innerHTML = h;
    ensureRowVisible($('scr-search'), SH.focus);
    setSoftkeys('Menu', 'Open', 'Option');
    rememberSoftkeys();
  }
  function runSearch(keepFocus) {
    var q = $('search-input').value.trim().toLowerCase();
    SH.query = q;
    SH.searching = false;
    SH.cancel = false;
    if (!q) {
      SH.results = [];
      SH.focus = 0;
      renderSearch();
      return;
    }
    if (SH.scope === 'here') {
      var out = [];
      for (var i = 0; i < SH.hereStores.length; i++) {
        var ce = cache[SH.hereStores[i]] || [];
        for (var j = 0; j < ce.length; j++) {
          var e = ce[j];
          if (SH.herePrefix && e.name.indexOf(SH.herePrefix) !== 0) continue;
          if (baseName(e.name).toLowerCase().indexOf(q) >= 0) out.push(e);
          if (out.length >= 400) break;
        }
        if (out.length >= 400) break;
      }
      SH.results = sortFiles(visibleEntries(out));
      SH.focus = 0;
      renderSearch();
      return;
    }
    /* scope 'all': bounded scan with Back-cancel */
    SH.searching = true;
    renderSearch();
    var stores = availStores();
    var results = [];
    var si = 0;
    function nextStore() {
      if (SH.cancel) {
        SH.searching = false;
        SH.results = [];
        $('search-hint').textContent = 'Search cancelled';
        return;
      }
      if (si >= stores.length) {
        SH.searching = false;
        SH.results = sortFiles(visibleEntries(results));
        SH.focus = 0;
        renderSearch();
        return;
      }
      var sn = stores[si++];
      FS.scanStore(sn, 500, null, function (entries) {
        for (var k = 0; k < entries.length; k++) {
          if (baseName(entries[k].name).toLowerCase().indexOf(q) >= 0) {
            results.push(entries[k]);
            if (results.length >= 400) break;
          }
        }
        cache[sn] = entries;
        nextStore();
      });
    }
    nextStore();
  }
  function searchScopeToggle() {
    if (SH.scope === 'here') {
      SH.scope = 'all';
    } else if (BW && BW.mode === 'storage') {
      SH.scope = 'here';
      SH.hereStores = BW.stores;
      SH.herePrefix = BW.prefix;
    } else {
      toast('No folder context — searching all storage');
      SH.scope = 'all';
    }
    runSearch();
  }
  function searchClear() {
    $('search-input').value = '';
    SH.results = [];
    SH.query = '';
    renderSearch();
  }
  function openContainingFolder(meta) {
    if (!meta) return;
    var internal = FS.INTERNAL_STORES.indexOf(meta.store) >= 0;
    openBrowseStorage(internal ? 'internal' : 'sdcard');
    var dir = meta.name.indexOf('/') >= 0 ? meta.name.slice(0, meta.name.lastIndexOf('/') + 1) : '';
    /* refreshBrowse is async; set prefix first, then focus after render */
    BW.prefix = dir;
    refreshBrowse(function () {
      for (var i = 0; i < BW.files.length; i++) {
        if (BW.files[i].name === meta.name) {
          BW.focus = BW.folders.length + i;
          break;
        }
      }
      renderBrowse();
    });
  }
  function searchKey(key, inInput) {
    if (inInput) {
      if (key === 'Enter' || key === 'ArrowUp' || key === 'ArrowDown') {
        try {
          $('search-input').blur();
        } catch (e) {}
        runSearch();
        return true;
      }
      return false;
    }
    if (key === 'ArrowUp') {
      if (SH.results.length && SH.focus > 0) { SH.focus--; renderSearch(); }
      return true;
    }
    if (key === 'ArrowDown') {
      if (SH.results.length && SH.focus < SH.results.length - 1) { SH.focus++; renderSearch(); }
      return true;
    }
    if (key === 'Enter') {
      if (SH.results.length) openFile(SH.results[SH.focus]);
      return true;
    }
    if (key === 'SoftLeft') {
      showAppMenu();
      return true;
    }
    if (key === 'SoftRight') {
      if (SH.results.length) showFileMenu(SH.results[SH.focus]);
      else toast('No item selected');
      return true;
    }
    if (key === 'Backspace') {
      if (SH.searching) {
        SH.cancel = true;
        return true;
      }
      goBack();
      return true;
    }
    return false;
  }

  /* ================= ZIP view (screen 8) ================= */
  var ZIP = null;
  /* ZIP = { meta, u8, entries:[{name,isDir,method,compSize,uncompSize,localOff,date,unsupported,safe}],
             prefix, focus, folders:[], files:[] } */
  function openZip(meta) {
    showBusy('Opening archive…');
    FS.getBlob(meta.store, meta.name, function (blob) {
      if (!blob) {
        hideBusy();
        toast('Cannot read file');
        return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        hideBusy();
        var u8;
        try {
          u8 = new Uint8Array(fr.result);
        } catch (e) {
          toast('Cannot read file');
          return;
        }
        var r = Archive.listEntries(u8);
        if (!r.ok) {
          toast('Not a valid ZIP archive');
          return;
        }
        if (!r.entries.length) {
          toast('Archive is empty');
          return;
        }
        ZIP = { meta: meta, u8: u8, entries: r.entries, prefix: '', focus: 0,
                folders: [], files: [], truncated: !!r.truncated };
        if (r.truncated) toast('Large archive: showing first ' + r.entries.length + ' entries');
        showScreen('zip');
      };
      fr.onerror = function () {
        hideBusy();
        toast('Cannot read file');
      };
      try {
        fr.readAsArrayBuffer(blob);
      } catch (e) {
        hideBusy();
        toast('Cannot read file');
      }
    });
  }
  function zipDerive() {
    var mapped = [];
    for (var i = 0; i < ZIP.entries.length; i++) {
      mapped.push({ name: ZIP.entries[i].name, ref: ZIP.entries[i] });
    }
    var dd = FS.deriveDir(mapped, ZIP.prefix);
    dd.folders.sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    ZIP.folders = dd.folders;
    ZIP.files = dd.files;
  }
  function renderZip() {
    setHeader('back', baseName(ZIP.meta.name));
    zipDerive();
    var h = '';
    var n = ZIP.folders.length + ZIP.files.length;
    if (!n) {
      h = '<div class="empty-note">This folder is empty.</div>';
    } else {
      for (var i = 0; i < ZIP.folders.length; i++) {
        var fo = ZIP.folders[i];
        h += '<div class="row' + (i === ZIP.focus ? ' focused' : '') + '">' +
          '<span class="ric">' + icon('i-folder') + '</span>' +
          '<span class="rmid"><div class="rn">' + esc(fo.name) + '/</div>' +
          '<div class="rs">' + fo.count + ' items</div></span>' +
          '<span class="rchev">' + icon('i-chev') + '</span></div>';
      }
      for (var j = 0; j < ZIP.files.length; j++) {
        var e = ZIP.files[j].ref;
        var kd = kindOf(e.name);
        var idx = ZIP.folders.length + j;
        var sub = e.unsupported ? 'Unsupported (' + e.unsupported + ')' : fmtSize(e.uncompSize);
        h += '<div class="row' + (idx === ZIP.focus ? ' focused' : '') + '">' +
          '<span class="ric">' + icon(e.isDir ? 'i-folder' : kd.icon) + '</span>' +
          '<span class="rmid"><div class="rn">' + esc(baseName(e.name)) + '</div>' +
          '<div class="rs">' + esc(sub) + '</div></span>' +
          '<span class="rmeta">' + fmtDate(e.date) + '</span></div>';
      }
    }
    $('zip-list').innerHTML = h;
    ensureRowVisible($('scr-zip'), ZIP.focus);
    setSoftkeys('Menu', 'Open', 'Option');
    rememberSoftkeys();
  }
  function zipUp() {
    if (!ZIP.prefix) {
      goBack();
      return;
    }
    var p = ZIP.prefix.slice(0, -1);
    var i = p.lastIndexOf('/');
    ZIP.prefix = i >= 0 ? p.slice(0, i + 1) : '';
    ZIP.focus = 0;
    renderZip();
  }
  function zipFocusedEntry() {
    var nf = ZIP.folders.length;
    if (ZIP.focus < nf) return { isFolder: true, name: ZIP.folders[ZIP.focus].name };
    var f = ZIP.files[ZIP.focus - nf];
    return f ? { isFolder: false, entry: f.ref } : null;
  }
  function zipMenu() {
    var items = [
      { label: 'Extract here…', icon: 'i-dl', value: 'here' },
      { label: 'Extract to…', icon: 'i-folder', value: 'to' },
      { sep: true },
      { label: 'Properties', icon: 'i-info', value: 'props' },
      { label: 'Close archive', icon: 'i-x', value: 'close' }
    ];
    showMenu('Archive Menu', items, function (i) {
      if (i < 0) return;
      var v = items[i].value;
      if (v === 'here') extractFlow(ZIP.entries, 'all');
      else if (v === 'to') extractFlow(ZIP.entries, 'pick');
      else if (v === 'props') showPropsFile(ZIP.meta);
      else if (v === 'close') goBack();
    });
  }
  /* which: 'focused' | 'all' | 'pick'(=all via picker) */
  function extractFlow(entries, which) {
    var list;
    if (which === 'focused') {
      var fe = zipFocusedEntry();
      if (!fe) return;
      if (fe.isFolder) {
        var pfx = ZIP.prefix + fe.name + '/';
        list = [];
        for (var i = 0; i < ZIP.entries.length; i++) {
          if (ZIP.entries[i].name.indexOf(pfx) === 0 && !ZIP.entries[i].isDir) list.push(ZIP.entries[i]);
        }
      } else {
        if (fe.entry.unsupported) {
          toast('Unsupported entry: ' + fe.entry.unsupported);
          return;
        }
        if (!fe.entry.safe) {
          toast('Unsafe path in archive');
          return;
        }
        list = [fe.entry];
      }
    } else {
      list = [];
      for (var j = 0; j < ZIP.entries.length; j++) {
        if (!ZIP.entries[j].isDir) list.push(ZIP.entries[j]);
      }
    }
    if (!list.length) {
      toast('Nothing to extract');
      return;
    }
    var skipped = [];
    var okList = [];
    for (var k = 0; k < list.length; k++) {
      var e = list[k];
      if (e.unsupported || !e.safe || e.uncompSize > Archive.MAX_SINGLE_UNCOMPRESSED) {
        skipped.push(e.name);
      } else {
        okList.push(e);
      }
    }
    if (!okList.length) {
      toast('No extractable entries' + (skipped.length ? ' (' + skipped.length + ' skipped)' : ''));
      return;
    }
    openPicker({ mode: 'extract', zipEntries: okList }, function (destStore, destPrefix) {
      doExtract(okList, destStore, destPrefix, skipped);
    });
  }
  function doExtract(list, destStore, destPrefix) {
    /* conflict scan */
    showBusy('Checking…');
    var conflicts = [];
    var i = 0;
    (function step() {
      if (i >= list.length) {
        hideBusy();
        if (conflicts.length) {
          showConfirm('Overwrite?', conflicts.length + ' file(s) already exist. Replace them?', 'Replace', true, function (yes) {
            if (yes) runExtract(list, destStore, destPrefix, conflicts);
          });
        } else {
          runExtract(list, destStore, destPrefix, []);
        }
        return;
      }
      var dp = Ops.normPrefix(destPrefix) + list[i].safe;
      FS.exists(destStore, dp, function (taken) {
        if (taken) conflicts.push(dp);
        i++;
        step();
      });
    })();
  }
  function runExtract(list, destStore, destPrefix, conflicts) {
    function delConflicts(next) {
      if (!conflicts.length) {
        next();
        return;
      }
      showBusy('Replacing…');
      var i = 0;
      (function step() {
        if (i >= conflicts.length) {
          next();
          return;
        }
        FS.deleteFile(destStore, conflicts[i++], function () {
          step();
        });
      })();
    }
    delConflicts(function () {
      showBusy('Extracting…');
      var done = 0, failed = 0;
      var i = 0;
      (function step() {
        if (i >= list.length) {
          hideBusy();
          invalidateCache([destStore]);
          afterOpRefresh();
          toast(failed ? 'Extracted ' + done + ', ' + failed + ' failed' : 'Extracted ' + done + ' file(s)');
          return;
        }
        var e = list[i++];
        updateBusy('Extracting… ' + done + '/' + list.length);
        var r = Archive.extractEntry(ZIP.u8, e);
        if (!r.ok) {
          failed++;
          step();
          return;
        }
        var blob;
        try {
          blob = new Blob([r.bytes], { type: 'application/octet-stream' });
        } catch (ex) {
          failed++;
          step();
          return;
        }
        FS.addNamed(destStore, Ops.normPrefix(destPrefix) + e.safe, blob, function (ok) {
          /* verify */
          FS.getBlob(destStore, Ops.normPrefix(destPrefix) + e.safe, function (vb) {
            if (ok && vb && vb.size === r.bytes.length) done++;
            else failed++;
            step();
          });
        });
      })();
    });
  }
  function zipKey(key) {
    var n = ZIP.folders.length + ZIP.files.length;
    if (key === 'ArrowUp') {
      if (n && ZIP.focus > 0) { ZIP.focus--; renderZip(); }
      return true;
    }
    if (key === 'ArrowDown') {
      if (n && ZIP.focus < n - 1) { ZIP.focus++; renderZip(); }
      return true;
    }
    if (key === 'Enter') {
      var fe = zipFocusedEntry();
      if (!fe) return true;
      if (fe.isFolder) {
        ZIP.prefix = ZIP.prefix + fe.name + '/';
        ZIP.focus = 0;
        renderZip();
      } else {
        showMenu(baseName(fe.entry.name), [
          { label: 'Extract', icon: 'i-dl', value: 'x' },
          { label: 'Properties', icon: 'i-info', value: 'p' }
        ], function (i) {
          if (i === 0) extractFlow(null, 'focused');
          else if (i === 1) {
            var e = fe.entry;
            PROP = { isFolder: false, meta: { store: ZIP.meta.store, name: '[zip] ' + e.name, size: e.uncompSize, date: e.date } };
            showScreen('props');
          }
        });
      }
      return true;
    }
    if (key === 'SoftLeft') {
      showAppMenu();
      return true;
    }
    if (key === 'SoftRight') {
      zipMenu();
      return true;
    }
    if (key === 'Backspace') {
      zipUp();
      return true;
    }
    return false;
  }

  /* ================= settings ================= */
  var SE = { focus: 0 };
  function settingRows() {
    return [
      { id: 'hidden', t: 'Show Hidden Files', v: settings.hidden ? 'On' : 'Off', icon: 'i-info' },
      { id: 'sort', t: 'Default Sort Order', v: sortLabel(), icon: 'i-info' },
      { id: 'defStore', t: 'Default Storage', v: settings.defStore === 'sdcard' ? 'SD Card' : 'Internal', icon: 'i-sd' },
      { id: 'confirmDelete', t: 'Confirm Before Delete', v: settings.confirmDelete ? 'On' : 'Off', icon: 'i-trash' },
      { id: 'about', t: 'About MS File Manager', v: '', icon: 'i-info' },
      { id: 'version', t: 'Version', v: '1.1.0', icon: 'i-check' }
    ];
  }
  function renderSettings() {
    setHeader('gear', 'Settings');
    var rows = settingRows();
    var h = '<div class="hint">Note: KaiOS does not expose hidden files to apps, so that option may show no change.</div>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      h += '<div class="row' + (i === SE.focus ? ' focused' : '') + '">' +
        '<span class="ric">' + icon(r.icon) + '</span>' +
        '<span class="rmid"><div class="rn">' + esc(r.t) + '</div></span>' +
        (r.v ? '<span class="rval">' + esc(r.v) + '</span>' : '<span class="rchev">' + icon('i-chev') + '</span>') +
        '</div>';
    }
    $('settings-list').innerHTML = h;
    ensureRowVisible($('scr-settings'), SE.focus);
    setSoftkeys('', '', 'Back');
    rememberSoftkeys();
  }
  function settingsActivate() {
    var id = settingRows()[SE.focus].id;
    if (id === 'hidden') {
      settings.hidden = !settings.hidden;
      saveSettings();
      renderSettings();
      toast('Show Hidden Files: ' + (settings.hidden ? 'On' : 'Off'));
    } else if (id === 'sort') {
      var order = ['name', 'size', 'date', 'type'];
      settings.sort = order[(order.indexOf(settings.sort) + 1) % order.length];
      saveSettings();
      renderSettings();
    } else if (id === 'defStore') {
      settings.defStore = settings.defStore === 'sdcard' ? 'internal' : 'sdcard';
      saveSettings();
      renderSettings();
    } else if (id === 'confirmDelete') {
      settings.confirmDelete = !settings.confirmDelete;
      saveSettings();
      renderSettings();
    } else if (id === 'about') {
      showAbout();
    }
  }
  function settingsKey(key) {
    var n = settingRows().length;
    if (key === 'ArrowUp') {
      if (SE.focus > 0) { SE.focus--; renderSettings(); }
      return true;
    }
    if (key === 'ArrowDown') {
      if (SE.focus < n - 1) { SE.focus++; renderSettings(); }
      return true;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Enter') {
      settingsActivate();
      return true;
    }
    if (key === 'Backspace' || key === 'SoftRight') {
      goBack();
      return true;
    }
    return false;
  }

  /* ================= screen dispatch ================= */
  function renderScreen(name, data) {
    if (name === 'home') renderHome();
    else if (name === 'browse') { BW = data || BW; renderBrowse(); }
    else if (name === 'props') { PROP = data || PROP; renderProps(); }
    else if (name === 'picker') { PK = data || PK; renderPicker(); }
    else if (name === 'search') { SH = data || SH || freshSearch(); renderSearch(); }
    else if (name === 'zip') { ZIP = data || ZIP; renderZip(); }
    else if (name === 'settings') { SE.focus = 0; renderSettings(); }
    else if (name === 'text') { TX = data || TX; renderText(); }
  }
  function isInInput() {
    var ae = document.activeElement;
    return !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'));
  }
  function screenKey(key, inInput) {
    if (current === 'home') return homeKey(key);
    if (current === 'browse') return browseKey(key);
    if (current === 'props') return propsKey(key);
    if (current === 'picker') return pickerKey(key);
    if (current === 'search') return searchKey(key, inInput);
    if (current === 'zip') return zipKey(key);
    if (current === 'settings') return settingsKey(key);
    if (current === 'text') return textKey(key);
    return false;
  }

  /* ================= central key router ================= */
  function onKey(e) {
    var key = e.key;
    if (busyOn) {
      e.preventDefault();
      return;
    }
    var handled = false;
    if (menuState) {
      handled = menuKey(key);
    } else if (dlgState) {
      handled = dlgKey(key, isInInput());
    } else {
      handled = screenKey(key, isInInput());
    }
    if (handled) e.preventDefault();
    /* Backspace at home root is NOT prevented: lets the system exit the app */
  }

  /* ================= init ================= */
  function init() {
    loadSettings();
    document.addEventListener('keydown', onKey, false);
    if (!FS.supported() || !FS.init()) {
      setHeader('app', 'MS File Manager');
      $('scr-home').innerHTML = '<div class="empty-note">Storage API not available on this device.<br>The file manager cannot run here.</div>';
      current = 'home';
      setSoftkeys('', '', '');
      return;
    }
    current = 'home';
    renderHome();
    rememberSoftkeys();
    try {
      $('search-clear').addEventListener('click', function () {
        $('search-input').value = '';
        $('search-input').focus();
      });
    } catch (e) {}
    /* async capability probes (never invent numbers: UI shows states) */
    FS.sdcardPresent(function (ok) {
      SD.present = ok;
      SD.probed = true;
      if (current === 'home') renderHome();
    });
    FS.storageStats('sdcard', function (s) {
      STATS.sdcard = s;
      STATS.sdcardDone = true;
      if (current === 'home') renderHome();
    });
  }

  document.addEventListener('DOMContentLoaded', init, false);

  return {
    init: init,
    toast: toast,
    kindOf: kindOf,
    fmtSize: fmtSize
  };
})();
