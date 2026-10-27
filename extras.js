/* Extras: About Agronica screen, offline Help bot, and the slim product ad strip. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // =================== About Agronica ===================
  // Contact details are the ones published on https://www.agronicaag.com/contact
  var ABOUT = { phone: '(+61) 475 570 872', tel: '+61475570872', emails: ['jonathan@agronicaag.com', 'admin@agronicaag.com'],
    address: '4468 Goodwood Road, Alloway QLD 4670', web: 'https://www.agronicaag.com',
    pin: { lat: -24.9857, lon: 152.3801 } };       // approximate: Goodwood Road, Alloway (OpenStreetMap) - no street-number geocode available
  var aboutMap = null;
  function mapsQuery() { return encodeURIComponent(ABOUT.address + ' Australia'); }
  function openAbout() {
    closeHelp(); $('sheet').classList.add('hidden');
    $('about').classList.remove('hidden'); $('about').scrollTop = 0;
    if (window.MMap && window.L) {
      if (!aboutMap) aboutMap = window.MMap.create($('aboutMap'), { noFollow: true, noSave: true });
      aboutMap.update({ marks: [], tracks: [], fitPoints: [ABOUT.pin], fitKey: 'about' });
      var m = aboutMap.getMap();
      if (m && !aboutMap._pinned) {
        aboutMap._pinned = true;
        var ll = [ABOUT.pin.lat, ABOUT.pin.lon];
        L.circle(ll, { radius: 500, color: '#ffb400', weight: 2, dashArray: '6 6', fillOpacity: 0.08, interactive: false }).addTo(m);
        L.marker(ll, { icon: L.divIcon({ className: 'mm-pin', html: '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="#ffb400" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="10" r="2.6" fill="#222"/></svg>', iconSize: [36, 36], iconAnchor: [18, 34] }), keyboard: false })
          .bindPopup('<b>Agronica</b><br>4468 Goodwood Road, Alloway QLD<br><small>Approximate map position</small>').addTo(m);
        m.setView(ll, 14, { animate: false });
      } else if (m) { aboutMap.invalidate(); }
    }
  }
  function closeAbout() { $('about').classList.add('hidden'); }
  function buildAbout() {
    var a = $('aboutBody');
    a.innerHTML =
      '<img src="img/agronica-logo.svg" alt="Agronica" class="about-logo">' +
      '<p class="about-lead">Agronomic services and products with accurate, pragmatic and confidential advice focused on productivity and profitability.</p>' +
      '<div class="card"><div class="card-title">What we do</div><ul class="about-list">' +
      '<li><b>Pest and Disease Management</b><span>Monitoring and identification of pests, diseases and weeds, using integrated pest and disease management.</span></li>' +
      '<li><b>Soil and Nutrition Management</b><span>Nutrient management plans, backed by soil and plant tissue testing.</span></li>' +
      '<li><b>Data Management and ESG</b><span>Turning data into insights: soil/leaf testing and residue, quality and maturity testing of crops.</span></li></ul></div>' +
      '<div class="card"><div class="card-title">Get in touch</div><div class="about-actions">' +
      '<a class="act" id="abCall" href="tel:' + ABOUT.tel + '"><svg class="ic"><use href="#i-phone"/></svg><span>Call<small>' + ABOUT.phone + '</small></span></a>' +
      ABOUT.emails.map(function (e, i) { return '<a class="act" id="abMail' + i + '" href="mailto:' + e + '?subject=Mistletoe%20Marker%20enquiry"><svg class="ic"><use href="#i-mail"/></svg><span>Email<small>' + e + '</small></span></a>'; }).join('') +
      '<a class="act" id="abWeb" href="' + ABOUT.web + '" target="_blank" rel="noopener"><svg class="ic"><use href="#i-globe"/></svg><span>Website<small>www.agronicaag.com</small></span></a>' +
      '</div></div>' +
      '<div class="card"><div class="card-title">Find us</div><div class="about-addr"><b>' + ABOUT.address + '</b><br><span class="dim small-txt">Bundaberg region</span></div>' +
      '<div class="about-actions two"><a class="act" id="abMaps" href="https://www.google.com/maps/search/?api=1&query=' + mapsQuery() + '" target="_blank" rel="noopener"><svg class="ic"><use href="#i-pin"/></svg><span>Open in Maps</span></a>' +
      '<a class="act" id="abApple" href="https://maps.apple.com/?q=' + mapsQuery() + '" target="_blank" rel="noopener"><svg class="ic"><use href="#i-pin"/></svg><span>Apple Maps</span></a></div>' +
      '<div id="aboutMap" class="about-map"></div><div class="dim small-txt about-note">Approximate position on Goodwood Road, Alloway.</div></div>';
  }

  // =================== Help bot ===================
  var FAQ = [
    { id: 'start', label: 'Starting', kw: ['start', 'begin', 'gps', 'first', 'how do i use', 'getting started', 'stop', 'permission', 'location', 'no fix', 'fix'],
      a: 'Open the Mark tab and press START. Allow location when your phone asks. The pill at the top turns "GPS OK" once there is a fix - give it a few seconds in the open.\nThen walk your rows and tap LEFT or RIGHT when you pass mistletoe on that side of you. Press STOP when you finish. The screen is kept awake while tracking.' },
    { id: 'mark', label: 'Marking L / R', kw: ['mark', 'left', 'right', 'record', 'clump', 'button', 'side', 'l/r', 'big'],
      a: 'The big blue LEFT and orange RIGHT buttons save a mark at your current GPS position, on the side you tapped. Marks are numbered (L-1, R-2...) and the button shows the last one. You must have pressed START and have a GPS fix, otherwise the app tells you the mark was not recorded.' },
    { id: 'other', label: 'Other categories', kw: ['other', 'categor', 'irrigation', 'phytophthora', 'nutrition', 'issue', 'type', 'colour', 'color', 'shape', 'legend'],
      a: 'Under the big buttons, "Other Left" and "Other Right" record something that is not mistletoe: Broken irrigation, Phytophthora treatment or Nutritional issue. Tap one, then pick the issue - the position is taken at the moment you tapped.\nEach type has its own colour and marker shape (darker = left, lighter = right); the legend under the maps shows them.' },
    { id: 'undo', label: 'Undo / delete', kw: ['undo', 'delete', 'remove', 'wrong', 'mistake', 'oops', 'accident', 'clear'],
      a: 'The arrow button next to START undoes the last mark. For an older mark, open the menu (the three-lines button), find it in the Marks list and tap Delete. "New session (clear all)" in the menu wipes everything - export first!' },
    { id: 'export', label: 'Export / share KML', kw: ['export', 'share', 'kml', 'send', 'email', 'whatsapp', 'google earth', 'save my', 'download', 'file'],
      a: 'Menu -> "Export / Share KML". On most phones you get the share sheet (email, messages, Drive...). Otherwise a .kml file downloads. It contains your track and all marks with their colours, and opens in Google Earth, Google My Maps, QGIS and similar.' },
    { id: 'import', label: 'Import / merge maps', kw: ['import', 'merge', 'combine', 'two people', 'colleague', 'other person', 'someone else', 'together', 'duplicate'],
      a: 'To combine two people\'s maps: each person exports their KML (Menu -> Export), sends it to the other, and each uses Menu -> "Import KML". Imported marks are added to your list, exact duplicates are skipped, and their track is added as an extra line. In Find mode use "Load KML" to be guided to someone else\'s marks.' },
    { id: 'find', label: 'Find mode', kw: ['find', 'found', 'treated', 'guide', 'arrow', 'navigate', 'return', 'locate', 'session', 'load kml', 'filter'],
      a: 'Find mode guides you back to marks. Open the Find tab, "Load KML" (one exported from this app, or any KML with points), then START TRACKING. The arrow points at the nearest unfound point and shows the distance. Tap FOUND when you reach it, or TREATED once treated. "Export found" saves those statuses to a KML. The "Find these" chips filter by type.' },
    { id: 'alerts', label: 'Alerts', kw: ['alert', 'radius', 'beep', 'vibrate', 'vibration', 'voice', 'sound', 'notify', 'warning', 'near', 'close'],
      a: 'In Find mode you are alerted as you approach the target: at your alert radius (slider, default 30 m), again at half that distance, and "arrived" at about 5 m. Choose Vibrate, Beep and/or Voice, and try them with "Test alert". The dashed ring on the map is the alert radius.' },
    { id: 'maps', label: 'Satellite & offline maps', kw: ['satellite', 'map', 'offline', 'tiles', 'imagery', 'no signal', 'no reception', 'download map', 'labels', 'follow', 'zoom', 'esri', 'cache'],
      a: 'Maps show Esri satellite imagery under your track and marks. Tap a mark for details (and Found/Treated in Find). "Follow me" keeps the map on you, "Fit" zooms to your data, "Labels" adds place names.\nOffline: tiles you have viewed are remembered (about 2000), and "Save map area for offline" downloads the current view (up to zoom 19) while you have signal. With no signal and no saved tiles you get a dark background - GPS, marks and track still work.' },
    { id: 'phones', label: 'iPhone vs Android', kw: ['iphone', 'ios', 'android', 'safari', 'chrome', 'samsung', 'apple', 'difference', 'compass'],
      a: 'Both work in the browser. Android (Chrome): vibration works and a KML can be shared straight into the app. iPhone (Safari): no vibration (beeps and voice only), use "Load KML" / "Import KML" rather than share-to-app, and tap Allow for the compass when tracking starts. On both, alerts only work while the app is open and the screen is on.' },
    { id: 'install', label: 'Add to home screen', kw: ['home screen', 'install', 'add to home', 'icon', 'app store', 'pwa', 'shortcut'],
      a: 'iPhone: open the page in Safari, tap Share, then "Add to Home Screen". Android: in Chrome tap the menu (three dots) then "Install app" or "Add to Home screen". After the first load it also starts without signal.' },
    { id: 'privacy', label: 'Privacy & data', kw: ['privacy', 'private', 'store', 'stored', 'server', 'track me', 'safe', 'secure', 'delete my data', 'my data', 'who sees'],
      a: 'By default your marks, tracks and settings stay on your phone (browser storage) and nothing is uploaded. Only if you tick "Share my marks with Agronica for research" are your marks (and a thinned track) sent to Agronica - see "Data sharing & research". Map tiles come from Esri, which sees the map area requested, not your marks. Clearing your browser data deletes your marks, so export a KML first.' },
    { id: 'sharing', label: 'Data sharing & research', kw: ['sharing', 'shared', 'is my data shared', 'research', 'opt in', 'opt out', 'opt-in', 'consent', 'database', 'model', 'modelling', 'share my', 'sync', 'upload', 'welcome', 'turn off', 'device id', 'what is shared', 'shared with'],
      a: 'Agronica is building a mistletoe modelling database to research how mistletoe is distributed and how severe it is across districts. Sharing is optional and OFF by default.\nIf you opt in (Menu -> Research & data sharing, or the welcome screen), your mark locations, type, side and time - plus optional severity, variety and a thinned GPS track - are uploaded with a random device ID. Your name, email, farm and district are only sent if you type them in.\nMarks queue on your phone when offline and upload when you are back online (or tap "Sync now"). Turn it off anytime: uploads stop and the queue is cleared. Data already received stays in the database - email Agronica to ask for removal.' },
    { id: 'collab', label: 'Collaborative data', kw: ['collaborative', 'pooled', 'download', 'csv', 'approved', 'pending', 'combined', 'community data', 'request access', 'access to', 'district data', 'get the data', 'see the data', 'benefit'],
      a: 'People who share their marks can ask for access to the combined district mistletoe data. Open Menu -> Research & data sharing and tap "Request collaborative data" (available once you have opted in and at least one sync has worked). Enter your name and email so Agronica can reply - if you are offline it is queued and sent later.\nThe same screen shows your request status (pending, approved...). When approved you can download the pooled data as KML or CSV, or tap "Load pooled data in Find/map" to see it as a separate, read-only, anonymised layer on the maps. Approval can expire, in which case you can request again.' },
    { id: 'severity', label: 'Severity & variety', kw: ['severity', 'severe', 'light', 'moderate', 'heavy', 'variety', 'varieties', 'cultivar', 'a4', 'a16', '741', '344', 'chip'],
      a: 'After each mistletoe LEFT/RIGHT mark, a Light / Moderate / Heavy row appears for about 4 seconds. Tap one to record severity for that mark, or ignore it and keep marking - it never blocks you. Set the macadamia variety for the session in the Menu (A4, A16, A38, 741, 344, 246, 816, 842, 660 or Other); new marks carry it. Severity and variety are included in KML export/import and, if you opt in, in the research data.' },
    { id: 'ads', label: 'About the ad strip', kw: ['ad ', 'ads', 'advert', 'sponsor', 'strip', 'banner', 'product'],
      a: 'The slim strip above the Mark/Find tabs shows product notices, changing every few seconds. It never pops up and tapping one just opens that product page in your browser.' }
  ];
  var CONTACT_REPLY = 'For anything else, the Agronica team is happy to help: tap "Contact Agronica" below for phone, email and address.';
  function score(q, e) {
    var s = 0; q = ' ' + q.toLowerCase().replace(/[^a-z0-9\/ ]+/g, ' ') + ' ';
    e.kw.forEach(function (k) { if (q.indexOf(k) >= 0) s += k.length > 5 ? 3 : 2; });
    if (q.indexOf(e.label.toLowerCase()) >= 0) s += 4;
    return s;
  }
  function answer(q) {
    if (/\b(contact|phone|call|email|address|agronica|who are you|speak|talk to)\b/i.test(q) && !/(kml|share|sharing|export|research|data|collaborative|sync|opt)/i.test(q)) return { contact: true, text: 'You can reach Agronica on ' + ABOUT.phone + ' or ' + ABOUT.emails[0] + '. Tap the button below for all contact details and a map.' };
    var best = null, bs = 0;
    FAQ.forEach(function (e) { var s = score(q, e); if (s > bs) { bs = s; best = e; } });
    return best ? { faq: best, text: best.a } : { fallback: true, text: "I'm not sure about that one yet. Pick a topic below, or ask the Agronica team directly. " + CONTACT_REPLY };
  }
  var helpBuilt = false, chatLog;
  function addMsg(who, text, extra) {
    var m = el('div', 'msg-b ' + who); var t = el('div', 'bub', text); m.appendChild(t);
    if (who === 'bot') { var av = el('img', 'av'); av.src = 'img/helper.png'; av.alt = ''; m.insertBefore(av, t); }
    if (extra) t.appendChild(extra);
    chatLog.appendChild(m); chatLog.scrollTop = chatLog.scrollHeight; return m;
  }
  function contactBtn() { var b = el('button', 'soft full', 'Contact Agronica'); b.type = 'button'; b.id = 'helpContact'; b.onclick = openAbout; return b; }
  function ask(q) {
    q = (q || '').trim(); if (!q) return;
    addMsg('me', q);
    var r = answer(q);
    setTimeout(function () { addMsg('bot', r.text, r.contact || r.fallback ? contactBtn() : null); }, 180);
  }
  function buildHelp() {
    if (helpBuilt) return; helpBuilt = true;
    chatLog = $('helpLog');
    var chips = $('helpChips');
    FAQ.forEach(function (e) { var b = el('button', 'qchip', e.label); b.type = 'button'; b.setAttribute('data-faq', e.id); b.onclick = function () { ask(e.label); }; chips.appendChild(b); });
    var cc = el('button', 'qchip contact', 'Contact Agronica'); cc.type = 'button'; cc.id = 'helpChipContact'; cc.onclick = openAbout; chips.appendChild(cc);
    $('helpForm').onsubmit = function (e) { e.preventDefault(); var i = $('helpInput'); var q = i.value; i.value = ''; ask(q); };
    addMsg('bot', "G'day, I'm Macca, the Mistletoe Marker Helper! Ask me how something works, or tap a topic below. I work offline.");
  }
  function openHelp() { buildHelp(); $('help').classList.remove('hidden'); setTimeout(function () { chatLog.scrollTop = chatLog.scrollHeight; }, 50); }
  function closeHelp() { var h = $('help'); if (h) h.classList.add('hidden'); }

  // =================== Ad strip ===================
  var ads = [], adIdx = 0, adTimer = null, lastTap = 0, ADMS = 6000;
  function showAd(i, instant) {
    var bar = $('adbar'), a = $('adLink'); if (!ads.length) { bar.classList.add('hidden'); return; }
    var ad = ads[i % ads.length];
    function apply() {
      a.href = ad.url; $('adImg').src = ad.image; $('adImg').alt = '';
      $('adName').textContent = ad.name + (ad.by ? ' by ' + ad.by : ''); $('adText').textContent = ad.text;
      a.setAttribute('aria-label', 'Ad: ' + ad.name + (ad.by ? ' by ' + ad.by : '') + ' - ' + ad.text); a.dataset.ad = i % ads.length;
      a.classList.remove('fade');
    }
    if (instant) apply(); else { a.classList.add('fade'); setTimeout(apply, 450); }
  }
  function nextAd() {
    if (document.hidden || ads.length < 2) return;
    if (Date.now() - lastTap < 8000) return;          // pause while the user is marking
    adIdx = (adIdx + 1) % ads.length; showAd(adIdx);
  }
  function loadAds() {
    fetch('ads.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      var list = Array.isArray(j) ? j : (j && j.ads) || [];
      ads = list.filter(function (x) { return x && x.name && x.url; });
      ads.forEach(function (x) { if (x.image) { var im = new Image(); im.src = x.image; } });
      adIdx = 0; showAd(0, true); $('adbar').classList.toggle('hidden', !ads.length);
      clearInterval(adTimer); adTimer = setInterval(nextAd, ADMS);
    }).catch(function () { $('adbar').classList.add('hidden'); });
  }
  ['btnL', 'btnR', 'btnOL', 'btnOR', 'undo', 'btnFound', 'btnTreated'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('pointerdown', function () { lastTap = Date.now(); }, true); });

  // =================== wiring ===================
  buildAbout();
  Array.prototype.forEach.call(document.querySelectorAll('.js-about'), function (b) { b.onclick = openAbout; }); $('menuAbout').onclick = openAbout; $('closeAbout').onclick = closeAbout;
  Array.prototype.forEach.call(document.querySelectorAll('.js-help'), function (b) { b.onclick = openHelp; }); $('menuHelp').onclick = function () { $('sheet').classList.add('hidden'); openHelp(); };
  $('closeHelp').onclick = closeHelp; $('helpBack').onclick = closeHelp;
  loadAds();
  window.Extras = { openAbout: openAbout, openHelp: openHelp, answer: answer, FAQ: FAQ, ABOUT: ABOUT, ads: function () { return ads.slice(); }, adIndex: function () { return adIdx; }, tick: nextAd,
    aboutMapStats: function () { return aboutMap ? aboutMap.stats() : null; } };
})();
