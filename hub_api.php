<?php
/**
 * FPP Central Hub - JSON API.
 * Reached through FPP's plugin loader so it works both inside FPP and standalone:
 *   plugin.php?plugin=fpp_Central_Hub&page=hub_api.php&nopage=1&action=...
 */
require_once __DIR__ . '/lib/Monitor.php';

function hub_out($data, $code = 200)
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

function hub_fail($msg, $code = 400)
{
    hub_out(array('ok' => false, 'error' => $msg), $code);
}

function hub_ensure_local(array &$cfg)
{
    global $settings;
    if (empty($settings['HostName'])) {
        return false; // not running inside FPP
    }
    foreach ($cfg['devices'] as $d) {
        if (!empty($d['local'])) {
            return false;
        }
    }
    $cfg['devices'][] = array(
        'id' => HubStore::newId(), 'kind' => 'fpp', 'type' => 'fpp', 'name' => (string) $settings['HostName'],
        'ip' => HubNet::localIp() ?: '127.0.0.1', 'port' => 80, 'uid' => '', 'model' => '', 'group' => '', 'notes' => 'This controller',
        'manual' => false, 'hidden' => false, 'linkedPlug' => null, 'extra' => array(), 'local' => true, 'added' => time(), 'lastSeen' => time(),
    );
    return true;
}

function hub_log($msg, $level = 'info', $devId = null)
{
    HubStore::logEvent($level, $msg, $devId);
}

function hub_pub($cfg)
{
    return HubStore::publicConfig($cfg);
}

function hub_validate_ranges(array $ranges)
{
    $clean = array();
    foreach (array('fpp', 'controller', 'plug') as $k) {
        $list = isset($ranges[$k]) && is_array($ranges[$k]) ? $ranges[$k] : array();
        $out = array();
        foreach ($list as $r) {
            $r = trim((string) $r);
            if ($r === '') {
                continue;
            }
            HubNet::expandRange($r); // throws on bad syntax
            $out[] = $r;
        }
        $clean[$k] = $out;
    }
    return $clean;
}

function hub_substr($s, $start, $len)
{
    return function_exists('mb_substr') ? mb_substr((string) $s, $start, $len) : substr((string) $s, $start, $len);
}

// Turn PHP warnings/fatals into a readable JSON error instead of a bare HTTP 500.
set_error_handler(function ($no, $str, $file, $line) {
    if (!(error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($str, 0, $no, $file, $line);
});
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR), true)) {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code(200);
        header('Content-Type: application/json');
        echo json_encode(array('ok' => false, 'error' => 'Server error: ' . $e['message'] . ' (' . basename($e['file']) . ':' . $e['line'] . ')'));
    }
});

// ------------------------------------------------------------------ dispatch
set_time_limit(300);
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$in = array();
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_SERVER['HTTP_X_REQUESTED_WITH']) || $_SERVER['HTTP_X_REQUESTED_WITH'] !== 'hub') {
        hub_fail('Missing X-Requested-With header', 403);
    }
    $j = json_decode((string) file_get_contents('php://input'), true);
    $in = is_array($j) ? $j : array();
}

$mutating = array('scan', 'device_add', 'device_update', 'device_remove', 'act', 'settings_save', 'scene_save', 'scene_delete', 'import');
$cfg = HubStore::load();
if (in_array($action, $mutating, true) && isset($_SERVER['HTTP_X_HUB_MODE']) && $_SERVER['HTTP_X_HUB_MODE'] === 'kiosk' && !empty($cfg['options']['kioskReadOnly'])) {
    hub_fail('Kiosk is in view-only mode', 403);
}

