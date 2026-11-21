<p align="center"><img src="icon.png" width="96" alt="FPP Central Hub logo"></p>

# FPP Central Hub

A Falcon Player (FPP) plugin that gives you one dashboard for your whole show network.

* **Falcon Players** – discovers every FPP on the network (plus MultiSync-known ones) and shows live cards: now playing + progress, playlist start/stop, volume, temperature, uptime, scheduler, restart FPPD / reboot / shutdown, quick links to FPP pages, and **Open FPP** in a new window.
* **Controllers** (kept separate) – Kulp, Falcon/Baldrick, Experience Lights, Pixel2Things, Hanson Electronics, ESPixelStick (Forkineye), WLED. Status cards with latency history and **Open dashboard** in a new window.
* **Smart plugs** – TP-Link Kasa (KP401, KP303, HS103…), Tasmota and Shelly, all controlled locally. Big on/off cards, per-outlet switches, power draw when available.
* **Per-type network ranges** – e.g. plugs on `192.168.1.x`, FPP/controllers on `192.168.80.x` (Settings → Network ranges). CIDR, `a.b.c.10-50`, `a.b.c.X` or single IPs.
* **Scan button** to search on demand, plus **manual add / remove** (with “test connection” auto-detection) and an ignore list so removed devices stay removed.
* **Extras**: link a plug to a controller/FPP for one-tap **power cycle**; **scenes** (e.g. “Show shutdown”); multi-select **bulk actions**; groups & search; activity log with online/offline events; latency sparklines; export/import backup; light/dark/auto theme and accent colour.
* **Kiosk / phone view** – a standalone page with no FPP menus (`plugin.php?plugin=fpp_Central_Hub&page=kiosk.php&nopage=1`), with optional `&kind=plug|controller|fpp`, `&cols=N`, `&readonly=1`. Wake-lock, fullscreen, clock. Settings → *Kiosk & phone link* builds the URL for you.
* **Auto-recovery watchdog** (background monitor, runs even when no page is open): per device, escalates **1) FPP API restart → 2) SSH command → 3) power-cycle the linked plug**. SSH login is per device or the default (`fpp`/`falcon`). Skipped steps are logged. It only acts while the device is supposed to be powered (inside the plug's **schedule**, or while the plug is on), never cycles a plug that also feeds other devices unless you allow it, and caps power cycles per 24 h. FPP players are also treated as unresponsive when FPPD is stopped or a "playing" playlist stops advancing.
* **Plug schedules** (e.g. road-sign plug and controller plugs at 5:15 pm): optionally switched by the Hub, or "watch only" if FPP/Kasa already switches them.
* All settings live on their own page (Status/Control → *Central Hub Settings*).

## Install
FPP → *Content Setup → Plugin Manager*, install from this URL, or copy `pluginInfo.json`'s `srcURL`:
`https://github.com/baelinc/fpp_Central_Hub`. Then open **Status/Control → Central Hub**, check Settings → Network ranges, and press **Scan**.

## Notes & limits
* Discovery is done by the Hub's server (not your browser), so the FPP must be able to route to every configured network.
* Controller detection is keyword-based on the device's web page (editable in Settings → Detection rules). Unrecognised web devices are listed after a scan so you can add them and then tune a rule.
* Kasa devices using the newer authenticated (KLAP/Tapo) protocol are not supported; the legacy local protocol used by KP401 is.
* If an FPP UI password is set, the kiosk URL is protected by it too. “View-only” hides controls and blocks control requests from the kiosk page; it is a convenience, not a security boundary.
* Verified against simulated devices (FPP API, Kasa XOR protocol over TCP/UDP, Tasmota, ESPixelStick/Kulp pages). Shelly and real-hardware behaviour for the other vendors should be confirmed on your network – please open an issue with any device that is missed.

## Notes on auto-recovery
* SSH uses the device's `ssh` client with `SSH_ASKPASS` (OpenSSH 8.4+). Passwords are stored in plain text in FPP's config folder and never sent back to the browser. Most pixel controllers have no SSH – leave step 2 off for those.
* The monitor is started by `scripts/postStart.sh`, and by the dashboard if it is not running. Test it with `php tests/watchdog_test.php` against `tests/mock_devices.py`.

## Layout
`hub_api.php` JSON API (deliberately not named api.php: FPP auto-loads any plugin api.php into its own REST API) · `lib/` discovery + drivers · `dashboard.php`, `kiosk.php`, `settings.php` pages · `assets/` UI · `tests/` mock devices.

## Author
Johnathan Evans
