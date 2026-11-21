<?php
require_once __DIR__ . '/Drivers.php';
require_once __DIR__ . '/Ssh.php';
require_once __DIR__ . '/Schedule.php';

/** Background monitor: records history, runs plug schedules and the recovery watchdog (API -> SSH -> power cycle). */
class HubMonitor
{
    const TICK = 15;

    /** Track online/offline transitions + latency history. Returns statuses decorated with since/hist. */
    public static function record(array $cfg, array $statuses)
    {
        $names = array();
        foreach ($cfg['devices'] as $d) {
            $names[$d['id']] = $d['name'];
        }
        return HubStore::mutateState(function (&$state) use ($names, $statuses) {
            $now = time();
            foreach ($statuses as $id => $st) {
                $prev = isset($state['dev'][$id]) ? $state['dev'][$id] : null;
                $online = !empty($st['online']);
                if (!$prev) {
                    $prev = array('online' => $online, 'since' => $now, 'hist' => array());
                } elseif ((bool) $prev['online'] !== $online) {
                    HubStore::addEvent($state, $online ? 'ok' : 'warn', $names[$id] . ($online ? ' is back online' : ' went offline'), $id);
                    $prev['online'] = $online;
                    $prev['since'] = $now;
                }
                if ($online && isset($st['ms']) && $st['ms'] !== null) {
                    $prev['hist'][] = (int) $st['ms'];
                    $prev['hist'] = array_slice($prev['hist'], -30);
                }
                $state['dev'][$id] = $prev;
                $statuses[$id]['since'] = $prev['since'];
                $statuses[$id]['hist'] = $prev['hist'];
            }
            foreach (array_keys($state['dev']) as $id) {
                if (!isset($names[$id])) {
                    unset($state['dev'][$id]);
                }
            }
            return $statuses;
        });
    }

    /** Devices (other than $exceptId) whose linked plug/outlet overlaps this one. */
    public static function sharedUsers(array $cfg, $plugId, $outlet, $exceptId)
    {
        $out = array();
        foreach ($cfg['devices'] as $d) {
            if ($d['id'] === $exceptId || empty($d['linkedPlug']['id']) || $d['linkedPlug']['id'] !== $plugId) {
                continue;
            }
            $o = isset($d['linkedPlug']['outlet']) ? $d['linkedPlug']['outlet'] : '*';
            if ($outlet === '*' || $o === '*' || (string) $o === (string) $outlet) {
                $out[] = $d;
            }
        }
        return $out;
    }

    private static function plugOn(array $st, $outlet)
    {
        if (empty($st['online']) || empty($st['detail']['outlets'])) {
            return null;
        }
        foreach ($st['detail']['outlets'] as $o) {
            if (($outlet === '*' || (string) $o['id'] === (string) $outlet) && $o['on']) {
                return true;
            }
        }
        return false;
    }

    /** Is this device supposed to be powered right now? Returns array(bool, plug|null) */
    public static function expectedUp(array $cfg, array $d, array $statuses, $now)
    {
        if (empty($d['linkedPlug']['id'])) {
            return array(true, null);
        }
        $plug = HubStore::find($cfg, $d['linkedPlug']['id']);
        if (!$plug) {
            return array(true, null);
        }
        $win = HubSchedule::plugWindow($plug, $now);
        if ($win !== null) {
            return array($win, $plug);
        }
        $on = isset($statuses[$plug['id']]) ? self::plugOn($statuses[$plug['id']], isset($d['linkedPlug']['outlet']) ? $d['linkedPlug']['outlet'] : '*') : null;
        return array($on !== false, $plug);
    }

    // ------------------------------------------------------------------ steps (each returns array(attempted, message))

    private static function stepApi(array $cfg, array $d, array $st, $why)
    {
        if (empty($st['online'])) {
            return array(false, 'web interface unreachable, API restart not possible');
        }
        if ($d['kind'] === 'fpp') {
            list($ok, $msg) = HubDrivers::act($cfg, $d, 'restart_fppd', array());
            return array(true, 'FPP API: restart FPPD (' . $why . ') - ' . ($ok ? 'sent' : 'failed: ' . $msg));
        }
        if ($d['kind'] === 'controller' && $d['type'] === 'wled') {
            list($ok, $msg) = HubDrivers::act($cfg, $d, 'reboot', array());
            return array(true, 'WLED API reboot - ' . ($ok ? 'sent' : 'failed'));
        }
        return array(false, 'this controller type has no restart API');
    }

