<?php
// Minimal stand-in for FPP's www/plugin.php, used only for local testing.
$GLOBALS['settings'] = array('HostName' => 'test-fpp', 'configDirectory' => getenv('HUB_DATA_DIR') ?: '/tmp/hubdata');
$settings = $GLOBALS['settings'];
$base = realpath(__DIR__ . '/..');
if (isset($_GET['file'])) {
    $p = realpath($base . '/' . $_GET['file']);
    if (!$p || strpos($p, $base . '/') !== 0 || !is_file($p)) { http_response_code(404); exit('nf'); }
    $ext = pathinfo($p, PATHINFO_EXTENSION);
    header('Content-Type: ' . ($ext === 'css' ? 'text/css' : ($ext === 'js' ? 'text/javascript' : 'text/plain')));
    readfile($p); exit;
}
$page = isset($_GET['page']) ? $_GET['page'] : '';
$p = realpath($base . '/' . $page);
if (!$p || strpos($p, $base . '/') !== 0 || !is_file($p)) { http_response_code(404); exit('Error with plugin, requesting a page that doesn\'t exist'); }
if (!isset($_GET['nopage'])) { echo "<!DOCTYPE html><html><head><link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'></head><body><div class='container'><h1>FPP Central Hub</h1>"; }
include $p;
if (!isset($_GET['nopage'])) { echo "</div></body></html>"; }
