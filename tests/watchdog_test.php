<?php
// Local test: php tests/watchdog_test.php  (needs tests/mock_devices.py running)
putenv('HUB_DATA_DIR=/tmp/hd2');
require __DIR__ . '/../lib/Monitor.php';
function say($m) { echo $m . "\n"; }
function ev($n = 4) { $s = HubStore::state(); foreach (array_slice($s['events'], -$n) as $e) { say('   [' . $e['level'] . '] ' . $e['msg']); } }
$ranges = array('fpp' => array('127.0.0.11'), 'controller' => array('127.0.0.31-32'), 'plug' => array('127.0.0.21-22'));
HubStore::mutate(function (&$c) use ($ranges) { $c['ranges'] = $ranges; $c['options']['cycleSeconds'] = 2; });
HubKasa::setRelay("127.0.0.21", true); HubKasa::setRelay("127.0.0.22", true);
$cfg = HubStore::load();
foreach (array('fpp', 'controller', 'plug') as $k) {
    $r = HubDrivers::scan($cfg, $k, HubNet::expandRanges($ranges[$k]));
    HubStore::mutate(function (&$c) use ($k, $r) { HubStore::mergeFound($c, $k, $r['found']); });
}
$cfg = HubStore::load();
$by = array(); foreach ($cfg['devices'] as $d) { $by[$d['ip']] = $d['id']; }
$w = array('enabled' => true, 'failAfter' => 30, 'bootGrace' => 0, 'cooldown' => 30);
HubStore::mutate(function (&$c) use ($by, $w) {
    foreach ($c['devices'] as &$d) {
        if ($d['ip'] === '127.0.0.11') { $d['watch'] = $w; $d['linkedPlug'] = array('id' => $by['127.0.0.21'], 'outlet' => '*'); $d['port'] = 81; }
        if ($d['ip'] === '127.0.0.32') { $d['watch'] = $w; $d['linkedPlug'] = array('id' => $by['127.0.0.22'], 'outlet' => '*'); $d['port'] = 81; }
        if ($d['ip'] === '127.0.0.31') { $d['linkedPlug'] = array('id' => $by['127.0.0.22'], 'outlet' => '*'); }
    }
});
$t = time();
say("T+0   both watched devices unreachable (port 81): start counting"); HubMonitor::tick($t); 
say("T+31  failAfter reached -> expect API skipped, SSH tried (no ssh client here)"); HubMonitor::tick($t + 31); ev(6);
say("T+62  next step -> FPP: power cycle its own plug; controller: blocked (plug shared with ESPixelStick)"); HubMonitor::tick($t + 62); ev(6);
say("--- allowShared on the controller, then T+93 / T+124");
HubStore::mutate(function (&$c) { foreach ($c['devices'] as &$d) { if ($d['ip'] === '127.0.0.32') { $d['watch']['allowShared'] = true; } } });
$W = HubStore::watch(); $W['dev'][$by['127.0.0.32']]['step'] = 2; $W['dev'][$by['127.0.0.32']]['lastAct'] = 0; HubStore::saveWatch($W);
HubMonitor::tick($t + 124); ev(3);
say("--- schedule: Kasa plug .21 window is NOT now -> FPP device expected OFF, watchdog stands down");
$now = $t; $off = date('H:i', $now + 7200); $off2 = date('H:i', $now + 10800);
HubStore::mutate(function (&$c) use ($by, $off, $off2) { foreach ($c['devices'] as &$d) { if ($d['id'] === $by['127.0.0.21']) { $d['schedules'] = HubSchedule::clean(array(array('days' => range(0, 6), 'on' => $off, 'off' => $off2, 'enforce' => false))); } } });
$W = HubStore::watch(); $W['dev'][$by['127.0.0.11']]['lastAct'] = 0; $W['dev'][$by['127.0.0.11']]['step'] = 0; HubStore::saveWatch($W);
HubMonitor::tick($t + 500); $W = HubStore::watch(); say('   FPP watch state: ' . $W['dev'][$by['127.0.0.11']]['state']);
say("--- schedule math");
$s = array('days' => array(1), 'on' => '17:15', 'off' => '01:00', 'enforce' => true);
$mon = strtotime('next monday 18:00'); $tue = strtotime('next tuesday 00:30'); $tue2 = strtotime('next tuesday 02:00');
say('   Mon 18:00 in window: ' . var_export(HubSchedule::inWindow($s, $mon), true) . ' | Tue 00:30 (overnight): ' . var_export(HubSchedule::inWindow($s, $tue), true) . ' | Tue 02:00: ' . var_export(HubSchedule::inWindow($s, $tue2), true));
$p = array('id' => 'p1', 'schedules' => array($s));
say('   due edge at Mon 17:16: ' . json_encode(HubSchedule::dueEdges($p, strtotime('next monday 17:16'))) . ' | Tue 01:02: ' . json_encode(HubSchedule::dueEdges($p, strtotime('next tuesday 01:02'))));
