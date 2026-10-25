@echo off
setlocal
rem Build both targets, then zip each dist folder for store submission.
cd /d "%~dp0"
set "ZIP=YoutubeFauxFullscreen.zip"

call npm run build || exit /b 1

for %%B in (chromium firefox) do (
  pushd "dist\%%B" || exit /b 1
  if exist "%ZIP%" del /f /q "%ZIP%"
  rem Windows tar writes forward-slash paths, which Firefox's store requires.
  "%SystemRoot%\System32\tar.exe" -a -cf "%ZIP%" --exclude "%ZIP%" * || (popd & exit /b 1)
  popd
  echo Created dist\%%B\%ZIP%
)
