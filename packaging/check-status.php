<?php
$desktop = getenv('USERPROFILE') . '\\Desktop';
$lnk = $desktop . '\\Inertia POS.lnk';
echo "Desktop folder: " . $desktop . "\n";
echo "Shortcut exists: " . (file_exists($lnk) ? 'YES' : 'NO') . "\n";

$localAppData = getenv('LOCALAPPDATA') . '\\InertiaPOS';
echo "Data folder: " . $localAppData . "\n";
echo "Data folder exists: " . (is_dir($localAppData) ? 'YES' : 'NO') . "\n";
if (is_dir($localAppData)) {
    $db = $localAppData . '\\database\\database.sqlite';
    echo "DB exists: " . (file_exists($db) ? 'YES (' . filesize($db) . ' bytes)' : 'NO') . "\n";
    $log = $localAppData . '\\launcher.log';
    if (file_exists($log)) {
        echo "=== Last 20 lines of launcher.log ===\n";
        $lines = file($log);
        $tail = array_slice($lines, -20);
        echo implode('', $tail);
        echo "=====================================\n";
    }
}
