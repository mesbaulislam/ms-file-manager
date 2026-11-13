/* filesystem.js - DeviceStorage adapter for MS File Manager. ES5 only.
 *
 * Wraps ONLY the verified KaiOS Device Storage API:
 *   navigator.getDeviceStorage(name) -> { enumerate(), get(name),
 *   addNamed(blob, name), delete(name) }
 * Folders are virtual: derived from "/" path prefixes in enumerate() results.
 * There is no mkdir/rename/statfs on this platform; see operations.js and
 * README.md for the honest fallbacks.
 *
 * v1.1.0 device-truth fixes (Energizer E241S, KaiOS 2.5.3.2):
 *  - enumerate() may return names with a leading '/' and/or a volume prefix
 *    like 'sdcard1/' (e.g. '/sdcard1/DCIM/Camera/IMG.jpg'). Callers ALWAYS
 *    work with DISPLAY names (entry.name); getBlob/addNamed/delete/exists
 *    convert back to the raw storage name internally via toRaw(). This is
 *    what the working Gallery app does (verbatim enumerate names for ops).
 *  - When every entry of a store shares a single 'sdcardN/' volume segment,
 *    that segment is stripped for display, so "Internal Storage" shows
 *    DCIM/, Download/ ... directly, like the built-in file manager.
 *  - entry.raw keeps the verbatim enumerate() name (debugging/tests).
 */
