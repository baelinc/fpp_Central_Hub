/* FPP Central Hub - shared helpers (API client, icons, toasts, modals, menus) */
(function () {
  'use strict';
  const B = window.HUB_BOOT || {};
  const Hub = (window.Hub = { boot: B });

  Hub.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  Hub.api = async function (action, body, extraQuery) {
    const url = B.apiUrl + '&action=' + encodeURIComponent(action) + (extraQuery ? '&' + extraQuery : '');
    const headers = { 'X-Requested-With': 'hub' };
    if (B.kiosk) headers['X-Hub-Mode'] = 'kiosk';
    const opt = { headers, cache: 'no-store' };
    if (body !== undefined && body !== null) {
      opt.method = 'POST';
      headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    let r;
    try { r = await fetch(url, opt); } catch (e) { throw new Error('Cannot reach the Hub server'); }
    let j = null;
    try { j = await r.json(); } catch (e) { throw new Error('Unexpected response from the Hub server (HTTP ' + r.status + ')'); }
    if (!r.ok || j.ok === false) {
      const err = new Error(j.error || j.msg || 'Request failed');
      err.data = j;
      throw err;
    }
    return j;
  };

  const P = {
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    max: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="m17 2-5 5-5-5"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };
  Hub.icon = (n, size) => '<svg class="hb-i" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || '') + '</svg>';

  Hub.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  Hub.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Hub.fmtDur = (s) => {
    if (s == null || isNaN(s)) return '–';
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  Hub.ago = (ts) => {
    if (!ts) return '';
    const d = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (d < 60) return d + 's';
    if (d < 3600) return Math.floor(d / 60) + 'm';
    if (d < 86400) return Math.floor(d / 3600) + 'h ' + Math.floor((d % 3600) / 60) + 'm';
    return Math.floor(d / 86400) + 'd';
  };

  /* ---------- toasts ---------- */
  Hub.toast = function (msg, type) {
    let box = document.getElementById('hb-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'hb-toasts';
      box.className = 'hb-toasts';
      (document.getElementById('hub-root') || document.body).appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'hb-toast ' + (type || 'info');
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 6000 : 3000);
    return t;
  };

  /* ---------- modal ---------- */
  Hub.modal = function (o) {
    const root = document.getElementById('hub-root') || document.body;
    const ov = document.createElement('div');
    ov.className = 'hb-ov';
    ov.innerHTML = '<div class="hb-modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true"><div class="hb-m-head"><h3>' + Hub.esc(o.title || '') + '</h3><button class="hb-ib" data-x aria-label="Close">' + Hub.icon('x') + '</button></div><div class="hb-m-body"></div><div class="hb-m-foot"></div></div>';
    const body = ov.querySelector('.hb-m-body');
    if (typeof o.html === 'string') body.innerHTML = o.html; else if (o.html) body.appendChild(o.html);
    const foot = ov.querySelector('.hb-m-foot');
    const api = { el: ov, body, close() { ov.classList.remove('in'); setTimeout(() => ov.remove(), 200); if (o.onClose) o.onClose(); } };
    (o.buttons || []).forEach((b) => {
      const el = document.createElement('button');
      el.className = 'hb-btn ' + (b.cls || '');
      el.innerHTML = Hub.esc(b.label);
      el.addEventListener('click', async () => {
        if (!b.onClick) return api.close();
        el.disabled = true;
        try { const r = await b.onClick(api, el); if (r !== false) api.close(); } catch (e) { Hub.toast(e.message, 'err'); } finally { el.disabled = false; }
      });
      foot.appendChild(el);
    });
    if (!(o.buttons || []).length) foot.remove();
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && !o.sticky) api.close(); });
    ov.querySelector('[data-x]').addEventListener('click', () => api.close());
    root.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('in'));
    if (o.onOpen) o.onOpen(api);
    const first = body.querySelector('input:not([type=checkbox]),select,textarea');
    if (first && !o.noFocus) first.focus();
    return api;
  };

  Hub.confirm = (msg, label, danger) => new Promise((res) => {
    let done = false;
    Hub.modal({
      title: 'Please confirm', html: '<p class="hb-confirm">' + Hub.esc(msg) + '</p>',
      onClose() { if (!done) res(false); },
      buttons: [{ label: 'Cancel', cls: 'ghost' }, { label: label || 'Confirm', cls: danger ? 'danger' : 'primary', onClick() { done = true; res(true); } }],
    });
  });

  /* ---------- popover menu ---------- */
  Hub.menu = function (anchor, items) {
    document.querySelectorAll('.hb-menu').forEach((m) => m.remove());
    const root = document.getElementById('hub-root') || document.body;
    const m = document.createElement('div');
    m.className = 'hb-menu';
    items.forEach((it) => {
      if (it === '-') { m.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); return; }
      const el = document.createElement(it.href ? 'a' : 'button');
      el.className = 'hb-mi' + (it.danger ? ' danger' : '');
      if (it.href) { el.href = it.href; el.target = '_blank'; el.rel = 'noopener'; }
      el.innerHTML = (it.icon ? Hub.icon(it.icon, 16) : '') + '<span>' + Hub.esc(it.label) + '</span>';
      el.addEventListener('click', () => { m.remove(); if (it.onClick) it.onClick(); });
      m.appendChild(el);
    });
    root.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.position = 'fixed';
    const w = m.offsetWidth, hgt = m.offsetHeight;
    let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    let top = r.bottom + 6;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  };

  /* ---------- theme ---------- */
  Hub.applyTheme = function (root, opts) {
    let t = opts.theme || 'dark';
    if (t === 'auto') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    if (opts.accent) root.style.setProperty('--accent', opts.accent);
  };

  Hub.openUrl = function (d) {
    if (d.local) return location.protocol + '//' + location.host + '/';
    const port = d.port && Number(d.port) !== 80 ? ':' + d.port : '';
    return 'http://' + d.ip + port + '/';
  };
})();
