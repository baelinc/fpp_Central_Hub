<?php
require_once __DIR__ . '/Store.php';
require_once __DIR__ . '/Net.php';
require_once __DIR__ . '/Kasa.php';

/** Device drivers: identification, discovery, status polling and control. */
class HubDrivers
{
    public static function types()
    {
        return array(
            'fpp' => array(
                'fpp' => array('label' => 'Falcon Player (FPP)', 'vendor' => 'Falcon Christmas'),
            ),
            'controller' => array(
                'espixelstick' => array('label' => 'ESPixelStick', 'vendor' => 'Forkineye'),
                'falcon' => array('label' => 'Falcon / Baldrick', 'vendor' => 'Falcon'),
                'kulp' => array('label' => 'Kulp', 'vendor' => 'Kulp Lights'),
                'experience' => array('label' => 'Experience Lights', 'vendor' => 'Experience Lights'),
                'pixel2things' => array('label' => 'Pixel2Things', 'vendor' => 'Pixel2Things'),
                'hanson' => array('label' => 'Hanson Electronics', 'vendor' => 'Hanson Electronics'),
                'wled' => array('label' => 'WLED', 'vendor' => 'WLED'),
                'other' => array('label' => 'Other controller', 'vendor' => ''),
            ),
            'plug' => array(
                'kasa' => array('label' => 'TP-Link Kasa', 'vendor' => 'TP-Link'),
                'tasmota' => array('label' => 'Tasmota', 'vendor' => 'Tasmota'),
                'shelly' => array('label' => 'Shelly', 'vendor' => 'Shelly'),
            ),
        );
    }

    /** Text fingerprints matched (case-insensitive) against the controller's response headers + HTML. Editable in Settings. */
    public static function defaultSignatures()
    {
        return array(
            array('type' => 'espixelstick', 'match' => array('espixelstick', 'esp pixel stick')),
            array('type' => 'wled', 'match' => array('wled')),
            array('type' => 'hanson', 'match' => array('hinkspix', 'hanson electronics', 'hanson')),
            array('type' => 'kulp', 'match' => array('kulp')),
            array('type' => 'experience', 'match' => array('experience lights', 'experiencelights')),
            array('type' => 'pixel2things', 'match' => array('pixel2things', 'pixel 2 things', 'pixel2thing')),
            array('type' => 'falcon', 'match' => array('baldrick', 'falcon pixel', 'f16v4', 'f48', 'f16v3', 'f4v3', 'f4v2', 'falcon')),
        );
    }

    public static function signatures(array $cfg)
    {
        return (!empty($cfg['signatures']) && is_array($cfg['signatures'])) ? $cfg['signatures'] : self::defaultSignatures();
    }

    // ---------------------------------------------------------------- helpers

    public static function host(array $d)
    {
        return !empty($d['local']) ? '127.0.0.1' : $d['ip'];
    }

    public static function base(array $d)
    {
        $port = !empty($d['port']) ? (int) $d['port'] : 80;
        return 'http://' . self::host($d) . ($port == 80 ? '' : ':' . $port);
    }

    private static function opts(array $cfg)
    {
        return array(
            'connect_ms' => (int) $cfg['options']['connectTimeoutMs'],
            'timeout_ms' => (int) $cfg['options']['httpTimeoutMs'],
        );
    }

    private static function jsonBody($res)
    {
        if (!$res || (int) $res['code'] < 200 || (int) $res['code'] >= 300) {
            return null;
        }
        $j = json_decode($res['body'], true);
        return is_array($j) ? $j : null;
    }

    private static function title($body)
    {
        if (preg_match('#<title[^>]*>(.*?)</title>#is', $body, $m)) {
            return trim(preg_replace('/\s+/', ' ', html_entity_decode($m[1], ENT_QUOTES, 'UTF-8')));
        }
        return '';
    }

    // ----------------------------------------------------------- identification

    public static function identFpp($ip, $port, $res)
    {
        $j = self::jsonBody($res);
        if (!$j || !isset($j['HostName'])) {
            return null;
        }
        return array(
            'type' => 'fpp', 'name' => (string) $j['HostName'], 'ip' => $ip, 'port' => $port,
            'uid' => isset($j['uuid']) ? (string) $j['uuid'] : '',
            'model' => trim((isset($j['Variant']) ? $j['Variant'] : '') . ' ' . (isset($j['Platform']) ? $j['Platform'] : '')),
            'extra' => array(
                'version' => isset($j['Version']) ? $j['Version'] : '',
                'branch' => isset($j['Branch']) ? $j['Branch'] : '',
                'mode' => isset($j['Mode']) ? $j['Mode'] : '',
            ),
        );
    }