var FS = (function () {
  var STORES = ['pictures', 'videos', 'music', 'sdcard'];
  var INTERNAL_STORES = ['pictures', 'videos', 'music'];
  var SCAN_CAP = 2000; /* max entries per store per scan (RAM safety) */

  var handles = {};
  /* store -> raw prefix stripped for display, e.g. '/sdcard1/', '/' or '' */
  var namePrefix = {};
  var VOL_SEG_RE = /^sdcard\d*$/i;

  function supported() {
    return !!(typeof navigator !== 'undefined' && navigator.getDeviceStorage);
  }

  function init() {
    handles = {};
    namePrefix = {};
    if (!supported()) return false;
    for (var i = 0; i < STORES.length; i++) {
      try {
        handles[STORES[i]] = navigator.getDeviceStorage(STORES[i]);
      } catch (e) {
        handles[STORES[i]] = null;
      }
    }
    return true;
  }

  function storeOk(name) {
    return !!handles[name];
  }

  /* Display-only cleanup: strip leading slashes. */
  function cleanName(n) {
    if (!n) return '';
    n = String(n);
    while (n.charAt(0) === '/') n = n.slice(1);
    return n;
  }

  /* Detect a common 'sdcardN/' volume segment across a store's raw names.
   * Returns {disp:'sdcard1/', raw:'/sdcard1/'} or null. Conservative: every
   * name must share the single segment, otherwise no stripping. */
  function detectVol(rawNames) {
    var seg = null;
    for (var i = 0; i < rawNames.length; i++) {
      var c = cleanName(rawNames[i]);
      if (!c) return null;
      var idx = c.indexOf('/');
      var s = idx < 0 ? c : c.slice(0, idx);
      if (!VOL_SEG_RE.test(s)) return null;
      if (seg === null) seg = s;
      else if (seg !== s) return null;
    }
    if (seg === null) return null;
    var disp = seg + '/';
    var raw0 = String(rawNames[0]);
    var c0 = cleanName(raw0);
    var rawPre = raw0.slice(0, raw0.length - c0.length) + disp;
    return { disp: disp, raw: rawPre };
  }

  /* Map a DISPLAY name back to the raw storage name.
   * e.g. toRaw('pictures','DCIM/a.jpg') -> '/sdcard1/DCIM/a.jpg' on E241S. */
  function toRaw(sname, dname) {
    var pre = namePrefix[sname];
    if (pre === undefined || pre === null) pre = '';
    return pre + cleanName(dname);
  }

  /* Enumerate one store.
   * onDone(entries[{store, name, raw, size, date}]).
   *  - name: DISPLAY path (cleaned, volume prefix stripped)
   *  - raw:  VERBATIM enumerate() name
   * Caps at maxN. */
  function scanStore(sname, maxN, onProgress, onDone) {
    var out = [];
    var store = handles[sname];
    if (!store) {
      onDone(out);
      return;
    }
    var cursor = null;
    try {
      cursor = store.enumerate();
    } catch (e) {
      onDone(out);
      return;
    }
    if (!cursor) {
      onDone(out);
      return;
    }
    var limit = maxN || SCAN_CAP;

    function finish() {
      var raws = [];
      for (var k = 0; k < out.length; k++) raws.push(String(out[k].name));
      var vol = detectVol(raws);
      /* raw prefix = leading slashes of first entry + volume segment */
      var pre = '';
      if (raws.length) {
        var r0 = raws[0];
        var c0 = cleanName(r0);
        pre = r0.slice(0, r0.length - c0.length) + (vol ? vol.disp : '');
      }
      /* display names + round-trip verification */
      var disps = [];
      var consistent = true;
      for (var i = 0; i < raws.length; i++) {
        var d = cleanName(raws[i]);
        if (vol && d.indexOf(vol.disp) === 0) d = d.slice(vol.disp.length);
        if (!d) d = cleanName(raws[i]); /* pathological guard */
        disps.push(d);
        if (pre + d !== raws[i]) consistent = false;
      }
      namePrefix[sname] = consistent ? pre : '';
      for (var j = 0; j < out.length; j++) {
        out[j].raw = raws[j];
        out[j].name = disps[j];
      }
      onDone(out);
    }

    cursor.onsuccess = function () {
      var f = null;
      try {
        f = cursor.result;
      } catch (e) {
        f = null;
      }
      if (f) {
        var nm = f.name || '';
        if (nm) {
          var d = 0;
          try {
            if (f.lastModifiedDate) d = f.lastModifiedDate.getTime();
          } catch (e2) {}
          out.push({ store: sname, name: nm, raw: nm, size: f.size || 0, date: d });
        }
        if (onProgress) {
          try {
            onProgress(out.length);
          } catch (e3) {}
        }
        if (out.length >= limit) {
          finish();
          return;
        }
        try {
          cursor.continue();
        } catch (e4) {
          finish();
        }
      } else {
        finish();
      }
    };
    cursor.onerror = function () {
      finish();
    };
  }

  /* Enumerate several stores in sequence, concatenating results. */
  function scanStores(names, maxEach, onProgress, onDone) {
    var all = [];
    var queue = names.slice();
    function next() {
      if (!queue.length) {
        onDone(all);
        return;
      }
      var sn = queue.shift();
      scanStore(sn, maxEach, onProgress, function (entries) {
        for (var i = 0; i < entries.length; i++) all.push(entries[i]);
        next();
      });
    }
    next();
  }

  /* Derive a directory listing from flat entries at the given DISPLAY prefix.
   * prefix: '' for root, or 'DCIM/' etc. (always ends with '/' when non-empty).
   * Returns { folders: [{name, count}], files: [entry] }.
   * count = recursive file count beneath that folder prefix. */
  function deriveDir(entries, prefix) {
    var folders = {};
    var files = [];
    var i, e, rest, slash, fname;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.name.indexOf(prefix) !== 0) continue;
      rest = e.name.slice(prefix.length);
      if (!rest) continue;
      slash = rest.indexOf('/');
      if (slash < 0) {
        files.push(e);
      } else {
        fname = rest.slice(0, slash);
        if (!folders[fname]) folders[fname] = 0;
        folders[fname]++;
      }
    }
    var flist = [];
    for (fname in folders) {
      if (Object.prototype.hasOwnProperty.call(folders, fname)) {
        flist.push({ name: fname, count: folders[fname] });
      }
    }
    return { folders: flist, files: files };
  }

  /* NOTE: the name arguments below take DISPLAY names (entry.name or a
   * display path built from one). They are converted to raw storage names
   * internally via toRaw(). */

  function getBlob(store, name, cb) {
    var st = handles[store];
    if (!st) {
      cb(null);
      return;
    }
    var req = null;
    try {
      req = st.get(toRaw(store, name));
    } catch (e) {
      cb(null);
      return;
    }
    if (!req) {
      cb(null);
      return;
    }
    req.onsuccess = function () {
      cb(req.result || null);
    };
    req.onerror = function () {
      cb(null);
    };
  }

  function deleteFile(store, name, cb) {
    var st = handles[store];
    if (!st) {
      cb(false);
      return;
    }
    var req = null;
    try {
      req = st.delete(toRaw(store, name));
    } catch (e) {
      cb(false);
      return;
    }
    if (!req) {
      cb(false);
      return;
    }
    req.onsuccess = function () {
      cb(true);
    };
    req.onerror = function () {
      cb(false);
    };
  }

  function addNamed(store, name, blob, cb) {
    var st = handles[store];
    if (!st) {
      cb(false);
      return;
    }
    var req = null;
    try {
      req = st.addNamed(blob, toRaw(store, name));
    } catch (e) {
      cb(false);
      return;
    }
    if (!req) {
      cb(false);
      return;
    }
    req.onsuccess = function () {
      cb(true);
    };
    req.onerror = function () {
      cb(false);
    };
  }

  /* Check existence via get(). cb(true/false). */
  function exists(store, name, cb) {
    getBlob(store, name, function (blob) {
      cb(!!blob);
    });
  }

  /* Storage statistics. Only calls back with {used,total} when the platform
   * really exposes freeSpace()/usedSpace(); otherwise cb(null) and the UI
   * must NOT invent numbers.
   * DEVICE-TRUTH (E241S, KaiOS 2.5.3.2, 2026-10-12): the pictures-area
   * freeSpace()/usedSpace() returns WRONG numbers (23.1 GB on a ~1 GB
   * partition) while the sdcard area is correct. The UI therefore only shows
   * SD-card stats and hides internal numbers entirely. */
  function storageStats(sname, cb) {
    var done = false;
    function fin(v) {
      if (!done) {
        done = true;
        cb(v);
      }
    }
    var st = handles[sname];
    try {
      if (
        st &&
        typeof st.freeSpace === 'function' &&
        typeof st.usedSpace === 'function'
      ) {
        var fr = st.freeSpace();
        var ur = st.usedSpace();
        var timer = setTimeout(function () {
          fin(null);
        }, 4000);
        var fv = -1,
          uv = -1;
        function maybe() {
          if (fv >= 0 && uv >= 0) {
            clearTimeout(timer);
            fin({ used: uv, total: uv + fv });
          }
        }
        fr.onsuccess = function () {
          fv = fr.result || 0;
          maybe();
        };
        fr.onerror = function () {
          clearTimeout(timer);
          fin(null);
        };
        ur.onsuccess = function () {
          uv = ur.result || 0;
          maybe();
        };
        ur.onerror = function () {
          clearTimeout(timer);
          fin(null);
        };
        return;
      }
    } catch (e) {}
    fin(null);
  }

  /* Probe whether the SD card storage is actually usable. */
  function sdcardPresent(cb) {
    var done = false;
    function fin(v) {
      if (!done) {
        done = true;
        cb(v);
      }
    }
    var st = handles['sdcard'];
    if (!st) {
      fin(false);
      return;
    }
    var timer = setTimeout(function () {
      fin(false);
    }, 4000);
    var cursor = null;
    try {
      cursor = st.enumerate();
    } catch (e) {
      clearTimeout(timer);
      fin(false);
      return;
    }
    if (!cursor) {
      clearTimeout(timer);
      fin(false);
      return;
    }
    cursor.onsuccess = function () {
      clearTimeout(timer);
      fin(true); /* any result (even end-of-list) means the store works */
    };
    cursor.onerror = function () {
      clearTimeout(timer);
      fin(false);
    };
  }

  return {
    STORES: STORES,
    INTERNAL_STORES: INTERNAL_STORES,
    SCAN_CAP: SCAN_CAP,
    supported: supported,
    init: init,
    storeOk: storeOk,
    scanStore: scanStore,
    scanStores: scanStores,
    deriveDir: deriveDir,
    toRaw: toRaw,
    getBlob: getBlob,
    deleteFile: deleteFile,
    addNamed: addNamed,
    exists: exists,
    storageStats: storageStats,
    sdcardPresent: sdcardPresent
  };
})();
