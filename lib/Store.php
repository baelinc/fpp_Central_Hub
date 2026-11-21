<?php
/**
 * FPP Central Hub - configuration + runtime state storage.
 *
 * Config lives in FPP's config directory (survives plugin updates):
 *   <configDirectory>/fpp_Central_Hub.json        (devices, ranges, options, scenes)
 *   <configDirectory>/fpp_Central_Hub.state.json  (online/offline history, event log)
 */
class HubStore
{
    const VERSION = '1.0.1';

    public static function dir()
    {
        global $settings;
        $env = getenv('HUB_DATA_DIR');
        if ($env) {
            $d = $env;
        } elseif (!empty($settings['configDirectory'])) {
            $d = $settings['configDirectory'];
        } else {
            $d = dirname(__DIR__) . '/data';
        }
        if (!is_dir($d)) {
            @mkdir($d, 0775, true);
        }
        return $d;
    }

    private static function file($name)
    {
        return self::dir() . '/fpp_Central_Hub.' . $name;
    }

    public static function defaults()
    {
        return array(
            'version' => 1,
            'ranges' => array('fpp' => array(), 'controller' => array(), 'plug' => array()),
            'options' => array(
                'refreshSeconds' => 5,
                'theme' => 'dark',
                'accent' => '#38bdf8',
                'connectTimeoutMs' => 700,
                'httpTimeoutMs' => 2500,
                'kioskTitle' => 'Light Show Hub',
                'kioskReadOnly' => false,
                'showOffline' => true,
                'compact' => false,
                'autoScanOnLoad' => false,
                'cycleSeconds' => 10,
            ),
            'devices' => array(),
            'ignored' => array(),
            'scenes' => array(),
            'signatures' => null,
            'lastScan' => new stdClass(),
        );
    }

    public static function load()
    {
        $f = self::file('json');
        $cfg = array();
        if (is_file($f)) {
            $j = json_decode((string) file_get_contents($f), true);
            if (is_array($j)) {
                $cfg = $j;
            }
        }
        $def = self::defaults();
        $cfg = array_replace($def, $cfg);
        $cfg['options'] = array_replace($def['options'], is_array($cfg['options']) ? $cfg['options'] : array());
        $cfg['ranges'] = array_replace($def['ranges'], is_array($cfg['ranges']) ? $cfg['ranges'] : array());
        foreach (array('devices', 'ignored', 'scenes') as $k) {
            if (!is_array($cfg[$k])) {
                $cfg[$k] = array();
            }
        }
        return $cfg;
    }

    private static function atomicWrite($file, $data)
    {
        $tmp = $file . '.tmp' . getmypid();
        file_put_contents($tmp, $data);
        @chmod($tmp, 0664);
        rename($tmp, $file);
    }

    /** Read-modify-write under an exclusive lock. $fn receives the config by reference. */
    public static function mutate($fn)
    {
        $lock = fopen(self::file('lock'), 'c');
        flock($lock, LOCK_EX);
        try {
            $cfg = self::load();
            $ret = $fn($cfg);
            self::atomicWrite(self::file('json'), json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return $ret;
    }

    public static function state()
    {
        $f = self::file('state.json');
        $s = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
        if (!is_array($s)) {
            $s = array();
        }
        if (!isset($s['dev']) || !is_array($s['dev'])) {
            $s['dev'] = array();
        }
        if (!isset($s['events']) || !is_array($s['events'])) {
            $s['events'] = array();
        }
        return $s;
    }

    public static function saveState($s)
    {
        $s['events'] = array_slice($s['events'], -200);
        self::atomicWrite(self::file('state.json'), json_encode($s));
    }

    public static function newId()
    {
        return 'd' . bin2hex(random_bytes(4));
    }

    public static function find(array $cfg, $id)
    {
        foreach ($cfg['devices'] as $d) {
            if ($d['id'] === $id) {
                return $d;
            }
        }
        return null;
    }

    /**
     * Merge discovery results into the config. Returns array(added, updated).
     * Match order: same uid (MAC / FPP uuid), then same kind+ip.
     */
    public static function mergeFound(array &$cfg, $kind, array $found)
    {
        $added = array();
        $updated = array();
        foreach ($found as $f) {
            $match = null;
            foreach ($cfg['devices'] as $i => $d) {
                if ($d['kind'] !== $kind) {
                    continue;
                }
                if (!empty($f['uid']) && !empty($d['uid']) && strcasecmp($f['uid'], $d['uid']) === 0) {
                    $match = $i;
                    break;
                }
                if ($d['ip'] === $f['ip'] && (int) $d['port'] === (int) $f['port']) {
                    $match = $i;
                    break;
                }
            }
            if ($match !== null) {
                $d = &$cfg['devices'][$match];
                $d['ip'] = $f['ip'];
                $d['port'] = $f['port'];
                if (!empty($f['uid'])) {
                    $d['uid'] = $f['uid'];
                }
                if (empty($d['nameCustom'])) {
                    $d['name'] = $f['name'];
                }
                $d['type'] = $f['type'];
                $d['model'] = isset($f['model']) ? $f['model'] : (isset($d['model']) ? $d['model'] : '');
                $d['extra'] = isset($f['extra']) ? $f['extra'] : array();
                $d['lastSeen'] = time();
                if (!empty($f['local'])) {
                    $d['local'] = true;
                }
                $updated[] = $d['id'];
                unset($d);
                continue;
            }
            if (in_array($kind . '|' . $f['ip'], $cfg['ignored'], true)) {
                continue;
            }
            $nd = array(
                'id' => self::newId(),
                'kind' => $kind,
                'type' => $f['type'],
                'name' => $f['name'],
                'ip' => $f['ip'],
                'port' => (int) $f['port'],
                'uid' => isset($f['uid']) ? $f['uid'] : '',
                'model' => isset($f['model']) ? $f['model'] : '',
                'group' => '',
                'notes' => '',
                'manual' => false,
                'hidden' => false,
                'linkedPlug' => null,
                'extra' => isset($f['extra']) ? $f['extra'] : array(),
                'local' => !empty($f['local']),
                'added' => time(),
                'lastSeen' => time(),
            );
            $cfg['devices'][] = $nd;
            $added[] = $nd['id'];
        }
        return array($added, $updated);
    }

    public static function addEvent(array &$state, $level, $msg, $devId = null)
    {
        $state['events'][] = array('t' => time(), 'level' => $level, 'msg' => $msg, 'dev' => $devId);
    }
}
