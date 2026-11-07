@echo off
REM ==========================================================================
REM  Inertia POS - Standalone offline launcher (Windows)
REM  Starts the local POS server on this computer and opens it in the browser.
REM  No internet connection is required. Close this window to stop the POS.
REM ==========================================================================
setlocal
cd /d "%~dp0"

set "POS_HOST=127.0.0.1"
set "POS_PORT=8000"
set "POS_URL=http://%POS_HOST%:%POS_PORT%"

REM --- Locate PHP (PATH first, then a bundled php\ folder, then Laragon) ---
set "PHP="
where php >nul 2>nul && set "PHP=php"
if not defined PHP if exist "%~dp0php\php.exe" set "PHP=%~dp0php\php.exe"
if not defined PHP for /d %%D in ("C:\laragon\bin\php\php-8*") do set "PHP=%%D\php.exe"
if not defined PHP (
    echo [ERROR] PHP 8.2+ was not found. Install PHP or place it in a "php" folder next to this file.
    pause
    exit /b 1
)

REM --- Load required extensions (SQLite, Sodium) if php.ini does not already enable them ---
set "PHPFLAGS="
"%PHP%" -m | findstr /i /x "pdo_sqlite" >nul || set "PHPFLAGS=-d extension=pdo_sqlite -d extension=sqlite3"
"%PHP%" -m | findstr /i /x "sodium" >nul || set "PHPFLAGS=%PHPFLAGS% -d extension=sodium"

REM --- Prepare database / caches (safe to run every launch) ---
"%PHP%" %PHPFLAGS% artisan pos:install --no-interaction
if errorlevel 1 (
    echo [ERROR] The POS could not be prepared. See the messages above.
    pause
    exit /b 1
)

REM --- Open the POS once the server is up (Edge app window if available) ---
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
    start "" cmd /c "timeout /t 2 >nul & start "" "%EDGE%" --app=%POS_URL%"
) else (
    start "" cmd /c "timeout /t 2 >nul & start "" %POS_URL%"
)

echo.
echo  Inertia POS is running at %POS_URL%
echo  Keep this window open while using the POS. Close it to stop the POS.
echo.

REM --- Serve from public\ (same as "php artisan serve") with Laravel's router script ---
pushd public
"%PHP%" %PHPFLAGS% -S %POS_HOST%:%POS_PORT% ..\vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php
popd