    private static function stepSsh(array $cfg, array $d)
    {
        $s = isset($d['ssh']) ? $d['ssh'] : HubStore::defaultSsh();
        if (empty($s['enabled'])) {
            return array(false, 'SSH recovery is turned off for this device');
        }
        list($u, $p) = HubSsh::creds($cfg, $d);
        if ($u === '') {
            return array(false, 'no SSH username configured');
        }
        $cmd = trim($s['command']) !== '' ? $s['command'] : 'sudo reboot';
        list($ok, $out) = HubSsh::run(HubDrivers::host($d), (int) ($s['port'] ?: 22), $u, $p, $cmd, 20);
        return array(true, 'SSH (' . $u . '@' . $d['ip'] . ') "' . $cmd . '" - ' . ($ok ? 'sent' : 'failed: ' . substr($out, 0, 120)));
    }

    private static function stepPower(array $cfg, array $d, array $statuses, $now, array $W, $w)
    {
        if (empty($d['linkedPlug']['id'])) {
            return array(false, 'no smart plug linked');
        }
        $plug = HubStore::find($cfg, $d['linkedPlug']['id']);
        if (!$plug || empty($statuses[$plug['id']]['online'])) {
            return array(false, 'the linked plug is not reachable');
        }
        $outlet = isset($d['linkedPlug']['outlet']) ? $d['linkedPlug']['outlet'] : '*';
        $win = HubSchedule::plugWindow($plug, $now);
        if ($win === false) {
            return array(false, 'outside the plug\'s scheduled on-time');
        }
        if (self::plugOn($statuses[$plug['id']], $outlet) === false) {
            return array(false, 'the plug is currently off');
        }
        $others = self::sharedUsers($cfg, $plug['id'], $outlet, $d['id']);
        if ($others && empty($w['allowShared'])) {
            return array(false, 'power cycle skipped: "' . $plug['name'] . '" also powers ' . implode(', ', array_map(function ($o) { return $o['name']; }, $others)) . ' (enable "allow shared plug cycling" to permit)');
        }
        $recent = array_filter(isset($W['cycles']) ? $W['cycles'] : array(), function ($t) use ($now) { return $now - $t < 86400; });
        if (count($recent) >= (int) (isset($w['maxCycles']) ? $w['maxCycles'] : 3)) {
            return array(false, 'daily power-cycle limit reached');
        }
        $o = array('outlet' => $outlet);
        list($ok1, $m1) = HubDrivers::act($cfg, $plug, 'off', $o);
        sleep(max(2, (int) $cfg['options']['cycleSeconds']));
        list($ok2, $m2) = HubDrivers::act($cfg, $plug, 'on', $o);
        return array(true, 'power cycled via "' . $plug['name'] . '"' . ($others ? ' (also affects ' . implode(', ', array_map(function ($x) { return $x['name']; }, $others)) . ')' : '') . ($ok1 && $ok2 ? '' : ' - plug reported an error'));
    }

    // ----------------------------------------------------------------------- tick

