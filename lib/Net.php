<?php
/** Networking helpers: range parsing, parallel HTTP, UDP sweeps. */
class HubNet
{
    const MAX_HOSTS = 4096;

    /** Expand one range expression to a list of IPv4 strings. Throws on bad input. */
    public static function expandRange($s)
    {
        $s = trim($s);
        if ($s === '') {
            return array();
        }
        // CIDR
        if (preg_match('#^(\d{1,3}(?:\.\d{1,3}){3})/(\d{1,2})$#', $s, $m)) {
            $ip = ip2long($m[1]);
            $bits = (int) $m[2];
            if ($ip === false || $bits < 16 || $bits > 32) {
                throw new Exception("Unsupported CIDR '$s' (prefix must be /16 to /32)");
            }
            $mask = $bits == 0 ? 0 : (~((1 << (32 - $bits)) - 1)) & 0xFFFFFFFF;
            $net = $ip & $mask;
            $bcast = $net | (~$mask & 0xFFFFFFFF);
            $out = array();
            if ($bits >= 31) {
                for ($i = $net; $i <= $bcast; $i++) {
                    $out[] = long2ip($i);
                }
            } else {
                for ($i = $net + 1; $i < $bcast; $i++) {
                    $out[] = long2ip($i);
                }
            }
            return $out;
        }
        // a.b.c.d-e   or   a.b.c.d-w.x.y.z
        if (preg_match('#^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){0,3})$#', $s, $m)) {
            $a = ip2long($m[1]);
            $endStr = $m[2];
            if (strpos($endStr, '.') === false) {
                $parts = explode('.', $m[1]);
                $parts[3] = $endStr;
                $endStr = implode('.', $parts);
            }
            $b = ip2long($endStr);
            if ($a === false || $b === false || $b < $a) {
                throw new Exception("Bad range '$s'");
            }
            if ($b - $a + 1 > self::MAX_HOSTS) {
                throw new Exception("Range '$s' is larger than " . self::MAX_HOSTS . ' hosts');
            }
            $out = array();
            for ($i = $a; $i <= $b; $i++) {
                $out[] = long2ip($i);
            }
            return $out;
        }
        // wildcards: 192.168.1.X / 192.168.*.* / 192.168.1.x
        if (preg_match('#^[0-9xX*]{1,3}(\.[0-9xX*]{1,3}){3}$#', $s)) {
            $oct = explode('.', $s);
            $sets = array();
            $total = 1;
            foreach ($oct as $i => $o) {
                if ($o === 'x' || $o === 'X' || $o === '*') {
                    $sets[] = $i == 3 ? range(1, 254) : range(0, 255);
                } else {
                    if ((int) $o > 255) {
                        throw new Exception("Bad address '$s'");
                    }
                    $sets[] = array((int) $o);
                }
                $total *= count($sets[$i]);
            }
            if ($total > self::MAX_HOSTS) {
                throw new Exception("Range '$s' is larger than " . self::MAX_HOSTS . ' hosts');
            }
            $out = array();
            foreach ($sets[0] as $a) {
                foreach ($sets[1] as $b) {
                    foreach ($sets[2] as $c) {
                        foreach ($sets[3] as $d) {
                            $out[] = "$a.$b.$c.$d";
                        }
                    }
                }
            }
            return $out;
        }
        throw new Exception("Unrecognised range '$s'. Use 192.168.1.0/24, 192.168.1.10-50 or 192.168.1.X");
    }

    public static function expandRanges(array $list)
    {
        $all = array();
        foreach ($list as $r) {
            foreach (self::expandRange($r) as $ip) {
                $all[$ip] = true;
            }
        }
        $ips = array_keys($all);
        if (count($ips) > self::MAX_HOSTS) {
            throw new Exception('Too many hosts (' . count($ips) . ') - limit is ' . self::MAX_HOSTS);
        }
        return $ips;
    }

    public static function validIp($ip)
    {
        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false
            || preg_match('/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/', $ip);
    }

