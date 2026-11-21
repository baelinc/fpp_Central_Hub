<?php
require_once __DIR__ . '/lib/View.php';
hub_render('dashboard', isset($HUB_KIOSK) ? array('kiosk' => true) : array());
