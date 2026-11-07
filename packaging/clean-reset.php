<?php
$localAppData = getenv('LOCALAPPDATA') . '\\InertiaPOS';
echo "Cleaning data directory: $localAppData\n";

function deleteDirectory($dir) {
    if (!file_exists($dir)) {
        return true;
    }
    if (!is_dir($dir)) {
        return unlink($dir);
    }
    foreach (scandir($dir) as $item) {
        if ($item == '.' || $item == '..') {
            continue;
        }
        if (!deleteDirectory($dir . DIRECTORY_SEPARATOR . $item)) {
            return false;
        }
    }
    return rmdir($dir);
}

if (is_dir($localAppData)) {
    // Delete database, storage, port.txt, edge-profile
    @unlink($localAppData . '\\port.txt');
    @unlink($localAppData . '\\launcher.log');
    deleteDirectory($localAppData . '\\database');
    deleteDirectory($localAppData . '\\storage');
    deleteDirectory($localAppData . '\\edge-profile');
    echo "Cleaned database, storage, port.txt, and edge-profile.\n";
} else {
    echo "Data directory does not exist.\n";
}

$desktop = getenv('USERPROFILE') . '\\Desktop\\Inertia POS.lnk';
if (file_exists($desktop)) {
    @unlink($desktop);
    echo "Removed old desktop shortcut.\n";
} else {
    echo "No old desktop shortcut found.\n";
}
echo "Clean reset complete.\n";
