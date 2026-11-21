<?php
// Background monitor (plug schedules + recovery watchdog). Started by scripts/postStart.sh or from the Hub UI.
// Deliberately NOT named api.php: FPP auto-loads api.php from every plugin.
if (php_sapi_name() !== 'cli') {
    exit;
}
require_once __DIR__ . '/lib/Monitor.php';
HubMonitor::run();
