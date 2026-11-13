/* tests/fake.js - fake DeviceStorage for layout testing in desktop Chrome. */
(function () {
  'use strict';
  var D = 86400000;
  var NOW = Date.now();
  var FAKE = {
    pictures: [
      { name: 'DCIM/Camera/IMG_001.jpg', size: 2203441, date: NOW - 1 * D },
      { name: 'DCIM/Camera/IMG_002.jpg', size: 1887436, date: NOW - 1 * D },
      { name: 'DCIM/Screenshots/shot1.png', size: 875520, date: NOW - 2 * D },
      { name: 'DCIM/notes.txt', size: 120, date: NOW - 3 * D },
      { name: 'Pictures/photo.jpg', size: 1258291, date: NOW - 4 * D }
    ],
    videos: [
      { name: 'Videos/VID_001.mp4', size: 13107200, date: NOW - 2 * D }
    ],
    music: [
      { name: 'Music/song.mp3', size: 4194304, date: NOW - 5 * D }
    ],
    sdcard: [
      { name: 'Download/app.zip', size: 364, date: NOW - 1 * D },
      { name: 'Download/song2.mp3', size: 5242880, date: NOW - 6 * D },
      { name: 'Documents/readme.txt', size: 2048, date: NOW - 7 * D }
    ]
  };
  /* 1x1 red PNG for image thumbnails */
  var PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  function b64ToBytes(b64) {
    var s = atob(b64);
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  var pngBytes = b64ToBytes(PNG_B64);
  var zipBytes = b64ToBytes('UEsDBBQAAAAIAJuTS10AAAAAAgAAAAAAAAAHAAAAcGhvdG9zLwMAUEsDBBQAAAAIAJuTS11t1XRUIAAAAEAGAAAPAAAAcGhvdG9zL2ltZzEuanBn+38jLTE7VTerIDVdNyWxJPH/KH+UP8of5Y/yR/lE8AFQSwMEFAAAAAgAm5NLXZr8dUAQAAAADgAAAAoAAAByZWFkbWUudHh0y0jNyclXSCvKz1WoyiwAAFBLAQIUAxQAAAAIAJuTS10AAAAAAgAAAAAAAAAHAAAAAAAAAAAAEAD9QQAAAABwaG90b3MvUEsBAhQDFAAAAAgAm5NLXW3VdFQgAAAAQAYAAA8AAAAAAAAAAAAAAIABJwAAAHBob3Rvcy9pbWcxLmpwZ1BLAQIUAxQAAAAIAJuTS12a/HVAEAAAAA4AAAAKAAAAAAAAAAAAAACAAXQAAAByZWFkbWUudHh0UEsFBgAAAAADAAMAqgAAAKwAAAAAAA==');

  function FakeStorage(sname) {
    this._name = sname;
  }
  FakeStorage.prototype.enumerate = function () {
    var files = FAKE[this._name] || [];
    var i = 0;
    var cursor = {};
    function fire() {
      var f = files[i];
      cursor.result = f ? { name: f.name, size: f.size, lastModifiedDate: new Date(f.date) } : null;
      if (cursor.onsuccess) cursor.onsuccess();
    }
    cursor.continue = function () {
      i++;
      setTimeout(fire, 5);
    };
    setTimeout(fire, 5);
    return cursor;
  };
  FakeStorage.prototype.get = function (name) {
    var req = {};
    setTimeout(function () {
      var blob;
      if (/\.zip$/i.test(name)) blob = new Blob([zipBytes], { type: 'application/zip' });
      else if (/\.(jpg|jpeg|png|gif)$/i.test(name)) blob = new Blob([pngBytes], { type: 'image/png' });
      else blob = new Blob(['fake content of ' + name], { type: 'text/plain' });
      req.result = blob;
      if (req.onsuccess) req.onsuccess();
    }, 5);
    return req;
  };
  FakeStorage.prototype.addNamed = function (blob, name) {
    var req = {};
    setTimeout(function () {
      if (req.onsuccess) req.onsuccess();
    }, 5);
    return req;
  };
  FakeStorage.prototype.delete = function (name) {
    var req = {};
    setTimeout(function () {
      if (req.onsuccess) req.onsuccess();
    }, 5);
    return req;
  };
  /* storage stats probe: claim unsupported so UI hides numbers */
  navigator.getDeviceStorage = function (n) {
    return new FakeStorage(n);
  };
})();
