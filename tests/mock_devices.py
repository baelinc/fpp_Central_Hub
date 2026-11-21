#!/usr/bin/env python3
"""Mock FPP / controller / plug devices on 127.0.0.x for local testing (needs root for port 80)."""
import json, socket, struct, threading, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def enc(s):
    k = 171; o = bytearray()
    for c in s.encode():
        k ^= c; o.append(k)
    return bytes(o)
def dec(b):
    k = 171; o = bytearray()
    for c in b:
        o.append(k ^ c); k = c
    return bytes(o).decode()

KASA = {'127.0.0.21': {'alias': 'Roof Plug', 'on': 0}, '127.0.0.22': {'alias': 'Tree Plug', 'on': 1}}
def kasa_info(ip):
    s = KASA[ip]
    return {'system': {'get_sysinfo': {'alias': s['alias'], 'model': 'KP401(US)', 'mac': 'AA:BB:CC:00:00:' + ip.split('.')[-1], 'relay_state': s['on'], 'rssi': -55, 'sw_ver': '1.0.0', 'feature': 'TIM'}}}

def kasa_handle(ip, req):
    if 'set_relay_state' in req.get('system', {}):
        KASA[ip]['on'] = req['system']['set_relay_state']['state']
        return {'system': {'set_relay_state': {'err_code': 0}}}
    return kasa_info(ip)

def kasa_servers(ip):
    def tcp():
        s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind((ip, 9999)); s.listen(5)
        while True:
            c, _ = s.accept()
            try:
                n = struct.unpack('>I', c.recv(4))[0]; data = b''
                while len(data) < n: data += c.recv(n - len(data))
                r = enc(json.dumps(kasa_handle(ip, json.loads(dec(data)))))
                c.sendall(struct.pack('>I', len(r)) + r)
            finally: c.close()
    def udp():
        u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.bind((ip, 9999))
        while True:
            d, a = u.recvfrom(4096)
            u.sendto(enc(json.dumps(kasa_info(ip))), a)
    threading.Thread(target=tcp, daemon=True).start(); threading.Thread(target=udp, daemon=True).start()

STATE = {'playing': False, 'vol': 70}
import base64, time as _t
LIDAR = {'cars': 37}
TEST = {'mode': 'RGBChase', 'subMode': 'RGBChase-RGB', 'cycleMS': 1000, 'colorPattern': 'FF000000FF000000FF', 'enabled': 0, 'channelSet': '1-520', 'channelSetType': 'channelRange'}
def board_csv(since):
    now = int(_t.time()); rows = ['Time,Devices detected,Adjusted']
    for i in range(12, 0, -1):
        t = now - i * 120
        if t >= since: rows.append('%s,%d,%d' % (_t.strftime('%Y-%m-%d %H:%M:%S', _t.localtime(t)), 20 + i % 5, 14 + (i * 3) % 9))
    return '\n'.join(rows) + '\n'
