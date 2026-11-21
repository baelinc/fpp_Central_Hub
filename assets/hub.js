/* FPP Central Hub - dashboard + kiosk */
(function () {
  'use strict';
  const H = window.Hub, B = H.boot, esc = H.esc, icon = H.icon;
  const root = document.getElementById('hub-root');
  const KINDS = [
    { k: 'fpp', title: 'Falcon Players', one: 'Falcon Player', ico: 'tv' },
    { k: 'controller', title: 'Controllers', one: 'Controller', ico: 'cpu' },
    { k: 'sensor', title: 'Counters & Sensors', one: 'Counter / sensor', ico: 'pulse' },
    { k: 'plug', title: 'Smart Plugs', one: 'Smart plug', ico: 'plug' },
  ];
  const NOPLAY = ['remote', 'bridge']; // modes with no playlists / scheduler of their own
  const FPP_PAGES = [['Status', 'index.php', 'pulse'], ['Playlists', 'playlists.php', 'list'], ['Schedule', 'scheduler.php', 'sun'], ['File manager', 'filemanager.php', 'download'], ['Channel outputs', 'channeloutputs.php', 'zap'], ['Test patterns', 'testing.php', 'zap'], ['Settings', 'settings.php', 'gear']];
  const S = { cfg: null, types: {}, status: {}, recv: {}, tab: B.kind || 'all', group: '', q: '', sel: new Set(), selMode: false, playlists: {}, drag: new Set(), polling: false, ro: false, timer: null, sigCfg: '', acted: {}, watch: {}, monitor: null };

  const dev = (id) => S.cfg.devices.find((d) => d.id === id);
  const typeLabel = (d) => ((S.types[d.kind] || {})[d.type] || {}).label || d.type;
  const opt = (k) => S.cfg.options[k];

  /* ------------------------------------------------------------------ shell */
  function shell() {
    root.innerHTML =
      '<div class="hb-app">' +
      '<header class="hb-top">' +
      '<div class="hb-brand"><span class="hb-logo">' + H.logo(46) + '</span><div><h2 id="hb-title">Central Hub</h2><div class="hb-sub" id="hb-summary">Loading…</div></div></div>' +
      '<label class="hb-search">' + icon('search', 16) + '<input id="hb-q" type="search" placeholder="Search devices, IPs, groups…" autocomplete="off"></label>' +
      '<div class="hb-actions" id="hb-actions"></div>' +
      '</header>' +
      '<nav class="hb-tabs" id="hb-tabs"></nav>' +
      '<div class="hb-scenes" id="hb-scenes"></div>' +
      '<main id="hb-sections"></main>' +
      '<div class="hb-selbar" id="hb-selbar" hidden></div>' +
      '</div>';
    document.getElementById('hb-q').addEventListener('input', H.debounce((e) => { S.q = e.target.value.trim().toLowerCase(); renderAll(); }, 150));
  }

  function renderActions() {
    const a = [];
    if (!S.ro) {
      a.push('<button class="hb-btn" data-top="scan" title="Search the network for devices">' + icon('refresh', 16) + '<span>Scan</span></button>');
      a.push('<button class="hb-btn" data-top="add">' + icon('plus', 16) + '<span>Add</span></button>');
      a.push('<button class="hb-btn' + (opt('watchdogEnabled') ? ' ok' : '') + '" data-top="watchdog" title="Master switch for automatic recovery of unresponsive devices">' + icon('pulse', 16) + '<span>Auto-recovery: ' + (opt('watchdogEnabled') ? 'On' : 'Off') + '</span></button>');
      a.push('<button class="hb-btn danger" data-top="lightsoff" title="Stop everything and turn all lights off">' + icon('power', 16) + '<span>Lights off</span></button>');
      a.push('<button class="hb-btn' + (S.selMode ? ' primary' : '') + '" data-top="select">' + icon('check', 16) + '<span>Select</span></button>');
    }
    a.push('<button class="hb-btn" data-top="events">' + icon('list', 16) + '<span>Activity</span></button>');
    if (B.kiosk) {
      a.push('<span class="hb-clock" id="hb-clock"></span>');
      a.push('<button class="hb-ib" data-top="full" title="Fullscreen">' + icon('max') + '</button>');
    } else {
      a.push('<a class="hb-ib" href="' + esc(B.kioskUrl) + '" target="_blank" rel="noopener" title="Open kiosk view in a new window">' + icon('tv') + '</a>');
      a.push('<a class="hb-ib" href="' + esc(B.settingsUrl) + '" title="Settings">' + icon('gear') + '</a>');
    }
    document.getElementById('hb-actions').innerHTML = a.join('');
  }

  /* ---------------------------------------------------------------- filters */
  function visible(d) {
    if (d.hidden) return false;
    if (B.kind && d.kind !== B.kind) return false;
    if (S.tab !== 'all' && d.kind !== S.tab) return false;
    if (S.group && (d.group || '') !== S.group) return false;
    const st = S.status[d.id];
    if (!opt('showOffline') && st && !st.online) return false;
    if (S.q) {
      const hay = [d.name, d.ip, d.group, d.notes, typeLabel(d), d.model].join(' ').toLowerCase();
      if (hay.indexOf(S.q) < 0) return false;
    }
    return true;
  }

  function renderTabs() {
    const devs = S.cfg.devices.filter((d) => !d.hidden);
    const count = (k) => devs.filter((d) => k === 'all' || d.kind === k).length;
    let h = '';
    if (!B.kind) {
      h += '<button class="hb-tab' + (S.tab === 'all' ? ' on' : '') + '" data-tab="all">All <em>' + count('all') + '</em></button>';
      KINDS.forEach((K) => { h += '<button class="hb-tab' + (S.tab === K.k ? ' on' : '') + '" data-tab="' + K.k + '">' + icon(K.ico, 15) + K.title + ' <em>' + count(K.k) + '</em></button>'; });
    }
    const groups = [...new Set(devs.map((d) => d.group).filter(Boolean))].sort();
    if (groups.length) {
      h += '<span class="hb-tabsep"></span>';
      groups.forEach((g) => { h += '<button class="hb-chipbtn' + (S.group === g ? ' on' : '') + '" data-group="' + esc(g) + '">' + esc(g) + '</button>'; });
    }
    document.getElementById('hb-tabs').innerHTML = h;
  }

  function renderScenes() {
    const el = document.getElementById('hb-scenes');
    const sc = S.cfg.scenes || [];
    if (!sc.length || S.ro || B.kind) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="hb-lbl">' + icon('layers', 15) + ' Scenes</span>' + sc.map((s) => '<button class="hb-scene" data-scene="' + esc(s.id) + '">' + (s.icon ? esc(s.icon) + ' ' : '') + esc(s.name) + '<em>' + s.steps.length + '</em></button>').join('');
  }

  /* ------------------------------------------------------------------ cards */
  function openBtn(d, label) {
    if (d.kind === 'plug' && d.type === 'kasa') return '';
    return '<a class="hb-btn primary hb-open" href="' + esc(H.openUrl(d)) + '" target="_blank" rel="noopener">' + icon('ext', 16) + '<span>' + label + '</span></a>';
  }

  function cardHTML(d) {
    const K = KINDS.find((x) => x.k === d.kind);
    const sub = esc(typeLabel(d)) + (d.local ? ' <b class="hb-tag">this unit</b>' : '') + (d.kind === 'fpp' ? ' <b class="hb-tag hb-modetag" data-b="mode" hidden></b>' : '') + '<br><span class="hb-mono">' + esc(d.ip) + '</span>' + (d.group ? ' · ' + esc(d.group) : '');
    let body = '', foot = '';
    if (d.kind === 'fpp') {
      body =
        '<div class="hb-np"><div class="hb-np-t" data-b="npT">—</div><div class="hb-np-s" data-b="npS"></div><div class="hb-bar"><i data-b="bar"></i></div><div class="hb-np-time"><span data-b="el">0:00</span><span data-b="rem"></span></div></div>' +
        '<div class="hb-row" data-ctl data-play><select class="hb-sel" data-b="pl"><option value="">Select playlist…</option></select><button class="hb-btn primary" data-act="start">' + icon('play', 14) + '<span>Start</span></button></div>' +
        '<div class="hb-row" data-ctl data-play><button class="hb-btn" data-act="stop">' + icon('stop', 14) + '<span>Stop</span></button><button class="hb-btn ghost" data-act="stopgraceful">Gentle stop</button><label class="hb-chk"><input type="checkbox" data-b="repeat"> Repeat</label></div>' +
        (d.hasAudio ? '<div class="hb-row hb-vol" data-ctl>' + icon('volume', 16) + '<input type="range" min="0" max="100" data-b="vol"><span data-b="volv" class="hb-mono">–</span></div>' : '') +
        '<div class="hb-chips" data-b="chips"></div>' +
        '<div class="hb-link" data-b="link"></div>';
      foot = openBtn(d, 'Open FPP') + '<button class="hb-btn" data-act="pages">' + icon('list', 16) + '<span>Pages</span></button><button class="hb-btn" data-act="test" data-ctl title="Run a channel test pattern">' + icon('zap', 16) + '<span>Test</span></button><button class="hb-btn" data-act="power" data-ctl>' + icon('power', 16) + '<span>Power</span></button>';
    } else if (d.kind === 'controller') {
      body =
        '<div class="hb-kv"><div><span>Status</span><b data-b="ctl">–</b></div><div><span>Latency</span><b data-b="lat" class="hb-mono">–</b></div><div><span>Page title</span><b data-b="ttl">–</b></div></div>' +
        '<div class="hb-spark" data-b="spark"></div>' +
        '<div class="hb-row" data-b="wled" data-ctl hidden><button class="hb-btn" data-act="wled_toggle">' + icon('power', 14) + '<span>Toggle</span></button><input type="range" min="1" max="255" data-b="bri" class="hb-grow"></div>' +
        (d.notes ? '<div class="hb-note">' + esc(d.notes) + '</div>' : '') +
        '<div class="hb-chips" data-b="chips"></div><div class="hb-link" data-b="link"></div>';
      foot = openBtn(d, 'Open dashboard');
    } else if (d.kind === 'sensor') {
      const lid = d.type === 'lidar';
      body =
        '<div class="hb-bigwrap"><div class="hb-bignum" data-b="big">–</div><div class="hb-biglbl" data-b="bigl">' + (lid ? 'cars tonight' : 'devices nearby') + '</div></div>' +
        (lid ? '<div class="hb-row" data-ctl><button class="hb-btn" data-act="car-">' + icon('minus', 14) + '<span>1 car</span></button><button class="hb-btn" data-act="car+">' + icon('plus', 14) + '<span>1 car</span></button></div>' : '') +
        '<div class="hb-bars" data-b="bars"></div><div class="hb-spark" data-b="spark"></div>' +
        '<div class="hb-alert" data-b="alert" hidden></div>' +
        (d.notes ? '<div class="hb-note">' + esc(d.notes) + '</div>' : '') +
        '<div class="hb-chips" data-b="chips"></div><div class="hb-link" data-b="link"></div>';
      foot = openBtn(d, 'Open dashboard');
    } else {
      body =
        '<div class="hb-plugmain"><button class="hb-bigpower" data-act="toggle" data-ctl title="Toggle all outlets" aria-label="Toggle power">' + icon('power', 34) + '</button><div><div class="hb-ps" data-b="ps">–</div><div class="hb-pw hb-mono" data-b="pw"></div></div></div>' +
        '<div class="hb-outlets" data-b="outlets"></div>' +
        '<div class="hb-chips" data-b="chips"></div><div class="hb-powers" data-b="powers"></div>';
      foot = '<button class="hb-btn ok" data-act="on" data-ctl>On</button><button class="hb-btn" data-act="off" data-ctl>Off</button>' + openBtn(d, 'Web UI');
    }
    return '<article class="hb-card k-' + d.kind + ' t-' + esc(d.type) + ' unk" data-id="' + esc(d.id) + '">' +
      '<header class="hb-c-head"><label class="hb-sel-box"><input type="checkbox" data-selbox' + (S.sel.has(d.id) ? ' checked' : '') + '></label>' +
      '<div class="hb-c-ico">' + icon(d.kind === 'sensor' ? (d.type === 'lidar' ? 'car' : 'users') : K.ico, 20) + '</div>' +
      '<div class="hb-c-title"><h3>' + esc(d.name) + '</h3><div class="hb-c-sub">' + sub + '</div></div>' +
      '<div class="hb-c-state"><span class="hb-dot" data-b="dot"></span><span data-b="state">Checking…</span><small data-b="since"></small></div>' +
      (S.ro ? '' : '<button class="hb-ib" data-act="menu" aria-label="Device menu">' + icon('more') + '</button>') +
      '</header><div class="hb-c-body">' + body + '</div><footer class="hb-c-foot">' + foot + '</footer></article>';
  }

  function renderAll() {
    renderTabs();
    renderScenes();
    const wrap = document.getElementById('hb-sections');
    let html = '';
    let any = false;
    KINDS.forEach((K) => {
      const list = S.cfg.devices.filter((d) => d.kind === K.k && visible(d));
      if (!list.length) return;
      any = true;
      const actions = S.ro ? '' : (K.k === 'plug'
        ? '<button class="hb-btn sm ok" data-sec="plug-on">All on</button><button class="hb-btn sm" data-sec="plug-off">All off</button>'
        : K.k === 'fpp' ? '<button class="hb-btn sm" data-sec="fpp-stop">' + icon('stop', 12) + ' Stop all</button>' : '');
      html += '<section class="hb-sec" data-kind="' + K.k + '"><div class="hb-sec-head"><h2>' + icon(K.ico, 20) + K.title + '</h2><span class="hb-count" data-b="count"></span><div class="hb-sec-actions">' + actions + '</div></div><div class="hb-grid">' + list.map(cardHTML).join('') + '</div></section>';
    });
    if (!any) {
      const total = S.cfg.devices.filter((d) => !d.hidden).length;
      html = total
        ? '<div class="hb-empty"><h3>No devices match</h3><p>Clear the search or filters to see everything.</p></div>'
        : '<div class="hb-empty"><div class="hb-empty-ico">' + icon('search', 40) + '</div><h3>No devices yet</h3><p>Run a network scan to discover your Falcon Players, controllers and smart plugs, or add them by hand.</p>' +
          (S.ro ? '' : '<div class="hb-row c"><button class="hb-btn primary" data-top="scan">' + icon('refresh', 16) + '<span>Scan network</span></button><button class="hb-btn" data-top="add">' + icon('plus', 16) + '<span>Add device</span></button></div>') + '</div>';
    }
    wrap.innerHTML = html;
    root.classList.toggle('selmode', S.selMode);
    patchAll();
    renderSelbar();
    renderActions();
  }

  /* ---------------------------------------------------------------- patching */
  function setB(card, name, text) { const e = card.querySelector('[data-b="' + name + '"]'); if (e && e.textContent !== String(text)) e.textContent = text; return e; }
  function spark(hist) {
    if (!hist || hist.length < 2) return '';
    const w = 160, h = 28, max = Math.max.apply(null, hist.concat([10])), n = hist.length;
    const pts = hist.map((v, i) => (i * (w / (n - 1))).toFixed(1) + ',' + (h - 2 - (v / max) * (h - 4)).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span>latency · max ' + max + ' ms</span>';
  }
  function sparkN(vals) {
    const w = 160, h = 28, max = Math.max.apply(null, vals.concat([1])), n = vals.length;
    const pts = vals.map((v, i) => (i * (w / (n - 1))).toFixed(1) + ',' + (h - 2 - (v / max) * (h - 4)).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span>last 30 min · peak ' + max + '</span>';
  }
  const chip = (label, val, cls) => '<span class="hb-chip ' + (cls || '') + '"><i>' + esc(label) + '</i>' + esc(val) + '</span>';
  const fmtT = (t) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? 'a' : 'p'); };
  function watchChips(d, chips) {
    if (!d.watch || !d.watch.enabled) return;
    const w = S.watch[d.id];
    const lbl = { ok: 'watching', down: 'not responding…', recovering: 'recovering', exhausted: 'recovery failed', 'off-expected': 'plug off (expected)' };
    const st = w && w.state ? w.state : 'ok';
    chips.push(chip('Watchdog', lbl[st] || st, st === 'exhausted' ? 'bad' : st === 'recovering' || st === 'down' ? 'warn' : ''));
    if (w && w.msg && (st === 'recovering' || st === 'exhausted')) chips.push(chip('Last step', w.msg.slice(0, 70) + ' · ' + H.ago(w.msgT) + ' ago', st === 'exhausted' ? 'bad' : 'warn'));
  }
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

  function linkedRow(d) {
    const lp = d.linkedPlug;
    if (!lp || !lp.id) return '';
    const p = dev(lp.id);
    if (!p) return '';
    const st = S.status[p.id];
    let on = null;
    if (st && st.online && st.detail && st.detail.outlets) {
      const os = st.detail.outlets.filter((o) => lp.outlet === '*' || String(o.id) === String(lp.outlet));
      if (os.length) on = os.some((o) => o.on);
    }
    return '<span class="hb-lk">' + icon('plug', 14) + ' Powered by <b>' + esc(p.name) + '</b> <em class="' + (on === null ? 'u' : on ? 'on' : 'off') + '">' + (on === null ? '?' : on ? 'on' : 'off') + '</em></span>' +
      (S.ro ? '' : '<button class="hb-btn sm" data-act="cycle" title="Turn the plug off, wait, then on again">' + icon('refresh', 12) + ' Power cycle</button>');
  }

  function patchCard(card) {
    const d = dev(card.dataset.id);
    if (!d) return;
    const st = S.status[d.id];
    const known = !!st, online = !!(st && st.online);
    const det = (st && st.detail) || {};
    card.classList.toggle('unk', !known);
    card.classList.toggle('off', known && !online);
    card.classList.toggle('warn', online && d.kind === 'fpp' && det.fppd === false);
    let state = 'Checking…', dot = 'unk';
    if (known && !online) { state = 'Offline'; dot = 'off'; }
    else if (online) {
      dot = 'on';
      if (d.kind === 'fpp') { state = det.fppd === false ? 'FPPD stopped' : cap(det.state) || 'Online'; if (det.fppd === false) dot = 'warn'; else if (det.state === 'playing') dot = 'play'; }
      else if (d.kind === 'sensor') { if (det.login) { state = 'Login needed'; dot = 'warn'; } else if (d.type === 'lidar' && det.running === false) { state = 'Counter stopped'; dot = 'warn'; } else if (d.type === 'lidar' && det.sensorOk === false) { state = 'Sensor fault'; dot = 'warn'; } else state = d.type === 'lidar' && det.counting === false ? 'Idle' : 'Counting'; if (d.type === 'baldrick') state = 'Online'; }
      else if (d.kind === 'plug') { state = det.state === 'on' ? 'On' : det.state === 'off' ? 'Off' : det.state === 'mixed' ? 'Mixed' : 'Online'; dot = det.state === 'on' ? 'on' : 'idle'; }
      else state = 'Online';
    }
    setB(card, 'state', state);
    const dotEl = card.querySelector('[data-b="dot"]'); dotEl.className = 'hb-dot ' + dot;
    setB(card, 'since', st && st.since ? (online ? 'for ' : 'since ') + H.ago(st.since) : '');

    if (d.kind === 'fpp') {
      const playing = online && det.state === 'playing';
      const noPlay = online && NOPLAY.indexOf(det.mode) >= 0;
      card.classList.toggle('playing', playing);
      card.classList.toggle('remote', noPlay);
      const mt = card.querySelector('[data-b="mode"]');
      if (mt) { mt.hidden = !(online && det.mode); mt.textContent = det.mode ? det.mode.toUpperCase() : ''; mt.classList.toggle('remote', noPlay); }
      setB(card, 'npT', !online ? '—' : det.fppd === false ? 'FPPD is not running' : playing ? (det.playlist || det.sequence || 'Playing') : noPlay ? (det.mode === 'remote' ? 'Waiting for the master' : 'Bridge mode') : 'Idle');
      setB(card, 'npS', !online ? '' : playing ? (det.sequence && det.sequence !== det.playlist ? det.sequence : '') : noPlay ? (det.mode === 'remote' ? 'Remote mode – the master starts and stops shows' : '') : (det.nextName ? 'Next: ' + det.nextName + (det.nextTime ? ' · ' + det.nextTime : '') : (det.schedEnabled === false ? 'Scheduler disabled' : '')));
      tickCard(card);
      const vol = card.querySelector('[data-b="vol"]');
      if (vol && det.volume != null && !S.drag.has(d.id)) { vol.value = det.volume; setB(card, 'volv', det.volume + '%'); }
      const chips = [];
      if (online) {
        if (det.temp != null) chips.push(chip('Temp', det.temp.toFixed(0) + '°C', det.temp > 75 ? 'bad' : det.temp > 65 ? 'warn' : ''));
        if (det.uptime) chips.push(chip('Up', det.uptime));
        if (det.version) chips.push(chip('FPP', 'v' + det.version));
        if (det.warnings) chips.push(chip('Warnings', det.warnings, 'warn'));
        if (st.ms != null) chips.push(chip('Ping', st.ms + ' ms'));
      }
      watchChips(d, chips);
      card.querySelector('[data-b="chips"]').innerHTML = chips.join('');
      if (online && det.fppd !== false && !noPlay) ensurePlaylists(d, card);
    } else if (d.kind === 'controller') {
      setB(card, 'ctl', known ? (online ? 'Online' : 'Down') : '–');
      setB(card, 'lat', online && st.ms != null ? st.ms + ' ms' : '–');
      setB(card, 'ttl', online ? det.title || ('HTTP ' + det.http) : '–');
      card.querySelector('[data-b="spark"]').innerHTML = online ? spark(st.hist) : '';
      const chips = [];
      if (online && d.type === 'wled') {
        if (det.leds != null) chips.push(chip('LEDs', det.leds));
        if (det.version) chips.push(chip('WLED', det.version));
        if (det.fps) chips.push(chip('FPS', det.fps));
        if (det.rssi != null) chips.push(chip('Wi-Fi', det.rssi + ' dBm'));
      }
      if (d.model) chips.push(chip('Model', d.model));
      watchChips(d, chips);
      card.querySelector('[data-b="chips"]').innerHTML = chips.join('');
      const w = card.querySelector('[data-b="wled"]'); if (w) w.hidden = !(d.type === 'wled' && online);
    } else if (d.kind === 'sensor') {
      const lid = d.type === 'lidar';
      const num = (v) => (v == null ? '–' : Number(v).toLocaleString());
      let big = '–', bigl = lid ? 'cars tonight' : 'devices nearby', al = '';
      const chips = [];
      if (online) {
        if (lid) {
          if (det.login) al = (det.login === 'bad' ? 'The saved password was rejected.' : 'This counter is password protected.') + (S.ro ? '' : ' <button class="hb-btn sm" data-act="login">Enter login</button>');
          else if (det.running === false) al = 'The counter service is not running on the Pi' + (det.http ? ' (HTTP ' + det.http + ')' : '') + '.';
          else {
            big = num(det.cars);
            if (det.season != null) chips.push(chip('Season', num(det.season)));
            if (det.offhours) chips.push(chip('Off-hours', det.offhours));
            if (det.counting != null) chips.push(chip('Counting', det.counting ? 'yes' : 'no' + (det.reason ? ' · ' + det.reason : ''), det.counting ? '' : 'warn'));
            if (det.fppPlaying != null) chips.push(chip('Show', det.fppPlaying ? 'playing' : 'not playing'));
            if (det.people != null) chips.push(chip('People', '~' + num(det.people)));
            if (det.test) chips.push(chip('Mode', 'TEST', 'warn'));
            if (det.syncOn) chips.push(chip('Website', det.syncOk === false ? 'sync failed' : det.syncOk ? 'synced' : 'pending', det.syncOk === false ? 'bad' : ''));
            if (det.sensorOk === false) al = 'Sensor problem: ' + esc(det.sensorError || 'no data');
            else if (det.warnings && det.warnings.length) al = det.warnings.map(esc).join('<br>');
            if (det.version) chips.push(chip('Counter', 'v' + det.version));
          }
        } else {
          big = num(det.count);
          if (det.count == null) al = det.http ? 'The board answered HTTP ' + det.http + ' – is the firmware up to date?' : 'No readings in the last 30 minutes.';
          if (det.peak != null) chips.push(chip('Peak (30 min)', det.peak));
          if (det.age != null) chips.push(chip('Reading', det.age < 90 ? 'just now' : H.ago(Math.floor(Date.now() / 1000) - det.age) + ' ago', det.age > 900 ? 'warn' : ''));
        }
        if (st.ms != null) chips.push(chip('Ping', st.ms + ' ms'));
      }
      card.classList.toggle('is-on', online && big !== '–' && big !== '0');
      setB(card, 'big', big); setB(card, 'bigl', bigl);
      const alEl = card.querySelector('[data-b="alert"]'); alEl.hidden = !al; if (alEl.innerHTML !== al) alEl.innerHTML = al;
      const bars = card.querySelector('[data-b="bars"]');
      if (bars) {
        const hrs = online && lid && det.hours && det.hours.length === 24 ? det.hours : null;
        if (hrs && Math.max.apply(null, hrs) > 0) { const mx = Math.max.apply(null, hrs); bars.innerHTML = hrs.map((v, i) => '<i title="' + i + ':00 · ' + v + '" style="height:' + Math.max(v ? 8 : 2, Math.round((v / mx) * 100)) + '%"></i>').join(''); bars.hidden = false; } else { bars.innerHTML = ''; bars.hidden = true; }
        const sp = card.querySelector('[data-b="spark"]');
        sp.innerHTML = online && !lid && det.series && det.series.length > 1 ? sparkN(det.series) : '';
      }
      watchChips(d, chips);
      card.querySelector('[data-b="chips"]').innerHTML = chips.join('');
    } else {
      card.classList.toggle('is-on', online && (det.state === 'on' || det.state === 'mixed'));
      setB(card, 'ps', !known ? '…' : !online ? 'Unreachable' : det.state === 'on' ? 'ON' : det.state === 'off' ? 'OFF' : det.state === 'mixed' ? 'PARTIAL' : '?');
      setB(card, 'pw', online && det.power != null ? det.power.toFixed(1) + ' W' : '');
      const os = online && det.outlets ? det.outlets : [];
      card.querySelector('[data-b="outlets"]').innerHTML = os.length > 1 ? os.map((o) => '<div class="hb-outlet' + (o.on ? ' on' : '') + '"><span>' + esc(o.name) + '</span>' + (S.ro ? '<b>' + (o.on ? 'ON' : 'OFF') + '</b>' : '<button class="hb-switch' + (o.on ? ' on' : '') + '" data-act="outlet" data-outlet="' + esc(o.id) + '" aria-label="Toggle ' + esc(o.name) + '"><i></i></button>') + '</div>').join('') : '';
      const chips = [];
      if (online) {
        if (det.model) chips.push(chip('Model', det.model));
        if (det.rssi != null) chips.push(chip('Wi-Fi', det.rssi < 0 ? det.rssi + ' dBm' : det.rssi + '%'));
        if (st.ms != null) chips.push(chip('Ping', st.ms + ' ms'));
      }
      (d.schedules || []).forEach((sc) => chips.push(chip('Schedule', fmtT(sc.on) + '–' + fmtT(sc.off) + (sc.enforce ? '' : ' (watch only)'), (S.watch[d.id] && S.watch[d.id].window) ? '' : '')));
      card.querySelector('[data-b="chips"]').innerHTML = chips.join('');
      const users = S.cfg.devices.filter((x) => x.linkedPlug && x.linkedPlug.id === d.id);
      card.querySelector('[data-b="powers"]').innerHTML = users.length ? '<span class="hb-lbl">Powers</span> ' + users.map((u) => '<span class="hb-pill">' + esc(u.name) + '</span>').join('') : '';
    }
    const lk = card.querySelector('[data-b="link"]');
    if (lk) { const html = linkedRow(d); if (lk.innerHTML !== html) lk.innerHTML = html; }
  }

  function tickCard(card) {
    const d = dev(card.dataset.id);
    const st = d && S.status[d.id];
    if (!st || !st.online || !st.detail) return;
    const det = st.detail;
    const playing = det.state === 'playing' && det.elapsed != null;
    const dt = playing ? (Date.now() - (S.recv[d.id] || Date.now())) / 1000 : 0;
    const el = playing ? det.elapsed + dt : 0;
    const rem = playing && det.remaining != null ? Math.max(0, det.remaining - dt) : null;
    setB(card, 'el', playing ? H.fmtDur(el) : '');
    setB(card, 'rem', playing && rem != null ? '-' + H.fmtDur(rem) : '');
    const bar = card.querySelector('[data-b="bar"]');
    if (bar) bar.style.width = playing && rem != null && el + rem > 0 ? Math.min(100, (el / (el + rem)) * 100) + '%' : '0%';
  }

  function patchAll() {
    document.querySelectorAll('.hb-card').forEach(patchCard);
    document.querySelectorAll('.hb-sec').forEach((sec) => {
      const cards = [...sec.querySelectorAll('.hb-card')];
      const on = cards.filter((c) => !c.classList.contains('off') && !c.classList.contains('unk')).length;
      const e = sec.querySelector('[data-b="count"]'); if (e) e.textContent = on + ' / ' + cards.length + ' online';
    });
    summary();
  }

  function summary() {
    const el = document.getElementById('hb-summary');
    if (!el) return;
    const parts = [];
    KINDS.forEach((K) => {
      const l = S.cfg.devices.filter((d) => d.kind === K.k && !d.hidden);
      if (!l.length) return;
      const on = l.filter((d) => S.status[d.id] && S.status[d.id].online).length;
      let t = on + '/' + l.length + ' ' + K.title.toLowerCase();
      if (K.k === 'fpp') { const p = l.filter((d) => S.status[d.id] && S.status[d.id].detail && S.status[d.id].detail.state === 'playing').length; if (p) t += ' · ' + p + ' playing'; }
      if (K.k === 'plug') { const p = l.filter((d) => S.status[d.id] && S.status[d.id].detail && S.status[d.id].detail.state === 'on').length; t += ' · ' + p + ' on'; }
      parts.push(t);
    });
    el.textContent = S.connErr ? 'Connection lost – retrying…' : (parts.join('  •  ') || 'No devices yet');
    el.classList.toggle('bad', !!S.connErr);
  }

  /* ---------------------------------------------------------------- network */
  async function poll() {
    if (S.polling || document.hidden || !S.cfg) return;
    S.polling = true;
    const t0 = Date.now();
    try {
      const r = await H.api('status');
      const now = Date.now();
      S.watch = r.watch || {}; S.monitor = r.monitor;
      Object.keys(r.status).forEach((id) => { if ((S.acted[id] || 0) > t0) return; S.status[id] = r.status[id]; S.recv[id] = now; });
      S.connErr = false;
      patchAll();
      if (!opt('showOffline')) renderAll();
    } catch (e) { S.connErr = true; summary(); } finally { S.polling = false; }
  }
  async function refreshOne(id, delay) {
    if (delay) await H.sleep(delay);
    try {
      const r = await H.api('status', null, 'ids=' + encodeURIComponent(id));
      if (r.status[id]) { S.status[id] = r.status[id]; S.recv[id] = Date.now(); }
      const c = document.querySelector('.hb-card[data-id="' + id + '"]');
      if (c) patchCard(c);
      summary();
    } catch (e) { /* ignore */ }
  }
  async function reloadConfig(force) {
    const r = await H.api('bootstrap');
    const sig = JSON.stringify([r.config.devices, r.config.scenes, r.config.options]);
    S.types = r.types;
    if (force || sig !== S.sigCfg) { S.cfg = r.config; S.sigCfg = sig; setupLook(); renderAll(); }
    return r;
  }
  function setupLook() {
    S.ro = !!(B.kiosk && (B.readonly || S.cfg.options.kioskReadOnly));
    root.classList.toggle('ro', S.ro);
    root.classList.toggle('compact', !!opt('compact'));
    H.applyTheme(root, S.cfg.options);
    const t = document.getElementById('hb-title');
    if (t) t.textContent = 'Central Hub';
    if (B.cols) root.style.setProperty('--hb-cols', B.cols);
  }

  async function act(d, cmd, args, o) {
    o = o || {};
    if (S.ro) return;
    const card = document.querySelector('.hb-card[data-id="' + d.id + '"]');
    if (card) card.classList.add('busy');
    try {
      const r = await H.api('act', { id: d.id, cmd, args: args || {} });
      S.acted[d.id] = Date.now();
      if (r.status) { S.status[d.id] = Object.assign({}, S.status[d.id] || {}, r.status); S.recv[d.id] = Date.now(); if (card) patchCard(card); summary(); }
      else if (cmd !== 'playlists') refreshOne(d.id, d.kind === 'fpp' ? 700 : 300);
      if (!o.quiet && r.msg) H.toast(d.name + ': ' + r.msg, 'ok');
      return r;
    } catch (e) {
      if (!o.quiet) H.toast(d.name + ': ' + e.message, 'err');
      throw e;
    } finally { if (card) card.classList.remove('busy'); }
  }

  async function ensurePlaylists(d, card, force) {
    const sel = card.querySelector('[data-b="pl"]');
    if (!sel) return;
    const have = S.playlists[d.id];
    if (have && !force) { if (sel.options.length <= 1 && have.length) fillSel(sel, have); return; }
    if (S.playlists['_loading' + d.id]) return;
    S.playlists['_loading' + d.id] = true;
    try {
      const r = await H.api('act', { id: d.id, cmd: 'playlists', args: {} });
      S.playlists[d.id] = r.data || [];
      fillSel(sel, S.playlists[d.id]);
    } catch (e) { /* retry on next poll */ } finally { delete S.playlists['_loading' + d.id]; }
  }
  function fillSel(sel, names) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Select playlist…</option>' + names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
    if (cur && names.indexOf(cur) >= 0) sel.value = cur;
  }

  /* ----------------------------------------------------------------- events */
  const sendVol = H.debounce(async (d, v) => { try { await act(d, 'volume', { value: v }, { quiet: true }); } catch (e) { H.toast(d.name + ': ' + e.message, 'err'); } S.drag.delete(d.id); }, 350);

  root.addEventListener('input', (e) => {
    const t = e.target, card = t.closest('.hb-card');
    if (!card) return;
    const d = dev(card.dataset.id);
    if (t.matches('[data-b="vol"]')) { S.drag.add(d.id); setB(card, 'volv', t.value + '%'); sendVol(d, +t.value); }
    if (t.matches('[data-b="bri"]')) { S.drag.add(d.id); sendBri(d, +t.value); }
  });
  const sendBri = H.debounce(async (d, v) => { try { await act(d, 'brightness', { value: v }, { quiet: true }); } catch (e) { /* toast handled */ } S.drag.delete(d.id); }, 300);

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-selbox]')) {
      const id = t.closest('.hb-card').dataset.id;
      if (t.checked) S.sel.add(id); else S.sel.delete(id);
      renderSelbar();
    }
  });
  root.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('[data-b="pl"]')) { const c = e.target.closest('.hb-card'); const d = dev(c.dataset.id); if (S.playlists[d.id]) ensurePlaylists(d, c, true); }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-top],[data-tab],[data-group],[data-scene],[data-sec],[data-act],[data-bulk]');
    if (!t) return;
    if (t.dataset.top) return top(t.dataset.top, t);
    if (t.dataset.tab) { S.tab = t.dataset.tab; return renderAll(); }
    if (t.dataset.group) { S.group = S.group === t.dataset.group ? '' : t.dataset.group; return renderAll(); }
    if (t.dataset.scene) return runScene(S.cfg.scenes.find((s) => s.id === t.dataset.scene));
    if (t.dataset.sec) return sectionAct(t.dataset.sec);
    if (t.dataset.bulk) return bulk(t.dataset.bulk);
    const card = t.closest('.hb-card');
    if (!card) return;
    const d = dev(card.dataset.id);
    const a = t.dataset.act;
    try {
      if (a === 'menu') return deviceMenu(t, d);
      if (a === 'car+' || a === 'car-') return act(d, 'adjust', { delta: a === 'car+' ? 1 : -1 });
      if (a === 'login') return editDevice(d);
      if (a === 'test') return testDialog(d);
      if (a === 'pages') return Hub.menu(t, FPP_PAGES.map((p) => ({ label: p[0], icon: p[2], href: H.openUrl(d) + p[1] })));
      if (a === 'power') return Hub.menu(t, [
        { label: 'Restart FPPD', icon: 'refresh', onClick: async () => { if (await H.confirm('Restart the FPP daemon on ' + d.name + '?', 'Restart')) act(d, 'restart_fppd'); } },
        { label: 'Reboot', icon: 'power', danger: true, onClick: async () => { if (await H.confirm('Reboot ' + d.name + '? The show will stop.', 'Reboot', true)) act(d, 'reboot'); } },
        { label: 'Shut down', icon: 'power', danger: true, onClick: async () => { if (await H.confirm('Shut down ' + d.name + '? You will need physical access (or a smart plug) to turn it back on.', 'Shut down', true)) act(d, 'shutdown'); } },
      ]);
      if (a === 'start') { const pl = card.querySelector('[data-b="pl"]').value; if (!pl) return H.toast('Choose a playlist first', 'err'); return act(d, 'start', { playlist: pl, repeat: card.querySelector('[data-b="repeat"]').checked }); }
      if (a === 'stop' || a === 'stopgraceful') return act(d, a);
      if (a === 'toggle') return act(d, 'toggle', { outlet: '*' });
      if (a === 'on' || a === 'off') return act(d, a, { outlet: '*' });
      if (a === 'outlet') return act(d, 'toggle', { outlet: t.dataset.outlet });
      if (a === 'wled_toggle') return act(d, 'toggle');
      if (a === 'cycle') return powerCycle(d);
    } catch (err) { /* toast already shown */ }
  });

  async function testDialog(d) {
    let cur = null;
    let models = [];
    try { cur = (await H.api('act', { id: d.id, cmd: 'testmode_get', args: {} })).data; } catch (e) { /* offline: dialog still opens */ }
    try { models = (await H.api('act', { id: d.id, cmd: 'models', args: {} })).data || []; } catch (e) { /* no models */ }
    const rng = (m) => m.start + '-' + (m.start + m.count - 1);
    const curSet = (cur && cur.channelSet) || '';
    const curModel = models.find((m) => rng(m) === curSet);
    const det = (S.status[d.id] || {}).detail || {};
    let on = !!(cur && Number(cur.enabled) === 1);
    const pat = cur && /Cycle/.test(cur.mode || '') ? 'cycle' : 'chase';
    const html = '<div class="hb-form"><div id="t-st" class="hb-hint"></div>' +
      (det.state === 'playing' ? '<div class="hb-warnbox">' + icon('alert', 16) + ' A playlist is playing on ' + esc(d.name) + '. The test pattern takes over the outputs until you stop it.</div>' : '') +
      '<div class="hb-two"><label>Pattern<select id="t-pat" class="hb-sel"><option value="chase"' + (pat === 'chase' ? ' selected' : '') + '>Chase – red, green, blue</option><option value="cycle"' + (pat === 'cycle' ? ' selected' : '') + '>Cycle – all pixels red, green, blue</option></select></label>' +
      '<label>Step time (ms)<input id="t-ms" type="number" min="100" max="10000" step="100" value="' + esc((cur && cur.cycleMS) || 1000) + '"></label></div>' +
      '<label>Model <small>(picks the right channels for you)</small><select id="t-mod" class="hb-sel"><option value="">All channels</option>' + models.map((m, i) => '<option value="' + i + '"' + (curModel === m ? ' selected' : '') + '>' + esc(m.name) + ' (' + m.count + ' ch)</option>').join('') + '<option value="custom"' + (curSet && !curModel && curSet !== '1-1048576' ? ' selected' : '') + '>Custom channel range…</option></select></label>' +
      '<label>Channels <small>(e.g. 1-1048576, or 1-510,1000-1500)</small><input id="t-ch" value="' + esc(curSet || '1-1048576') + '" autocomplete="off"></label>' +
      '<p class="hb-hint">Uses FPP\'s built-in test mode. Remember to press <b>Stop test</b> when you are done.</p></div>';
    const wireModel = (m) => {
      const sel = m.body.querySelector('#t-mod'), ch = m.body.querySelector('#t-ch');
      const sync = () => { const v = sel.value; if (v === '') ch.value = '1-1048576'; else if (v !== 'custom') ch.value = rng(models[+v]); ch.readOnly = v !== 'custom' && v !== ''; ch.style.opacity = ch.readOnly ? '.6' : '1'; };
      sel.addEventListener('change', sync);
      ch.addEventListener('input', () => { if (!ch.readOnly) sel.value = 'custom'; });
      const v = sel.value; ch.readOnly = v !== 'custom' && v !== ''; ch.style.opacity = ch.readOnly ? '.6' : '1';
    };
    const show = (m) => { m.body.querySelector('#t-st').innerHTML = on ? '<span class="hb-ok">● Test pattern is running</span>' : 'Test mode is off'; };
    const run = async (m, enabled) => {
      const q = (s) => m.body.querySelector(s);
      try {
        const r = await act(d, 'testmode_set', { enabled, preset: q('#t-pat').value, cycleMS: +q('#t-ms').value || 1000, channelSet: q('#t-ch').value.trim() });
        if (r && r.ok) { on = enabled; show(m); }
      } catch (e) { /* toast shown */ }
      return false;
    };
    H.modal({ title: 'Test pattern – ' + d.name, html, onOpen: (m) => { show(m); wireModel(m); },
      buttons: [{ label: 'Close', cls: 'ghost' }, { label: 'Stop test', onClick: (m) => run(m, false) }, { label: 'Start test', cls: 'primary', onClick: (m) => run(m, true) }] });
  }

  function deviceMenu(anchor, d) {
    Hub.menu(anchor, [
      { label: 'Edit / link plug', icon: 'edit', onClick: () => editDevice(d) },
      { label: 'Refresh now', icon: 'refresh', onClick: () => refreshOne(d.id) },
      ...(d.kind === 'sensor' && d.type === 'lidar' ? [{ label: 'Reset today\'s count', icon: 'refresh', onClick: async () => { if (await H.confirm('Reset tonight\'s car count on ' + d.name + ' to zero?', 'Reset', true)) act(d, 'reset_today'); } }] : []),
      ...(d.kind !== 'plug' && d.kind !== 'sensor' && !d.local ? [{ label: (d.watch && d.watch.enabled ? 'Disable' : 'Enable') + ' auto-recovery', icon: 'pulse', onClick: async () => {
        try { const r = await H.api('device_update', { id: d.id, patch: { watch: { enabled: !(d.watch && d.watch.enabled) } } }); S.cfg = r.config; S.sigCfg = ''; renderAll(); H.toast('Auto-recovery ' + (d.watch && d.watch.enabled ? 'disabled' : 'enabled') + ' for ' + d.name, 'ok'); } catch (e) { H.toast(e.message, 'err'); }
      } }] : []),
      { label: 'Copy address', icon: 'link', onClick: () => { try { navigator.clipboard.writeText(d.ip); H.toast('Copied ' + d.ip, 'ok'); } catch (e) { /* ignore */ } } },
      '-',
      { label: 'Hide from dashboard', icon: 'x', onClick: async () => { await H.api('device_update', { id: d.id, patch: { hidden: true } }); await reloadConfig(true); H.toast('Hidden – restore it in Settings → Devices', 'ok'); } },
      { label: 'Remove device', icon: 'trash', danger: true, onClick: () => removeDevice(d) },
    ]);
  }

  async function powerCycle(d) {
    const lp = d.linkedPlug, p = lp && dev(lp.id);
    if (!p) return H.toast('No plug is linked to this device', 'err');
    const secs = +opt('cycleSeconds') || 10;
    const others = S.cfg.devices.filter((x) => x.id !== d.id && x.linkedPlug && x.linkedPlug.id === p.id && (x.linkedPlug.outlet === '*' || lp.outlet === '*' || x.linkedPlug.outlet === lp.outlet));
    if (!(await H.confirm('Cut power to ' + d.name + ' via "' + p.name + '" for ' + secs + ' seconds, then restore it?' + (others.length ? ' WARNING: this plug also powers ' + others.map((o) => o.name).join(', ') + ', which will lose power too.' : ''), 'Power cycle', true))) return;
    const t = H.toast('Powering off ' + d.name + '…', 'info');
    try {
      await act(p, 'off', { outlet: lp.outlet || '*' }, { quiet: true });
      for (let i = secs; i > 0; i--) { t.textContent = d.name + ' off – back on in ' + i + 's'; await H.sleep(1000); }
      await act(p, 'on', { outlet: lp.outlet || '*' }, { quiet: true });
      H.toast(d.name + ' power restored', 'ok');
    } catch (e) { H.toast('Power cycle failed: ' + e.message, 'err'); }
  }

  async function removeDevice(d) {
    const ig = !d.manual;
    const ok = await H.confirm('Remove "' + d.name + '" (' + d.ip + ')?' + (ig ? ' It will not be re-added by future scans.' : ''), 'Remove', true);
    if (!ok) return;
    try { await H.api('device_remove', { id: d.id, ignore: ig }); S.sel.delete(d.id); await reloadConfig(true); H.toast('Removed ' + d.name, 'ok'); } catch (e) { H.toast(e.message, 'err'); }
  }

  /* --------------------------------------------------------- section / bulk */
  async function sectionAct(a) {
    const kind = a.split('-')[0];
    const list = S.cfg.devices.filter((d) => d.kind === kind && visible(d));
    if (a === 'fpp-stop') { if (!(await H.confirm('Stop playback on ' + list.length + ' player(s)?', 'Stop all', true))) return; return runBulk(list, 'stop', {}); }
    if (a === 'plug-on') return runBulk(list, 'on', { outlet: '*' });
    if (a === 'plug-off') { if (!(await H.confirm('Turn OFF ' + list.length + ' plug(s)?', 'All off', true))) return; return runBulk(list, 'off', { outlet: '*' }); }
  }
  async function lightsOff() {
    const all = S.cfg.devices.filter((d) => !d.hidden);
    const targets = all.filter((d) => d.kind === 'fpp' || (d.kind === 'controller' && d.type === 'wled'));
    const skipped = all.filter((d) => d.kind === 'controller' && d.type !== 'wled').length;
    if (!targets.length) return H.toast('No Falcon Players or WLED controllers to switch off', 'err');
    const msg = 'Turn the lights off on ' + targets.length + ' device' + (targets.length === 1 ? '' : 's') + '? Playlists are stopped, test patterns are cancelled and outputs are blanked.' +
      (skipped ? ' ' + skipped + ' other controller' + (skipped === 1 ? ' has' : 's have') + ' no off command the Hub can send – they go dark when their FPP stops sending data.' : '') + ' Smart plugs are not touched.';
    if (!(await H.confirm(msg, 'Lights off', true))) return;
    await runBulk(targets, 'lights_off', {});
  }

  async function runBulk(list, cmd, args) {
    const res = await Promise.allSettled(list.map((d) => act(d, cmd, args, { quiet: true })));
    const bad = res.filter((r) => r.status === 'rejected').length;
    H.toast(bad ? (list.length - bad) + ' succeeded, ' + bad + ' failed' : cmd + ' sent to ' + list.length + ' device' + (list.length === 1 ? '' : 's'), bad ? 'err' : 'ok');
  }

  function renderSelbar() {
    const bar = document.getElementById('hb-selbar');
    if (!S.selMode || S.ro) { bar.hidden = true; return; }
    const ds = [...S.sel].map(dev).filter(Boolean);
    const has = (k) => ds.some((d) => d.kind === k);
    bar.hidden = false;
    bar.innerHTML = '<b>' + ds.length + ' selected</b><button class="hb-btn sm ghost" data-bulk="all">Select all shown</button><button class="hb-btn sm ghost" data-bulk="none">Clear</button><span class="hb-sp"></span>' +
      (has('fpp') ? '<button class="hb-btn sm primary" data-bulk="start">' + icon('play', 12) + ' Start playlist</button><button class="hb-btn sm" data-bulk="stop">Stop</button><button class="hb-btn sm" data-bulk="volume">' + icon('volume', 12) + ' Volume</button><button class="hb-btn sm" data-bulk="restart_fppd">Restart FPPD</button><button class="hb-btn sm danger" data-bulk="reboot">Reboot</button>' : '') +
      (has('plug') ? '<button class="hb-btn sm ok" data-bulk="on">Plugs on</button><button class="hb-btn sm" data-bulk="off">Plugs off</button>' : '') +
      '<button class="hb-btn sm ghost" data-bulk="done">Done</button>';
  }

  async function bulk(a) {
    if (a === 'done') { S.selMode = false; S.sel.clear(); return renderAll(); }
    if (a === 'none') { S.sel.clear(); document.querySelectorAll('[data-selbox]').forEach((c) => (c.checked = false)); return renderSelbar(); }
    if (a === 'all') { document.querySelectorAll('.hb-card').forEach((c) => { S.sel.add(c.dataset.id); c.querySelector('[data-selbox]').checked = true; }); return renderSelbar(); }
    const ds = [...S.sel].map(dev).filter(Boolean);
    let fpps = ds.filter((d) => d.kind === 'fpp'); const plugs = ds.filter((d) => d.kind === 'plug');
    if (a === 'on' || a === 'off') return runBulk(plugs, a, { outlet: '*' });
    if (a === 'stop') return runBulk(fpps, 'stop', {});
    if (a === 'restart_fppd' || a === 'reboot') { if (!(await H.confirm(a === 'reboot' ? 'Reboot ' + fpps.length + ' player(s)?' : 'Restart FPPD on ' + fpps.length + ' player(s)?', 'Yes', true))) return; return runBulk(fpps, a, {}); }
    if (a === 'volume') {
      const aud = fpps.filter((d) => d.hasAudio);
      if (!aud.length) return H.toast('None of the selected players is marked as having audio / an FM transmitter (Edit → Audio)', 'err');
      fpps = aud;
      return H.modal({ title: 'Set volume on ' + fpps.length + ' player(s)', html: '<div class="hb-form"><label>Volume <b id="hb-bv">50</b>%<input type="range" min="0" max="100" value="50" id="hb-bvr"></label></div>', onOpen: (m) => { const r = m.body.querySelector('#hb-bvr'); r.oninput = () => (m.body.querySelector('#hb-bv').textContent = r.value); },
        buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Apply', cls: 'primary', onClick: (m) => runBulk(fpps, 'volume', { value: +m.body.querySelector('#hb-bvr').value }) }] });
    }
    if (a === 'start') {
      const names = new Set();
      await Promise.all(fpps.map(async (d) => { try { const r = await H.api('act', { id: d.id, cmd: 'playlists', args: {} }); (r.data || []).forEach((n) => names.add(n)); } catch (e) { /* offline */ } }));
      if (!names.size) return H.toast('No playlists found on the selected players', 'err');
      return H.modal({ title: 'Start playlist on ' + fpps.length + ' player(s)', html: '<div class="hb-form"><label>Playlist<select id="hb-bp" class="hb-sel">' + [...names].sort().map((n) => '<option>' + esc(n) + '</option>').join('') + '</select></label><label class="hb-chk"><input type="checkbox" id="hb-br"> Repeat</label><p class="hb-hint">Players that do not have a playlist with this name will report an error.</p></div>',
        buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Start', cls: 'primary', onClick: (m) => runBulk(fpps, 'start', { playlist: m.body.querySelector('#hb-bp').value, repeat: m.body.querySelector('#hb-br').checked }) }] });
    }
  }

  /* ----------------------------------------------------------------- scenes */
  async function runScene(sc) {
    if (!sc || S.ro) return;
    const t = H.toast('Running "' + sc.name + '"…', 'info');
    let bad = 0;
    for (let i = 0; i < sc.steps.length; i++) {
      const st = sc.steps[i], d = dev(st.device);
      if (!d) { bad++; continue; }
      t.textContent = sc.name + ' – step ' + (i + 1) + ' of ' + sc.steps.length + ': ' + d.name;
      try { await act(d, st.cmd, st.args && !Array.isArray(st.args) ? st.args : {}, { quiet: true }); } catch (e) { bad++; }
      if (st.delay > 0) { for (let s = st.delay; s > 0; s--) { t.textContent = sc.name + ' – waiting ' + s + 's…'; await H.sleep(1000); } }
    }
    H.toast('"' + sc.name + '" finished' + (bad ? ' with ' + bad + ' error(s)' : ''), bad ? 'err' : 'ok');
  }

  /* ------------------------------------------------------------- top bar etc */
  function top(a, el) {
    if (a === 'scan') return scanMenu(el);
    if (a === 'add') return addDevice();
    if (a === 'select') { S.selMode = !S.selMode; if (!S.selMode) S.sel.clear(); return renderAll(); }
    if (a === 'events') return showEvents();
    if (a === 'lightsoff') return lightsOff();
    if (a === 'watchdog') return toggleWatchdog();
    if (a === 'full') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
  }

  function scanMenu(el) {
    if (!el || !el.getBoundingClientRect) return scanFlow(['fpp', 'controller', 'sensor', 'plug']);
    Hub.menu(el, [
      { label: 'Scan everything', icon: 'refresh', onClick: () => scanFlow(['fpp', 'controller', 'sensor', 'plug']) },
      '-',
      { label: 'Falcon Players only', icon: 'tv', onClick: () => scanFlow(['fpp']) },
      { label: 'Controllers only', icon: 'cpu', onClick: () => scanFlow(['controller']) },
      { label: 'Counters & sensors only', icon: 'pulse', onClick: () => scanFlow(['sensor']) },
      { label: 'Smart plugs only', icon: 'plug', onClick: () => scanFlow(['plug']) },
    ]);
  }

  async function scanFlow(kinds, silent) {
    const titles = { fpp: 'Falcon Players', controller: 'Controllers', sensor: 'Counters & sensors', plug: 'Smart plugs' };
    let m = null;
    if (!silent) {
      m = H.modal({ title: 'Searching the network', sticky: true, html: kinds.map((k) => '<div class="hb-scanrow" data-k="' + k + '"><span class="hb-spin"></span><b>' + titles[k] + '</b><span class="msg">Waiting…</span></div>').join('') + '<div id="hb-unm"></div>', buttons: [{ label: 'Close', cls: 'primary' }] });
    }
    const unmatched = [];
    for (const k of kinds) {
      const row = m && m.body.querySelector('[data-k="' + k + '"]');
      if (row) row.querySelector('.msg').textContent = 'Scanning…';
      try {
        const r = await H.api('scan', { kind: k });
        S.cfg = r.config;
        if (row) { row.classList.add('done'); row.querySelector('.msg').textContent = r.found + ' found · ' + r.added.length + ' new · ' + r.scanned + ' addresses checked'; }
        (r.unmatched || []).forEach((u) => unmatched.push(u));
      } catch (e) { if (row) { row.classList.add('err'); row.querySelector('.msg').textContent = e.message; } else H.toast(e.message, 'err'); }
    }
    S.sigCfg = JSON.stringify([S.cfg.devices, S.cfg.scenes, S.cfg.options]);
    renderAll();
    poll();
    if (m && unmatched.length) {
      const known = S.cfg.devices.map((d) => d.ip);
      const list = unmatched.filter((u) => known.indexOf(u.ip) < 0);
      if (list.length) {
        const opts = Object.keys(S.types.controller).map((t) => '<option value="' + t + '">' + esc(S.types.controller[t].label) + '</option>').join('');
        m.body.querySelector('#hb-unm').innerHTML = '<h4 class="hb-h4">Other web devices answered</h4><p class="hb-hint">These responded on port 80 but did not match a known controller. Add any that are lighting controllers.</p>' +
          list.map((u) => '<div class="hb-unrow" data-ip="' + esc(u.ip) + '"><div><b class="hb-mono">' + esc(u.ip) + '</b><div class="hb-hint">' + esc(u.title || u.server || 'HTTP ' + u.code) + '</div></div><select class="hb-sel" data-t>' + opts.replace('value="other"', 'value="other" selected') + '</select><button class="hb-btn sm primary" data-addun>Add</button></div>').join('');
        m.body.querySelectorAll('[data-addun]').forEach((b) => b.addEventListener('click', async () => {
          const row = b.closest('.hb-unrow'), u = list.find((x) => x.ip === row.dataset.ip);
          b.disabled = true;
          try { const r = await H.api('device_add', { kind: 'controller', type: row.querySelector('[data-t]').value, ip: u.ip, port: u.port, name: u.title && u.title.length < 40 ? u.title : '' }); S.cfg = r.config; row.innerHTML = '<span class="hb-ok">' + icon('check', 16) + ' Added ' + esc(u.ip) + '</span>'; S.sigCfg = ''; renderAll(); poll(); } catch (e) { H.toast(e.message, 'err'); b.disabled = false; }
        }));
      }
    }
  }

  function typeOptions(kind, sel) { return Object.keys(S.types[kind]).map((t) => '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + esc(S.types[kind][t].label) + '</option>').join(''); }

  function addDevice() {
    const html = '<div class="hb-form"><div class="hb-seg" id="hb-ak">' + KINDS.map((K, i) => '<button type="button" class="' + (i === 0 ? 'on' : '') + '" data-k="' + K.k + '">' + icon(K.ico, 15) + K.one + '</button>').join('') + '</div>' +
      '<div class="hb-two"><label>IP address / hostname<input id="hb-aip" placeholder="192.168.1.50" autocomplete="off"></label><label>Port <small>(optional)</small><input id="hb-aport" type="number" placeholder="80" min="1" max="65535"></label></div>' +
      '<div class="hb-two"><label>Type<select id="hb-at" class="hb-sel"></select></label><label>Name<input id="hb-an" placeholder="Auto-detected if blank"></label></div>' +
      '<label>Group <small>(optional)</small><input id="hb-ag" placeholder="e.g. Roof, Yard, Garage" list="hb-glist"></label><datalist id="hb-glist">' + [...new Set(S.cfg.devices.map((d) => d.group).filter(Boolean))].map((g) => '<option value="' + esc(g) + '">').join('') + '</datalist>' +
      '<div class="hb-probe" id="hb-ap"></div></div>';
    let kind = 'fpp', found = null;
    H.modal({
      title: 'Add a device', html,
      onOpen(m) {
        const $ = (s) => m.body.querySelector(s);
        const setKind = (k) => { kind = k; found = null; $('#hb-at').innerHTML = typeOptions(k); $('#hb-ap').textContent = ''; m.body.querySelectorAll('#hb-ak button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); };
        setKind('fpp');
        m.body.querySelectorAll('#hb-ak button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.k)));
        m.testConn = async (btn) => {
          const ip = $('#hb-aip').value.trim();
          if (!ip) { H.toast('Enter an IP address first', 'err'); return false; }
          $('#hb-ap').innerHTML = '<span class="hb-spin"></span> Contacting ' + esc(ip) + '…';
          try {
            const r = await H.api('probe', { kind, ip, port: +$('#hb-aport').value || 0 });
            found = r.device;
            if (r.device) { $('#hb-at').value = r.device.type; if (!$('#hb-an').value) $('#hb-an').value = r.device.name; if (r.device.port && !$('#hb-aport').value && r.device.port !== 80) $('#hb-aport').value = r.device.port; $('#hb-ap').innerHTML = '<span class="hb-ok">' + icon('check', 16) + ' Found ' + esc(typeOptionLabel(kind, r.device.type)) + ' “' + esc(r.device.name) + '”</span>'; }
            else if (r.reachable) $('#hb-ap').innerHTML = '<span class="hb-warn">' + icon('alert', 16) + ' Something answered, but it was not recognised as this device type. You can still add it – choose the type manually.</span>';
            else $('#hb-ap').innerHTML = '<span class="hb-bad">' + icon('alert', 16) + ' No response. Check the address, or add it anyway if it is currently powered off.</span>';
          } catch (e) { $('#hb-ap').innerHTML = '<span class="hb-bad">' + esc(e.message) + '</span>'; }
          return false;
        };
        m.save = async () => {
          const ip = $('#hb-aip').value.trim();
          if (!ip) { H.toast('Enter an IP address', 'err'); return false; }
          const body = { kind, ip, type: $('#hb-at').value, name: $('#hb-an').value.trim(), group: $('#hb-ag').value.trim(), port: +$('#hb-aport').value || 0 };
          if (found && found.type === body.type) { body.uid = found.uid; body.model = found.model; body.extra = found.extra; if (!body.port) body.port = found.port; }
          const r = await H.api('device_add', body);
          S.cfg = r.config; S.sigCfg = ''; renderAll(); poll();
          H.toast('Device added', 'ok');
        };
      },
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Test connection', onClick: (m) => m.testConn() }, { label: 'Add device', cls: 'primary', onClick: (m) => m.save() }],
    });
  }
  function typeOptionLabel(kind, t) { return (S.types[kind][t] || {}).label || t; }

  function editDevice(d) {
    const plugs = S.cfg.devices.filter((x) => x.kind === 'plug');
    const lp = d.linkedPlug || {};
    const html = '<div class="hb-form"><label>Name<input id="hb-en" value="' + esc(d.name) + '"></label>' +
      '<div class="hb-two"><label>IP address<input id="hb-eip" value="' + esc(d.ip) + '"></label><label>Port<input id="hb-ep" type="number" value="' + esc(d.port) + '"></label></div>' +
      '<div class="hb-two"><label>Type<select id="hb-et" class="hb-sel">' + typeOptions(d.kind, d.type) + '</select></label><label>Group<input id="hb-eg" value="' + esc(d.group || '') + '" list="hb-glist"></label></div>' +
      '<datalist id="hb-glist">' + [...new Set(S.cfg.devices.map((x) => x.group).filter(Boolean))].map((g) => '<option value="' + esc(g) + '">').join('') + '</datalist>' +
      (d.kind !== 'plug' ? '<div class="hb-two"><label>Powered by plug <small>(enables Power cycle)</small><select id="hb-elp" class="hb-sel"><option value="">— none —</option>' + plugs.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === lp.id ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.ip) + ')</option>').join('') + '</select></label><label>Outlet<select id="hb-elo" class="hb-sel"></select></label></div>' : '') +
      (d.kind === 'fpp' ? '<label class="hb-chk"><input type="checkbox" id="hb-eaud"' + (d.hasAudio ? ' checked' : '') + '> This player has audio output or an FM transmitter <small>(shows the volume control)</small></label>' : '') +
      '<label>Notes<textarea id="hb-eno" rows="2">' + esc(d.notes || '') + '</textarea></label>' + extraSections(d) + '</div>';
    H.modal({
      title: 'Edit ' + d.name, html, wide: true,
      onOpen(m) {
        const $ = (s) => m.body.querySelector(s);
        const fillOutlets = () => {
          const sel = $('#hb-elo'); if (!sel) return;
          const pid = $('#hb-elp').value, st = S.status[pid];
          const os = st && st.detail && st.detail.outlets && st.detail.outlets.length > 1 ? st.detail.outlets : [];
          sel.innerHTML = '<option value="*">All outlets</option>' + os.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>').join('');
          sel.value = lp.outlet && lp.id === pid ? lp.outlet : '*';
        };
        if ($('#hb-elp')) { $('#hb-elp').addEventListener('change', fillOutlets); fillOutlets(); }
        wireExtra(m, d);
      },
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Remove', cls: 'danger', onClick: (m) => { setTimeout(() => removeDevice(d), 250); } }, {
        label: 'Save', cls: 'primary', onClick: async (m) => {
          const $ = (s) => m.body.querySelector(s);
          const patch = { name: $('#hb-en').value, ip: $('#hb-eip').value, port: +$('#hb-ep').value || 80, type: $('#hb-et').value, group: $('#hb-eg').value, notes: $('#hb-eno').value };
          if ($('#hb-eaud')) patch.hasAudio = $('#hb-eaud').checked;
          if ($('#hb-elp')) patch.linkedPlug = $('#hb-elp').value ? { id: $('#hb-elp').value, outlet: $('#hb-elo').value || '*' } : null;
          Object.assign(patch, collectExtra(m, d));
          const r = await H.api('device_update', { id: d.id, patch });
          S.cfg = r.config; S.sigCfg = ''; renderAll(); poll();
        },
      }],
    });
  }

  /* ---- recovery watchdog / SSH / plug schedule sections of the edit dialog ---- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function sharedWith(d) {
    const lp = d.linkedPlug;
    if (!lp || !lp.id) return [];
    return S.cfg.devices.filter((x) => x.id !== d.id && x.linkedPlug && x.linkedPlug.id === lp.id);
  }
  function schedRow(sc) {
    sc = sc || { days: [1, 2, 3, 4, 5, 6, 0], on: '17:15', off: '23:00', enforce: true };
    return '<div class="hb-stepbox" data-sched><span class="hb-days">' + DAYS.map((n, i) => '<label class="hb-day"><input type="checkbox" data-day="' + i + '"' + (sc.days.indexOf(i) >= 0 ? ' checked' : '') + '><span>' + n.slice(0, 2) + '</span></label>').join('') + '</span>' +
      '<span class="hb-hint">on</span><input type="time" data-on value="' + esc(sc.on) + '" style="width:110px!important"><span class="hb-hint">off</span><input type="time" data-off value="' + esc(sc.off) + '" style="width:110px!important">' +
      '<label class="hb-chk" title="When on, the Hub switches the plug at these times. When off, the schedule only tells the watchdog when the plug is supposed to be on (use this if FPP or the Kasa app already switches it)."><input type="checkbox" data-enf' + (sc.enforce ? ' checked' : '') + '> Switch plug automatically</label><button class="hb-ib" data-rmsched title="Remove">' + icon('x', 14) + '</button></div>';
  }
  function extraSections(d) {
    if (d.kind === 'sensor') {
      if (d.type !== 'lidar') return '';
      const au = Object.assign({ user: 'admin', hasPass: false }, d.auth || {});
      return '<details class="hb-fs" open><summary class="hb-sum">Counter login</summary><div class="hb-form"><div class="hb-two"><label>Username<input id="a-user" value="' + esc(au.user || 'admin') + '" autocomplete="off"></label><label>Password<input id="a-pass" type="password" placeholder="' + (au.hasPass ? '•••••• (saved – leave blank to keep)' : 'the counter page password') + '" autocomplete="new-password"></label></div>' +
        '<p class="hb-hint">The counter\'s web page is password protected (user <b>admin</b>; set with <span class="hb-mono">sudo car-counter-passwd</span> on that Pi). The Hub needs it to read the count. It is stored in FPP\'s config folder and never sent to the browser or kiosk.</p></div></details>';
    }
    if (d.kind === 'plug') {
      const users = S.cfg.devices.filter((x) => x.linkedPlug && x.linkedPlug.id === d.id);
      return '<details class="hb-fs" open><summary class="hb-sum">Schedule <small>(when this plug is supposed to be on)</small></summary><div id="hb-sched">' + (d.schedules || []).map(schedRow).join('') + '</div><button class="hb-btn sm" id="hb-addsched" type="button">' + icon('plus', 12) + ' Add schedule</button>' +
        '<p class="hb-hint">The recovery watchdog only restarts or power-cycles devices on this plug <b>inside</b> these windows (they are expected to be off outside them). Overnight windows (on 17:15, off 01:00) are supported.' + (users.length ? ' This plug powers: <b>' + users.map((u) => esc(u.name)).join(', ') + '</b>.' : '') + '</p></details>';
    }
    if (d.local) return '';
    const w = Object.assign({ enabled: false, failAfter: 120, bootGrace: 180, cooldown: 120, steps: ['api', 'ssh', 'power'], frozen: true, freezeSec: 90, allowShared: false, maxCycles: 3 }, d.watch || {});
    const ss = Object.assign({ enabled: true, useDefault: true, user: '', port: 22, command: 'sudo reboot', hasPass: false }, d.ssh || {});
    const sh = sharedWith(d);
    const ck = (id, v, label, extra) => '<label class="hb-chk"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '> ' + label + '</label>';
    return '<details class="hb-fs"' + (w.enabled ? ' open' : '') + '><summary class="hb-sum">Auto-recovery <small>(runs in the background, even when this page is closed)</small></summary><div class="hb-form">' +
      ck('w-en', w.enabled, 'Watch this device and try to fix it if it stops responding') +
      '<div><span class="hb-lbl">Steps, in order</span><div class="hb-row" style="flex-wrap:wrap;margin-top:6px">' +
      ck('w-api', w.steps.indexOf('api') >= 0, '1 · ' + (d.kind === 'fpp' ? 'FPP API: restart FPPD' : 'Restart over its API (WLED only)')) +
      ck('w-ssh', w.steps.indexOf('ssh') >= 0, '2 · SSH command') + ck('w-pow', w.steps.indexOf('power') >= 0, '3 · Power-cycle the linked plug') + '</div></div>' +
      (sh.length ? '<div class="hb-warnbox">' + icon('alert', 16) + ' The linked plug also powers <b>' + sh.map((x) => esc(x.name)).join(', ') + '</b>. Step 3 will be skipped unless you allow it below.</div>' + ck('w-shared', w.allowShared, 'Allow power-cycling even though it also cuts power to the devices above') : '') +
      '<div class="hb-two"><label>Not responding for (seconds) before acting<input id="w-fail" type="number" min="30" max="3600" value="' + w.failAfter + '"></label><label>Ignore failures after power-on (boot grace, seconds)<input id="w-boot" type="number" min="0" max="1800" value="' + w.bootGrace + '"></label></div>' +
      '<div class="hb-two"><label>Wait between steps (seconds)<input id="w-cool" type="number" min="30" max="1800" value="' + w.cooldown + '"></label><label>Max power cycles per 24 h<input id="w-max" type="number" min="1" max="20" value="' + w.maxCycles + '"></label></div>' +
      (d.kind === 'fpp' ? ck('w-froz', w.frozen, 'Also treat it as unresponsive if a playlist is “playing” but the time stops advancing') + '<label>…for at least (seconds)<input id="w-fsec" type="number" min="30" max="1800" value="' + w.freezeSec + '"></label>' : '') +
      '<h4 class="hb-h4" style="margin:6px 0 0">SSH (step 2)</h4>' + ck('s-en', ss.enabled, 'Allow SSH recovery for this device') + ck('s-def', ss.useDefault, 'Use the default SSH login (set in Settings → Auto-recovery; FPP default is fpp / falcon)') +
      '<div class="hb-two" id="s-cust"><label>SSH username<input id="s-user" value="' + esc(ss.user) + '" autocomplete="off"></label><label>SSH password<input id="s-pass" type="password" placeholder="' + (ss.hasPass ? '•••••• (saved – leave blank to keep)' : 'password') + '" autocomplete="new-password"></label></div>' +
      '<div class="hb-two"><label>SSH port<input id="s-port" type="number" min="1" max="65535" value="' + ss.port + '"></label><label>Command<input id="s-cmd" value="' + esc(ss.command) + '"></label></div>' +
      '<div class="hb-row"><button class="hb-btn sm" id="s-test" type="button">Test SSH login</button><span class="hb-hint" id="s-res"></span></div>' +
      '<p class="hb-hint">Passwords are stored in plain text in FPP\'s config folder (needed to log in on your behalf). Most pixel controllers do not offer SSH – leave step 2 off for those.</p></div></details>';
  }
  function wireExtra(m, d) {
    const $ = (x) => m.body.querySelector(x);
    if (d.kind === 'sensor') return;
    if (d.kind === 'plug') {
      const box = $('#hb-sched');
      const wireRm = () => box.querySelectorAll('[data-rmsched]').forEach((b) => (b.onclick = () => b.closest('[data-sched]').remove()));
      $('#hb-addsched').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', schedRow()); wireRm(); });
      wireRm();
      return;
    }
    if (d.local || !$('#s-def')) return;
    const sync = () => { $('#s-cust').style.opacity = $('#s-def').checked ? '.45' : '1'; $('#s-user').disabled = $('#s-pass').disabled = $('#s-def').checked; };
    $('#s-def').addEventListener('change', sync); sync();
    $('#s-test').addEventListener('click', async () => {
      $('#s-res').textContent = 'Saving & testing…';
      try {
        await H.api('device_update', { id: d.id, patch: { ssh: collectExtra(m, d).ssh } });
        const r = await H.api('ssh_test', { id: d.id });
        $('#s-res').innerHTML = '<span class="hb-ok">' + icon('check', 14) + ' Logged in as ' + esc(r.user) + '</span>';
      } catch (e) { $('#s-res').innerHTML = '<span class="hb-bad">' + esc(e.message) + '</span>'; }
    });
  }
  function collectExtra(m, d) {
    const $ = (x) => m.body.querySelector(x);
    if (d.kind === 'sensor') return $('#a-user') ? { auth: { user: $('#a-user').value.trim() || 'admin', pass: $('#a-pass').value } } : {};
    if (d.kind === 'plug') {
      const rows = [...m.body.querySelectorAll('[data-sched]')];
      return { schedules: rows.map((r) => ({ days: [...r.querySelectorAll('[data-day]')].filter((c) => c.checked).map((c) => +c.dataset.day), on: r.querySelector('[data-on]').value, off: r.querySelector('[data-off]').value, enforce: r.querySelector('[data-enf]').checked })) };
    }
    if (d.local || !$('#w-en')) return {};
    const steps = [];
    if ($('#w-api').checked) steps.push('api'); if ($('#w-ssh').checked) steps.push('ssh'); if ($('#w-pow').checked) steps.push('power');
    const watch = { enabled: $('#w-en').checked, steps, failAfter: +$('#w-fail').value, bootGrace: +$('#w-boot').value, cooldown: +$('#w-cool').value, maxCycles: +$('#w-max').value };
    if ($('#w-shared')) watch.allowShared = $('#w-shared').checked;
    if ($('#w-froz')) { watch.frozen = $('#w-froz').checked; watch.freezeSec = +$('#w-fsec').value; }
    return { watch, ssh: { enabled: $('#s-en').checked, useDefault: $('#s-def').checked, user: $('#s-user').value, pass: $('#s-pass').value, port: +$('#s-port').value, command: $('#s-cmd').value } };
  }

  async function toggleWatchdog() {
    const on = !opt('watchdogEnabled');
    try {
      const r = await H.api('settings_save', { options: { watchdogEnabled: on } });
      S.cfg = r.config; S.sigCfg = JSON.stringify([S.cfg.devices, S.cfg.scenes, S.cfg.options]); renderActions();
      H.toast('Auto-recovery ' + (on ? 'enabled' : 'disabled') + ' for all devices', on ? 'ok' : 'info');
    } catch (e) { H.toast(e.message, 'err'); }
  }

  async function showEvents() {
    const m = H.modal({ title: 'Activity', wide: true, html: '<div class="hb-events"><span class="hb-spin"></span></div>', buttons: S.ro ? [{ label: 'Close', cls: 'primary' }] : [{ label: 'Clear log', cls: 'ghost', onClick: async () => { await H.api('events_clear', {}); } }, { label: 'Close', cls: 'primary' }] });
    try {
      const r = await H.api('events');
      m.body.querySelector('.hb-events').innerHTML = r.events.length ? r.events.map((e) => '<div class="hb-ev ' + esc(e.level) + '"><time>' + new Date(e.t * 1000).toLocaleString() + '</time><span>' + esc(e.msg) + '</span></div>').join('') : '<p class="hb-hint">Nothing has happened yet. Online/offline changes, discoveries and commands you send show up here.</p>';
    } catch (e) { m.body.querySelector('.hb-events').textContent = e.message; }
  }

  /* -------------------------------------------------------------------- init */
  async function init() {
    shell();
    try { await reloadConfig(true); } catch (e) { root.querySelector('#hb-sections').innerHTML = '<div class="hb-empty"><h3>Cannot load the Hub</h3><p>' + esc(e.message) + '</p></div>'; return; }
    poll();
    const loop = () => { clearInterval(S.timer); S.timer = setInterval(poll, Math.max(2, +opt('refreshSeconds') || 5) * 1000); };
    loop();
    setInterval(() => document.querySelectorAll('.hb-card.k-fpp.playing').forEach(tickCard), 1000);
    setInterval(() => { if (!document.hidden) reloadConfig(false).then(loop).catch(() => {}); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    if (B.kiosk) {
      const clock = () => { const c = document.getElementById('hb-clock'); if (c) c.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
      clock(); setInterval(clock, 15000);
      const wake = async () => { try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ } };
      wake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
      let idle; const hide = () => { document.body.classList.remove('hb-idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('hb-idle'), 15000); };
      ['mousemove', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, hide, { passive: true })); hide();
    }
    if (!B.kiosk) {
      H.api('update_check').then((u) => {
        if (!u.available) return;
        const b = document.createElement('div');
        b.className = 'hb-banner';
        b.innerHTML = icon('download', 16) + '<span>Central Hub <b>v' + esc(u.latest) + '</b> is available (you have v' + esc(u.current) + ').</span><button class="hb-btn sm primary">Update now</button>';
        b.querySelector('button').addEventListener('click', () => H.updateFlow(u.latest));
        root.querySelector('.hb-app').prepend(b);
      }).catch(() => {});
    }
    if (!B.kiosk && opt('autoScanOnLoad')) {
      const last = Math.max(0, ...Object.values(S.cfg.lastScan || {}).map((x) => x.t || 0));
      if (Date.now() / 1000 - last > 3600) scanFlow(['fpp', 'controller', 'plug'], true);
    }
  }
  init();
})();
