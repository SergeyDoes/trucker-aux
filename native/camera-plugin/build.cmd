@echo off
rem Builds trucker_aux_camera.dll (Release, x64) into out\ with Visual Studio 2022's C++ tools.
setlocal
set "HERE=%~dp0"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo vswhere.exe not found: install Visual Studio 2022 with "Desktop development with C++".
  exit /b 1
)
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (
  echo Visual Studio with the C++ x64 tools not found.
  exit /b 1
)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
if not exist "%HERE%out" mkdir "%HERE%out"
rem /MT: the C runtime linked in, so the game needs no redistributable.
cl /nologo /O2 /W4 /MT /LD /EHsc /DNDEBUG ^
  /I "%HERE%..\..\third_party\scs-sdk-plugin\scs_sdk\include" ^
  "%HERE%trucker_aux_camera.cpp" ^
  /Fo"%HERE%out\\" /Fe"%HERE%out\trucker_aux_camera.dll" ^
  /link /DEF:"%HERE%trucker_aux_camera.def" kernel32.lib || exit /b 1
echo Built %HERE%out\trucker_aux_camera.dll
