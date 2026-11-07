; Inertia POS - Inno Setup Installer Script
; Packages the bundled PHP runtime, pre-compiled Laravel application, and native launcher.

#define MyAppName "Inertia POS"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Inertia Solutions"
#define MyAppExeName "InertiaPOS.exe"

[Setup]
AppId={{8B324317-0A63-4C41-8630-B1479F224E99}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Inertia POS
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\dist
OutputBaseFilename=Inertia-POS-Setup-v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DisableDirPage=no
DisableProgramGroupPage=no
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; The entire staging folder is copied into {app}
Source: "..\staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// Protect customer data during uninstallation
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  MsgResult: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\InertiaPOS');
    if DirExists(DataDir) then
    begin
      MsgResult := MsgBox(
        'Do you want to permanently remove your POS customer data (SQLite database, sales history, inventory, and license activation)?' + #13#10 + #13#10 +
        'Click "No" to preserve your database and license for future updates or reinstallation.' + #13#10 +
        'Click "Yes" to delete all data.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2
      );

      if MsgResult = IDYES then
      begin
        DelTree(DataDir, True, True, True);
      end;
    end;
  end;
end;