try {
    switch ($action) {
        case 'bootstrap':
            $firstRun = empty($cfg['ranges']['fpp']) && empty($cfg['ranges']['controller']) && empty($cfg['ranges']['plug']) && empty($cfg['devices']);
            $changed = hub_ensure_local($cfg);
            if ($changed || $firstRun) {
                HubStore::mutate(function (&$c) use ($firstRun) {
                    hub_ensure_local($c);
                    if ($firstRun) {
                        $subs = HubNet::localSubnets();
                        foreach (array('fpp', 'controller', 'plug') as $k) {
                            $c['ranges'][$k] = $subs;
                        }
                    }
                });
                $cfg = HubStore::load();
            }
            hub_out(array(
                'ok' => true, 'config' => hub_pub($cfg), 'types' => HubDrivers::types(), 'defaultSignatures' => HubDrivers::defaultSignatures(),
                'localSubnets' => HubNet::localSubnets(), 'localIp' => HubNet::localIp(), 'version' => HubStore::VERSION,
            ));

        case 'status':
            $ids = isset($_GET['ids']) && $_GET['ids'] !== '' ? explode(',', (string) $_GET['ids']) : null;
            $st = HubDrivers::statusAll($cfg, $ids);
            $st = HubMonitor::record($cfg, $st);
            HubStore::applyTimezone();
            $w = HubStore::watch();
            $watch = array();
            foreach ($cfg['devices'] as $d) {
                if ($d['kind'] === 'plug' && !empty($d['schedules'])) {
                    $watch[$d['id']] = array('window' => HubSchedule::plugWindow($d, time()));
                }
                if (isset($w['dev'][$d['id']]) && !empty($d['watch']['enabled'])) {
                    $x = $w['dev'][$d['id']];
                    $watch[$d['id']] = array('state' => $x['state'], 'step' => $x['step'], 'msg' => $x['msg'], 'msgT' => $x['msgT']);
                }
            }
            HubMonitor::ensureRunning($cfg);
            hub_out(array('ok' => true, 'status' => $st, 'watch' => $watch, 'monitor' => HubMonitor::running(), 'ts' => time()));

        case 'scan':
            $kind = isset($in['kind']) ? $in['kind'] : '';
            if (!in_array($kind, array('fpp', 'controller', 'plug'), true)) {
                hub_fail('Unknown device kind');
            }
            $ranges = $cfg['ranges'][$kind];
            if (!$ranges && $kind !== 'fpp') {
                hub_fail('No address ranges are configured for this device type. Add one in Settings.');
            }
            $ips = HubNet::expandRanges($ranges);
            $res = HubDrivers::scan($cfg, $kind, $ips);
            $report = array();
            HubStore::mutate(function (&$c) use ($kind, $res, &$report) {
                list($added, $updated) = HubStore::mergeFound($c, $kind, $res['found']);
                $c['lastScan'] = (array) $c['lastScan'];
                $c['lastScan'][$kind] = array('t' => time(), 'found' => count($res['found']), 'added' => count($added), 'scanned' => $res['scanned']);
                $report = array('added' => $added, 'updated' => $updated);
            });
            $c2 = HubStore::load();
            foreach ($report['added'] as $id) {
                $dv = HubStore::find($c2, $id);
                HubStore::logEvent('ok', 'Discovered ' . $dv['name'] . ' (' . $dv['ip'] . ')', $id);
            }
            hub_out(array('ok' => true, 'scanned' => $res['scanned'], 'found' => count($res['found']), 'added' => $report['added'],
                'updated' => $report['updated'], 'unmatched' => $res['unmatched'], 'config' => hub_pub($c2)));

        case 'probe':
            $kind = isset($in['kind']) ? $in['kind'] : '';
            $ip = isset($in['ip']) ? trim($in['ip']) : '';
            if (!in_array($kind, array('fpp', 'controller', 'plug'), true) || !HubNet::validIp($ip)) {
                hub_fail('Enter a valid IP address or hostname');
            }
            list($rec, $reachable) = HubDrivers::probe($cfg, $kind, $ip, isset($in['port']) ? (int) $in['port'] : 0);
            hub_out(array('ok' => true, 'device' => $rec, 'reachable' => $reachable));

        case 'device_add':
            $kind = isset($in['kind']) ? $in['kind'] : '';
            $ip = isset($in['ip']) ? trim($in['ip']) : '';
            $types = HubDrivers::types();
            if (!isset($types[$kind]) || !HubNet::validIp($ip)) {
                hub_fail('Pick a device kind and enter a valid IP address');
            }
            $type = isset($in['type']) && isset($types[$kind][$in['type']]) ? $in['type'] : key($types[$kind]);
            $port = !empty($in['port']) ? (int) $in['port'] : ($type === 'kasa' ? 9999 : 80);
            $newId = HubStore::newId();
            HubStore::mutate(function (&$c) use ($kind, $type, $ip, $port, $in, $newId) {
                foreach ($c['devices'] as $d) {
                    if ($d['kind'] === $kind && $d['ip'] === $ip && (int) $d['port'] === $port) {
                        throw new Exception('That device is already in the list');
                    }
                }
                $c['ignored'] = array_values(array_diff($c['ignored'], array($kind . '|' . $ip)));
                $c['devices'][] = array(
                    'id' => $newId, 'kind' => $kind, 'type' => $type,
                    'name' => !empty($in['name']) ? hub_substr(trim($in['name']), 0, 60) : ($types[$kind][$type]['label'] . ' ' . $ip),
                    'ip' => $ip, 'port' => $port, 'uid' => isset($in['uid']) ? (string) $in['uid'] : '', 'model' => isset($in['model']) ? (string) $in['model'] : '',
                    'group' => isset($in['group']) ? hub_substr(trim($in['group']), 0, 40) : '', 'notes' => '', 'manual' => true, 'hidden' => false,
                    'linkedPlug' => null, 'extra' => isset($in['extra']) && is_array($in['extra']) ? $in['extra'] : array(), 'local' => false,
                    'nameCustom' => !empty($in['name']), 'added' => time(), 'lastSeen' => 0,
                );
            });
            hub_log('Added ' . $ip . ' manually', 'info', $newId);
            hub_out(array('ok' => true, 'id' => $newId, 'config' => hub_pub(HubStore::load())));

        case 'device_update':
            $id = isset($in['id']) ? $in['id'] : '';
            $patch = isset($in['patch']) && is_array($in['patch']) ? $in['patch'] : array();
            $types = HubDrivers::types();
            HubStore::mutate(function (&$c) use ($id, $patch, $types) {
                foreach ($c['devices'] as $i => &$d) {
                    if ($d['id'] !== $id) {
                        continue;
                    }
                    if (isset($patch['name'])) {
                        $d['name'] = hub_substr(trim($patch['name']), 0, 60);
                        $d['nameCustom'] = true;
                    }
                    if (isset($patch['ip'])) {
                        if (!HubNet::validIp(trim($patch['ip']))) {
                            throw new Exception('Invalid IP address');
                        }
                        $d['ip'] = trim($patch['ip']);
                    }
                    if (isset($patch['port'])) {
                        $d['port'] = max(1, min(65535, (int) $patch['port']));
                    }
                    if (isset($patch['group'])) {
                        $d['group'] = hub_substr(trim($patch['group']), 0, 40);
                    }
                    if (isset($patch['notes'])) {
                        $d['notes'] = hub_substr(trim($patch['notes']), 0, 500);
                    }
                    if (isset($patch['hidden'])) {
                        $d['hidden'] = (bool) $patch['hidden'];
                    }
                    if (isset($patch['type']) && isset($types[$d['kind']][$patch['type']])) {
                        $d['type'] = $patch['type'];
                    }
                    if (isset($patch['watch']) && is_array($patch['watch'])) {
                        $w = array_replace(HubStore::defaultWatch(), isset($d['watch']) ? $d['watch'] : array());
                        $pw = $patch['watch'];
                        foreach (array('failAfter' => array(30, 3600), 'bootGrace' => array(0, 1800), 'cooldown' => array(30, 1800), 'freezeSec' => array(30, 1800), 'maxCycles' => array(1, 20)) as $k => $lim) {
                            if (isset($pw[$k])) {
                                $w[$k] = max($lim[0], min($lim[1], (int) $pw[$k]));
                            }
                        }
                        foreach (array('enabled', 'frozen', 'allowShared') as $k) {
                            if (isset($pw[$k])) {
                                $w[$k] = (bool) $pw[$k];
                            }
                        }
                        if (isset($pw['steps']) && is_array($pw['steps'])) {
                            $w['steps'] = array_values(array_intersect(array('api', 'ssh', 'power'), $pw['steps']));
                        }
                        $d['watch'] = $w;
                    }
                    if (isset($patch['ssh']) && is_array($patch['ssh'])) {
                        $x = array_replace(HubStore::defaultSsh(), isset($d['ssh']) ? $d['ssh'] : array());
                        $ps = $patch['ssh'];
                        foreach (array('enabled', 'useDefault') as $k) {
                            if (isset($ps[$k])) {
                                $x[$k] = (bool) $ps[$k];
                            }
                        }
                        if (isset($ps['user'])) {
                            $x['user'] = preg_replace('/[^A-Za-z0-9._-]/', '', (string) $ps['user']);
                        }
                        if (isset($ps['pass']) && $ps['pass'] !== '') {
                            $x['pass'] = (string) $ps['pass'];
                        }
                        if (!empty($ps['clearPass'])) {
                            $x['pass'] = '';
                        }
                        if (isset($ps['port'])) {
                            $x['port'] = max(1, min(65535, (int) $ps['port']));
                        }
                        if (isset($ps['command'])) {
                            $x['command'] = hub_substr(trim((string) $ps['command']), 0, 200);
                        }
                        $d['ssh'] = $x;
                    }
                    if (array_key_exists('schedules', $patch) && $d['kind'] === 'plug') {
                        $d['schedules'] = HubSchedule::clean($patch['schedules']);
                    }
                    if (array_key_exists('linkedPlug', $patch)) {
                        $lp = $patch['linkedPlug'];
                        if (is_array($lp) && !empty($lp['id'])) {
                            $d['linkedPlug'] = array('id' => (string) $lp['id'], 'outlet' => isset($lp['outlet']) ? (string) $lp['outlet'] : '*');
                        } else {
                            $d['linkedPlug'] = null;
                        }
                    }
                    return;
                }
                throw new Exception('Device not found');
            });
            hub_out(array('ok' => true, 'config' => hub_pub(HubStore::load())));

        case 'device_remove':
            $id = isset($in['id']) ? $in['id'] : '';
            $ignore = !empty($in['ignore']);
            $name = '';
            HubStore::mutate(function (&$c) use ($id, $ignore, &$name) {
                foreach ($c['devices'] as $i => $d) {
                    if ($d['id'] === $id) {
                        $name = $d['name'];
                        if ($ignore) {
                            $c['ignored'][] = $d['kind'] . '|' . $d['ip'];
                            $c['ignored'] = array_values(array_unique($c['ignored']));
                        }
                        array_splice($c['devices'], $i, 1);
                        break;
                    }
                }
                foreach ($c['devices'] as &$d) {
                    if (!empty($d['linkedPlug']['id']) && $d['linkedPlug']['id'] === $id) {
                        $d['linkedPlug'] = null;
                    }
                }
                unset($d);
                foreach ($c['scenes'] as &$sc) {
                    $sc['steps'] = array_values(array_filter($sc['steps'], function ($s) use ($id) {
                        return $s['device'] !== $id;
                    }));
                }
                unset($sc);
            });
            hub_log('Removed ' . $name, 'info');
            hub_out(array('ok' => true, 'config' => hub_pub(HubStore::load())));

        case 'act':
            $id = isset($in['id']) ? $in['id'] : '';
            $cmd = isset($in['cmd']) ? (string) $in['cmd'] : '';
            $args = isset($in['args']) && is_array($in['args']) ? $in['args'] : array();
            $d = HubStore::find($cfg, $id);
            if (!$d) {
                hub_fail('Device not found', 404);
            }
            list($ok, $msg, $data) = HubDrivers::act($cfg, $d, $cmd, $args);
            if ($cmd !== 'playlists') {
                $what = $cmd . (isset($args['playlist']) ? ' "' . $args['playlist'] . '"' : '') . (isset($args['value']) ? ' ' . $args['value'] : '') . (isset($args['outlet']) && $args['outlet'] !== '*' ? ' (outlet ' . $args['outlet'] . ')' : '');
                hub_log($d['name'] . ': ' . $what . ($ok ? '' : ' - FAILED'), $ok ? 'info' : 'warn', $id);
            }
            $resp = array('ok' => $ok, 'msg' => $msg);
            if ($d['kind'] === 'plug' && is_array($data)) {
                $resp['status'] = $data;
            } else {
                $resp['data'] = $data;
            }
            hub_out($resp);

        case 'settings_save':
            $ranges = isset($in['ranges']) && is_array($in['ranges']) ? hub_validate_ranges($in['ranges']) : null;
            $opts = isset($in['options']) && is_array($in['options']) ? $in['options'] : array();
            $sigs = array_key_exists('signatures', $in) ? $in['signatures'] : false;
            if (is_array($sigs)) {
                foreach ($sigs as $s) {
                    if (!is_array($s) || empty($s['type']) || empty($s['match']) || !is_array($s['match'])) {
                        throw new Exception('Each signature needs a "type" and a "match" list');
                    }
                }
            }
            HubStore::mutate(function (&$c) use ($ranges, $opts, $sigs) {
                if ($ranges !== null) {
                    $c['ranges'] = $ranges;
                }
                $o = &$c['options'];
                $num = array('refreshSeconds' => array(2, 300), 'connectTimeoutMs' => array(150, 5000), 'httpTimeoutMs' => array(500, 15000), 'cycleSeconds' => array(2, 120));
                foreach ($num as $k => $lim) {
                    if (isset($opts[$k])) {
                        $o[$k] = max($lim[0], min($lim[1], (int) $opts[$k]));
                    }
                }
                foreach (array('kioskReadOnly', 'showOffline', 'compact', 'autoScanOnLoad', 'watchdogEnabled') as $k) {
                    if (isset($opts[$k])) {
                        $o[$k] = (bool) $opts[$k];
                    }
                }
                if (isset($opts['theme']) && in_array($opts['theme'], array('dark', 'light', 'auto'), true)) {
                    $o['theme'] = $opts['theme'];
                }
                if (isset($opts['accent']) && preg_match('/^#[0-9a-fA-F]{6}$/', $opts['accent'])) {
                    $o['accent'] = $opts['accent'];
                }
                if (isset($opts['sshDefaultUser'])) {
                    $o['sshDefaultUser'] = preg_replace('/[^A-Za-z0-9._-]/', '', (string) $opts['sshDefaultUser']);
                }
                if (isset($opts['sshDefaultPass']) && $opts['sshDefaultPass'] !== '') {
                    $o['sshDefaultPass'] = (string) $opts['sshDefaultPass'];
                }
                if (isset($opts['kioskTitle'])) {
                    $o['kioskTitle'] = hub_substr(trim($opts['kioskTitle']), 0, 60);
                }
                if ($sigs !== false) {
                    $c['signatures'] = is_array($sigs) && $sigs ? $sigs : null;
                }
            });
            hub_out(array('ok' => true, 'config' => hub_pub(HubStore::load())));

        case 'parse_ranges':
            $res = array();
            $list = isset($in['ranges']) && is_array($in['ranges']) ? $in['ranges'] : array();
            foreach ($list as $r) {
                try {
                    $res[] = array('range' => $r, 'count' => count(HubNet::expandRange($r)));
                } catch (Exception $e) {
                    $res[] = array('range' => $r, 'error' => $e->getMessage());
                }
            }
            hub_out(array('ok' => true, 'results' => $res));

        case 'scene_save':
            $sc = isset($in['scene']) && is_array($in['scene']) ? $in['scene'] : array();
            if (empty($sc['name'])) {
                hub_fail('Give the scene a name');
            }
            $steps = array();
            foreach (isset($sc['steps']) && is_array($sc['steps']) ? $sc['steps'] : array() as $s) {
                if (empty($s['device']) || empty($s['cmd'])) {
                    continue;
                }
                $steps[] = array(
                    'device' => (string) $s['device'], 'cmd' => (string) $s['cmd'],
                    'args' => isset($s['args']) && is_array($s['args']) ? $s['args'] : new stdClass(),
                    'delay' => max(0, min(3600, (int) (isset($s['delay']) ? $s['delay'] : 0))),
                );
            }
            $scene = array('id' => !empty($sc['id']) ? (string) $sc['id'] : 's' . bin2hex(random_bytes(3)), 'name' => hub_substr(trim($sc['name']), 0, 50), 'icon' => isset($sc['icon']) ? hub_substr((string) $sc['icon'], 0, 4) : '', 'steps' => $steps);
            HubStore::mutate(function (&$c) use ($scene) {
                foreach ($c['scenes'] as $i => $s) {
                    if ($s['id'] === $scene['id']) {
                        $c['scenes'][$i] = $scene;
                        return;
                    }
                }
                $c['scenes'][] = $scene;
            });
            hub_out(array('ok' => true, 'config' => hub_pub(HubStore::load())));

        case 'scene_delete':
            $id = isset($in['id']) ? $in['id'] : '';
            HubStore::mutate(function (&$c) use ($id) {
                $c['scenes'] = array_values(array_filter($c['scenes'], function ($s) use ($id) {
                    return $s['id'] !== $id;
                }));
            });
            hub_out(array('ok' => true, 'config' => hub_pub(HubStore::load())));

        case 'update_check':
            $state = HubStore::state();
            $force = !empty($_GET['force']);
            $u = isset($state['update']) ? $state['update'] : array('t' => 0);
            if ($force || time() - (int) $u['t'] > 6 * 3600) {
                $r = HubNet::http('https://raw.githubusercontent.com/baelinc/fpp_Central_Hub/main/VERSION?t=' . time(), 'GET', null, 6000);
                $latest = trim($r['body']);
                if ($r['code'] === 200 && preg_match('/^\d+\.\d+\.\d+$/', $latest)) {
                    $u = array('t' => time(), 'latest' => $latest);
                    HubStore::mutateState(function (&$st2) use ($u) {
                        $st2['update'] = $u;
                    });
                } else {
                    hub_out(array('ok' => true, 'current' => HubStore::VERSION, 'latest' => null, 'available' => false, 'error' => 'Could not reach GitHub (does this device have internet access?)'));
                }
            }
            $latest = isset($u['latest']) ? $u['latest'] : null;
            hub_out(array('ok' => true, 'current' => HubStore::VERSION, 'latest' => $latest, 'available' => $latest && version_compare($latest, HubStore::VERSION, '>')));

        case 'update_apply':
            $dir = __DIR__;
            if (!is_dir($dir . '/.git') || !function_exists('shell_exec')) {
                hub_fail('This install is not a git checkout, so it cannot update itself. Use FPP > Content Setup > Plugin Manager instead.');
            }
            $cmd = 'cd ' . escapeshellarg($dir) . ' && HOME=' . escapeshellarg(HubStore::dir()) . ' git -c safe.directory=' . escapeshellarg($dir) . ' pull --ff-only 2>&1';
            $out = (string) shell_exec($cmd);
            HubStore::mutateState(function (&$st2) use ($out) {
                unset($st2['update']);
                HubStore::addEvent($st2, 'info', 'Update requested: ' . substr(trim($out), -120));
            });
            HubMonitor::stop();
            $ok = stripos($out, 'fatal') === false && stripos($out, 'error') === false;
            hub_out(array('ok' => $ok, 'output' => $out, 'error' => $ok ? null : 'Update failed: ' . trim($out)));

        case 'monitor_status':
            $m = array('ok' => true, 'running' => HubMonitor::running(), 'heartbeat' => HubMonitor::heartbeat(), 'ssh' => HubSsh::available());
            $ef = HubStore::runtimeFile('monitor.err');
            $m['lastError'] = is_file($ef) ? trim(implode('', array_slice(file($ef), -1))) : '';
            hub_out($m);

        case 'monitor_ctl':
            $op = isset($in['op']) ? $in['op'] : '';
            if ($op === 'stop' || $op === 'restart') {
                HubMonitor::stop();
            }
            if ($op === 'start' || $op === 'restart') {
                HubMonitor::start();
            }
            hub_out(array('ok' => true, 'running' => HubMonitor::running()));

        case 'ssh_test':
            $d = HubStore::find($cfg, isset($in['id']) ? $in['id'] : '');
            if (!$d) {
                hub_fail('Device not found', 404);
            }
            $s = isset($d['ssh']) ? $d['ssh'] : HubStore::defaultSsh();
            list($u, $p) = HubSsh::creds($cfg, $d);
            list($ok, $out) = HubSsh::run(HubDrivers::host($d), (int) ($s['port'] ?: 22), $u, $p, 'echo hub-ssh-ok', 15);
            hub_out(array('ok' => $ok && strpos($out, 'hub-ssh-ok') !== false, 'msg' => $out, 'error' => $ok ? null : 'SSH failed: ' . $out, 'user' => $u));

        case 'events':
            $s = HubStore::state();
            hub_out(array('ok' => true, 'events' => array_reverse(array_slice($s['events'], -100))));

        case 'events_clear':
            HubStore::mutateState(function (&$s) {
                $s['events'] = array();
            });
            hub_out(array('ok' => true));

        case 'export':
            hub_out(array('ok' => true, 'config' => hub_pub($cfg)));

        case 'import':
            $n = isset($in['config']) && is_array($in['config']) ? $in['config'] : null;
            if (!$n || !isset($n['devices'])) {
                hub_fail('That file does not look like a Central Hub export');
            }
            HubStore::mutate(function (&$c) use ($n) {
                foreach (array('ranges', 'options', 'devices', 'ignored', 'scenes', 'signatures') as $k) {
                    if (isset($n[$k])) {
                        $c[$k] = $n[$k];
                    }
                }
            });
            hub_out(array('ok' => true, 'config' => hub_pub(HubStore::load())));

        default:
            hub_fail('Unknown action', 404);
    }
} catch (Throwable $e) {
    hub_fail($e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')');
}