    /** Returns array(record|null, unmatched|null) */
    public static function identController($ip, $port, $res, array $sigs)
    {
        if (!$res || (int) $res['code'] < 100) {
            return array(null, null);
        }
        $hay = strtolower($res['headers'] . "\n" . $res['body']);
        if (strpos($hay, 'falcon player') !== false) {
            return array(null, null); // an FPP instance, handled by the FPP scan
        }
        $title = self::title($res['body']);
        $types = self::types();
        foreach ($sigs as $sig) {
            if (empty($sig['type']) || empty($sig['match'])) {
                continue;
            }
            foreach ((array) $sig['match'] as $m) {
                if ($m !== '' && strpos($hay, strtolower($m)) !== false) {
                    $t = $sig['type'];
                    $label = isset($types['controller'][$t]) ? $types['controller'][$t]['label'] : $t;
                    $last = substr(strrchr($ip, '.'), 1);
                    $name = ($title !== '' && strlen($title) <= 40 && strcasecmp($title, 'index') !== 0) ? $title : ($label . ' .' . $last);
                    return array(array('type' => $t, 'name' => $name, 'ip' => $ip, 'port' => $port, 'uid' => '', 'model' => '', 'extra' => array('title' => $title)), null);
                }
            }
        }
        $server = '';
        if (preg_match('/^Server:\s*(.+)$/mi', $res['headers'], $m)) {
            $server = trim($m[1]);
        }
        return array(null, array('ip' => $ip, 'port' => $port, 'title' => $title, 'server' => $server, 'code' => (int) $res['code']));
    }

    public static function identKasa($ip, $port, array $si)
    {
        $n = HubKasa::normalise($si);
        return array(
            'type' => 'kasa', 'name' => $n['alias'] !== '' ? $n['alias'] : ('Kasa ' . $n['model']), 'ip' => $ip, 'port' => $port,
            'uid' => $n['mac'], 'model' => $n['model'], 'extra' => array('outlets' => count($n['outlets']), 'fw' => $n['fw']),
        );
    }

    public static function identTasmota($ip, $port, $res)
    {
        $j = self::jsonBody($res);
        if (!$j || !isset($j['StatusFWR']) || !isset($j['Status'])) {
            return null;
        }
        $fn = isset($j['Status']['FriendlyName']) ? (array) $j['Status']['FriendlyName'] : array();
        $mac = isset($j['StatusNET']['Mac']) ? $j['StatusNET']['Mac'] : '';
        return array(
            'type' => 'tasmota', 'name' => !empty($fn[0]) ? $fn[0] : (isset($j['StatusNET']['Hostname']) ? $j['StatusNET']['Hostname'] : 'Tasmota'),
            'ip' => $ip, 'port' => $port, 'uid' => $mac, 'model' => '',
            'extra' => array('fw' => isset($j['StatusFWR']['Version']) ? $j['StatusFWR']['Version'] : ''),
        );
    }

    public static function identShelly($ip, $port, $res)
    {
        $j = self::jsonBody($res);
        if (!$j || !isset($j['mac'])) {
            return null;
        }
        // Gen1: {"type":"SHSW-1","mac":..,"num_outputs":1}   Gen2+: {"id":"shellyplus1-..","gen":2,"model":"SNSW-001X16EU",..}
        $isGen1 = isset($j['type']) && preg_match('/^SH[A-Z0-9-]+/i', (string) $j['type']);
        $isGen2 = isset($j['gen']) && (int) $j['gen'] >= 2 && (isset($j['model']) || isset($j['app']) || isset($j['id']));
        if (!$isGen1 && !$isGen2) {
            return null;
        }
        $gen = isset($j['gen']) ? (int) $j['gen'] : 1;
        $model = isset($j['model']) ? $j['model'] : (isset($j['type']) ? $j['type'] : '');
        $name = !empty($j['name']) ? $j['name'] : ('Shelly ' . $model);
        return array(
            'type' => 'shelly', 'name' => $name, 'ip' => $ip, 'port' => $port, 'uid' => $j['mac'], 'model' => $model,
            'extra' => array('gen' => $gen, 'fw' => isset($j['fw']) ? $j['fw'] : (isset($j['ver']) ? $j['ver'] : '')),
        );
    }

