// The voice that says which variant plays (docs/superpowers/specs/2026-10-10-controls-voice-
// design.md): offline Windows speech (System.Speech, an English voice) in a PowerShell helper,
// started at the first phrase and ended with the app. A phrase comes back as WAV bytes, which the
// window plays on its output device. Without PowerShell or a voice there is no voice.
import { spawn } from 'node:child_process';

// Reads a phrase a line, writes its WAV as one base64 line ("" when it could not be said).
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$english = $speech.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
if ($english) { $speech.SelectVoice($english.VoiceInfo.Name) }
$speech.Rate = 1
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $wave = New-Object IO.MemoryStream
    $speech.SetOutputToWaveStream($wave)
    $speech.Speak($line)
    $speech.SetOutputToNull()
    [Console]::Out.WriteLine([Convert]::ToBase64String($wave.ToArray()))
  } catch {
    [Console]::Out.WriteLine('')
  }
}
`;

// onError(message): once, when the helper cannot run.
export function createVoice({ onError = () => {} } = {}) {
  let helper = null;
  let failed = false;
  let buffer = '';
  const waiting = []; // resolve functions, in the order the phrases went

  function fail(message) {
    if (!failed) onError(`The voice does not work: ${message}`);
    failed = true;
    helper = null;
    while (waiting.length) waiting.shift()(null);
  }

  function start() {
    if (helper || failed) return helper;
    if (process.platform !== 'win32') {
      fail('Windows speech is on Windows only.');
      return null;
    }
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    helper.on('error', (err) => fail(err.message));
    helper.on('exit', (code) => {
      if (helper) fail(`the speech helper stopped (${code}).`);
    });
    helper.stdout.setEncoding('ascii');
    helper.stdout.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        const resolve = waiting.shift();
        if (resolve) resolve(line ? Buffer.from(line, 'base64') : null);
      }
    });
    return helper;
  }

  return {
    // Starts the helper ahead of the first phrase (it takes a moment).
    warm() {
      start();
    },
    // The phrase as WAV bytes (a Buffer), or null.
    speak(text) {
      const line = String(text).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!line || !start()) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiting.push(resolve);
        helper.stdin.write(`${line}\n`, 'utf8');
      });
    },
    stop() {
      const running = helper;
      helper = null;
      running?.kill();
      while (waiting.length) waiting.shift()(null);
    },
  };
}
