<?php
/** Plug schedules: windows during which a plug (and the devices it powers) is expected to be ON. */
class HubSchedule
{
    public static function valid(array $s)
    {
        return isset($s['on'], $s['off']) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $s['on']) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $s['off'])
            && !empty($s['days']) && is_array($s['days']);
    }

    private static function mins($hhmm)
    {
        return (int) substr($hhmm, 0, 2) * 60 + (int) substr($hhmm, 3, 2);
    }

    public static function clean($list)
    {
        $out = array();
        foreach ((array) $list as $s) {
            if (!is_array($s)) {
                continue;
            }
            $s['days'] = array_values(array_unique(array_map('intval', isset($s['days']) ? (array) $s['days'] : array())));
            if (self::valid($s)) {
                $out[] = array('days' => $s['days'], 'on' => $s['on'], 'off' => $s['off'], 'enforce' => !empty($s['enforce']));
            }
        }
        return $out;
    }

    public static function inWindow(array $s, $ts)
    {
        $dow = (int) date('w', $ts);
        $m = (int) date('G', $ts) * 60 + (int) date('i', $ts);
        $on = self::mins($s['on']);
        $off = self::mins($s['off']);
        if ($off > $on) {
            return in_array($dow, $s['days'], true) && $m >= $on && $m < $off;
        }
        if ($off === $on) {
            return in_array($dow, $s['days'], true); // same time = all day
        }
        $prev = ($dow + 6) % 7;
        return (in_array($dow, $s['days'], true) && $m >= $on) || (in_array($prev, $s['days'], true) && $m < $off);
    }

    /** null when the plug has no schedule, otherwise whether now is inside any window. */
    public static function plugWindow(array $plug, $ts)
    {
        if (empty($plug['schedules'])) {
            return null;
        }
        foreach ($plug['schedules'] as $s) {
            if (self::inWindow($s, $ts)) {
                return true;
            }
        }
        return false;
    }

    /** Edge events due now (within $lateSec after the exact time): array of array(key, 'on'|'off'). */
    public static function dueEdges(array $plug, $ts, $lateSec = 600)
    {
        $out = array();
        foreach ((array) (isset($plug['schedules']) ? $plug['schedules'] : array()) as $s) {
            if (empty($s['enforce'])) {
                continue;
            }
            foreach (array('on', 'off') as $edge) {
                for ($back = 0; $back <= $lateSec; $back += 60) {
                    $t = $ts - $back;
                    $dayOfEdge = (int) date('w', $t);
                    if ($edge === 'off' && self::mins($s['off']) <= self::mins($s['on'])) {
                        $dayOfEdge = ((int) date('w', $t) + 6) % 7; // overnight window: the off edge belongs to the previous day's schedule
                    }
                    if (date('H:i', $t) === $s[$edge] && in_array($dayOfEdge, $s['days'], true)) {
                        $out[] = array($plug['id'] . '|' . date('Ymd', $t) . '|' . $edge . '|' . $s[$edge], $edge);
                        break;
                    }
                }
            }
        }
        return $out;
    }
}
