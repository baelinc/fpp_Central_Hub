/* FPP Central Hub - settings page */
(function () {
  'use strict';
  const H = window.Hub, B = H.boot, esc = H.esc, icon = H.icon;
  const root = document.getElementById('hub-root');
  const KINDS = [
    { k: 'fpp', title: 'Falcon Players', ico: 'tv', hint: 'Other FPP instances (also discovered through FPP MultiSync when this runs on an FPP).', ph: '192.168.80.0/24' },
    { k: 'controller', title: 'Lighting controllers', ico: 'cpu', hint: 'Kulp, Falcon / Baldrick, Experience Lights, Pixel2Things, Hanson Electronics, ESPixelStick (Forkineye), WLED.', ph: '192.168.80.0/24' },
    { k: 'sensor', title: 'Counters & sensors', ico: 'pulse', hint: 'The Christmas Lidar Counter (a Pi with a lidar sensor) and BaldrickSignals crowd boards.', ph: '192.168.1.0/24' },
    { k: 'plug', title: 'Smart plugs', ico: 'plug', hint: 'TP-Link Kasa (KP401 etc.), Tasmota and Shelly plugs – anything controlled locally, no cloud.', ph: '192.168.1.0/24' },
  ];
  const NAV = [['net', 'Network ranges', 'search'], ['dev', 'Devices', 'list'], ['scn', 'Scenes', 'layers'], ['app', 'Appearance & behavior', 'sun'], ['kio', 'Kiosk & phone link', 'tv'], ['det', 'Detection rules', 'cpu'], ['bak', 'Backup & log', 'download'], ['rec', 'Auto-recovery', 'zap'], ['upd', 'Updates', 'refresh']];
  const S = { cfg: null, types: {}, boot: null, tab: 'net', dirty: false, status: {} };
  const $ = (s, r) => (r || root).querySelector(s);
  const abs = (rel) => new URL(rel, location.href).href;

  function shell() {
    root.innerHTML = '<div class="hb-top"><div class="hb-brand"><span class="hb-logo">' + H.logo(46) + '</span><div><h2>Central Hub Settings</h2><div class="hb-sub">Version ' + esc(B.version) + '</div></div></div><div class="hb-actions"><a class="hb-btn primary" href="' + esc(B.dashUrl) + '">' + icon('home', 16) + '<span>Back to dashboard</span></a></div></div>' +
      '<div class="hb-set"><nav class="hb-snav">' + NAV.map((n) => '<button data-p="' + n[0] + '">' + icon(n[2], 17) + n[1] + '</button>').join('') + '</nav><div id="hb-panes"></div></div>';
    root.querySelectorAll('.hb-snav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.p)));
  }
  function show(p) {
    S.tab = p;
    root.querySelectorAll('.hb-snav button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    root.querySelectorAll('.hb-pane').forEach((x) => x.classList.toggle('on', x.dataset.p === p));
    try { sessionStorage.setItem('hbSetTab', p); } catch (e) { /* ignore */ }
  }
  const pane = (id, html) => '<section class="hb-pane" data-p="' + id + '">' + html + '</section>';
  const saveBar = (what) => '<div class="hb-savebar"><span class="hb-hint" data-saved></span><button class="hb-btn primary" data-save="' + what + '">' + icon('check', 16) + ' Save changes</button></div>';

  /* ------------------------------------------------------------ build panes */
  function build() {
    const o = S.cfg.options;
    const panes = [];

    panes.push(pane('net',
      '<h3>Network address ranges</h3><span class="hb-hint">Tell the Hub where each type of device lives. Each type can use a different network – for example plugs on 192.168.1.x and FPP/controllers on 192.168.80.x. The Hub must be able to route to these networks.</span>' +
      KINDS.map((K) => '<div class="hb-fs" data-k="' + K.k + '"><h4>' + icon(K.ico, 17) + K.title + '</h4><div class="hb-hint">' + K.hint + '</div>' +
        '<textarea class="hb-ranges" data-r="' + K.k + '" spellcheck="false" placeholder="' + K.ph + '">' + esc((S.cfg.ranges[K.k] || []).join('\n')) + '</textarea>' +
        '<div class="hb-rinfo" data-ri="' + K.k + '"></div>' +
        '<div class="hb-sugg"><span class="hb-lbl">Detected here</span>' + (S.boot.localSubnets.length ? S.boot.localSubnets.map((s) => '<button class="hb-chipbtn" data-sugg="' + K.k + '" data-v="' + esc(s) + '">+ ' + esc(s) + '</button>').join('') : '<span class="hb-hint">none</span>') +
        '<span class="hb-sp"></span><button class="hb-btn sm" data-scan="' + K.k + '">' + icon('refresh', 12) + ' Save & scan now</button></div></div>').join('') +
      '<p class="hb-hint">One entry per line. Accepted: <span class="hb-mono">192.168.1.0/24</span> (CIDR, /16–/32) · <span class="hb-mono">192.168.1.10-50</span> · <span class="hb-mono">192.168.1.10-192.168.2.20</span> · <span class="hb-mono">192.168.1.X</span> · a single IP. Maximum 4096 addresses per type.</p>' + saveBar('net')));

    panes.push(pane('dev', '<h3>Devices</h3><span class="hb-hint">Everything the Hub knows about. Hidden devices are kept but not shown on the dashboard.</span><div id="hb-devtbl"></div><div id="hb-ignored"></div>'));

    panes.push(pane('scn', '<h3>Scenes</h3><span class="hb-hint">A scene is a one-tap sequence – for example “Shutdown”: stop playlists, wait, turn plugs off. Scenes appear as buttons on the dashboard.</span><div id="hb-scnlist"></div><div class="hb-row" style="margin-top:12px"><button class="hb-btn primary" data-newscn>' + icon('plus', 16) + ' New scene</button></div>'));

    panes.push(pane('app', '<h3>Appearance & behavior</h3><span class="hb-hint">Applies to the dashboard and the kiosk view.</span><div class="hb-form">' +
      '<div class="hb-two"><label>Theme<select id="o-theme" class="hb-sel"><option value="dark">Dark</option><option value="light">Light</option><option value="auto">Follow device</option></select></label><label>Accent color<input id="o-accent" type="color" value="' + esc(o.accent) + '" style="height:40px;padding:3px"></label></div>' +
      '<div class="hb-two"><label>Refresh every (seconds)<input id="o-refresh" type="number" min="2" max="300" value="' + o.refreshSeconds + '"></label><label>Power-cycle off time (seconds)<input id="o-cycle" type="number" min="2" max="120" value="' + o.cycleSeconds + '"></label></div>' +
      '<div class="hb-two"><label>Scan connect timeout (ms)<input id="o-ct" type="number" min="150" max="5000" value="' + o.connectTimeoutMs + '"></label><label>Request timeout (ms)<input id="o-ht" type="number" min="500" max="15000" value="' + o.httpTimeoutMs + '"></label></div>' +
      '<label class="hb-chk"><input type="checkbox" id="o-off"' + (o.showOffline ? ' checked' : '') + '> Show offline devices on the dashboard</label>' +
      '<label class="hb-chk"><input type="checkbox" id="o-compact"' + (o.compact ? ' checked' : '') + '> Compact cards</label>' +
      '<label class="hb-chk"><input type="checkbox" id="o-auto"' + (o.autoScanOnLoad ? ' checked' : '') + '> Re-scan the network automatically when the dashboard is opened (at most once an hour)</label>' +
      '<p class="hb-hint">Lower scan timeouts are faster; raise them on slow Wi-Fi or if devices are missed.</p></div>' + saveBar('app')));

    const kurl = abs(B.kioskUrl);
    panes.push(pane('kio', '<h3>Kiosk & phone link</h3><span class="hb-hint">A standalone page with no FPP menus – ideal for a phone home-screen shortcut, a wall tablet or a kiosk browser. It is served by this FPP, so the viewing device only needs to reach this FPP.</span><div class="hb-form">' +
      '<div class="hb-qrrow"><div class="hb-qr" id="k-qr" title="Scan with your phone camera"></div><div class="hb-hint"><b>Scan to open on your phone.</b><br>Point the camera at the code. The code always matches the link and options below, and is made right here in your browser.<br><button class="hb-btn sm" id="k-qrsave" type="button" style="margin-top:8px">' + icon('download', 14) + ' Save QR image</button></div></div>' +
      '<label>Link<div class="hb-urlbox"><input id="k-url" readonly value="' + esc(kurl) + '"><button class="hb-btn" data-copy="k-url">Copy</button><a class="hb-btn primary" id="k-open" href="' + esc(kurl) + '" target="_blank" rel="noopener">' + icon('ext', 16) + ' Open</a></div></label>' +
      '<div class="hb-two"><label>Show only<select id="k-kind" class="hb-sel"><option value="">Everything</option><option value="fpp">Falcon Players</option><option value="controller">Controllers</option><option value="sensor">Counters &amp; sensors</option><option value="plug">Smart plugs</option></select></label><label>Columns<select id="k-cols" class="hb-sel"><option value="">Automatic</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option></select></label></div>' +
      '<label class="hb-chk"><input type="checkbox" id="k-ro"> Add <span class="hb-mono">&readonly=1</span> to this link (view-only)</label>' +
      '<hr style="border:0;border-top:1px solid var(--bd);width:100%">' + '<label class="hb-chk"><input type="checkbox" id="o-kro"' + (o.kioskReadOnly ? ' checked' : '') + '> Always view-only in the kiosk (hides all controls and blocks control requests from the kiosk page)</label>' +
      '<p class="hb-hint">If an FPP UI password is set, the kiosk page asks for it too – it is protected like the rest of FPP. Tip: on iOS/Android use “Add to Home Screen” for a full-screen app-like launcher.</p></div>' + saveBar('kio')));

    panes.push(pane('det', '<h3>Detection rules</h3><span class="hb-hint">How lighting controllers are recognised: the Hub loads each device\'s web page on port 80 and looks for these words (case-insensitive) in the headers and HTML. First matching rule wins, so keep specific rules above generic ones. If a controller is not found, scan once, look under “Other web devices answered”, and add a keyword here.</span>' +
      '<textarea id="d-sig" class="hb-ranges" style="min-height:300px" spellcheck="false"></textarea><div class="hb-rinfo" id="d-sig-i"></div><p class="hb-hint">Types: ' + Object.keys(S.types.controller).join(', ') + '</p><div class="hb-row"><button class="hb-btn" data-sigreset>Reset to defaults</button></div>' + saveBar('det')));

    panes.push(pane('bak', '<h3>Backup & log</h3><span class="hb-hint">Export all devices, ranges, scenes and settings as a file, or restore from one.</span><div class="hb-row" style="flex-wrap:wrap"><button class="hb-btn" data-export>' + icon('download', 16) + ' Export</button><label class="hb-btn" style="cursor:pointer">' + icon('upload', 16) + ' Import<input type="file" id="b-file" accept="application/json" hidden></label><button class="hb-btn danger" data-clearlog>Clear activity log</button></div>'));

    panes.push(pane('rec', '<h3>Auto-recovery</h3><span class="hb-hint">A background monitor watches the devices you enable it for (open a device → Edit → Auto-recovery). When one stops responding it escalates: <b>1)</b> FPP API restart → <b>2)</b> SSH command → <b>3)</b> power-cycle its smart plug. It only acts while the device is supposed to be powered (inside the plug\'s schedule, or while the plug is on), never power-cycles a plug that also feeds other devices unless you allow it, and limits power cycles per day.</span><div class="hb-form">' +
      '<label class="hb-chk"><input type="checkbox" id="o-wd"' + (o.watchdogEnabled ? ' checked' : '') + '> Auto-recovery master switch</label>' +
      '<div class="hb-two"><label>Default SSH username<input id="o-su" value="' + esc(o.sshDefaultUser) + '" autocomplete="off"></label><label>Default SSH password<input id="o-sp" type="password" placeholder="' + (o.sshDefaultPassSet ? '•••••• (saved – leave blank to keep)' : 'password') + '" autocomplete="new-password"></label></div>' +
      '<p class="hb-hint">FPP\'s factory login is <span class="hb-mono">fpp</span> / <span class="hb-mono">falcon</span>. Devices set to “use default” use this login.</p>' +
      '<div class="hb-fs"><h4>Background monitor</h4><div id="mon-st" class="hb-hint">Checking…</div><div class="hb-row" style="margin-top:8px"><button class="hb-btn sm" data-mon="start">Start</button><button class="hb-btn sm" data-mon="restart">Restart</button><button class="hb-btn sm" data-mon="stop">Stop</button></div><p class="hb-hint">Starts automatically with FPP and whenever the dashboard is open. It also runs your <b>plug schedules</b>. Recovery actions appear in the Activity log.</p></div></div>' + saveBar('rec')));
    panes.push(pane('upd', '<h3>Updates</h3><span class="hb-hint">Created by Johnathan Evans · installed version <b>v' + esc(B.version) + '</b>. Checks github.com/baelinc/fpp_Central_Hub (the FPP needs internet access). FPP\'s Plugin Manager can also update this plugin.</span><div class="hb-row"><button class="hb-btn" id="u-check">' + icon('refresh', 16) + ' Check for updates</button><button class="hb-btn primary" id="u-apply" hidden>Update now</button></div><p class="hb-hint" id="u-msg" style="margin-top:10px"></p>'));
    $('#hb-panes').innerHTML = panes.join('');
    $('#o-theme').value = o.theme;
    $('#d-sig').value = JSON.stringify(S.cfg.signatures || S.boot.defaultSignatures, null, 1);
    renderDevices();
    renderScenes();
    root.querySelectorAll('[data-r]').forEach((t) => validateRange(t.dataset.r));
    wire();
    show((function () { try { return sessionStorage.getItem('hbSetTab') || 'net'; } catch (e) { return 'net'; } })());
  }

  /* ------------------------------------------------------------- behaviour */
  const parseSig = () => { try { const v = JSON.parse($('#d-sig').value); if (!Array.isArray(v)) throw new Error('must be a list'); return v; } catch (e) { return e; } };
  function kioskUrl() {
    const p = [];
    if ($('#k-kind').value) p.push('kind=' + $('#k-kind').value);
    if ($('#k-cols').value) p.push('cols=' + $('#k-cols').value);
    if ($('#k-ro').checked) p.push('readonly=1');
    const u = abs(B.kioskUrl) + (p.length ? '&' + p.join('&') : '');
    $('#k-url').value = u; $('#k-open').href = u;
    drawQr(u);
  }
  function qrSvg(text) {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  function drawQr(u) {
    const box = $('#k-qr'); if (!box) return;
    try { box.innerHTML = qrSvg(u); } catch (e) { box.innerHTML = '<span class="hb-hint">Link too long for a QR code</span>'; }
  }
  async function validateRange(k) {
    const ta = $('[data-r="' + k + '"]'), info = $('[data-ri="' + k + '"]');
    const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { info.innerHTML = '<span>No ranges – ' + (k === 'fpp' ? 'only MultiSync-known players will be found.' : 'this type will not be scanned.') + '</span>'; return; }
    try {
      const r = await H.api('parse_ranges', { ranges: lines });
      info.innerHTML = r.results.map((x) => x.error ? '<span class="bad">' + icon('alert', 13) + ' ' + esc(x.error) + '</span>' : '<span>' + esc(x.range) + ' → ' + x.count + ' addresses</span>').join('');
    } catch (e) { info.innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
  }
  const collect = () => {
    const ranges = {};
    root.querySelectorAll('[data-r]').forEach((t) => (ranges[t.dataset.r] = t.value.split('\n').map((s) => s.trim()).filter(Boolean)));
    const options = {
      theme: $('#o-theme').value, accent: $('#o-accent').value, refreshSeconds: +$('#o-refresh').value, cycleSeconds: +$('#o-cycle').value,
      connectTimeoutMs: +$('#o-ct').value, httpTimeoutMs: +$('#o-ht').value, showOffline: $('#o-off').checked, compact: $('#o-compact').checked,
      autoScanOnLoad: $('#o-auto').checked, watchdogEnabled: $('#o-wd').checked, sshDefaultUser: $('#o-su').value, sshDefaultPass: $('#o-sp').value, kioskReadOnly: $('#o-kro').checked,
    };
    const sig = parseSig();
    if (sig instanceof Error) throw new Error('Detection rules: ' + sig.message);
    const def = JSON.stringify(S.boot.defaultSignatures);
    return { ranges, options, signatures: JSON.stringify(sig) === def ? null : sig };
  };
  async function save(btn) {
    btn.disabled = true;
    try {
      const r = await H.api('settings_save', collect());
      S.cfg = r.config; H.applyTheme(root, S.cfg.options);
      H.toast('Settings saved', 'ok');
      root.querySelectorAll('[data-saved]').forEach((e) => (e.textContent = 'Saved ' + new Date().toLocaleTimeString()));
      root.querySelectorAll('[data-r]').forEach((t) => validateRange(t.dataset.r));
      return true;
    } catch (e) { H.toast(e.message, 'err'); return false; } finally { btn.disabled = false; }
  }

  function wire() {
    root.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => save(b)));
    root.querySelectorAll('[data-r]').forEach((t) => t.addEventListener('input', H.debounce(() => validateRange(t.dataset.r), 300)));
    root.querySelectorAll('[data-sugg]').forEach((b) => b.addEventListener('click', () => { const t = $('[data-r="' + b.dataset.sugg + '"]'); const l = t.value.split('\n').map((s) => s.trim()).filter(Boolean); if (l.indexOf(b.dataset.v) < 0) l.push(b.dataset.v); t.value = l.join('\n'); validateRange(b.dataset.sugg); }));
    root.querySelectorAll('[data-scan]').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.scan; b.disabled = true; const old = b.innerHTML; b.innerHTML = '<span class="hb-spin"></span> Scanning…';
      try {
        if (await save(root.querySelector('[data-save="net"]'))) {
          const r = await H.api('scan', { kind: k }); S.cfg = r.config; renderDevices();
          H.toast(r.found + ' found, ' + r.added.length + ' new (' + r.scanned + ' addresses checked)' + (r.unmatched && r.unmatched.length ? ' · ' + r.unmatched.length + ' unrecognised web device(s) – see the dashboard scan for details' : ''), r.found ? 'ok' : 'info');
        }
      } catch (e) { H.toast(e.message, 'err'); } finally { b.disabled = false; b.innerHTML = old; }
    }));
    ['#k-kind', '#k-cols', '#k-ro'].forEach((s) => $(s).addEventListener('change', kioskUrl));
    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => { const i = $('#' + b.dataset.copy); try { await navigator.clipboard.writeText(i.value); } catch (e) { i.select(); document.execCommand('copy'); } H.toast('Link copied', 'ok'); }));
    $('[data-sigreset]').addEventListener('click', () => { $('#d-sig').value = JSON.stringify(S.boot.defaultSignatures, null, 1); });
    $('#d-sig').addEventListener('input', H.debounce(() => { const s = parseSig(); $('#d-sig-i').innerHTML = s instanceof Error ? '<span class="bad">' + esc(s.message) + '</span>' : '<span>' + s.length + ' rules</span>'; }, 250));
    $('[data-newscn]').addEventListener('click', () => editScene(null));
    $('[data-export]').addEventListener('click', async () => {
      const r = await H.api('export'); const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(r.config, null, 2)], { type: 'application/json' })); a.download = 'central-hub-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    });
    $('#b-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (!(await H.confirm('Replace the current devices, scenes, ranges and settings with this file?', 'Import', true))) return; const r = await H.api('import', { config: j }); S.cfg = r.config; build(); H.toast('Imported', 'ok'); } catch (err) { H.toast(err.message, 'err'); }
      e.target.value = '';
    });
    $('[data-clearlog]').addEventListener('click', async () => { await H.api('events_clear', {}); H.toast('Log cleared', 'ok'); });
    const monRefresh = async () => { try { const m = await H.api('monitor_status'); $('#mon-st').innerHTML = (m.running ? '<span class="hb-ok">● Running</span> (last check ' + H.ago(m.heartbeat) + ' ago)' : '<span class="hb-bad">● Not running</span>') + ' · ssh client: ' + (m.ssh ? 'available' : '<span class="hb-bad">not installed – step 2 unavailable</span>') + (m.lastError ? '<br><span class="hb-bad">' + esc(m.lastError) + '</span>' : ''); } catch (e) { $('#mon-st').textContent = e.message; } };
    root.querySelectorAll('[data-mon]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; try { await H.api('monitor_ctl', { op: b.dataset.mon }); } catch (e) { H.toast(e.message, 'err'); } b.disabled = false; monRefresh(); }));
    monRefresh();
    kioskUrl();
    $('#k-qrsave').addEventListener('click', () => {
      try {
        const q = window.qrcode(0, 'M'); q.addData($('#k-url').value); q.make();
        const n = q.getModuleCount(), cell = 10, pad = 4 * cell, size = n * cell + pad * 2;
        const cv = document.createElement('canvas'); cv.width = cv.height = size;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, size, size); cx.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cx.fillRect(pad + c * cell, pad + r * cell, cell, cell);
        const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'central-hub-qr.png'; document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { H.toast('Could not make the image: ' + e.message, 'err'); }
    });
    let latest = null;
    $('#u-check').addEventListener('click', async () => {
      $('#u-msg').textContent = 'Checking…';
      try { const u = await H.api('update_check', null, 'force=1'); latest = u.latest; $('#u-apply').hidden = !u.available; $('#u-msg').textContent = u.error || (u.available ? 'Version ' + u.latest + ' is available.' : 'You are up to date (v' + u.current + ').'); } catch (e) { $('#u-msg').textContent = e.message; }
    });
    $('#u-apply').addEventListener('click', () => H.updateFlow(latest));
  }

  /* --------------------------------------------------------------- devices */
  function renderDevices() {
    const ds = S.cfg.devices;
    const tl = (d) => ((S.types[d.kind] || {})[d.type] || {}).label || d.type;
    $('#hb-devtbl').innerHTML = ds.length ? '<table class="hb-tbl"><thead><tr><th>Name</th><th>Kind</th><th>Type</th><th>Address</th><th>Group</th><th></th></tr></thead><tbody>' +
      ds.map((d) => '<tr data-id="' + esc(d.id) + '"><td><b>' + esc(d.name) + '</b>' + (d.hidden ? ' <span class="hb-pill">hidden</span>' : '') + (d.manual ? ' <span class="hb-pill">manual</span>' : '') + '</td><td>' + esc(d.kind) + '</td><td>' + esc(tl(d)) + '</td><td class="hb-mono">' + esc(d.ip) + (d.port && +d.port !== 80 ? ':' + d.port : '') + '</td><td>' + esc(d.group || '') + '</td><td style="text-align:right;white-space:nowrap"><button class="hb-btn sm" data-hide>' + (d.hidden ? 'Show' : 'Hide') + '</button> <button class="hb-btn sm danger" data-del>' + icon('trash', 12) + '</button></td></tr>').join('') + '</tbody></table>'
      : '<p class="hb-hint">No devices yet. Save your ranges, then press “Save & scan now”, or use Add on the dashboard.</p>';
    $('#hb-devtbl').querySelectorAll('tr[data-id]').forEach((tr) => {
      const d = ds.find((x) => x.id === tr.dataset.id);
      tr.querySelector('[data-hide]').addEventListener('click', async () => { const r = await H.api('device_update', { id: d.id, patch: { hidden: !d.hidden } }); S.cfg = r.config; renderDevices(); });
      tr.querySelector('[data-del]').addEventListener('click', async () => { if (!(await H.confirm('Remove "' + d.name + '"?' + (!d.manual ? ' Future scans will not re-add it.' : ''), 'Remove', true))) return; const r = await H.api('device_remove', { id: d.id, ignore: !d.manual }); S.cfg = r.config; renderDevices(); renderScenes(); });
    });
    const ig = S.cfg.ignored || [];
    $('#hb-ignored').innerHTML = ig.length ? '<h4 class="hb-h4">Ignored addresses</h4><p class="hb-hint">Removed devices that scans skip. Restore one to let scans add it again.</p>' + ig.map((x) => '<div class="hb-unrow"><div class="hb-mono">' + esc(x.replace('|', ' · ')) + '</div><button class="hb-btn sm" data-restore="' + esc(x) + '">Restore</button></div>').join('') : '';
    $('#hb-ignored').querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      const left = S.cfg.ignored.filter((x) => x !== b.dataset.restore);
      const r = await H.api('import', { config: Object.assign({}, S.cfg, { ignored: left }) }); S.cfg = r.config; renderDevices();
    }));
  }

  /* ---------------------------------------------------------------- scenes */
  const CMDS = {
    fpp: [['start', 'Start playlist'], ['stop', 'Stop now'], ['stopgraceful', 'Stop gracefully'], ['volume', 'Set volume'], ['restart_fppd', 'Restart FPPD'], ['reboot', 'Reboot'], ['shutdown', 'Shut down']],
    plug: [['on', 'Turn on'], ['off', 'Turn off'], ['toggle', 'Toggle']],
    controller: [['toggle', 'Toggle power (WLED)']],
  };
  function renderScenes() {
    const sc = S.cfg.scenes || [];
    const nm = (id) => { const d = S.cfg.devices.find((x) => x.id === id); return d ? d.name : '(removed)'; };
    $('#hb-scnlist').innerHTML = sc.length ? sc.map((s) => '<div class="hb-fs" data-s="' + esc(s.id) + '"><div class="hb-row"><h4 style="margin:0;flex:1">' + (s.icon ? esc(s.icon) + ' ' : '') + esc(s.name) + '</h4><button class="hb-btn sm" data-es>' + icon('edit', 12) + ' Edit</button><button class="hb-btn sm danger" data-ds>' + icon('trash', 12) + '</button></div><div class="hb-hint">' +
      (s.steps.length ? s.steps.map((st, i) => (i + 1) + '. ' + esc(nm(st.device)) + ' → ' + esc((CMDS.fpp.concat(CMDS.plug)).filter((c) => c[0] === st.cmd).map((c) => c[1])[0] || st.cmd) + (st.args && st.args.playlist ? ' “' + esc(st.args.playlist) + '”' : '') + (st.args && st.args.value != null ? ' ' + esc(st.args.value) : '') + (st.delay ? ' (then wait ' + st.delay + 's)' : '')).join('<br>') : 'No steps') + '</div></div>').join('') : '<p class="hb-hint">No scenes yet.</p>';
    $('#hb-scnlist').querySelectorAll('[data-s]').forEach((el) => {
      const s = sc.find((x) => x.id === el.dataset.s);
      el.querySelector('[data-es]').addEventListener('click', () => editScene(s));
      el.querySelector('[data-ds]').addEventListener('click', async () => { if (!(await H.confirm('Delete scene "' + s.name + '"?', 'Delete', true))) return; const r = await H.api('scene_delete', { id: s.id }); S.cfg = r.config; renderScenes(); });
    });
  }

  function editScene(sc) {
    const devs = S.cfg.devices.filter((d) => d.kind !== 'controller' || d.type === 'wled');
    const steps = sc ? JSON.parse(JSON.stringify(sc.steps)) : [];
    const stepHtml = (st, i) => {
      const d = devs.find((x) => x.id === st.device) || devs[0];
      const kind = d ? d.kind : 'plug';
      return '<div class="hb-stepbox" data-i="' + i + '"><select class="hb-sel" data-f="device">' + ['fpp', 'controller', 'plug'].map((k) => { const l = devs.filter((x) => x.kind === k); return l.length ? '<optgroup label="' + k + '">' + l.map((x) => '<option value="' + esc(x.id) + '"' + (d && x.id === d.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</optgroup>' : ''; }).join('') + '</select>' +
        '<select class="hb-sel" data-f="cmd">' + CMDS[kind].map((c) => '<option value="' + c[0] + '"' + (c[0] === st.cmd ? ' selected' : '') + '>' + c[1] + '</option>').join('') + '</select>' +
        '<input data-f="arg" placeholder="' + (st.cmd === 'volume' ? '0-100' : 'playlist name') + '" value="' + esc(st.cmd === 'start' ? (st.args && st.args.playlist) || '' : st.cmd === 'volume' ? (st.args && st.args.value) || '' : '') + '"' + (st.cmd === 'start' || st.cmd === 'volume' ? '' : ' hidden') + ' list="hb-pls" style="width:150px!important">' +
        '<span class="hb-hint">then wait</span><input data-f="delay" type="number" min="0" max="3600" value="' + (st.delay || 0) + '" title="Seconds to wait after this step"><span class="hb-hint">s</span><button class="hb-ib" data-rm title="Remove step">' + icon('x', 14) + '</button></div>';
    };
    const m = H.modal({
      title: sc ? 'Edit scene' : 'New scene', wide: true, noFocus: false,
      html: '<div class="hb-form"><div class="hb-two"><label>Name<input id="sc-n" value="' + esc(sc ? sc.name : '') + '" placeholder="e.g. Show shutdown"></label><label>Emoji / icon <small>(optional)</small><input id="sc-i" maxlength="4" value="' + esc(sc ? sc.icon || '' : '') + '" placeholder="🎄"></label></div><div><span class="hb-lbl">Steps run top to bottom</span><div id="sc-steps" style="margin-top:8px"></div><datalist id="hb-pls"></datalist><button class="hb-btn sm" id="sc-add">' + icon('plus', 12) + ' Add step</button></div></div>',
      onOpen(mm) {
        const box = mm.body.querySelector('#sc-steps');
        const draw = () => { box.innerHTML = steps.map(stepHtml).join('') || '<p class="hb-hint">No steps yet.</p>'; box.querySelectorAll('.hb-stepbox').forEach(wireStep); };
        const wireStep = (el) => {
          const i = +el.dataset.i, st = steps[i];
          const read = () => { st.device = el.querySelector('[data-f=device]').value; st.cmd = el.querySelector('[data-f=cmd]').value; st.delay = +el.querySelector('[data-f=delay]').value || 0; const a = el.querySelector('[data-f=arg]').value; st.args = st.cmd === 'start' ? { playlist: a } : st.cmd === 'volume' ? { value: +a || 0 } : (st.cmd === 'on' || st.cmd === 'off' || st.cmd === 'toggle') && (devs.find((x) => x.id === st.device) || {}).kind === 'plug' ? { outlet: '*' } : {}; };
          el.querySelector('[data-f=device]').addEventListener('change', async (e) => { read(); const d = devs.find((x) => x.id === st.device); if (!CMDS[d.kind].some((c) => c[0] === st.cmd)) st.cmd = CMDS[d.kind][0][0]; draw(); if (d.kind === 'fpp') loadPl(d); });
          el.querySelector('[data-f=cmd]').addEventListener('change', () => { read(); draw(); });
          ['arg', 'delay'].forEach((f) => el.querySelector('[data-f=' + f + ']').addEventListener('input', read));
          el.querySelector('[data-rm]').addEventListener('click', () => { steps.splice(i, 1); draw(); });
          const d = devs.find((x) => x.id === st.device); if (d && d.kind === 'fpp') loadPl(d);
        };
        const loadPl = async (d) => { try { const r = await H.api('act', { id: d.id, cmd: 'playlists', args: {} }); mm.body.querySelector('#hb-pls').innerHTML = (r.data || []).map((n) => '<option value="' + esc(n) + '">').join(''); } catch (e) { /* offline */ } };
        mm.body.querySelector('#sc-add').addEventListener('click', () => { if (!devs.length) return H.toast('No devices to control yet', 'err'); const d = devs[0]; steps.push({ device: d.id, cmd: CMDS[d.kind][0][0], args: d.kind === 'plug' ? { outlet: '*' } : {}, delay: 0 }); draw(); });
        draw();
      },
      buttons: [{ label: 'Cancel', cls: 'ghost' }, {
        label: 'Save scene', cls: 'primary', onClick: async (mm) => {
          const name = mm.body.querySelector('#sc-n').value.trim();
          if (!name) { H.toast('Give the scene a name', 'err'); return false; }
          const r = await H.api('scene_save', { scene: { id: sc ? sc.id : '', name, icon: mm.body.querySelector('#sc-i').value.trim(), steps } });
          S.cfg = r.config; renderScenes();
        },
      }],
    });
  }

  async function init() {
    shell();
    try {
      const r = await H.api('bootstrap');
      S.cfg = r.config; S.types = r.types; S.boot = r;
      H.applyTheme(root, S.cfg.options);
      build();
    } catch (e) { $('#hb-panes').innerHTML = '<div class="hb-empty"><h3>Cannot load settings</h3><p>' + esc(e.message) + '</p></div>'; }
  }
  init();
})();