    /** IPv4 subnets this host sits on, as CIDR strings. */
    public static function localSubnets()
    {
        $out = array();
        $o = @shell_exec('ip -o -4 addr show 2>/dev/null');
        if ($o) {
            foreach (explode("\n", $o) as $line) {
                if (preg_match('#inet (\d+\.\d+\.\d+\.\d+)/(\d+)#', $line, $m)) {
                    if (strpos($m[1], '127.') === 0 || strpos($m[1], '169.254.') === 0) {
                        continue;
                    }
                    $bits = max(16, min(24, (int) $m[2]));
                    $mask = (~((1 << (32 - $bits)) - 1)) & 0xFFFFFFFF;
                    $out[long2ip(ip2long($m[1]) & $mask) . '/' . $bits] = true;
                }
            }
        }
        if (!$out && !empty($_SERVER['SERVER_ADDR']) && filter_var($_SERVER['SERVER_ADDR'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $p = explode('.', $_SERVER['SERVER_ADDR']);
            $out["$p[0].$p[1].$p[2].0/24"] = true;
        }
        return array_keys($out);
    }

    public static function localIp()
    {
        if (!empty($_SERVER['SERVER_ADDR']) && filter_var($_SERVER['SERVER_ADDR'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)
            && strpos($_SERVER['SERVER_ADDR'], '127.') !== 0) {
            return $_SERVER['SERVER_ADDR'];
        }
        $o = @shell_exec("hostname -I 2>/dev/null");
        if ($o && preg_match('/(\d+\.\d+\.\d+\.\d+)/', $o, $m)) {
            return $m[1];
        }
        return '';
    }

    /**
     * Run many HTTP requests concurrently.
     * $reqs: key => array(url, method?, body?, headers?, timeout_ms?, connect_ms?, max?)
     * returns key => array(code, ms, body, headers, err)
     */
    public static function multi(array $reqs, $concurrency = 96)
    {
        $out = array();
        if (!$reqs) {
            return $out;
        }
        $mh = curl_multi_init();
        $pending = array_keys($reqs);
        $live = array();   // (int)handle => array(key, ch)
        $bufs = array();
        $hdrs = array();
        do {
            while ($pending && count($live) < $concurrency) {
                $k = array_shift($pending);
                $r = $reqs[$k];
                $bufs[$k] = '';
                $hdrs[$k] = '';
                $ch = self::makeHandle($r, $bufs[$k], $hdrs[$k]);
                curl_multi_add_handle($mh, $ch);
                $live[(int) $ch] = array($k, $ch);
            }
            do {
                $st = curl_multi_exec($mh, $running);
            } while ($st === CURLM_CALL_MULTI_PERFORM);
            if ($running) {
                curl_multi_select($mh, 0.05);
            }
            while ($info = curl_multi_info_read($mh)) {
                $ch = $info['handle'];
                list($k, ) = $live[(int) $ch];
                $out[$k] = array(
                    'code' => (int) curl_getinfo($ch, CURLINFO_HTTP_CODE),
                    'ms' => (int) round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000),
                    'body' => $bufs[$k],
                    'headers' => $hdrs[$k],
                    'err' => $info['result'] === 0 ? '' : curl_error($ch),
                );
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
                unset($live[(int) $ch], $bufs[$k], $hdrs[$k]);
            }
        } while ($pending || $live);
        curl_multi_close($mh);
        return $out;
    }

    private static function makeHandle(array $r, &$buf, &$hdr)
    {
        $max = isset($r['max']) ? (int) $r['max'] : 65536;
        $ch = curl_init($r['url']);
        $opt = array(
            CURLOPT_NOSIGNAL => 1,
            CURLOPT_TIMEOUT_MS => isset($r['timeout_ms']) ? (int) $r['timeout_ms'] : 2500,
            CURLOPT_CONNECTTIMEOUT_MS => isset($r['connect_ms']) ? (int) $r['connect_ms'] : 800,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_USERAGENT => 'FPP-Central-Hub/' . HubStore::VERSION,
            CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$hdr) {
                if (strlen($hdr) < 8192) {
                    $hdr .= $h;
                }
                return strlen($h);
            },
            CURLOPT_WRITEFUNCTION => function ($c, $d) use (&$buf, $max) {
                $buf .= $d;
                return strlen($buf) > $max ? -1 : strlen($d);
            },
        );
        $method = isset($r['method']) ? strtoupper($r['method']) : 'GET';
        if ($method === 'POST' || $method === 'PUT') {
            $opt[CURLOPT_CUSTOMREQUEST] = $method;
            $opt[CURLOPT_POSTFIELDS] = isset($r['body']) ? $r['body'] : '';
        }
        $h = isset($r['headers']) ? $r['headers'] : array();
        if ($h) {
            $opt[CURLOPT_HTTPHEADER] = $h;
        }
        curl_setopt_array($ch, $opt);
        return $ch;
    }

    public static function http($url, $method = 'GET', $body = null, $timeoutMs = 2500, $headers = array())
    {
        $req = array('url' => $url, 'method' => $method, 'timeout_ms' => $timeoutMs, 'headers' => $headers);
        if ($body !== null) {
            $req['body'] = $body;
        }
        $r = self::multi(array('x' => $req), 1);
        return $r['x'];
    }

    /** Send one UDP datagram to many hosts from one socket and gather replies. ip => payload */
    public static function udpSweep(array $ips, $port, $payload, $waitMs = 1200)
    {
        $res = array();
        $errno = 0;
        $errstr = '';
        $sock = @stream_socket_server('udp://0.0.0.0:0', $errno, $errstr, STREAM_SERVER_BIND);
        if (!$sock) {
            return $res;
        }
        stream_set_blocking($sock, false);
        $n = 0;
        foreach ($ips as $ip) {
            @stream_socket_sendto($sock, $payload, 0, "$ip:$port");
            if ((++$n % 64) == 0) {
                usleep(2000);
            }
        }
        $end = microtime(true) + $waitMs / 1000;
        while (($left = $end - microtime(true)) > 0) {
            $r = array($sock);
            $w = null;
            $e = null;
            $sec = (int) floor($left);
            $usec = (int) (($left - $sec) * 1e6);
            if (@stream_select($r, $w, $e, $sec, $usec) < 1) {
                break;
            }
            $peer = '';
            $data = @stream_socket_recvfrom($sock, 65535, 0, $peer);
            if ($data !== false && $data !== '' && $peer) {
                $ip = substr($peer, 0, strrpos($peer, ':'));
                $res[$ip] = $data;
            }
        }
        fclose($sock);
        return $res;
    }
}