    // ---------------------------------------------------------------- discovery

    /** Addresses fppd already knows from multicast MultiSync discovery (only works when running on an FPP). */
    public static function multisyncAddresses()
    {
        $out = array();
        $r = HubNet::http('http://127.0.0.1/api/fppd/multiSyncSystems', 'GET', null, 1500);
        $j = self::jsonBody($r);
        if ($j) {
            $list = isset($j['systems']) ? $j['systems'] : $j;
            if (is_array($list)) {
                foreach ($list as $s) {
                    if (is_array($s) && !empty($s['address']) && filter_var($s['address'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                        $out[] = $s['address'];
                    }
                }
            }
        }
        return array_values(array_unique($out));
    }

    /** returns array('found'=>[], 'unmatched'=>[], 'scanned'=>int) */
    public static function scan(array $cfg, $kind, array $ips)
    {
        $found = array();
        $unmatched = array();
        $o = self::opts($cfg);
        $local = HubNet::localIp();

        if ($kind === 'fpp') {
            $extra = self::multisyncAddresses();
            $targets = array_values(array_unique(array_merge($ips, $extra)));
            $reqs = array();
            foreach ($targets as $ip) {
                $reqs[$ip] = array('url' => "http://$ip/api/system/info") + $o;
            }
            foreach (HubNet::multi($reqs, 128) as $ip => $res) {
                $rec = self::identFpp($ip, 80, $res);
                if ($rec) {
                    if ($local !== '' && $ip === $local) {
                        $rec['local'] = true;
                    }
                    $found[] = $rec;
                }
            }
            return array('found' => $found, 'unmatched' => array(), 'scanned' => count($targets));
        }

        if ($kind === 'controller') {
            $sigs = self::signatures($cfg);
            $reqs = array();
            foreach ($ips as $ip) {
                $reqs[$ip] = array('url' => "http://$ip/", 'max' => 32768) + $o;
            }
            foreach (HubNet::multi($reqs, 128) as $ip => $res) {
                list($rec, $un) = self::identController($ip, 80, $res, $sigs);
                if ($rec) {
                    $found[] = $rec;
                } elseif ($un) {
                    $unmatched[] = $un;
                }
            }
            return array('found' => $found, 'unmatched' => $unmatched, 'scanned' => count($ips));
        }

        if ($kind === 'plug') {
            // Kasa: one UDP socket, unicast to every host in range (works across routed subnets)
            $kasaSeen = array();
            foreach (HubNet::udpSweep($ips, 9999, HubKasa::udpPayload(), 1500) as $ip => $data) {
                $si = HubKasa::parseUdp($data);
                if ($si) {
                    $found[] = self::identKasa($ip, 9999, $si);
                    $kasaSeen[$ip] = true;
                }
            }
            // Tasmota + Shelly over HTTP
            $reqs = array();
            foreach ($ips as $ip) {
                if (isset($kasaSeen[$ip])) {
                    continue;
                }
                $reqs["t|$ip"] = array('url' => "http://$ip/cm?cmnd=Status%200") + $o;
                $reqs["s|$ip"] = array('url' => "http://$ip/shelly") + $o;
            }
            foreach (HubNet::multi($reqs, 128) as $key => $res) {
                list($t, $ip) = explode('|', $key, 2);
                $rec = $t === 't' ? self::identTasmota($ip, 80, $res) : self::identShelly($ip, 80, $res);
                if ($rec) {
                    $found[] = $rec;
                }
            }
            return array('found' => $found, 'unmatched' => array(), 'scanned' => count($ips));
        }
        return array('found' => array(), 'unmatched' => array(), 'scanned' => 0);
    }

    /** Identify a single host (manual add / "test connection"). */
    public static function probe(array $cfg, $kind, $ip, $port)
    {
        $o = self::opts($cfg);
        $port = $port ? (int) $port : 80;
        $host = $port == 80 ? $ip : "$ip:$port";
        if ($kind === 'fpp') {
            $r = HubNet::http("http://$host/api/system/info", 'GET', null, $o['timeout_ms']);
            return array(self::identFpp($ip, $port, $r), $r['code'] > 0);
        }
        if ($kind === 'controller') {
            $r = HubNet::http("http://$host/", 'GET', null, $o['timeout_ms']);
            list($rec, $un) = self::identController($ip, $port, $r, self::signatures($cfg));
            return array($rec, $r['code'] > 0);
        }
        if ($kind === 'plug') {
            $kp = $port == 80 ? 9999 : $port;
            $si = HubKasa::sysinfo($ip, 9999, $o['timeout_ms']);
            if ($si) {
                return array(self::identKasa($ip, 9999, $si), true);
            }
            $rs = HubNet::multi(array(
                't' => array('url' => "http://$host/cm?cmnd=Status%200") + $o,
                's' => array('url' => "http://$host/shelly") + $o,
            ), 2);
            $rec = self::identTasmota($ip, $port, $rs['t']);
            if (!$rec) {
                $rec = self::identShelly($ip, $port, $rs['s']);
            }
            return array($rec, $rs['t']['code'] > 0 || $rs['s']['code'] > 0);
        }
        return array(null, false);
    }

    // ------------------------------------------------------------------- status

    private static function fppDetail(array $j)
    {
        $temp = null;
        if (!empty($j['sensors']) && is_array($j['sensors'])) {
            foreach ($j['sensors'] as $s) {
                if (isset($s['valueType']) && $s['valueType'] === 'Temperature' && isset($s['value'])) {
                    $temp = $temp === null ? (float) $s['value'] : max($temp, (float) $s['value']);
                }
            }
        }
        $pl = isset($j['current_playlist']) && is_array($j['current_playlist']) ? $j['current_playlist'] : array();
        $sch = isset($j['scheduler']) && is_array($j['scheduler']) ? $j['scheduler'] : array();
        $next = isset($sch['nextPlaylist']) && is_array($sch['nextPlaylist']) ? $sch['nextPlaylist'] : array();
        return array(
            'fppd' => !isset($j['fppd']) || $j['fppd'] === 'running',
            'mode' => isset($j['mode_name']) ? $j['mode_name'] : '',
            'state' => isset($j['status_name']) ? $j['status_name'] : '',
            'playlist' => isset($pl['playlist']) ? $pl['playlist'] : '',
            'sequence' => isset($j['current_sequence']) ? $j['current_sequence'] : '',
            'song' => isset($j['current_song']) ? $j['current_song'] : '',
            'elapsed' => isset($j['seconds_played']) ? (int) $j['seconds_played'] : null,
            'remaining' => isset($j['seconds_remaining']) ? (int) $j['seconds_remaining'] : null,
            'volume' => isset($j['volume']) ? (int) $j['volume'] : null,
            'version' => isset($j['version']) ? $j['version'] : '',
            'branch' => isset($j['branch']) ? $j['branch'] : '',
            'uptime' => isset($j['uptime']) ? $j['uptime'] : '',
            'temp' => $temp,
            'warnings' => isset($j['warnings']) && is_array($j['warnings']) ? count($j['warnings']) : 0,
            'schedEnabled' => isset($sch['enabled']) ? (bool) $sch['enabled'] : null,
            'nextName' => isset($next['playlistName']) ? $next['playlistName'] : '',
            'nextTime' => isset($next['scheduledStartTimeStr']) ? $next['scheduledStartTimeStr'] : '',
        );
    }

    private static function plugDetailTasmota(array $j)
    {
        $sts = isset($j['StatusSTS']) ? $j['StatusSTS'] : $j;
        $outlets = array();
        foreach ($sts as $k => $v) {
            if (preg_match('/^POWER(\d*)$/', $k, $m)) {
                $outlets[] = array('id' => $m[1], 'name' => $m[1] === '' ? 'Outlet' : 'Outlet ' . $m[1], 'on' => strtoupper((string) $v) === 'ON');
            }
        }
        $pow = null;
        if (isset($j['StatusSNS']['ENERGY']['Power'])) {
            $pow = (float) $j['StatusSNS']['ENERGY']['Power'];
        }
        return array('outlets' => $outlets, 'power' => $pow, 'model' => '',
            'rssi' => isset($sts['Wifi']['RSSI']) ? (int) $sts['Wifi']['RSSI'] : null, 'fw' => isset($j['StatusFWR']['Version']) ? $j['StatusFWR']['Version'] : '');
    }

    private static function plugDetailShelly(array $d, array $j)
    {
        $outlets = array();
        $pow = null;
        if (isset($d['extra']['gen']) && (int) $d['extra']['gen'] >= 2) {
            foreach ($j as $k => $v) {
                if (preg_match('/^switch:(\d+)$/', $k, $m)) {
                    $outlets[] = array('id' => $m[1], 'name' => 'Outlet ' . ($m[1] + 1), 'on' => !empty($v['output']));
                    if (isset($v['apower'])) {
                        $pow = ($pow === null ? 0 : $pow) + (float) $v['apower'];
                    }
                }
            }
        } else {
            if (!empty($j['relays'])) {
                foreach ($j['relays'] as $i => $r) {
                    $outlets[] = array('id' => (string) $i, 'name' => 'Outlet ' . ($i + 1), 'on' => !empty($r['ison']));
                }
            }
            if (!empty($j['meters'][0]['power'])) {
                $pow = (float) $j['meters'][0]['power'];
            }
        }
        return array('outlets' => $outlets, 'power' => $pow, 'model' => isset($d['model']) ? $d['model'] : '', 'rssi' => isset($j['wifi_sta']['rssi']) ? (int) $j['wifi_sta']['rssi'] : (isset($j['sys']['wifi']['rssi']) ? 0 : null), 'fw' => '');
    }

    private static function finishPlug(array $detail)
    {
        $any = false;
        $all = true;
        foreach ($detail['outlets'] as $o) {
            $any = $any || $o['on'];
            $all = $all && $o['on'];
        }
        $detail['state'] = !$detail['outlets'] ? null : ($all ? 'on' : ($any ? 'mixed' : 'off'));
        return $detail;
    }

    /** Poll devices (all, or those whose ids are given). Returns id => array(online, ms, detail, error?) */
    public static function statusAll(array $cfg, $ids = null)
    {
        $o = self::opts($cfg);
        $devs = array();
        foreach ($cfg['devices'] as $d) {
            if ($ids === null || in_array($d['id'], $ids, true)) {
                $devs[$d['id']] = $d;
            }
        }
        $reqs = array();
        $kasa = array();
        foreach ($devs as $id => $d) {
            $b = self::base($d);
            if ($d['kind'] === 'fpp') {
                $reqs[$id] = array('url' => $b . '/api/fppd/status') + $o;
            } elseif ($d['kind'] === 'controller') {
                $reqs[$id] = $d['type'] === 'wled'
                    ? array('url' => $b . '/json/info') + $o
                    : array('url' => $b . '/', 'max' => 4096) + $o;
            } elseif ($d['kind'] === 'plug') {
                if ($d['type'] === 'kasa') {
                    $kasa[$id] = $d;
                } elseif ($d['type'] === 'tasmota') {
                    $reqs[$id] = array('url' => $b . '/cm?cmnd=Status%200') + $o;
                } elseif ($d['type'] === 'shelly') {
                    $gen2 = isset($d['extra']['gen']) && (int) $d['extra']['gen'] >= 2;
                    $reqs[$id] = array('url' => $b . ($gen2 ? '/rpc/Shelly.GetStatus' : '/status')) + $o;
                }
            }
        }
        $res = HubNet::multi($reqs, 64);

        // FPP: when fppd is down the web UI may still be up
        $retry = array();
        foreach ($res as $id => $r) {
            if ($devs[$id]['kind'] === 'fpp' && !self::jsonBody($r)) {
                $retry[$id] = array('url' => self::base($devs[$id]) . '/api/system/info') + $o;
            }
        }
        $res2 = $retry ? HubNet::multi($retry, 32) : array();

        $out = array();
        foreach ($devs as $id => $d) {
            if (!isset($res[$id])) {
                continue;
            }
            $r = $res[$id];
            $st = array('online' => false, 'ms' => null, 'detail' => new stdClass());
            if ($d['kind'] === 'fpp') {
                $j = self::jsonBody($r);
                if ($j) {
                    $st = array('online' => true, 'ms' => $r['ms'], 'detail' => self::fppDetail($j));
                } elseif (isset($res2[$id]) && self::jsonBody($res2[$id])) {
                    $st = array('online' => true, 'ms' => $res2[$id]['ms'], 'detail' => array('fppd' => false, 'state' => 'fppd stopped'));
                }
            } elseif ($d['kind'] === 'controller') {
                if ($r['code'] > 0) {
                    $det = array('title' => self::title($r['body']), 'http' => $r['code']);
                    if ($d['type'] === 'wled' && ($j = self::jsonBody($r))) {
                        $det['leds'] = isset($j['leds']['count']) ? $j['leds']['count'] : null;
                        $det['fps'] = isset($j['leds']['fps']) ? $j['leds']['fps'] : null;
                        $det['version'] = isset($j['ver']) ? $j['ver'] : '';
                        $det['uptime'] = isset($j['uptime']) ? (int) $j['uptime'] : null;
                        $det['rssi'] = isset($j['wifi']['rssi']) ? (int) $j['wifi']['rssi'] : null;
                    }
                    $st = array('online' => true, 'ms' => $r['ms'], 'detail' => $det);
                }
            } elseif ($d['type'] === 'tasmota') {
                $j = self::jsonBody($r);
                if ($j) {
                    $st = array('online' => true, 'ms' => $r['ms'], 'detail' => self::finishPlug(self::plugDetailTasmota($j)));
                }
            } elseif ($d['type'] === 'shelly') {
                $j = self::jsonBody($r);
                if ($j) {
                    $st = array('online' => true, 'ms' => $r['ms'], 'detail' => self::finishPlug(self::plugDetailShelly($d, $j)));
                }
            }
            $out[$id] = $st;
        }

        // Kasa: bulk UDP sweep, TCP fallback for stragglers
        if ($kasa) {
            $ips = array();
            foreach ($kasa as $d) {
                $ips[] = $d['ip'];
            }
            $t0 = microtime(true);
            $udp = HubNet::udpSweep($ips, 9999, HubKasa::udpPayload(), 900);
            $ms = (int) round((microtime(true) - $t0) * 1000);
            foreach ($kasa as $id => $d) {
                $si = isset($udp[$d['ip']]) ? HubKasa::parseUdp($udp[$d['ip']]) : null;
                if (!$si) {
                    $si = HubKasa::sysinfo($d['ip'], 9999, 1200);
                }
                if ($si) {
                    $det = HubKasa::normalise($si);
                    $out[$id] = array('online' => true, 'ms' => null, 'detail' => self::finishPlug($det));
                } else {
                    $out[$id] = array('online' => false, 'ms' => null, 'detail' => new stdClass());
                }
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ actions

    private static function fppGet(array $cfg, array $d, $path, $method = 'GET', $body = null)
    {
        $o = self::opts($cfg);
        return HubNet::http(self::base($d) . $path, $method, $body, max(6000, $o['timeout_ms']), $body !== null ? array('Content-Type: application/json') : array());
    }

    /** returns array(ok(bool), msg(string), data(mixed)) */
    public static function act(array $cfg, array $d, $cmd, array $args)
    {
        if ($d['kind'] === 'fpp') {
            return self::actFpp($cfg, $d, $cmd, $args);
        }
        if ($d['kind'] === 'plug') {
            return self::actPlug($cfg, $d, $cmd, $args);
        }
        if ($d['kind'] === 'controller' && $d['type'] === 'wled') {
            $b = self::base($d);
            if ($cmd === 'toggle') {
                $r = HubNet::http($b . '/json/state', 'POST', '{"on":"t"}', 4000, array('Content-Type: application/json'));
                return array($r['code'] == 200, $r['code'] == 200 ? 'Toggled' : 'WLED did not respond', null);
            }
            if ($cmd === 'brightness') {
                $v = max(1, min(255, (int) (isset($args['value']) ? $args['value'] : 128)));
                $r = HubNet::http($b . '/json/state', 'POST', json_encode(array('bri' => $v)), 4000, array('Content-Type: application/json'));
                return array($r['code'] == 200, 'Brightness ' . $v, null);
            }
        }
        return array(false, 'This device does not support that action', null);
    }

    private static function actFpp(array $cfg, array $d, $cmd, array $args)
    {
        switch ($cmd) {
            case 'playlists':
                $r = self::fppGet($cfg, $d, '/api/playlists');
                $j = self::jsonBody($r);
                if ($j === null) {
                    return array(false, 'Could not load playlists', array());
                }
                $names = array();
                foreach ($j as $p) {
                    $names[] = is_array($p) ? (isset($p['name']) ? $p['name'] : '') : (string) $p;
                }
                $names = array_values(array_filter($names, 'strlen'));
                return array(true, '', $names);
            case 'start':
                $n = isset($args['playlist']) ? (string) $args['playlist'] : '';
                if ($n === '') {
                    return array(false, 'Choose a playlist first', null);
                }
                $path = '/api/playlist/' . rawurlencode($n) . '/start' . (!empty($args['repeat']) ? '/true' : '');
                $r = self::fppGet($cfg, $d, $path);
                return array($r['code'] >= 200 && $r['code'] < 300, 'Started ' . $n, null);
            case 'stop':
                $r = self::fppGet($cfg, $d, '/api/playlists/stop');
                return array($r['code'] >= 200 && $r['code'] < 300, 'Stopped', null);
            case 'stopgraceful':
                $r = self::fppGet($cfg, $d, '/api/playlists/stopgracefully');
                return array($r['code'] >= 200 && $r['code'] < 300, 'Stopping gracefully', null);
            case 'stoploop':
                $r = self::fppGet($cfg, $d, '/api/playlists/stopgracefullyafterloop');
                return array($r['code'] >= 200 && $r['code'] < 300, 'Will stop after this loop', null);
            case 'volume':
                $v = max(0, min(100, (int) (isset($args['value']) ? $args['value'] : 0)));
                $r = self::fppGet($cfg, $d, '/api/system/volume', 'POST', json_encode(array('volume' => $v)));
                return array($r['code'] >= 200 && $r['code'] < 300, 'Volume ' . $v . '%', null);
            case 'restart_fppd':
                $r = self::fppGet($cfg, $d, '/api/system/fppd/restart');
                return array($r['code'] >= 200 && $r['code'] < 300, 'Restarting FPPD', null);
            case 'reboot':
                $r = self::fppGet($cfg, $d, '/api/system/reboot');
                return array($r['code'] >= 200 && $r['code'] < 300, 'Rebooting', null);
            case 'shutdown':
                $r = self::fppGet($cfg, $d, '/api/system/shutdown');
                return array($r['code'] >= 200 && $r['code'] < 300, 'Shutting down', null);
        }
        return array(false, 'Unknown FPP command', null);
    }

    private static function actPlug(array $cfg, array $d, $cmd, array $args)
    {
        if (!in_array($cmd, array('on', 'off', 'toggle'), true)) {
            return array(false, 'Unknown plug command', null);
        }
        $outlet = isset($args['outlet']) ? (string) $args['outlet'] : '*';
        $stAll = self::statusAll($cfg, array($d['id']));
        $st = isset($stAll[$d['id']]) ? $stAll[$d['id']] : null;
        if (!$st || !$st['online']) {
            return array(false, 'Plug is offline', null);
        }
        $outlets = $st['detail']['outlets'];
        $targets = array();
        foreach ($outlets as $o) {
            if ($outlet === '*' || (string) $o['id'] === $outlet) {
                $targets[] = $o;
            }
        }
        if (!$targets) {
            return array(false, 'Outlet not found', null);
        }
        $ok = true;
        $b = self::base($d);
        foreach ($targets as $o) {
            $want = $cmd === 'toggle' ? !$o['on'] : ($cmd === 'on');
            if ($d['type'] === 'kasa') {
                $ok = HubKasa::setRelay($d['ip'], $want, $o['id'], (int) $d['port'] ?: 9999) && $ok;
            } elseif ($d['type'] === 'tasmota') {
                $r = HubNet::http($b . '/cm?cmnd=' . rawurlencode('Power' . $o['id'] . ' ' . ($want ? 'On' : 'Off')), 'GET', null, 4000);
                $ok = $r['code'] == 200 && $ok;
            } elseif ($d['type'] === 'shelly') {
                if (isset($d['extra']['gen']) && (int) $d['extra']['gen'] >= 2) {
                    $r = HubNet::http($b . '/rpc/Switch.Set?id=' . (int) $o['id'] . '&on=' . ($want ? 'true' : 'false'), 'GET', null, 4000);
                } else {
                    $r = HubNet::http($b . '/relay/' . (int) $o['id'] . '?turn=' . ($want ? 'on' : 'off'), 'GET', null, 4000);
                }
                $ok = $r['code'] == 200 && $ok;
            }
        }
        usleep(150000);
        $new = self::statusAll($cfg, array($d['id']));
        return array($ok, $ok ? 'Done' : 'The plug did not accept the command', isset($new[$d['id']]) ? $new[$d['id']] : null);
    }
}
