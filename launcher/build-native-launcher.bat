@echo off
setlocal
set "HERE=%~dp0"

rem Locate gcc and make sure its own bin dir wins on PATH (avoids picking up
rem conflicting mingw DLLs from other toolchains, e.g. conda).
set "GCCDIR="
for /f "delims=" %%I in ('where gcc 2^>nul') do (
  if not defined GCCDIR set "GCCDIR=%%~dpI"
)
if not defined GCCDIR (
  echo Could not find gcc ^(MinGW-w64^) in PATH.
  echo Install MinGW-w64, or build manually:
  echo   gcc -O2 -s -static -municode -mwindows -o ArxivPdfTranslate.exe native\launcher.c -luser32 -lshell32 -lgdi32 -lole32 -luuid -lws2_32 -ladvapi32
  exit /b 1
)
set "PATH=%GCCDIR%;%PATH%"

gcc -O2 -s -static -municode -mwindows ^
  -o "%HERE%ArxivPdfTranslate.exe" ^
  "%HERE%native\launcher.c" ^
  -luser32 -lshell32 -lgdi32 -lole32 -luuid -lws2_32 -ladvapi32

if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Built "%HERE%ArxivPdfTranslate.exe"
