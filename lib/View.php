<?php
require_once __DIR__ . '/Store.php';

function hub_asset($f)
{
    return 'plugin.php?plugin=fpp_Central_Hub&file=assets/' . $f . '&nopage=1&v=' . HubStore::VERSION;
}

/** Render a Hub page: a fragment inside FPP, or a complete HTML document when opened with nopage=1 (kiosk/phone). */
function hub_render($which, array $o = array())
{
    $standalone = isset($_GET['nopage']);
    $kiosk = !empty($o['kiosk']);
    $cfg = HubStore::load();
    $sfx = $standalone ? '&nopage=1' : '';
    $kind = isset($_GET['kind']) && in_array($_GET['kind'], array('fpp', 'controller', 'plug'), true) ? $_GET['kind'] : '';
    $boot = array(
        'apiUrl' => 'plugin.php?plugin=fpp_Central_Hub&page=hub_api.php&nopage=1',
        'kiosk' => $kiosk,
        'standalone' => $standalone,
        'dashUrl' => 'plugin.php?plugin=fpp_Central_Hub&page=dashboard.php' . $sfx,
        'settingsUrl' => ($standalone ? '' : '') . 'plugin.php?' . ($standalone ? '' : '_menu=status&') . 'plugin=fpp_Central_Hub&page=settings.php' . $sfx,
        'kioskUrl' => 'plugin.php?plugin=fpp_Central_Hub&page=kiosk.php&nopage=1',
        'kind' => $kind,
        'cols' => isset($_GET['cols']) ? max(1, min(8, (int) $_GET['cols'])) : 0,
        'readonly' => !empty($_GET['readonly']),
        'version' => HubStore::VERSION,
    );
    $theme = $cfg['options']['theme'] === 'light' ? 'light' : 'dark';
    if ($standalone) {
        echo "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">";
        echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
        echo '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">';
        echo '<meta name="theme-color" content="#080d1a">';
        echo '<title>' . htmlspecialchars($kiosk ? $cfg['options']['kioskTitle'] : 'FPP Central Hub') . '</title>';
        echo '<link rel="stylesheet" href="' . hub_asset('hub.css') . '">';
        echo '</head><body class="hb-page" data-theme="' . $theme . '">';
    } else {
        echo '<link rel="stylesheet" href="' . hub_asset('hub.css') . '">';
    }
    echo '<div id="hub-root" class="hub" data-theme="' . $theme . '"><noscript>FPP Central Hub needs JavaScript.</noscript></div>';
    echo '<script>window.HUB_BOOT=' . json_encode($boot, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>';
    echo '<script src="' . hub_asset('common.js') . '"></script>';
    echo '<script src="' . hub_asset($which === 'settings' ? 'settings.js' : 'hub.js') . '"></script>';
    if ($standalone) {
        echo '</body></html>';
    }
}
