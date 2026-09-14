@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo  2FA Authenticator - Docker Build Script
echo ============================================
echo.

REM Check Docker
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

echo [1/4] Building Docker image...
docker build --target packager -t 2fa-packager .
if errorlevel 1 (
    echo [ERROR] Docker build failed.
    pause
    exit /b 1
)

echo.
echo [2/4] Creating temporary container...
for /f "tokens=*" %%i in ('docker create 2fa-packager') do set CONTAINER_ID=%%i
if errorlevel 1 (
    echo [ERROR] Failed to create container.
    pause
    exit /b 1
)

echo.
echo [3/4] Copying .vsix file...
if not exist "dist" mkdir dist
docker cp "%CONTAINER_ID%:/output/vscode-2fa-authenticator.vsix" "dist\vscode-2fa-authenticator.vsix"
if errorlevel 1 (
    echo [ERROR] Failed to copy .vsix file.
    docker rm %CONTAINER_ID% >nul 2>&1
    pause
    exit /b 1
)

echo.
echo [4/4] Cleaning up container...
docker rm %CONTAINER_ID% >nul 2>&1

echo.
echo ============================================
echo  [OK] Build successful!
echo  Output: dist\vscode-2fa-authenticator.vsix
echo ============================================
echo.

set /p INSTALL="Install to VS Code now? (Y/N): "
if /i "%INSTALL%"=="Y" (
    echo Installing...
    code --install-extension "dist\vscode-2fa-authenticator.vsix"
    if errorlevel 1 (
        echo [WARN] Install failed. Run manually:
        echo   code --install-extension dist\vscode-2fa-authenticator.vsix
    ) else (
        echo [OK] Installed! Reload VS Code window: Ctrl+Shift+P -^> Reload Window
    )
)

echo.
pause
endlocal
