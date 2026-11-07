<?php
// Simple error-reporting probe
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

echo "<h1>PHP Environment Check</h1>";
echo "PHP Version: " . phpversion() . "<br>";
echo "Document Root: " . $_SERVER['DOCUMENT_ROOT'] . "<br>";
echo "Current File: " . __FILE__ . "<br>";

$autoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload)) {
    echo "✅ vendor/autoload.php found!<br>";
    try {
        require $autoload;
        echo "✅ Composer autoloader loaded successfully!<br>";
    } catch (\Throwable $e) {
        echo "❌ Error loading autoloader: " . $e->getMessage() . "<br>";
    }
} else {
    echo "❌ <strong>vendor/autoload.php NOT FOUND!</strong> (Did you extract vendor.zip into htdocs?)<br>";
}

$env = __DIR__ . '/.env';
if (file_exists($env)) {
    echo "✅ .env file exists!<br>";
} else {
    echo "❌ <strong>.env file NOT found!</strong><br>";
}

$storage = __DIR__ . '/storage';
if (is_dir($storage) && is_writable($storage)) {
    echo "✅ storage/ directory exists and is writable!<br>";
} else {
    echo "⚠️ storage/ directory status: exists=" . (is_dir($storage)?'yes':'no') . ", writable=" . (is_writable($storage)?'yes':'no') . "<br>";
}

echo "<hr><h3>Testing Laravel Bootstrap:</h3>";
try {
    if (file_exists($autoload)) {
        $app = require_once __DIR__ . '/bootstrap/app.php';
        echo "✅ Laravel application bootstrapped successfully!<br>";
    }
} catch (\Throwable $e) {
    echo "❌ <strong>Laravel bootstrap failed:</strong><br>";
    echo "<pre>" . $e->getMessage() . "\n" . $e->getTraceAsString() . "</pre>";
}
