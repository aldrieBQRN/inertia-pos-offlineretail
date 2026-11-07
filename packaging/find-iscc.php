<?php
$candidates = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    getenv('LOCALAPPDATA') . '\\Programs\\Inno Setup 6\\ISCC.exe',
];
foreach ($candidates as $c) {
    if (file_exists($c)) {
        echo "FOUND: $c\n";
        exit(0);
    }
}
echo "NOT FOUND\n";
