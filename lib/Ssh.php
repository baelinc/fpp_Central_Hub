<?php
/**
 * SSH via the system `ssh` binary. Passwords are fed through SSH_ASKPASS (OpenSSH 8.4+, SSH_ASKPASS_REQUIRE=force),
 * so no sshpass package and no PHP ssh2 extension are needed. The password is passed by environment variable,
 * never on the command line.
 */
class HubSsh
{
    public static function available()
    {
        return trim((string) @shell_exec('command -v ssh 2>/dev/null')) !== '';
    }

    /** returns array(ok, output) */
    public static function run($host, $port, $user, $pass, $command, $timeout = 15)
    {
        if (!self::available()) {
            return array(false, 'The ssh client is not installed on this device');
        }
        if (!preg_match('/^[A-Za-z0-9._-]+$/', (string) $user) || !preg_match('/^[A-Za-z0-9.:-]+$/', (string) $host)) {
            return array(false, 'Invalid SSH user or host');
        }
        $askpass = tempnam(sys_get_temp_dir(), 'hubap');
        file_put_contents($askpass, "#!/bin/sh\nprintf '%s\\n' \"\$HUB_SSH_PW\"\n");
        chmod($askpass, 0700);
        $cmd = array('ssh', '-p', (string) (int) $port, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR',
            '-o', 'ConnectTimeout=8', '-o', 'NumberOfPasswordPrompts=1', '-o', 'PreferredAuthentications=password,keyboard-interactive,publickey',
            $user . '@' . $host, $command);
        $env = array('PATH' => '/usr/local/bin:/usr/bin:/bin', 'HOME' => sys_get_temp_dir(), 'DISPLAY' => 'none:0', 'SSH_ASKPASS' => $askpass,
            'SSH_ASKPASS_REQUIRE' => 'force', 'HUB_SSH_PW' => (string) $pass);
        $spec = array(0 => array('file', '/dev/null', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w'));
        $proc = @proc_open($cmd, $spec, $pipes, null, $env);
        if (!is_resource($proc)) {
            @unlink($askpass);
            return array(false, 'Could not start ssh');
        }
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $out = '';
        $end = microtime(true) + $timeout;
        $code = null;
        while (microtime(true) < $end) {
            $out .= stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
            $st = proc_get_status($proc);
            if (!$st['running']) {
                $code = $st['exitcode'];
                break;
            }
            usleep(100000);
        }
        $out .= stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        if ($code === null) {
            proc_terminate($proc, 9);
            $out .= "\n(timed out)";
        }
        foreach ($pipes as $p) {
            fclose($p);
        }
        proc_close($proc);
        @unlink($askpass);
        $out = trim($out);
        $bad = preg_match('/permission denied|could not resolve|connection (refused|timed out|reset)|no route|timed out|host key|not found|authentication failed/i', $out);
        // a reboot/shutdown command drops the connection (exit 255) - treat as success unless ssh itself reported a failure
        $ok = !$bad && ($code === 0 || ($code === 255 && preg_match('/reboot|shutdown|poweroff|halt/i', $command)));
        return array($ok, $out === '' ? ($ok ? 'ok' : 'exit ' . var_export($code, true)) : $out);
    }

    /** Resolve the credentials a device should use. */
    public static function creds(array $cfg, array $d)
    {
        $s = isset($d['ssh']) ? $d['ssh'] : HubStore::defaultSsh();
        if (!empty($s['useDefault'])) {
            return array($cfg['options']['sshDefaultUser'], $cfg['options']['sshDefaultPass']);
        }
        return array($s['user'], $s['pass']);
    }
}
