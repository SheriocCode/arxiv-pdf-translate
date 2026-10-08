; Arxiv PDF Translate - Inno Setup installer
;
; Build (after tools\build-release.ps1 produced dist\payload\):
;   iscc /DVersion=0.5.0 installer\ArxivPdfTranslate.iss
;
; Installs per-user (no admin) to %LOCALAPPDATA%\ArxivPdfTranslate, bundles the
; engine, and creates shortcuts / optional autostart. User data (config.json,
; storage\) is not part of the payload, so upgrades keep it and uninstall can
; remove the whole folder.

#ifndef Version
  #define Version "0.0.0"
#endif

#define AppName "Arxiv PDF Translate"
#define AppExe "launcher\ArxivPdfTranslate.exe"
#define AppId "{{8F2C1A44-6B3E-4D9C-9E27-5A1F3C7B9D42}"
#define Payload "..\dist\payload"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#Version}
AppVerName={#AppName} {#Version}
AppPublisher=SheriocCode
AppPublisherURL=https://github.com/SheriocCode/arxiv-pdf-translate
AppSupportURL=https://github.com/SheriocCode/arxiv-pdf-translate
DefaultDirName={localappdata}\ArxivPdfTranslate
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=lowest
OutputDir=..\dist\release
OutputBaseFilename=ArxivPdfTranslate-Setup-v{#Version}
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"
Name: "autostart"; Description: "开机自动启动（登录时在托盘静默运行）"; GroupDescription: "附加任务:"

[Files]
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "BrowserPDFTranslate"; ValueData: """{app}\{#AppExe}"" --tray"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
procedure StopExisting();
var
  ResultCode: Integer;
begin
  { Stop the tray launcher and the local server so files are not locked. }
  Exec('powershell',
    '-NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ' +
    '$_.CommandLine -like ''*server.py*'' -or $_.Name -eq ''ArxivPdfTranslate.exe'' } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(600);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopExisting();
end;

function InitializeUninstall(): Boolean;
begin
  StopExisting();
  Result := True;
end;