TAS = {'on': False}
def make(ip):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def send(self, body, ct='application/json', code=200, hdr=None):
            b = body.encode() if isinstance(body, str) else body
            self.send_response(code); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(b)))
            for k, v in (hdr or {}).items(): self.send_header(k, v)
            self.end_headers(); self.wfile.write(b)
        def do_POST(self):
            n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n)
            if ip == '127.0.0.51':
                if not self.auth_ok(): return self.send('Login required (user: admin)\n', 'text/plain', 401, {'WWW-Authenticate': 'Basic realm="Christmas Lidar Counter"'})
                if 'X-Requested-With' not in self.headers: return self.send('{"ok":false,"error":"Forbidden"}', code=403)
                c = json.loads(body)
                if c.get('cmd') == 'adjust': LIDAR['cars'] = max(0, LIDAR['cars'] + c.get('delta', 1))
                if c.get('cmd') == 'reset_today': LIDAR['cars'] = 0
                return self.send('{"ok":true,"id":"abc"}')
            if self.path == '/api/testmode':
                TEST.update(json.loads(body)); return self.send('{"status":"OK"}')
            if self.path == '/api/system/volume': STATE['vol'] = json.loads(body)['volume']; return self.send('{"status":"OK"}')
            self.send('{}', code=404)
        def auth_ok(self):
            return self.headers.get('Authorization') == 'Basic ' + base64.b64encode(b'admin:secret').decode()
        def do_GET(self):
            p = self.path
            if ip == '127.0.0.51':   # Christmas Lidar Counter
                if not self.auth_ok(): return self.send('Login required (user: admin)\n', 'text/plain', 401, {'WWW-Authenticate': 'Basic realm="Christmas Lidar Counter", charset="UTF-8"'})
                if p.startswith('/plugin.php') and 'action=status' in p:
                    hrs = [0]*17 + [2, 5, 9, 12, 7, 2, 0]
                    return self.send(json.dumps({'running': True, 'status': {'version': '1.4.0', 'uptime': 5000, 'sensor': {'ok': True, 'error': '', 'distance_cm': 412.5}, 'counting': {'active': True, 'reason': 'show playing'}, 'today': {'date': '2026-11-21', 'total': LIDAR['cars'], 'offhours': 3, 'hours': hrs}, 'season_total': 812, 'test_mode': False, 'fpp_playing': True, 'sync_enabled': True, 'sync': {'last_ok': True, 'message': 'ok'}, 'people': {'enabled': True, 'today': {'people': 88, 'people_peak': 31}}, 'warnings': []}}))
                return self.send('Not found', 'text/plain', 404)
            if ip == '127.0.0.52':   # BaldrickSignals board
                if p.startswith('/turnip_data_log/data'):
                    import urllib.parse as up
                    q = up.parse_qs(up.urlparse(p).query); return self.send(board_csv(int(q.get('from', ['0'])[0])), 'text/csv')
                return self.send('<html><title>Baldrick Signals</title></html>', 'text/html')
            if ip in ('127.0.0.11', '127.0.0.12'):   # FPP (.12 is in remote mode)
                if p == '/api/system/info': return self.send(json.dumps({'HostName': 'MockFPP' if ip.endswith('.11') else 'RemoteFPP', 'Platform': 'Raspberry Pi', 'Variant': 'Pi 4', 'Version': '9.0', 'Branch': 'master', 'Mode': 'player', 'uuid': 'mock-uuid-' + ip[-2:]}))
                if p == '/api/fppd/status': return self.send(json.dumps({'fppd': 'running', 'mode_name': 'player' if ip.endswith('.11') else 'remote', 'status_name': 'playing' if STATE['playing'] else 'idle', 'current_playlist': {'playlist': 'Main Show' if STATE['playing'] else ''}, 'current_sequence': 'jingle.fseq', 'seconds_played': 42, 'seconds_remaining': 118, 'volume': STATE['vol'], 'version': '9.0', 'branch': 'master', 'uptime': '2 days', 'sensors': [{'label': 'CPU', 'valueType': 'Temperature', 'value': 51.2}], 'warnings': [], 'scheduler': {'enabled': 1, 'nextPlaylist': {'playlistName': 'Main Show', 'scheduledStartTimeStr': 'Today @ 17:00'}}}))
                if p.startswith('/api/command/'): STATE['cmds'] = STATE.get('cmds', []) + [p]; return self.send('{"status":"OK"}')
                if p == '/api/models': return self.send(json.dumps([{'Name': 'Roofline', 'StartChannel': 1, 'ChannelCount': 900}, {'Name': 'Mega Tree', 'StartChannel': 901, 'ChannelCount': 1500}, {'Name': 'Unused', 'StartChannel': 0, 'ChannelCount': 10}]))
                if p == '/api/testmode': return self.send(json.dumps(TEST))
                if p == '/api/playlists': return self.send('["Main Show","Kids Show"]')
                if p.startswith('/api/playlist/') and '/start' in p: STATE['playing'] = True; return self.send('{"Status":"OK"}')
                if p == '/api/state': return self.send(json.dumps(STATE))
                if p.startswith('/api/playlists/stop'): STATE['playing'] = False; return self.send('{"Status":"OK"}')
                if p.startswith('/api/system/'): return self.send('{"status":"OK"}')
                if p == '/': return self.send('<title>FPP</title><!-- Falcon Player - FPP -->', 'text/html')
            if ip == '127.0.0.31': return self.send('<html><title>ESPixelStick</title></html>', 'text/html') if p == '/' else self.send('', code=404)
            if ip == '127.0.0.32': return self.send('<html><title>K16A Controller</title><body>Kulp Lights</body></html>', 'text/html') if p == '/' else self.send('', code=404)
            if ip == '127.0.0.33': return self.send('<html><title>Mystery Box</title></html>', 'text/html', hdr={'Server': 'lighttpd'}) if p == '/' else self.send('', code=404)
            if ip == '127.0.0.41':   # Tasmota
                if p.startswith('/cm?cmnd=Power'):
                    TAS['on'] = 'On' in p or '%20On' in p; return self.send(json.dumps({'POWER': 'ON' if TAS['on'] else 'OFF'}))
                if p.startswith('/cm?cmnd=Status'): return self.send(json.dumps({'Status': {'Module': 1, 'FriendlyName': ['Garage Tasmota'], 'Topic': 'g'}, 'StatusFWR': {'Version': '13.0'}, 'StatusNET': {'Hostname': 'garage', 'IPAddress': ip, 'Mac': 'DC:4F:22:00:00:41'}, 'StatusSTS': {'POWER': 'ON' if TAS['on'] else 'OFF', 'Wifi': {'RSSI': 70}}}))
            if ip == '127.0.0.42':   # Shelly gen1
                if p == '/shelly': return self.send(json.dumps({'type': 'SHSW-PM', 'mac': 'AABBCC000042', 'fw': '1.14', 'num_outputs': 1}))
                if p == '/status': return self.send(json.dumps({'relays': [{'ison': False}], 'meters': [{'power': 0.0}]}))
            self.send('nf', 'text/plain', 404)
    return H

if __name__ == '__main__':
    for ip in ['127.0.0.11', '127.0.0.12', '127.0.0.31', '127.0.0.32', '127.0.0.33', '127.0.0.41', '127.0.0.42', '127.0.0.51', '127.0.0.52']:
        srv = ThreadingHTTPServer((ip, 80), make(ip)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    for ip in KASA: kasa_servers(ip)
    print('mock devices up', flush=True)
    threading.Event().wait()
