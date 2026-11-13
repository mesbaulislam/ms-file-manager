/* operations.js - safe file operations. ES5 only.
 *
 * Rules (platform-honest):
 *  - No native rename/mkdir on KaiOS: rename = copy + verify + delete.
 *  - Folders are virtual path prefixes: "rename folder" rewrites each file's
 *    prefix; "new folder" only materializes when a file is written into it.
 *  - The source is NEVER deleted before the destination is written AND
 *    verified (get + size match).
 *  - Large files cannot be streamed (DeviceStorage get() returns a whole
 *    Blob); callers should warn above LARGE_WARN bytes.
 */
var Ops = (function () {
  var LARGE_WARN = 50 * 1024 * 1024; /* 50 MB: warn, still attempt */

  function normPrefix(p) {
    if (!p) return '';
    if (p.charAt(p.length - 1) !== '/') p += '/';
    while (p.charAt(0) === '/') p = p.slice(1);
    return p;
  }

  function joinPath(prefix, name) {
    return normPrefix(prefix) + name;
  }

  /* True when dest sits inside src (or equals it): forbidden for copy/move. */
  function isInsideOrSame(srcPrefix, destPrefix) {
    var s = normPrefix(srcPrefix);
    var d = normPrefix(destPrefix);
    return d.indexOf(s) === 0;
  }

  /* Copy one file. cb(true) / cb(false, reason).
   * Reasons: 'self' | 'exists' | 'read' | 'write' | 'verify' */
  function copyFile(srcMeta, destStore, destName, cb) {
    if (srcMeta.store === destStore && srcMeta.name === destName) {
      cb(false, 'self');
      return;
    }
    FS.exists(destStore, destName, function (taken) {
      if (taken) {
        cb(false, 'exists');
        return;
      }
      FS.getBlob(srcMeta.store, srcMeta.name, function (blob) {
        if (!blob) {
          cb(false, 'read');
          return;
        }
        FS.addNamed(destStore, destName, blob, function (ok) {
          if (!ok) {
            cb(false, 'write');
            return;
          }
          /* verify before reporting success */
          FS.getBlob(destStore, destName, function (vblob) {
            if (vblob && vblob.size === blob.size) {
              cb(true);
            } else {
              FS.deleteFile(destStore, destName, function () {
                cb(false, 'verify');
              });
            }
          });
        });
      });
    });
  }

  /* Move one file = copy + verify + delete source. Source is only removed
   * after the destination verified OK. cb(true) / cb(false, reason). */
  function moveFile(srcMeta, destStore, destName, cb) {
    copyFile(srcMeta, destStore, destName, function (ok, reason) {
      if (!ok) {
        cb(false, reason);
        return;
      }
      if (srcMeta.store === destStore && srcMeta.name === destName) {
        cb(true);
        return;
      }
      FS.deleteFile(srcMeta.store, srcMeta.name, function (delOk) {
        /* copy already verified; a failed source-delete is reported but the
         * data is safe (it now exists in both places). */
        cb(delOk, delOk ? null : 'srcdelete');
      });
    });
  }

  /* Rename a file within its store. New name only (same folder). */
  function renameFile(meta, newBaseName, cb) {
    var dir = meta.name.indexOf('/') >= 0
      ? meta.name.slice(0, meta.name.lastIndexOf('/') + 1)
      : '';
    var destName = dir + newBaseName;
    if (destName === meta.name) {
      cb(false, 'self');
      return;
    }
    copyFile(meta, meta.store, destName, function (ok, reason) {
      if (!ok) {
        cb(false, reason);
        return;
      }
      FS.deleteFile(meta.store, meta.name, function (delOk) {
        cb(delOk, delOk ? null : 'srcdelete');
      });
    });
  }

  /* Batch helper: run fn(item, next) sequentially with progress. */
  function batch(items, fn, onProgress, cb) {
    var i = 0;
    var done = 0;
    function next() {
      if (i >= items.length) {
        cb(true, done);
        return;
      }
      var it = items[i++];
      if (onProgress) {
        try {
          onProgress(done, items.length);
        } catch (e) {}
      }
      fn(it, function (ok) {
        if (!ok) {
          cb(false, done);
          return;
        }
        done++;
        next();
      });
    }
    next();
  }

  /* Copy every file under srcPrefix to destPrefix (same relative layout).
   * Guards against copying a folder into itself/descendant. */
  function copyFolder(entries, srcStore, srcPrefix, destStore, destPrefix, onProgress, cb) {
    var s = normPrefix(srcPrefix);
    var d = normPrefix(destPrefix);
    if (srcStore === destStore && isInsideOrSame(s, d)) {
      cb(false, 0, 'intodescendant');
      return;
    }
    var files = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name.indexOf(s) === 0) files.push(entries[i]);
    }
    batch(
      files,
      function (it, next) {
        var rel = it.name.slice(s.length);
        copyFile(it, destStore, d + rel, function (ok) {
          next(ok);
        });
      },
      onProgress,
      function (ok, done) {
        cb(ok, done, ok ? null : 'partial');
      }
    );
  }

  /* Move folder = copyFolder, then delete sources only for verified copies. */
  function moveFolder(entries, srcStore, srcPrefix, destStore, destPrefix, onProgress, cb) {
    var s = normPrefix(srcPrefix);
    var d = normPrefix(destPrefix);
    if (srcStore === destStore && isInsideOrSame(s, d)) {
      cb(false, 0, 'intodescendant');
      return;
    }
    var files = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name.indexOf(s) === 0) files.push(entries[i]);
    }
    batch(
      files,
      function (it, next) {
        var rel = it.name.slice(s.length);
        moveFile(it, destStore, d + rel, function (ok) {
          next(ok);
        });
      },
      onProgress,
      function (ok, done) {
        cb(ok, done, ok ? null : 'partial');
      }
    );
  }

  /* Rename a folder (same store): move every file under the prefix. */
  function renameFolder(entries, store, srcPrefix, newBaseName, onProgress, cb) {
    var s = normPrefix(srcPrefix);
    var parent = s.slice(0, s.slice(0, -1).lastIndexOf('/') + 1);
    var d = normPrefix(parent + newBaseName);
    if (d === s) {
      cb(false, 0, 'self');
      return;
    }
    moveFolder(entries, store, s, store, d, onProgress, cb);
  }

  function deleteFile(meta, cb) {
    FS.deleteFile(meta.store, meta.name, function (ok) {
      cb(ok);
    });
  }

  /* Delete every file under a folder prefix. */
  function deleteFolder(entries, store, prefix, onProgress, cb) {
    var s = normPrefix(prefix);
    var files = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].store === store && entries[i].name.indexOf(s) === 0) {
        files.push(entries[i]);
      }
    }
    batch(
      files,
      function (it, next) {
        FS.deleteFile(it.store, it.name, function (ok) {
          next(ok);
        });
      },
      onProgress,
      function (ok, done) {
        cb(ok, done, ok ? null : 'partial');
      }
    );
  }

  return {
    LARGE_WARN: LARGE_WARN,
    normPrefix: normPrefix,
    joinPath: joinPath,
    isInsideOrSame: isInsideOrSame,
    copyFile: copyFile,
    moveFile: moveFile,
    renameFile: renameFile,
    renameFolder: renameFolder,
    copyFolder: copyFolder,
    moveFolder: moveFolder,
    deleteFile: deleteFile,
    deleteFolder: deleteFolder,
    batch: batch
  };
})();
