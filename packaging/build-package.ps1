# Inertia POS - Production Packaging Foundation Script
# Assembles the isolated PHP runtime, builds frontend assets, compiles launcher, and creates staging directory

$ErrorActionPreference = "Stop"
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
$stagingDir = Join-Path $PSScriptRoot "staging"
$runtimePhpDir = Join-Path $stagingDir "runtime\php"
$stagingAppDir = Join-Path $stagingDir "app"

Write-Host "=========================================================="
Write-Host " Building Inertia POS Packaging Staging Environment"
Write-Host " Root Directory: $rootDir"
Write-Host " Staging Target: $stagingDir"
Write-Host "=========================================================="

# 1. Clean previous staging
if (Test-Path $stagingDir) {
    Write-Host "Cleaning existing staging directory..."
    Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $stagingDir) {
        Start-Sleep -Milliseconds 500
        Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Path $runtimePhpDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtimePhpDir "ext") -Force | Out-Null
New-Item -ItemType Directory -Path $stagingAppDir -Force | Out-Null

# 2. Compile Native C# Launcher
Write-Host "Compiling native Windows launcher (InertiaPOS.exe)..."
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$launcherCs = Join-Path $PSScriptRoot "launcher\Program.cs"
$launcherExe = Join-Path $stagingDir "InertiaPOS.exe"

& $csc /target:winexe "/out:$launcherExe" /reference:System.Windows.Forms.dll,System.Drawing.dll,System.dll,System.Management.dll /optimize+ "$launcherCs"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to compile InertiaPOS.exe"
}
Write-Host "Launcher compiled successfully."

# 3. Assemble Minimal PHP 8.4 Runtime
Write-Host "Assembling isolated PHP runtime from Laragon..."
$sourcePhp = "C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64"

# Core binaries and libraries
$coreFiles = @(
    "php.exe",
    "php-win.exe",
    "php8.dll",
    "libsqlite3.dll",
    "libsodium.dll",
    "libcrypto-3-x64.dll",
    "libssl-3-x64.dll",
    "icudt75.dll",
    "icuin75.dll",
    "icuio75.dll",
    "icuuc75.dll",
    "nghttp2.dll",
    "libssh2.dll"
)

foreach ($file in $coreFiles) {
    $src = Join-Path $sourcePhp $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $runtimePhpDir $file) -Force
    }
}

# Required extensions
$requiredExts = @(
    "php_pdo_sqlite.dll",
    "php_sqlite3.dll",
    "php_sodium.dll",
    "php_openssl.dll",
    "php_mbstring.dll",
    "php_fileinfo.dll",
    "php_curl.dll",
    "php_intl.dll",
    "php_gd.dll",
    "php_zip.dll",
    "php_exif.dll"
)

foreach ($ext in $requiredExts) {
    $src = Join-Path $sourcePhp "ext\$ext"
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $runtimePhpDir "ext\$ext") -Force
    } else {
        throw "Required PHP extension missing: $ext"
    }
}

# Write production php.ini
$phpIniContent = @"
[PHP]
engine = On
short_open_tag = Off
precision = 14
output_buffering = 4096
zlib.output_compression = Off
implicit_flush = Off
serialize_precision = -1
zend.enable_gc = On
expose_php = Off
max_execution_time = 120
max_input_time = 60
memory_limit = 256M
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = "php_errors.log"
default_mimetype = "text/html"
default_charset = "UTF-8"
enable_dl = Off
file_uploads = On
upload_max_filesize = 10M
max_file_uploads = 20
post_max_size = 12M
extension_dir = "ext"

extension=pdo_sqlite
extension=sqlite3
extension=sodium
extension=openssl
extension=mbstring
extension=fileinfo
extension=curl
extension=intl
extension=gd
extension=zip
extension=exif

[Date]
date.timezone = UTC
"@

Set-Content -Path (Join-Path $runtimePhpDir "php.ini") -Value $phpIniContent -Encoding Ascii
Write-Host "PHP runtime assembled successfully."

# 4. Copy Laravel Application to staging
Write-Host "Copying production Laravel application files..."
$includeDirs = @("app", "bootstrap", "config", "database", "public", "routes", "vendor")
foreach ($dir in $includeDirs) {
    $src = Join-Path $rootDir $dir
    $dst = Join-Path $stagingAppDir $dir
    if (Test-Path $src) {
        robocopy "$src" "$dst" /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    }
}

# Only blade views are needed from resources at runtime (compiled JS/CSS are in public/build)
$viewsSrc = Join-Path $rootDir "resources\views"
$viewsDst = Join-Path $stagingAppDir "resources\views"
if (Test-Path $viewsSrc) {
    robocopy "$viewsSrc" "$viewsDst" /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
}

# Copy root entry files
$rootFiles = @("artisan", "composer.json", ".env.example")
foreach ($file in $rootFiles) {
    $src = Join-Path $rootDir $file
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $stagingAppDir $file) -Force
    }
}

# Create a clean production .env for the packaged app
$prodEnvContent = @"
APP_NAME="Inertia POS"
APP_ENV=production
APP_KEY=base64:Auk0pc00OHFBwama64BHcTzBPxBFBYgp3ucD+TEooJA=
APP_DEBUG=false
APP_URL=http://127.0.0.1:8000

LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=warning

DB_CONNECTION=sqlite

SESSION_DRIVER=file
SESSION_LIFETIME=720
SESSION_ENCRYPT=false

QUEUE_CONNECTION=sync
CACHE_STORE=file
AUDIT_QUEUE_ENABLED=false
MAIL_MAILER=log
"@
Set-Content -Path (Join-Path $stagingAppDir ".env") -Value $prodEnvContent -Encoding Ascii

# 5. SECURITY PURGE: Ensure no private keys or developer tools enter staging
Write-Host "Executing security purge in staging..."
$blacklistedPaths = @(
    (Join-Path $stagingAppDir "database\database.sqlite"),
    (Join-Path $stagingAppDir "storage"),
    (Join-Path $stagingAppDir "node_modules"),
    (Join-Path $stagingAppDir "tests"),
    (Join-Path $stagingAppDir "license-generator"),
    (Join-Path $stagingDir "license-generator")
)

foreach ($bPath in $blacklistedPaths) {
    if (Test-Path $bPath) {
        Remove-Item $bPath -Recurse -Force
        Write-Host "Purged: $bPath"
    }
}

# Recursively delete any .key, .secret, or .log files from staging
Get-ChildItem -Path $stagingDir -Recurse -Include "*.key", "*.secret", "*.private", "*.log" -Force | ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-Host "Purged private key or log file: $($_.FullName)"
}

Write-Host "=========================================================="
Write-Host " Staging Build Complete: $stagingDir"
Write-Host "=========================================================="
