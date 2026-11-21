#!/bin/bash
# FPP Central Hub needs php-curl (shipped with FPP). Nothing else to install.
php -r 'exit(function_exists("curl_multi_init") && function_exists("stream_socket_server") ? 0 : 1);' || echo "WARNING: PHP curl/sockets support missing - discovery will not work"
if [ "$(id -u)" = "0" ] && id fpp >/dev/null 2>&1; then chown -R fpp:fpp "$(cd "$(dirname "$0")/.." && pwd)" 2>/dev/null; fi
exit 0
