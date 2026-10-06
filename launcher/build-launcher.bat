@echo off
setlocal
set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "PROJ=%%~fI"

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Could not find csc.exe ^(the .NET Framework C# compiler^).
  exit /b 1
)

"%CSC%" /nologo /target:winexe /optimize+ ^
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll ^
  /win32icon:"%PROJ%\icons\icon.ico" ^
  /resource:"%PROJ%\icons\icon.ico",appicon.ico ^
  /out:"%HERE%ArxivPdfTranslate.exe" ^
  "%HERE%TrayApp.cs"

if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Built "%HERE%ArxivPdfTranslate.exe"
