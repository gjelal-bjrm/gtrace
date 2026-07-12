@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===================================================
echo   GTrace - construction de l'installeur Windows
echo ===================================================
echo.

REM --- Verifie que Node est disponible ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js est introuvable dans le PATH.
    echo Installe Node 20 LTS depuis https://nodejs.org puis relance ce script.
    echo.
    pause
    exit /b 1
)

REM --- Verifie la version majeure de Node ( >= 20 requis ) ---
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
echo Node detecte : version !NODE_MAJOR!.x
if !NODE_MAJOR! LSS 20 (
    echo.
    echo [ERREUR] Node !NODE_MAJOR! est trop ancien. GTrace exige Node 20+.
    echo.
    pause
    exit /b 1
)
echo.

REM --- Sidecar ScriptDom : embarque tel quel par l'installeur. S'il est deja
REM compile (resources\sidecar), la construction ne necessite PAS le SDK .NET 8.
REM On ne le (re)compile que s'il manque (dotnet requis dans ce cas seulement).
if exist "resources\sidecar\GTrace.Parser.exe" (
  echo Sidecar : deja compile ^(dotnet non requis^).
) else (
  echo Sidecar absent : compilation requise ^(SDK .NET 8^)...
  call npm run build:sidecar
  if errorlevel 1 (
    echo [ERREUR] Compilation du sidecar echouee. Installe le SDK .NET 8 :
    echo   https://dotnet.microsoft.com/download/dotnet/8.0
    pause
    exit /b 1
  )
)
echo.

REM --- Installe les dependances si besoin ---
set NEED_INSTALL=
if not exist "node_modules" set NEED_INSTALL=1
if not exist "node_modules\electron-builder" set NEED_INSTALL=1
if not exist "node_modules\electron-updater" set NEED_INSTALL=1
if defined NEED_INSTALL (
    echo Installation / mise a jour des dependances...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [ERREUR] npm install a echoue.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM --- Construit l'installeur (sidecar + app + NSIS) ---
echo Construction de l'installeur ^(npm run dist^)...
echo Cette etape peut prendre quelques minutes.
echo.
call npm run dist
if errorlevel 1 (
    echo.
    echo [ERREUR] La construction a echoue.
    echo - Si l'erreur mentionne un certificat ^(unable to verify^), c'est le
    echo   telechargement des outils electron-builder bloque par un proxy.
    echo - Si elle mentionne dotnet, verifie le SDK .NET 8.
    echo.
    pause
    exit /b 1
)

echo.
echo ===================================================
echo   Termine ! Installeur genere dans le dossier dist :
echo ===================================================
dir /b "dist\*.exe" 2>nul
echo.
echo Ouverture du dossier dist...
start "" explorer "%~dp0dist"
echo.
echo Double-clique sur GTrace-Setup-x.y.z.exe pour installer GTrace.
echo ^(Au 1er lancement, Windows SmartScreen peut avertir : app non signee,
echo  clique sur "Informations complementaires" puis "Executer quand meme".^)
echo.
pause
endlocal
