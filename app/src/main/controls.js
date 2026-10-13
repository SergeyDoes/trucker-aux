// The cab's keys and controller buttons (shared/controls.js), polled in a process of their own
// (input-poller.js): the Windows joystick API under it has brought the whole app down before.
// Gone, that process is started again and the music plays on. It runs only while something is
// bound or a binding is pressed.
import { utilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBound } from '../shared/controls.js';

const POLLER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'input-poller.js');
const RESTART_MS = 2000;
const RESTARTS = 5;                     // within RESTART_WINDOW_MS; then it stays down, with a warning
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const RESCAN_MS = 1000;                 // devices changing come in bursts
const NAMES_MS = 3000;

// onAction(action): a binding fired. onError(message): the controls do not work.
export function createControls({ onAction, onError = () => {} }) {
  let bindings = { next: [], previous: [], auto: [] };
  let child = null;
  let capture = null;  // resolve of the capture waiting for a combination
  let naming = [];     // resolves of the names asked for
  let crashes = [];
  let restartTimer = null;
  let rescanTimer = null;
  let stopped = false;

  const wanted = () => !stopped && (isBound(bindings) || Boolean(capture));
  const send = (message) => child?.postMessage(message);

  function settleCapture(ids) {
    const resolve = capture;
    capture = null;
    resolve?.(ids);
    update();
  }

  function settleNames(names) {
    const waiting = naming;
    naming = [];
    for (const resolve of waiting) resolve(names);
  }

  function start() {
    if (child || restartTimer) return;
    const forked = utilityProcess.fork(POLLER, [], { serviceName: 'Trucker AUX input' });
    child = forked;
    forked.on('message', (message) => {
      if (message.type === 'action') onAction(message.action);
      else if (message.type === 'error') onError(message.message);
      else if (message.type === 'captured') settleCapture(message.ids);
      else if (message.type === 'names') settleNames(message.names);
    });
    forked.on('exit', () => {
      if (child !== forked) return; // one stopped on purpose, another may run already
      child = null;
      settleNames({});
      if (capture) settleCapture(null);
      if (!wanted()) return;
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < RESTART_WINDOW_MS), now];
      if (crashes.length > RESTARTS) {
        onError('Keys and controller buttons stopped: the controllers\' driver keeps failing. Restart the app to try again.');
        return;
      }
      restartTimer = setTimeout(() => {
        restartTimer = null;
        update();
      }, RESTART_MS);
    });
    send({ type: 'bindings', bindings });
  }

  // The poller runs while it is wanted, with the bindings it should watch.
  function update() {
    if (wanted()) {
      start();
      send({ type: 'bindings', bindings });
    } else if (child) {
      const stopping = child;
      child = null;
      stopping.kill();
    }
  }

  return {
    // bindings: settings.controls (shared/controls.js normalizeControls).
    setBindings(next) {
      bindings = next;
      update();
    },
    // The next combination pressed (ids), or null: Escape, cancelCapture, nothing for 15 s, or
    // the poller gone.
    capture() {
      if (capture) settleCapture(null);
      return new Promise((resolve) => {
        capture = resolve;
        update();
        send({ type: 'capture' });
      });
    },
    cancelCapture() {
      send({ type: 'cancel' });
      if (capture) settleCapture(null);
    },
    // The names Windows gives the controllers bound or plugged in: { "vid:pid": name }.
    names() {
      if (!child) return Promise.resolve({});
      return new Promise((resolve) => {
        naming.push(resolve);
        send({ type: 'names' });
        setTimeout(() => settleNames({}), NAMES_MS);
      });
    },
    // Windows says the devices changed (main.js: WM_DEVICECHANGE): the controllers are looked
    // for again.
    devicesChanged() {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(() => send({ type: 'rescan' }), RESCAN_MS);
    },
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      clearTimeout(rescanTimer);
      update();
    },
  };
}