    public static function tick($now = null)
    {
        $now = $now ?: time();
        HubStore::applyTimezone();
        $cfg = HubStore::load();
        if (!$cfg['devices']) {
            return;
        }
        $statuses = self::record($cfg, HubDrivers::statusAll($cfg));
        $W = HubStore::watch();
        $W['dev'] = isset($W['dev']) && is_array($W['dev']) ? $W['dev'] : array();
        $W['fired'] = isset($W['fired']) && is_array($W['fired']) ? $W['fired'] : array();

        // 1) enforced plug schedules
        foreach ($cfg['devices'] as $p) {
            if ($p['kind'] !== 'plug' || empty($p['schedules'])) {
                continue;
            }
            foreach (HubSchedule::dueEdges($p, $now) as $e) {
                list($key, $edge) = $e;
                if (isset($W['fired'][$key]) && $W['fired'][$key] >= 3) {
                    continue;
                }
                list($ok, $msg) = HubDrivers::act($cfg, $p, $edge, array('outlet' => '*'));
                $W['fired'][$key] = $ok ? 99 : (isset($W['fired'][$key]) ? $W['fired'][$key] + 1 : 1);
                HubStore::logEvent($ok ? 'info' : 'warn', 'Schedule: ' . $p['name'] . ' turned ' . $edge . ($ok ? '' : ' - FAILED: ' . $msg), $p['id']);
            }
        }
        if (count($W['fired']) > 120) {
            $W['fired'] = array_slice($W['fired'], -80, null, true);
        }

        // 2) watchdog
        if (!empty($cfg['options']['watchdogEnabled'])) {
            foreach ($cfg['devices'] as $d) {
                if (empty($d['watch']['enabled']) || !in_array($d['kind'], array('fpp', 'controller'), true) || !empty($d['local'])) {
                    continue;
                }
                $id = $d['id'];
                $w = array_replace(HubStore::defaultWatch(), $d['watch']);
                $dw = isset($W['dev'][$id]) ? $W['dev'][$id] : array();
                $dw = array_replace(array('state' => 'ok', 'downSince' => null, 'expSince' => null, 'step' => 0, 'lastAct' => 0, 'cycles' => array(), 'lastEl' => null, 'lastElT' => $now, 'msg' => '', 'msgT' => 0), $dw);
                $st = isset($statuses[$id]) ? $statuses[$id] : array('online' => false);

                list($expected, ) = self::expectedUp($cfg, $d, $statuses, $now);
                if (!$expected) {
                    $dw['state'] = 'off-expected';
                    $dw['downSince'] = null;
                    $dw['expSince'] = null;
                    $dw['step'] = 0;
                    $W['dev'][$id] = $dw;
                    continue;
                }
                if (!$dw['expSince']) {
                    $dw['expSince'] = $now;
                }

                // health
                $healthy = !empty($st['online']);
                $why = 'no response';
                if ($healthy && $d['kind'] === 'fpp') {
                    $det = isset($st['detail']) ? $st['detail'] : array();
                    if (isset($det['fppd']) && $det['fppd'] === false) {
                        $healthy = false;
                        $why = 'FPPD not running';
                    } elseif (!empty($w['frozen']) && isset($det['state']) && $det['state'] === 'playing' && isset($det['elapsed'])) {
                        if ($dw['lastEl'] !== null && $det['elapsed'] === $dw['lastEl']) {
                            if ($now - $dw['lastElT'] >= (int) $w['freezeSec']) {
                                $healthy = false;
                                $why = 'playback frozen';
                            }
                        } else {
                            $dw['lastEl'] = $det['elapsed'];
                            $dw['lastElT'] = $now;
                        }
                    } else {
                        $dw['lastEl'] = null;
                        $dw['lastElT'] = $now;
                    }
                }

                if ($healthy) {
                    if ($dw['downSince']) {
                        HubStore::logEvent('ok', 'Recovery: ' . $d['name'] . ' is responding again after ' . gmdate('i:s', max(0, $now - $dw['downSince'])) . ' (reached step ' . $dw['step'] . ')', $id);
                    }
                    $dw['state'] = 'ok';
                    $dw['downSince'] = null;
                    $dw['step'] = 0;
                    $W['dev'][$id] = $dw;
                    continue;
                }

                if (!$dw['downSince']) {
                    $dw['downSince'] = $now;
                }
                $downFor = $now - max($dw['downSince'], $dw['expSince'] + (int) $w['bootGrace']);
                if ($downFor < (int) $w['failAfter']) {
                    $dw['state'] = 'down';
                    $W['dev'][$id] = $dw;
                    continue;
                }
                $steps = array_values(array_intersect(array('api', 'ssh', 'power'), (array) $w['steps']));
                $guard = 0;
                while ($guard++ < 3) {
                    if ($now - $dw['lastAct'] < (int) $w['cooldown']) {
                        break;
                    }
                    if ($dw['step'] >= count($steps)) {
                        if ($now - $dw['lastAct'] > 1800) {
                            $dw['step'] = 0; // start the ladder over
                            $dw['state'] = 'recovering';
                            continue;
                        }
                        if ($dw['state'] !== 'exhausted') {
                            HubStore::logEvent('warn', 'Recovery: all steps tried for ' . $d['name'] . ' - it still is not responding. Will retry in 30 minutes.', $id);
                        }
                        $dw['state'] = 'exhausted';
                        break;
                    }
                    $step = $steps[$dw['step']];
                    if ($step === 'api') {
                        list($tried, $msg) = self::stepApi($cfg, $d, $st, $why);
                    } elseif ($step === 'ssh') {
                        list($tried, $msg) = self::stepSsh($cfg, $d);
                    } else {
                        list($tried, $msg) = self::stepPower($cfg, $d, $statuses, $now, $dw, $w);
                        if ($tried) {
                            $dw['cycles'][] = $now;
                            $dw['cycles'] = array_slice($dw['cycles'], -10);
                            $dw['expSince'] = $now; // allow boot time again
                        }
                    }
                    $dw['step']++;
                    $dw['state'] = 'recovering';
                    $dw['msg'] = ucfirst($step) . ': ' . $msg;
                    $dw['msgT'] = $now;
                    HubStore::logEvent($tried ? 'warn' : 'info', 'Recovery ' . $d['name'] . ' [' . $why . '] step ' . $dw['step'] . '/' . count($steps) . ' ' . ($tried ? '' : '(skipped) ') . ucfirst($step) . ': ' . $msg, $id);
                    if ($tried) {
                        $dw['lastAct'] = $now;
                        break;
                    }
                }
                $W['dev'][$id] = $dw;
            }
            // forget removed devices
            $ids = array_column($cfg['devices'], 'id');
            foreach (array_keys($W['dev']) as $k) {
                if (!in_array($k, $ids, true)) {
                    unset($W['dev'][$k]);
                }
            }
        }
        HubStore::saveWatch($W);
    }

