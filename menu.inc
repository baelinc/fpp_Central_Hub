<?php
// FPP includes this once per top-level menu; only add our links under "Status / Control".
if (isset($menu) && $menu === 'status') {
    echo '<li><a href="plugin.php?plugin=fpp_Central_Hub&page=dashboard.php">Central Hub</a></li>';
    echo '<li><a href="plugin.php?plugin=fpp_Central_Hub&page=settings.php">Central Hub Settings</a></li>';
}
