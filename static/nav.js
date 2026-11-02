// Stub. The site menu now lives in site-nav.js, owned by the steves-site repo
// (public/site-nav.js) and served from stevessite.com. Edit SITE_NAV_CONFIG there.
//
// Dev switch: on localhost, load /dev/site-nav.js, which Flask serves from a
// local steves-site checkout in debug mode (see app.py). Falls back to the live file.
(function () {
  var me = document.currentScript;
  var LIVE = 'https://stevessite.com/site-nav.js';
  var local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  function load(src, onerror) {
    var s = document.createElement('script');
    s.src = src;
    s.dataset.section = 'backtester';
    if (onerror) s.onerror = onerror;
    me.parentNode.insertBefore(s, me.nextSibling);
  }
  if (local) load('/dev/site-nav.js', function () { load(LIVE); });
  else load(LIVE);
})();
