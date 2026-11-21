<?php
/** TP-Link Kasa "legacy" local protocol (TCP/UDP 9999, XOR autokey). Works for KP401, KP303, HS103, HS300, EP10, ... */
class HubKasa
{
    public static function encrypt($s)
    {
        $key = 171;
        $out = '';
        $n = strlen($s);
        for ($i = 0; $i < $n; $i++) {
            $key = $key ^ ord($s[$i]);
            $out .= chr($key);
        }
        return $out;
    }

    public static function decrypt($s)
    {
        $key = 171;
        $out = '';
        $n = strlen($s);
        for ($i = 0; $i < $n; $i++) {
            $c = ord($s[$i]);
            $out .= chr($key ^ $c);
            $key = $c;
        }
        return $out;
    }

    /** UDP discovery / bulk status payload (no length header) */
    public static function udpPayload()
    {
        return self::encrypt('{"system":{"get_sysinfo":{}}}');
    }

    public static function parseUdp($data)
    {
        $j = json_decode(self::decrypt($data), true);
        return (is_array($j) && isset($j['system']['get_sysinfo'])) ? $j['system']['get_sysinfo'] : null;
    }

    /** Send a JSON command over TCP, return decoded response array or null. */
    public static function query($ip, array $cmd, $timeoutMs = 2000, $port = 9999)
    {
        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client("tcp://$ip:$port", $errno, $errstr, $timeoutMs / 1000);
        if (!$fp) {
            return null;
        }
        stream_set_timeout($fp, 0, $timeoutMs * 1000);
        $enc = self::encrypt(json_encode($cmd, JSON_UNESCAPED_SLASHES));
        fwrite($fp, pack('N', strlen($enc)) . $enc);
        $hdr = self::readN($fp, 4);
        if ($hdr === null) {
            fclose($fp);
            return null;
        }
        $len = unpack('N', $hdr)[1];
        if ($len < 1 || $len > 65536) {
            fclose($fp);
            return null;
        }
        $body = self::readN($fp, $len);
        fclose($fp);
        if ($body === null) {
            return null;
        }
        $j = json_decode(self::decrypt($body), true);
        return is_array($j) ? $j : null;
    }

    private static function readN($fp, $n)
    {
        $buf = '';
        while (strlen($buf) < $n) {
            $chunk = fread($fp, $n - strlen($buf));
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($fp);
                if ($meta['timed_out'] || feof($fp)) {
                    return null;
                }
                continue;
            }
            $buf .= $chunk;
        }
        return $buf;
    }

    public static function sysinfo($ip, $port = 9999, $timeoutMs = 2000)
    {
        $r = self::query($ip, array('system' => array('get_sysinfo' => new stdClass())), $timeoutMs, $port);
        return ($r && isset($r['system']['get_sysinfo'])) ? $r['system']['get_sysinfo'] : null;
    }

    public static function realtime($ip, $port = 9999, $timeoutMs = 1500)
    {
        $r = self::query($ip, array('emeter' => array('get_realtime' => new stdClass())), $timeoutMs, $port);
        if ($r && isset($r['emeter']['get_realtime']) && empty($r['emeter']['get_realtime']['err_code'])) {
            return $r['emeter']['get_realtime'];
        }
        return null;
    }

    /** $childId: full child id string for multi-outlet strips, or null for single plugs. */
    public static function setRelay($ip, $on, $childId = null, $port = 9999)
    {
        $cmd = array('system' => array('set_relay_state' => array('state' => $on ? 1 : 0)));
        if ($childId !== null && $childId !== '') {
            $cmd = array('context' => array('child_ids' => array($childId))) + $cmd;
        }
        $r = self::query($ip, $cmd, 2500, $port);
        return $r && isset($r['system']['set_relay_state']['err_code']) && (int) $r['system']['set_relay_state']['err_code'] === 0;
    }

    /** Normalise a sysinfo blob to the Hub's plug detail structure. */
    public static function normalise(array $si)
    {
        $outlets = array();
        if (!empty($si['children']) && is_array($si['children'])) {
            foreach ($si['children'] as $i => $c) {
                $outlets[] = array('id' => isset($c['id']) ? $c['id'] : (string) $i, 'name' => isset($c['alias']) ? $c['alias'] : 'Outlet ' . ($i + 1), 'on' => !empty($c['state']));
            }
        } else {
            $outlets[] = array('id' => '', 'name' => isset($si['alias']) ? $si['alias'] : 'Outlet', 'on' => !empty($si['relay_state']));
        }
        return array(
            'model' => isset($si['model']) ? $si['model'] : '',
            'alias' => isset($si['alias']) ? $si['alias'] : '',
            'mac' => isset($si['mac']) ? $si['mac'] : (isset($si['mic_mac']) ? $si['mic_mac'] : ''),
            'rssi' => isset($si['rssi']) ? (int) $si['rssi'] : null,
            'fw' => isset($si['sw_ver']) ? $si['sw_ver'] : '',
            'onTime' => isset($si['on_time']) ? (int) $si['on_time'] : null,
            'outlets' => $outlets,
            'hasEmeter' => !empty($si['feature']) && strpos($si['feature'], 'ENE') !== false,
        );
    }
}
