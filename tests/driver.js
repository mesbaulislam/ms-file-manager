/* tests/driver.js - scripted key presses for layout screenshots (?s=NAME). */
(function () {
  'use strict';
  function key(k) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }
  function seq(steps, i) {
    if (i >= steps.length) return;
    setTimeout(function () {
      key(steps[i][1]);
      seq(steps, i + 1);
    }, steps[i][0]);
  }
  function downs(n, first) {
    var s = [[first || 300, 'ArrowDown']];
    for (var i = 1; i < n; i++) s.push([220, 'ArrowDown']);
    return s;
  }
  var m = location.search.match(/s=([a-z]+)/);
  var S = m ? m[1] : 'home';
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (S === 'browse') {
        seq([[400, 'Enter']], 0);
      } else if (S === 'menu') {
        seq([[400, 'Enter'], [250, 'Enter'], [250, 'SoftLeft']], 0);
      } else if (S === 'props') {
        var s = [[400, 'Enter'], [250, 'Enter'], [250, 'ArrowDown'], [250, 'ArrowDown'],
                 [250, 'SoftLeft']].concat(downs(5, 250));
        s.push([250, 'Enter']);
        seq(s, 0);
      } else if (S === 'picker') {
        seq([[400, 'Enter'], [250, 'Enter'], [250, 'ArrowDown'], [250, 'ArrowDown'],
             [250, 'SoftLeft'], [250, 'ArrowDown'], [250, 'ArrowDown'], [250, 'Enter']], 0);
      } else if (S === 'search') {
        var s2 = downs(8, 400);
        s2.push([250, 'Enter']);
        seq(s2, 0);
      } else if (S === 'zip') {
        seq([[400, 'ArrowDown'], [250, 'Enter'], [250, 'ArrowDown'], [250, 'Enter'], [250, 'Enter']], 0);
      } else if (S === 'settings') {
        var s3 = downs(9, 400);
        s3.push([250, 'Enter']);
        seq(s3, 0);
      }
    }, 500);
  });
})();
