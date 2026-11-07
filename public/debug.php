<?php
// Simple error-reporting probe
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

echo "<h1>PHP Environment Check</h1>";
echo "PHP Version: " . phpversion() . "<br>";
echo "Document Root: " . ($_SERVER['DOCUMENT_ROOT'] ?? 'unknown') . "<br>";
echo "Current File: " . __FILE__ . "<br>";

$baseDir = dirname(__DIR__);
$autoload = $baseDir . '/vendor/autoload.php';
if (file_exists($autoload)) {
    echo "✅ vendor/autoload.php found at " . $autoload . "<br>";
    try {
        require $autoload;
        echo "✅ Composer autoloader loaded successfully!<br>";
    } catch (\Throwable $e) {
        echo "❌ Error loading autoloader: " . $e->getMessage() . "<br>";
    }
} else {
    echo "❌ <strong>vendor/autoload.php NOT FOUND!</strong> Looking at: " . $autoload . "<br>";
}

$env = $baseDir . '/.env';
if (file_exists($env)) {
    echo "✅ .env file exists at " . $env . "<br>";
} else {
    echo "❌ <strong>.env file NOT found!</strong> Looking at: " . $env . "<br>";
}

$storage = $baseDir . '/storage';
$views = $storage . '/framework/views';
$sessions = $storage . '/framework/sessions';
echo "storage/ exists: " . (is_dir($storage) ? 'yes' : 'no') . "<br>";
echo "storage/framework/views exists: " . (is_dir($views) ? 'yes' : 'no') . "<br>";
echo "storage/framework/sessions exists: " . (is_dir($sessions) ? 'yes' : 'no') . "<br>";

echo "<hr><h3>Testing Laravel Bootstrap:</h3>";
try {
    if (file_exists($autoload)) {
        $app = require_once $baseDir . '/bootstrap/app.php';
        echo "✅ Laravel application bootstrapped successfully!<br>";
    }
} catch (\Throwable $e) {
    echo "❌ <strong>Laravel bootstrap failed:</strong><br>";
    echo "<pre>" . $e->getMessage() . "\n" . $e->getTraceAsString() . "</pre>";
}
