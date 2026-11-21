# Remote access to the Hub only (not the whole FPP)

Goal: reach the Hub kiosk from a phone away from home without a firewall port-forward and without exposing the rest of FPP.

Two layers:
1. **A path filter on the FPP** (Caddy, port 8088) that only forwards the Hub's kiosk page, its API and its assets. Everything else returns 404.
2. **Tailscale ACL** so the phone can reach only `fpp:8088` (not port 80/22/etc.).

The filter also stamps every request with `X-Hub-Mode: kiosk`. Since v1.1.3 the Hub API treats such requests as *view + device controls only*: no settings, device add/remove, scans, SSH tests, updates, monitor control, reboot/shutdown. Turn on Settings → Kiosk → "Always view-only" to remove controls too.

> Written from the documented behaviour of Tailscale and Caddy; not tested on a real FPP. After setting up, verify the negative cases below.

## 1. Tailscale
```
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Install Tailscale on the phone, same account.

## 2. Caddy filter
```
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CFG'
{
	auto_https off
}
:8088 {
	@hub expression `{http.request.uri.path} == "/plugin.php" && {http.request.uri.query.plugin} == "fpp_Central_Hub" && ({http.request.uri.query.page} in ["kiosk.php", "hub_api.php"] || {http.request.uri.query.file}.startsWith("assets/"))`
	handle @hub {
		reverse_proxy 127.0.0.1:80 {
			header_up X-Hub-Mode kiosk
		}
	}
	handle {
		respond "Not found" 404
	}
}
CFG
sudo systemctl restart caddy
```
(The packaged Caddy listens on port 80 by default; the file above replaces that so it does not fight FPP's web server.)

Kiosk URL on the phone: `http://<fpp-tailscale-name>:8088/plugin.php?plugin=fpp_Central_Hub&page=kiosk.php&nopage=1`

## 3. Tailscale ACL (admin console → Access controls)
Tag the FPP (`tag:fpp`) and phone (`tag:phone`), then allow only:
```
"acls": [{"action": "accept", "src": ["tag:phone"], "dst": ["tag:fpp:8088"]}]
```

## Verify
From the phone (on cellular): the kiosk URL works; `http://<name>:8088/index.php` → 404; `http://<name>/` and `ssh <name>` → blocked by the ACL.

Note "Open FPP / Open dashboard" buttons link to device IPs on your LAN, so they will not work remotely – that is intentional.
