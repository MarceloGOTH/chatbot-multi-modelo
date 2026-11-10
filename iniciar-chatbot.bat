@echo off
setlocal
title Nexo - Chatbot
cd /d "%~dp0"
if errorlevel 1 goto :error

rem Buscar Node tambien en su ubicacion habitual si no esta en el PATH.
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  )
)
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js 24 o superior y vuelve a abrir este archivo.
  goto :error
)
node -e "if(Number(process.versions.node.split('.')[0]) < 24) { console.error('Se necesita Node.js 24 o superior.'); process.exit(1); }"
if errorlevel 1 goto :error
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo No se encontro npm. Reinstala Node.js incluyendo npm.
  goto :error
)

if not defined PORT set "PORT=3000"
rem Compartir Nexo con los dispositivos de la red local.
set "HOST=0.0.0.0"
node -e "const p=Number(process.env.PORT); if(!Number.isInteger(p)||p<1||p>65535) { console.error('PORT debe ser un numero entre 1 y 65535.'); process.exit(1); }"
if errorlevel 1 goto :error

node scripts\network.mjs
if errorlevel 1 goto :error

rem Si Nexo ya esta abierto, reutilizar el servidor existente.
if /i "%~1"=="--check" goto :prepare
powershell -NoProfile -Command "try { $s = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $env:PORT + '/api/state') -TimeoutSec 2; if ($s.token -and $null -ne $s.chats -and $null -ne $s.providers) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Nexo ya esta funcionando. Abriendo el navegador...
  echo Si esa instancia se inicio antes de habilitar la red, detenla y vuelve a abrir este archivo.
  start "" "http://localhost:%PORT%"
  exit /b 0
)

:prepare
if not exist "node_modules\typescript\bin\tsc" (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 goto :error
)

echo Compilando la aplicacion...
call npm.cmd run build
if errorlevel 1 goto :error
if /i "%~1"=="--check" (
  echo Preparacion completada correctamente.
  exit /b 0
)

echo.
echo Iniciando Nexo en http://localhost:%PORT%
echo Conserva esta ventana abierta. Para detener el servidor, presiona Ctrl+C.
echo.
rem Abrir el navegador cuando la API este lista, sin otra ventana visible.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 60; $i++) { try { $s = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $env:PORT + '/api/state') -TimeoutSec 1; if ($s.token) { Start-Process ('http://localhost:' + $env:PORT); exit } } catch {}; Start-Sleep -Milliseconds 500 }" >nul 2>nul
call npm.cmd start
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo No se pudo iniciar Nexo. Revisa el mensaje anterior.
pause
exit /b 1