    // -------------------------------------------------------------- process control

    public static function heartbeat()
    {
        $f = HubStore::runtimeFile('monitor.hb');
        return is_file($f) ? (int) @file_get_contents($f) : 0;
    }

    public static function running()
    {
        return time() - self::heartbeat() < self::TICK * 4;
    }

    private static function phpBin()
    {
        $b = trim((string) @shell_exec('command -v php 2>/dev/null'));
        return $b !== '' ? $b : '/usr/bin/php';
    }

    public static function start()
    {
        if (!function_exists('shell_exec')) {
            return false;
        }
        $script = dirname(__DIR__) . '/monitor.php';
        $cmd = 'cd ' . escapeshellarg(dirname(__DIR__)) . ' && (HUB_DATA_DIR=' . escapeshellarg(HubStore::dir()) . ' setsid ' . escapeshellarg(self::phpBin()) . ' ' . escapeshellarg($script) . ' >/dev/null 2>&1 &) ; sleep 1';
        @shell_exec($cmd);
        return true;
    }

    public static function stop()
    {
        @file_put_contents(HubStore::runtimeFile('monitor.stop'), '1');
        for ($i = 0; $i < 20 && self::running(); $i++) {
            usleep(500000);
        }
    }

    /** Called from the web UI: start the monitor if something needs it and it is not alive. */
    public static function ensureRunning(array $cfg)
    {
        $need = false;
        foreach ($cfg['devices'] as $d) {
            if (!empty($d['watch']['enabled']) || !empty($d['schedules'])) {
                $need = true;
            }
        }
        if ($need && !self::running()) {
            self::start();
        }
    }

    public static function run()
    {
        $lock = fopen(HubStore::runtimeFile('monitor.lock'), 'c');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            return; // already running
        }
        @unlink(HubStore::runtimeFile('monitor.stop'));
        $ver = trim((string) @file_get_contents(dirname(__DIR__) . '/VERSION'));
        while (true) {
            try {
                self::tick();
            } catch (Throwable $e) {
                @file_put_contents(HubStore::runtimeFile('monitor.err'), date('c') . ' ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine() . "\n", FILE_APPEND);
            }
            @file_put_contents(HubStore::runtimeFile('monitor.hb'), (string) time());
            if (is_file(HubStore::runtimeFile('monitor.stop'))) {
                @unlink(HubStore::runtimeFile('monitor.stop'));
                @unlink(HubStore::runtimeFile('monitor.hb'));
                return;
            }
            if (trim((string) @file_get_contents(dirname(__DIR__) . '/VERSION')) !== $ver) {
                return; // updated on disk: exit; the dashboard/postStart restarts the new code
            }
            sleep(self::TICK);
        }
    }
}
