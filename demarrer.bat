@echo off
setlocal
cd /d "%~dp0"
title GTrace - demarrage

echo ============================================
echo   GTrace - Debogueur T-SQL time-travel
echo ============================================
echo.

REM --- 1. .NET dans le PATH (sinon installation locale hors PATH) ---
where dotnet >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Microsoft\dotnet\dotnet.exe" (
    set "PATH=%LOCALAPPDATA%\Microsoft\dotnet;%PATH%"
    echo [i] .NET local ajoute au PATH de cette session.
  ) else (
    echo [!] .NET introuvable : le sidecar ne pourra pas etre compile.
  )
)

REM --- 2. Dependances npm ---
if not exist "node_modules" (
  echo [1/4] Installation des dependances npm ^(peut prendre une minute^)...
  call npm install
) else (
  echo [1/4] Dependances npm : OK
)

REM --- 3. Sidecar .NET (parseur ScriptDom) - requis au runtime ---
if not exist "resources\sidecar\GTrace.Parser.exe" (
  echo [2/4] Compilation du sidecar .NET ScriptDom...
  call npm run build:sidecar
) else (
  echo [2/4] Sidecar .NET : OK
)

REM --- 4. Conteneur SQL Server de dev (base gestfit-bluefit) ---
docker info >nul 2>nul
if errorlevel 1 (
  echo [3/4] [!] Docker Desktop n'est pas demarre.
  echo         Lancez-le pour acceder a la base gestfit-bluefit, puis relancez.
) else (
  echo [3/4] Demarrage du conteneur SQL gtrace-sql...
  docker start gtrace-sql >nul 2>nul
)

REM --- 5. Lancement de l'application (bloquant) ---
echo [4/4] Lancement de GTrace...
echo.
call npm run dev

endlocal
