<?php
// Standalone, phone/kiosk friendly dashboard. Open with &nopage=1 so FPP's own menus are skipped.
// Optional URL parameters:  &kind=plug|controller|fpp   &cols=3   &readonly=1
$_GET['nopage'] = 1;
$HUB_KIOSK = true;
require __DIR__ . '/dashboard.php';
