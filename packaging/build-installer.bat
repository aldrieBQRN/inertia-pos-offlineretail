@echo off
set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"

if not exist "%ISCC%" (
    echo [ERROR] Inno Setup compiler ISCC.exe not found!
    exit /b 1
)

echo Compiling installer using: %ISCC%
"%ISCC%" "%~dp0installer\InertiaPOS.iss"
if errorlevel 1 (
    echo [ERROR] Inno Setup compilation failed!
    exit /b 1
)

echo [SUCCESS] Installer generated in packaging\dist\
