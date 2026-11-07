<?php

require_once 'C:/laragon/www/inertia-pos-license-portal/vendor/autoload.php';
$app = require 'C:/laragon/www/inertia-pos-license-portal/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$clientName = $argv[1] ?? 'Corner Retail Store';
$machineId = $argv[2] ?? 'POS-AAD3-0752-1729-737A';

$gen = $app->make(\App\Services\LicenseGeneratorService::class);
$res = $gen->generate($clientName, $machineId);

echo json_encode($res);
