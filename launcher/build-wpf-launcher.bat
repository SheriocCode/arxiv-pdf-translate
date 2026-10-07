@echo off
setlocal
set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "PROJ=%%~fI"

set "MSB=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
if not exist "%MSB%" set "MSB=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\MSBuild.exe"
if not exist "%MSB%" (
  echo Could not find MSBuild.exe ^(.NET Framework 4.x^).
  exit /b 1
)

rem Find a Roslyn csc.exe (the theme uses C# 7; the framework csc only supports C# 5).
set "CSC="
for %%P in (
  "%ProgramFiles(x86)%\Microsoft SDKs\UWPNuGetPackages\microsoft.net.native.compiler\2.2.10-rel-29722-00\tools\csc\csc.exe"
  "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\Roslyn\csc.exe"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\Roslyn\csc.exe"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\Roslyn\csc.exe"
) do (
  if not defined CSC if exist %%P set "CSC=%%~P"
)

if not defined CSC goto :nrosc
echo Using Roslyn csc: %CSC%
for %%D in ("%CSC%") do set "CSCDIR=%%~dpD"
if "%CSCDIR:~-1%"=="\" set "CSCDIR=%CSCDIR:~0,-1%"
"%MSB%" "%HERE%wpf\ArxivPdfTranslateWpf.csproj" -p:Configuration=Release "-p:CscToolPath=%CSCDIR%" -p:CscToolExe=csc.exe -v:minimal -nologo
goto :after

:nrosc
echo WARNING: no Roslyn csc found; trying the framework compiler ^(may fail on C# 7^).
"%MSB%" "%HERE%wpf\ArxivPdfTranslateWpf.csproj" -p:Configuration=Release -v:minimal -nologo

:after
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

copy /y "%HERE%wpf\bin\Release\ArxivPdfTranslateWpf.exe" "%HERE%ArxivPdfTranslateWpf.exe" >nul
echo Built "%HERE%ArxivPdfTranslateWpf.exe"
