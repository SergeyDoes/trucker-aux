import { createEngine } from './engine.js';
import { createPanel } from './panel.js';
import { createViews } from './views.js';
import { listDevices, openInput, probeOutput } from './audio-io.js';
import {
  LABEL_COLORS, LABEL_MAX, MAX_SPEAKERS, addPair, addSpeaker, copySpeakers, linkPair, moveSpeakers, pasteSpeakers, patchSpeakers,
  defaultLayout, removeSpeakers, setCoordinate, setBoundsEdge, setWidth, shiftGains, unlinkPair,
} from '../shared/layout.js';
import { nudge } from '../shared/view.js';
import {
  EMPTY, boxSelect, clickSelect, pruneSelection, selectAll,
} from '../shared/selection.js';
import {
  addVariant, adoptPicked, adoptVehicle, allPresetKey, copyVariant, deleteVariant, moveVariant, alternatesOf, applyScope, chooseVariant, createPreset, currentScope, cycleVariant, deletePreset, dropAlternate, editLayout, exportFiles,
  importClashes, importPresets,
  keyPath, newAlternate, parseSelection, pickAlternate, planAssign, planScope, presetOptions, presetTree, rememberVehicle, resolvePlaying, scopeLabel, scopeLadder,
  scopesOf, selectionValue, truckStatus, variantChoice, variantKey,
} from '../shared/presets.js';
import { isCollectionKey } from '../shared/collection.js';
import { ask } from './dialog.js';
import { createKeyTree } from './key-tree.js';
import { branchIds, chooseExport, exportItems } from './export-dialog.js';
import { cableOutputFor, channelsWarning, pickDevice, rateWarning } from '../shared/devices.js';
import { normalizeSettings } from '../shared/settings.js';
import { isBound } from '../shared/controls.js';
import { isSilenced } from '../shared/dsp.js';
import { perceptualGain, trimFromLevels } from '../shared/loudness.js';
import { measureLoudness } from './loudness-meter.js';
import {
  cameraPoint, cameraView, createCameraWatch, createFallbackWatch, withCameraView,
} from '../shared/camera.js';
import {
  DEFAULT_HEAD_X, angleText, createFrameWatch, createPauseHold, createRamp, headRestX, lockAxes, musicSilenced, pluginWarning, turnLook, turnsToDeg,
  withTurnLook,
} from '../shared/pose.js';

const SAVE_DELAY_MS = 500;
const STATUS_PERIOD_MS = 100;

const loaded = await window.aux.load();
const state = {
  // The shared presets ride along in store.collection (presets.js); they are never saved.
  store: { ...loaded.store, collection: loaded.collection.collection },
  collectionWarnings: loaded.collection.warnings, // files in presets/ that are not presets
  settings: loaded.settings,
  debug: loaded.debug, // debug tools shown (main.js): from source, or a build started with --dev-tools
  selection: { mode: 'auto' },
  truck: null,
  pose: null,
  silenced: false, // music muted: the vehicle is parked or the game paused (settings.muteWhen, pauseBehavior)
  inWorld: false,  // game frames are coming (not the main menu or loading)
  turn: 0,          // the game's look into turns and toward the blinker, added to the head, in turns
  view: { source: null }, // the game camera's view (shared/camera.js), when trucker_aux_camera.dll runs
  cameraFallback: false, // seen in the game without the camera: the Game camera settings are shown
  heard: null,      // the pose the engine and the views were given last
  roll: 0,          // the head's roll against the cab, in turns: shown, heard unless locked (lockAxes)
  picked: EMPTY,   // selected speakers { ids, primary } (state.selection is the preset choice)
  loudnessDb: null, // the playing layout's loudness-matching trim, once measured
  clipboard: [],   // copied speakers, kept across presets for this session
  presetClip: null, // the preset copied in the tree (Ctrl+C there, or its menu's Copy), for Paste
  // Session-only, by speaker id. Ids repeat across presets, so these are cleared when
  // the truck or the chosen preset changes.
  solo: null,
  muted: new Set(),
  devices: [],
  inputId: null,
  outputId: null,
  fileUrl: null,
  storeWarnings: loaded.warnings,
  audioWarnings: [],
  pluginWarning: null, // an scs-telemetry revision the offsets were not made for (pose.js)
  controlWarning: null, // the keys and buttons, or the voice, do not work (main/controls.js, voice.js)
  capturing: null,      // the action whose binding is being pressed (Controls)
  controlNames: {},     // the controllers' names: { "vid:pid": name }
};
let audio = null; // { ctx, engine, stream, player }

// The test file is a debug tool: a release build always plays the input device.
const source = () => (state.debug ? state.settings.source : 'input');
const playing = () => resolvePlaying(state.store, state.selection, state.truck);
const order = () => playing().layout.speakers.map((s) => s.id);

function syncEngine() {
  const { layout } = playing();
  const ids = new Set(layout.speakers.map((s) => s.id));
  state.picked = pruneSelection(state.picked, order());
  if (state.solo && !ids.has(state.solo)) {
    state.solo = null;
    audio?.engine.setSolo(null);
  }
  for (const id of state.muted) if (!ids.has(id)) state.muted.delete(id);
  audio?.engine.sync(layout);
  scheduleLoudness();
}

// Loudness matching: the playing layout is measured a moment after it stops changing
// (a drag sends many edits) and trimmed to the loudness of the default two doors.
const LOUDNESS_DELAY_MS = 250;
let reference = null; // the default layout's level, measured once
let loudnessTimer = null;
let loudnessRun = 0;

function applyVolume() {
  audio?.engine.setVolume(perceptualGain(state.settings.volume));
}

// The voice's way (over everything, or from the cab's speakers) and its own volume.
function applyVoice() {
  audio?.engine.setVoice(state.settings.voice, perceptualGain(state.settings.voiceVolume));
}

function applyTrim() {
  const on = state.settings.matchLoudness && state.loudnessDb !== null;
  audio?.engine.setTrim(on ? 10 ** (state.loudnessDb / 20) : 1);
}

function scheduleLoudness() {
  clearTimeout(loudnessTimer);
  loudnessTimer = setTimeout(async () => {
    const run = ++loudnessRun;
    try {
      reference ??= measureLoudness(defaultLayout(), DEFAULT_HEAD_X);
      const [ref, level] = await Promise.all([reference, measureLoudness(playing().layout, headRestX(state.truck))]);
      if (run !== loudnessRun) return; // a newer measurement is on its way
      state.loudnessDb = trimFromLevels(ref, level);
    } catch (err) {
      state.loudnessDb = null;
      console.error('Loudness measurement failed', err);
    }
    applyTrim();
    render();
  }, LOUDNESS_DELAY_MS);
}

// Another truck or another chosen preset is another set of speakers: drop solo, mute and
// the selection. Not called when the first edit in a truck creates its preset.
function resetSession() {
  if (state.solo) audio?.engine.setSolo(null);
  for (const id of state.muted) audio?.engine.setMuted(id, false);
  state.solo = null;
  state.muted = new Set();
  state.picked = EMPTY;
}

// The engine is told only when the state flips; each call starts a new fade.
function applySilence() {
  const { muteWhen, pauseBehavior } = state.settings;
  const on = musicSilenced(state.pose, muteWhen, state.inWorld, pauseBehavior);
  if (on === state.silenced) return;
  state.silenced = on;
  audio?.engine.setSilent(on);
}

let saveTimer = null;
let savePending = false;
let frozen = false;     // File › Import under way: nothing is saved over what it brings (the window reloads)
let saveWarning = null; // a save that failed: the next one that works takes only it away
// Saves the presets now, if a save is waiting.
async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!savePending || frozen) return;
  savePending = false;
  const { collection, ...own } = state.store;
  const warning = await window.aux.saveLayouts(own);
  if (warning === saveWarning) return;
  state.storeWarnings = [...state.storeWarnings.filter((w) => w !== saveWarning), ...(warning ? [warning] : [])];
  saveWarning = warning;
  render();
}
function scheduleSave() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

async function saveSettings() {
  if (frozen) return;
  const warning = await window.aux.saveSettings(state.settings);
  if (warning) {
    state.storeWarnings = [warning];
    render();
  }
}

// Undo / redo: snapshots of your presets and keys (the shared files are not yours to undo),
// taken before each change. Changes of one kind in quick succession (a drag sends many edits)
// make one step.
const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
const history = { undo: [], redo: [], tag: null, at: 0 };
const ownStore = () => {
  const { collection, ...own } = state.store;
  return structuredClone(own);
};
function remember(tag = null) {
  // An edit puts away what was said (an import's summary and so on), not a failed save.
  state.storeWarnings = state.storeWarnings.filter((w) => w === saveWarning);
  const now = performance.now();
  if (tag && tag === history.tag && now - history.at < COALESCE_MS) {
    history.at = now;
    return;
  }
  history.undo.push(ownStore());
  if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
  history.redo = [];
  history.tag = tag;
  history.at = now;
}
function stepHistory(from, to) {
  if (!from.length) return;
  to.push(ownStore());
  const before = playing().key;
  state.store = { ...from.pop(), collection: state.store.collection };
  history.tag = null;
  if (state.selection.mode === 'truck' && !isCollectionKey(state.selection.key) && !state.store.presets[state.selection.key]) {
    state.selection = { mode: 'auto' };
  }
  if (playing().key !== before) resetSession();
  else {
    state.picked = pruneSelection(state.picked, order());
  }
  syncEngine();
  scheduleSave();
  render();
}

// The name, label and colour of what plays change on that very preset: unlike the speakers,
// they never make a copy for this chassis or key first (a key picked in the map that only
// inherits has no preset of its own to name, so it goes the usual way).
function editPlayingMeta(change) {
  const { key, kind } = playing();
  const own = state.selection.mode !== 'scope' || state.store.assignments[state.selection.scope] === key;
  if (kind !== 'preset' || !own) return edit(change);
  remember();
  state.store = { ...state.store, presets: { ...state.store.presets, [key]: change(state.store.presets[key]) } };
  scheduleSave();
  render();
}

// Every change to a layout goes through here: routing (with auto-created truck
// presets), the engine and saving.
function edit(change) {
  remember('edit');
  // A shared file picked in the list is never changed: it becomes your own copy first.
  ({ store: state.store, selection: state.selection } = adoptPicked(state.store, state.selection));
  state.store = editLayout(state.store, state.selection, state.truck, change);
  syncEngine();
  scheduleSave();
  render();
}

async function stopAudio() {
  if (!audio) return;
  audio.stream?.getTracks().forEach((track) => track.stop());
  audio.player?.pause();
  await audio.ctx.close();
  audio = null;
}

async function startAudio() {
  await stopAudio();
  const warnings = [];
  try {
    state.devices = await listDevices();
  } catch (err) {
    state.devices = [];
    warnings.push(`Cannot list audio devices: ${err.message}`);
  }
  // A new setup records from a virtual cable (never a microphone) and plays to the default
  // output unless that is a virtual device (shared/devices.js).
  const input = pickDevice(state.devices, 'audioinput', state.settings.input);
  const output = pickDevice(state.devices, 'audiooutput', state.settings.output);
  warnings.push(...[input.warning, output.warning].filter(Boolean));
  state.inputId = input.device?.deviceId ?? null;
  state.outputId = output.device?.deviceId ?? null;
  const sinkId = !state.outputId || state.outputId === 'default' ? '' : state.outputId;

  let stream = null;
  let rate;
  if (source() === 'input') {
    if (!state.inputId) {
      if (!input.warning) warnings.push('No input device found.');
    } else {
      try {
        ({ stream, rate } = await openInput(state.inputId));
      } catch (err) {
        warnings.push(`Cannot open the input: ${err.message}`);
      }
    }
  }
  try {
    const out = await probeOutput(sinkId);
    warnings.push(...[rateWarning(rate, out.rate), channelsWarning(out.channels)].filter(Boolean));
    rate ??= out.rate;
  } catch (err) {
    warnings.push(`Cannot open the output: ${err.message}`);
  }

  // The graph runs at the input's rate, so the cable is not resampled on the way in.
  const ctx = new AudioContext({ sampleRate: rate, sinkId });
  const engine = createEngine(ctx);
  let player = null;
  if (stream) ctx.createMediaStreamSource(stream).connect(engine.input);
  if (source() === 'file') {
    player = new Audio();
    player.controls = true;
    player.loop = true;
    if (state.fileUrl) player.src = state.fileUrl;
    ctx.createMediaElementSource(player).connect(engine.input);
  }
  audio = { ctx, engine, stream, player };
  syncEngine();
  applyTrim(); // the last measured trim right away; syncEngine measures again
  applyVolume();
  applyVoice();
  engine.setSolo(state.solo);
  for (const id of state.muted) engine.setMuted(id, true);
  engine.setPose(state.pose, headRestX(state.truck));
  engine.setSilent(state.silenced);
  state.audioWarnings = warnings;
  render();
}

let audioTask = Promise.resolve();
function restartAudio() {
  audioTask = audioTask.then(startAudio).catch((err) => {
    state.audioWarnings = [`Audio failed: ${err.message}`];
    render();
  });
}

// The cab's buttons (shared/controls.js): Next and Previous try the model's variants as a
// pick in the list does; Auto goes back to what fitted the cab when you got in (nothing is
// remembered while trying). Getting out keeps the one tried for the cab (see onPose). The voice
// says what plays then.
function controlAction(action) {
  if (action === 'auto') {
    actions.selectPreset('auto');
    const what = spokenName(playing().key);
    say(what ? `Auto, ${what}` : 'Auto');
    return;
  }
  if (!state.truck) return say('No vehicle');
  const from = playing().key;
  const next = cycleVariant(state.store, state.truck, from, action === 'next' ? 1 : -1);
  if (!next) return say('No variants');
  if (next.key === from) return say('One variant');
  state.selection = { mode: 'truck', key: next.key, cycled: true };
  resetSession();
  syncEngine();
  render();
  say(next.label || `variant ${next.index + 1}`);
}

// What plays, as the voice says it: its label, else its place among the model's variants.
// A preset of yours or a file, there still.
const presetExists = (key) => Boolean(key && (state.store.presets[key] ?? state.store.collection?.[key]));

// The key picked in the tree (a key's row, or a variant's row: its key) for Paste and Duplicate;
// null in Auto or for a preset picked elsewhere.
function pickedScope() {
  const { selection } = state;
  if (selection.mode === 'scope') return selection.scope;
  return selection.mode === 'truck' ? selection.variantOf ?? null : null;
}

function spokenName(key) {
  const label = playing().layout.label;
  if (label) return label;
  const index = state.truck ? alternatesOf(state.store, state.truck.key).findIndex((v) => v.key === key) : -1;
  return index >= 0 ? `variant ${index + 1}` : '';
}

// Says a phrase on the output device (main/voice.js, engine.voice); a newer one cuts it short.
let sayRun = 0;
let voiceSource = null;
async function say(text) {
  if (state.settings.voice === 'off' || !audio) return;
  const run = ++sayRun;
  try {
    const bytes = await window.aux.speak(text);
    if (!bytes || run !== sayRun || !audio) return;
    const buffer = await audio.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (run !== sayRun || !audio) return;
    voiceSource?.stop();
    voiceSource = new AudioBufferSourceNode(audio.ctx, { buffer });
    voiceSource.connect(audio.engine.voice);
    voiceSource.start();
  } catch (err) {
    console.error('Voice failed', err);
  }
}

// The bindings go to the poller (main/controls.js). The voice helper starts at the first phrase,
// or ahead when a binding or the voice is set (about to be used): not at every start.
function applyControls() {
  window.aux.setControls(state.settings.controls);
  window.aux.controlNames().then((names) => {
    state.controlNames = names;
    render();
  });
}

const deviceRef = (id) => {
  const device = state.devices.find((d) => d.deviceId === id);
  return device ? { id, label: device.label } : null;
};

// Asks what the card's scope choice needs (see moveToScope) and carries it out. True when
// something changed.
async function putAtScope(to) {
  const truck = state.truck;
  const plan = truck && planScope(state.store, state.selection, truck, to);
  if (!plan) {
    render(); // puts the dropdown back
    return false;
  }
  const ladder = scopeLadder(state.store, truck);
  const labelOf = (scope) => ladder.find((r) => r.scope === scope)?.label ?? scope;
  return carryOut(plan, labelOf, resolvePlaying(state.store, state.selection, truck).layout.name, true);
}

// Asks what a plan (planScope, planAssign) needs and carries it out. True when something
// changed. inVehicle: the plan is about the vehicle in the game (the card), not the map.
async function carryOut(plan, labelOf, name, inVehicle) {
  const { to } = plan;
  const truck = state.truck;
  const lines = [];
  // A preset of yours there can stay on the key as a variant (a brand's, a game's; a model takes variants anyway).
  const asVariant = Boolean(plan.taken && !plan.taken.keeps && !plan.taken.key.startsWith('file:'));
  if (plan.taken) {
    lines.push(`"${plan.taken.name}" will no longer apply to ${labelOf(to)}.${plan.taken.keeps ? '' : ' It stays in the list, unassigned.'}`);
    if (asVariant) lines.push(`Add as a variant: both stay on ${labelOf(to)}, this one plays and "${plan.taken.name}" waits; the card picks between them.`);
  }
  if (plan.outplayed) {
    const what = plan.outplayed.file ? `The collection's "${plan.outplayed.name}"` : `"${plan.outplayed.name}"`;
    lines.push(`${what} is narrower and will keep playing in this vehicle.`);
  }
  if (!inVehicle && plan.shadow.length) {
    lines.push('Narrower presets on the way keep playing for their vehicles unless unassigned:');
  }
  const checks = plan.shadow.map((s) => ({
    value: s.scope,
    label: `Also unassign "${s.name}" from ${s.label}${inVehicle ? ' (otherwise it keeps playing in this vehicle)' : ''}`,
  }));
  const copies = plan.mode === 'copy' || plan.mustCopy;
  let answer = { button: copies ? 'copy' : 'move', checked: checks.map((c) => c.value) };
  if ((plan.direction === 'down' || plan.direction === 'across') && !plan.mustCopy) {
    const after = plan.fallback ? `"${plan.fallback.name}" (${plan.fallback.label})` : 'a wider preset';
    answer = await ask({
      title: `"${name}" to ${labelOf(to)}`,
      lines: [
        `Move: it no longer applies to ${labelOf(plan.from)}; other vehicles there will play ${after}.`,
        `Copy for here: ${labelOf(plan.from)} keeps it, and a copy applies to ${labelOf(to)}.`,
        ...lines,
      ],
      checks,
      buttons: [{ value: 'move', label: 'Move' }, { value: 'copy', label: 'Copy for here', primary: true }, { value: null, label: 'Cancel' }],
    });
  } else if (lines.length || checks.length || plan.mustCopy) {
    let title = `"${name}" to ${labelOf(to)}`;
    if (plan.mustCopy) {
      title = `A copy of "${name}" to ${labelOf(to)}`;
      lines.unshift('All vehicles keep this preset: something must play when nothing else does.');
    }
    answer = await ask({
      title,
      lines,
      checks,
      buttons: [
        { value: answer.button, label: copies ? 'Copy' : 'Move', primary: true },
        ...(asVariant ? [{ value: 'variant', label: 'Add as a variant' }] : []),
        { value: null, label: 'Cancel' },
      ],
    });
  }
  if (!answer) {
    render();
    return false;
  }
  const before = speakerIds();
  remember();
  const variant = answer.button === 'variant';
  state.store = applyScope(state.store, plan, truck, { copy: variant ? copies : answer.button === 'copy', clear: answer.checked, variant });
  afterScopeChange(before);
  return true;
}

// What plays may have changed with the scopes: solo and mute stay only on the same layout
// (a copy of what plays keeps them).
const speakerIds = () => JSON.stringify(playing().layout.speakers);
function afterScopeChange(before) {
  if (speakerIds() !== before) resetSession();
  syncEngine();
  scheduleSave();
  render();
}

const actions = {
  selectInput(id) {
    state.settings = { ...state.settings, input: deviceRef(id) };
    saveSettings();
    restartAudio();
  },
  selectOutput(id) {
    state.settings = { ...state.settings, output: deviceRef(id) };
    saveSettings();
    restartAudio();
  },
  setSource(source) {
    state.settings = { ...state.settings, source };
    saveSettings();
    restartAudio();
  },
  // Camera › Mode: 'game', 'vr' or 'telemetry' (settings.js HEAD_SOURCES); the next pose takes it.
  setHeadFrom(value) {
    state.settings = normalizeSettings({ ...state.settings, headFrom: value });
    saveSettings();
    render();
  },
  // Camera › Lock: an axis of the head locked, or not, for the mode chosen.
  setAxisLock(axis, on) {
    const way = state.settings.headFrom;
    const locks = { ...state.settings.axisLocks, [way]: { ...state.settings.axisLocks[way], [axis]: on } };
    state.settings = normalizeSettings({ ...state.settings, axisLocks: locks });
    saveSettings();
    render();
  },
  // { on, percent, reverse, blinkers }: any of them; the next pose applies it.
  setTurnLook(patch) {
    state.settings = normalizeSettings({ ...state.settings, turnLook: { ...state.settings.turnLook, ...patch } });
    saveSettings();
    render();
  },
  // fraction: the slider, 0..1. Saved when the slider is let go (save).
  setVolume(fraction, save = true) {
    state.settings = normalizeSettings({ ...state.settings, volume: fraction });
    applyVolume();
    if (save) saveSettings();
    render();
  },
  setMatchLoudness(on) {
    state.settings = { ...state.settings, matchLoudness: on };
    saveSettings();
    applyTrim();
    render();
  },
  setMuteWhen(mode) {
    state.settings = { ...state.settings, muteWhen: mode };
    saveSettings();
    applySilence();
    render();
  },
  // Controls: waits for a combination for the action (a second click cancels), or clears it.
  async bindControl(action) {
    if (state.capturing) {
      window.aux.cancelCapture();
      return;
    }
    state.capturing = action;
    document.activeElement?.blur?.(); // Space or Enter must not press the button again
    render();
    const ids = await window.aux.captureControl();
    state.capturing = null;
    if (ids?.length) {
      state.settings = normalizeSettings({ ...state.settings, controls: { ...state.settings.controls, [action]: ids } });
      saveSettings();
      applyControls();
      if (state.settings.voice !== 'off') window.aux.warmVoice();
    }
    render();
  },
  clearControl(action) {
    state.settings = normalizeSettings({ ...state.settings, controls: { ...state.settings.controls, [action]: [] } });
    saveSettings();
    applyControls();
    render();
  },
  // The voice: 'off', 'system' or 'aux' (settings.js VOICE_MODES), and its own volume (the
  // slider, 0..2; saved when it is let go).
  setVoice(mode) {
    state.settings = normalizeSettings({ ...state.settings, voice: mode });
    saveSettings();
    applyVoice();
    if (mode !== 'off' && isBound(state.settings.controls)) window.aux.warmVoice();
    render();
  },
  // Audio › Control voice › Test: says what plays now, as the bindings would.
  testVoice() {
    say(spokenName(playing().key) || 'Trucker AUX');
  },
  setVoiceVolume(fraction, save = true) {
    state.settings = normalizeSettings({ ...state.settings, voiceVolume: fraction });
    applyVoice();
    if (save) saveSettings();
    render();
  },
  setPauseBehavior(mode) {
    state.settings = { ...state.settings, pauseBehavior: mode };
    saveSettings();
    applySilence();
    render();
  },
  pickFile(file) {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = URL.createObjectURL(file);
    if (audio?.player) {
      audio.player.src = state.fileUrl;
      audio.player.play();
    }
  },
  selectPreset(value) {
    state.selection = parseSelection(value);
    resetSession();
    syncEngine();
    render();
  },
  // Copies what plays now into a new preset (not tied to a truck) and switches to it.
  newPreset() {
    remember();
    const created = createPreset(state.store, playing().layout);
    state.store = created.store;
    state.selection = { mode: 'truck', key: created.key };
    resetSession();
    syncEngine();
    scheduleSave();
    render();
  },
  renamePreset(name) {
    const trimmed = name.trim();
    if (trimmed && playing().kind === 'preset') editPlayingMeta((layout) => ({ ...layout, name: trimmed }));
    else render(); // an empty name puts the old one back
  },
  // The card's Applies to (presets.js planScope): moves the preset that plays up or down
  // this vehicle's ladder, asking first when that takes a scope from another preset, leaves
  // narrower ones playing, or (down) whether to move or copy.
  async moveToScope(to) {
    await putAtScope(to);
  },
  // A preset picked in the list is put to use in this vehicle as well; back to Auto.
  async useInScope(to) {
    if (await putAtScope(to)) state.selection = { mode: 'auto' };
    render();
  },
  // A variant picked on the card plays at once, back in Auto; your own vehicle remembers it by
  // its plate, another by its hook (presets.js chooseVariant).
  cardVariant(key) {
    const before = speakerIds();
    remember();
    state.store = chooseVariant(state.store, state.truck, key);
    state.selection = { mode: 'auto' };
    afterScopeChange(before);
  },
  // The tree's menu: one of a key's variants plays there (on the model of the vehicle in the
  // game, in that vehicle, as the card picks). New ones, copies, join a key's variants and what
  // plays there stays (presets.js addVariant); the key opens to show them.
  playVariant(scope, key) {
    const before = speakerIds();
    remember();
    const inGame = state.truck?.key === scope;
    state.store = inGame ? chooseVariant(state.store, state.truck, key) : pickAlternate(state.store, scope, key);
    afterScopeChange(before);
  },
  // Add current as variant: a copy of what plays now, labelled "new".
  newVariant(scope, from = playing().key) {
    const before = speakerIds();
    remember();
    state.store = newAlternate(state.store, scope, state.truck, from);
    keyTree.reveal(scope);
    afterScopeChange(before);
  },
  // Duplicate, Paste: a copy of a preset or a file (with its label) among a key's variants.
  copyToKey(scope, key) {
    if (!scope || !key) return;
    const before = speakerIds();
    const copied = copyVariant(state.store, scope, key, state.truck);
    if (!copied.key) return;
    remember();
    state.store = copied.store;
    keyTree.reveal(scope);
    afterScopeChange(before);
  },
  // Delete in the tree: off the key, and gone when no other key uses it (a file of a model: hidden
  // from it).
  deleteVariant(scope, key) {
    const before = speakerIds();
    remember();
    state.store = deleteVariant(state.store, scope, key);
    if (state.selection.mode === 'truck' && state.selection.key === key && !presetExists(key)) state.selection = { mode: 'auto' };
    afterScopeChange(before);
  },
  // The tree's Copy and Paste; the keyboard's work on what is picked there (pickedScope).
  copyPreset(key = playing().key) {
    state.presetClip = key;
  },
  canPaste: () => presetExists(state.presetClip),
  pastePreset(scope = pickedScope()) {
    if (actions.canPaste()) actions.copyToKey(scope, state.presetClip);
  },
  duplicatePicked() {
    actions.copyToKey(pickedScope(), playing().key);
  },
  // A variant's row clicked in the preset map: it plays, to edit it (a file of the model becomes
  // your copy in its place at the first edit: presets.js adoptPicked).
  selectVariant(scope, key) {
    state.selection = { mode: 'truck', key, variantOf: scope };
    resetSession();
    syncEngine();
    render();
  },
  dropVariant(scope, key) {
    const before = speakerIds();
    remember();
    state.store = dropAlternate(state.store, scope, key);
    afterScopeChange(before);
  },
  // A key clicked in the preset map: it plays what it has or inherits; editing gives it its own.
  selectScope(scope) {
    state.selection = { mode: 'scope', scope };
    resetSession();
    syncEngine();
    render();
  },
  // The map's menu: the preset that plays now set on a key (shared), or a copy of it there.
  async assignCurrent(scope) {
    const { key, layout } = playing();
    const plan = planAssign(state.store, key, scope);
    if (!plan) return render();
    return carryOut(plan, (s) => scopeLabel(state.store, s, state.truck), layout.name, false);
  },
  async copyCurrent(scope) {
    const { key, layout } = playing();
    const plan = planAssign(state.store, key, scope)
      ?? { mode: 'use', key, from: null, to: scope, direction: null, mustCopy: false, taken: null, shadow: [], fallback: null, outplayed: null };
    return carryOut({ ...plan, mode: 'copy' }, (s) => scopeLabel(state.store, s, state.truck), layout.name, false);
  },
  undo() {
    stepHistory(history.undo, history.redo);
  },
  redo() {
    stepHistory(history.redo, history.undo);
  },
  // Dragging in the map adds to the key's variants, what plays there stays: a preset of yours
  // moves from its key (one on no key leaves the unused ones); with Ctrl, from all vehicles
  // (something must play there) or a file, a copy goes.
  dropInMap({ from, key, file }, to, copy) {
    if (copy || file || from === 'all') return actions.copyToKey(to, key);
    const before = speakerIds();
    remember();
    state.store = from ? moveVariant(state.store, from, to, key) : addVariant(state.store, to, key);
    keyTree.reveal(to);
    afterScopeChange(before);
  },
  // A key's preset dropped among the unused presets: it leaves that key (the preset stays).
  // With Ctrl, from all vehicles (something must play) or for a shared file: a copy instead.
  dropToUnused({ from, key, file }, copy) {
    if (copy || file || from === 'all' || !from) return actions.duplicatePresetKey(key);
    actions.dropVariant(from, key);
  },
  // The unused presets' menu and in-place rename.
  // The short label of what plays, shown beside its keys in the map; empty removes it.
  setPresetLabel(text) {
    const label = text.trim().slice(0, LABEL_MAX);
    if (playing().kind !== 'preset' || (playing().layout.label ?? '') === label) return render();
    editPlayingMeta((layout) => {
      const { label: _old, labelColor, ...rest } = layout;
      return label ? { ...rest, label, ...(labelColor ? { labelColor } : {}) } : rest; // no label, no colour
    });
  },
  setPresetLabelColor(color) {
    if (playing().kind !== 'preset' || !LABEL_COLORS.includes(color)) return render();
    editPlayingMeta((layout) => {
      const { labelColor: _old, ...rest } = layout;
      return color === 'blue' ? rest : { ...rest, labelColor: color };
    });
  },
  renamePresetKey(key, name) {
    if (!state.store.presets[key]) return;
    remember();
    state.store = { ...state.store, presets: { ...state.store.presets, [key]: { ...state.store.presets[key], name } } };
    scheduleSave();
    render();
  },
  duplicatePresetKey(key) {
    const layout = state.store.presets[key] ?? state.store.collection?.[key]?.layout;
    if (!layout) return;
    remember();
    state.store = createPreset(state.store, layout).store;
    scheduleSave();
    render();
  },
  deletePresetKey(key) {
    const layout = state.store.presets[key];
    if (!layout || key === allPresetKey(state.store)) return;
    if (!confirm(`Delete the preset "${layout.name}"?`)) return;
    const before = speakerIds();
    remember();
    state.store = deletePreset(state.store, key);
    if (state.selection.mode === 'truck' && state.selection.key === key) state.selection = { mode: 'auto' };
    afterScopeChange(before);
  },
  // Unbind: the preset that plays leaves the scope it holds here (off the model as a variant,
  // off your vehicle, off the brand or the game); the preset stays.
  truckAction(action) {
    if (action === 'auto') return actions.selectPreset('auto');
    if (action !== 'unbind' || !state.truck) return;
    const from = currentScope(state.store, state.selection, state.truck);
    if (from) actions.dropVariant(from, playing().key);
  },
  // The export window, ticked at first: from: a key of the tree (its presets and those under
  // it, but vehicles' own), 'playing' (the preset that plays), { key } (a variant's row: that
  // preset), or nothing (all your presets on keys but vehicles' own). Then Save As in main.
  async exportPresets(from = null) {
    const map = presetTree(state.store, state.truck, state.selection);
    const items = exportItems(map);
    const find = (n, scope) => (n.scope === scope ? n : n.children.map((c) => find(c, scope)).find(Boolean));
    let checked;
    const one = from === 'playing' ? playing().key : from?.key;
    if (one) checked = [...items].filter(([, item]) => item.key === one).map(([id]) => id);
    else if (from) {
      const node = find(map.root, from);
      checked = node ? branchIds(node, (item) => !item.personal) : [];
    } else checked = branchIds(map.root, (item) => !item.personal && !item.file);
    const picks = await chooseExport({ map, checked, check: (p) => exportFiles(state.store, p, state.truck) });
    if (!picks) return;
    const set = exportFiles(state.store, picks, state.truck);
    const name = typeof from === 'string' && from !== 'playing' && !from.startsWith('?') ? keyPath(state.store, from, state.truck) : 'Trucker AUX presets';
    const result = await window.aux.exportPresets(set.files, name);
    if (result.canceled) return;
    state.storeWarnings = result.warning ? [result.warning] : [`Exported ${result.written} preset(s) to ${result.path}.`];
    render();
  },
  // File › Export › All presets: the export window's choice with all of yours ticked (a file for
  // each key a preset is on, a vehicle's own for its hook), not the shared files, without the
  // window. Then Save As in main.
  async exportAllPresets() {
    const map = presetTree(state.store, state.truck, state.selection);
    const picks = [...exportItems(map).values()].filter((item) => !item.file);
    if (!picks.length) return;
    const set = exportFiles(state.store, picks, state.truck);
    const result = await window.aux.exportPresets(set.files, 'Trucker AUX presets');
    if (result.canceled) return;
    state.storeWarnings = result.warning ? [result.warning] : [`Exported ${result.written} preset(s) to ${result.path}.`];
    render();
  },
  // Import: preset files (main asks which) become your presets, a file for a model a variant of
  // it (importPresets). The hooks (or models, brands, games) that play a preset of yours are
  // listed: on the ticked ones the imported one plays, on the others yours keeps playing; both
  // stay variants. Undo takes it all back.
  async importPresets() {
    const result = await window.aux.importPresets();
    if (result.canceled) return;
    const { entries, warnings } = result;
    let replace = new Set();
    const clashes = importClashes(state.store, entries, state.truck);
    if (clashes.length) {
      const answer = await ask({
        title: `Import ${entries.length} preset(s)`,
        lines: ['These play a preset of yours. The imported ones become variants either way (the card picks between them). Tick where the imported one should play; elsewhere yours keeps playing.'],
        checks: clashes.map((c) => ({ value: c.scope, label: `${c.label}: ${c.yours} → ${c.theirs}`, checked: false })),
        buttons: [{ value: null, label: 'Cancel' }, { value: 'import', label: 'Import', primary: true }],
      });
      if (!answer) return;
      replace = new Set(answer.checked);
    }
    const before = speakerIds();
    remember();
    const done = importPresets(state.store, entries, replace);
    state.store = done.store;
    const parts = [`${done.placed} on their keys`, ...(done.variants ? [`${done.variants} as variants`] : []), `${done.unused} among the unused`, ...(done.same ? [`${done.same} yours already`] : [])];
    state.storeWarnings = [...warnings, ...(entries.length ? [`Imported ${entries.length} preset(s): ${parts.join(', ')}.`] : [])];
    afterScopeChange(before);
  },
  deleteCurrentPreset() {
    const current = playing();
    if (current.kind !== 'preset' || current.key === allPresetKey(state.store)) return;
    const scopes = scopesOf(state.store, current.key);
    const after = scopes.length
      ? ` It applies to ${scopes.map((s) => scopeLabel(state.store, s, state.truck)).join('; ')}: those will play a wider preset.`
      : '';
    if (!confirm(`Delete the preset "${current.layout.name}"?${after}`)) return;
    remember();
    state.store = deletePreset(state.store, current.key);
    state.selection = { mode: 'auto' };
    resetSession();
    syncEngine();
    scheduleSave();
    render();
  },
  setWidth(width) {
    edit((layout) => setWidth(layout, width));
  },
  // In the game's free camera new speakers go where the camera is.
  addSpeaker() {
    const at = cameraPoint(state.view, headRestX(state.truck));
    edit((layout) => {
      const result = addSpeaker(layout, at);
      if (result.id) state.picked = { ids: [result.id], primary: result.id };
      return result.layout;
    });
  },
  addPair() {
    const at = cameraPoint(state.view, headRestX(state.truck));
    edit((layout) => {
      const result = addPair(layout, at);
      if (result.ids.length) state.picked = { ids: result.ids, primary: result.ids[0] };
      return result.layout;
    });
  },
  // id null: a click on empty space. mods: { toggle, range }.
  selectSpeaker(id, mods = {}) {
    state.picked = clickSelect(state.picked, id, mods, order());
    render();
  },
  selectBox(ids, add) {
    state.picked = boxSelect(state.picked, ids, add, order());
    render();
  },
  selectAll() {
    state.picked = selectAll(state.picked, order());
    render();
  },
  // The grabbed speaker goes to `position`; the rest of the selection moves by the same step.
  moveSelection(leaderId, position) {
    const ids = state.picked.ids.includes(leaderId) ? state.picked.ids : [leaderId];
    edit((layout) => {
      const leader = layout.speakers.find((s) => s.id === leaderId);
      if (!leader) return layout;
      return moveSpeakers(layout, ids, position.map((c, i) => c - leader.position[i]), leaderId);
    });
  },
  nudgeSelection(key, big) {
    const { ids, primary } = state.picked;
    const leader = playing().layout.speakers.find((s) => s.id === primary);
    const target = leader && nudge(leader.position, key, big);
    if (!target) return false;
    edit((layout) => moveSpeakers(layout, ids, target.map((c, i) => c - leader.position[i]), primary));
    return true;
  },
  setBoundsEdge(axis, side, metres) {
    edit((layout) => setBoundsEdge(layout, axis, side, metres));
  },
  toggleSolo(id) {
    state.solo = state.solo === id ? null : id;
    audio?.engine.setSolo(state.solo);
    render();
  },
  toggleMute(id) {
    const on = !state.muted.has(id);
    if (on) state.muted.add(id);
    else state.muted.delete(id);
    audio?.engine.setMuted(id, on);
    render();
  },
  // Name, channel or type: the same value for every selected speaker.
  updateSelected(patch) {
    const { ids } = state.picked;
    if (ids.length) edit((layout) => patchSpeakers(layout, ids, patch));
  },
  // The form's level slider shows the primary speaker; the others move by the same step.
  setLevel(gainDb) {
    const { ids, primary } = state.picked;
    const current = playing().layout.speakers.find((s) => s.id === primary);
    if (current) edit((layout) => shiftGains(layout, ids, gainDb - current.gainDb));
  },
  setCoordinate(axis, metres) {
    const { ids, primary } = state.picked;
    if (ids.length) edit((layout) => setCoordinate(layout, ids, axis, metres, primary));
  },
  setPair(otherId) {
    const id = state.picked.primary;
    if (id) edit((layout) => (otherId ? linkPair(layout, id, otherId) : unlinkPair(layout, id)));
  },
  deleteSelected() {
    const { ids } = state.picked;
    if (!ids.length) return;
    state.picked = EMPTY;
    edit((layout) => removeSpeakers(layout, ids));
  },
  copySelected() {
    if (!state.picked.ids.length) return;
    state.clipboard = copySpeakers(playing().layout, state.picked.ids);
    render();
  },
  paste(clip = state.clipboard) {
    if (!clip.length) return;
    edit((layout) => {
      const result = pasteSpeakers(layout, clip);
      if (result.ids.length) state.picked = { ids: result.ids, primary: result.ids[0] };
      return result.layout;
    });
  },
  // Like copy and paste, without touching the clipboard.
  duplicateSelected() {
    if (state.picked.ids.length) actions.paste(copySpeakers(playing().layout, state.picked.ids));
  },
};

const panel = createPanel(document.getElementById('panel'), actions, document.getElementById('bounds'));
const keyTree = createKeyTree(document.getElementById('tree'), actions);
const views = createViews(document.getElementById('views'), actions);

// three.js is loaded on demand; without it the app still works, only the 3D view is missing.
let overview = null;
import('./overview3d.js')
  .then(({ createOverview }) => {
    overview = createOverview(document.getElementById('overview'));
    render();
    overview.setPose(state.pose, headRestX(state.truck));
  })
  .catch((err) => {
    document.getElementById('overview').textContent = `3D view unavailable: ${err.message}`;
  });

let menuHistory = null; // what Edit › Undo / Redo were last told
function render() {
  const can = `${history.undo.length > 0} ${history.redo.length > 0}`;
  if (can !== menuHistory) {
    menuHistory = can;
    window.aux.menuHistory(history.undo.length > 0, history.redo.length > 0);
  }
  keyTree.update(
    { ...presetTree(state.store, state.truck, state.selection), currentKey: playing().key },
    { undo: history.undo.length, redo: history.redo.length, auto: state.selection.mode === 'auto' },
  );
  const current = playing();
  const { layout } = current;
  const { ids } = state.picked;
  // Speakers you do not hear (muted, or another one soloed) are drawn grey.
  const silentIds = layout.speakers.filter((s) => isSilenced(s, state.solo, state.muted)).map((s) => s.id);
  panel.update({
    warnings: [state.pluginWarning, state.controlWarning, ...state.storeWarnings, ...state.collectionWarnings, ...state.audioWarnings].filter(Boolean),
    inputs: state.devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    outputs: state.devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications'),
    inputId: state.inputId,
    outputId: state.outputId,
    // The cable's other side, where the music is to be played (for a new setup).
    cableOutput: cableOutputFor(state.devices, state.devices.find((d) => d.kind === 'audioinput' && d.deviceId === state.inputId))?.label ?? null,
    debug: state.debug,
    source: source(),
    muteWhen: state.settings.muteWhen,
    turnLook: state.settings.turnLook,
    cameraSource: state.view.source,
    cameraFallback: state.cameraFallback,
    headFrom: state.settings.headFrom,
    axisLocks: state.settings.axisLocks[state.settings.headFrom],
    pauseBehavior: state.settings.pauseBehavior,
    volume: state.settings.volume,
    controls: state.settings.controls,
    controlNames: state.controlNames,
    capturing: state.capturing,
    voice: state.settings.voice,
    voiceVolume: state.settings.voiceVolume,
    player: audio?.player ?? null,
    presets: presetOptions(state.store, state.truck, state.selection),
    card: truckStatus(state.store, state.selection, state.truck),
    variant: variantChoice(state.store, state.truck),
    preset: selectionValue(state.selection),
    canDelete: current.kind === 'preset' && current.key !== allPresetKey(state.store), // all vehicles' preset and files stay
    canRename: current.kind === 'preset',
    presetName: layout.name,
    presetLabel: layout.label ?? '',
    presetLabelColor: layout.labelColor ?? 'blue',
    width: layout.width,
    matchLoudness: state.settings.matchLoudness,
    loudnessDb: state.loudnessDb,
    bounds: layout.bounds,
    headX: headRestX(state.truck),
    headFromGame: typeof state.truck?.centerX === 'number',
    speakers: layout.speakers,
    maxSpeakers: MAX_SPEAKERS,
    picked: ids,
    selected: layout.speakers.filter((s) => ids.includes(s.id)),
    primary: layout.speakers.find((s) => s.id === state.picked.primary) ?? null,
    canDuplicate: ids.length > 0 && layout.speakers.length + ids.length <= MAX_SPEAKERS,
    canPaste: state.clipboard.length > 0 && layout.speakers.length + state.clipboard.length <= MAX_SPEAKERS,
    solo: state.solo,
    muted: state.muted,
    silentIds,
  });
  views.update({ layout, layoutKey: current.key, selectedIds: ids, silentIds });
  overview?.update({ layout, layoutKey: current.key, selectedIds: ids, silentIds });
}

// The status line: [the vehicle or the game's state, the angles and notes]. Two lines that
// never wrap and angles of one width (angleText), so the panel does not jump as they change.
function statusText() {
  const pose = state.pose;
  if (!pose || !pose.sdkActive) return ['Game not running', ''];
  if (!state.inWorld) return ['Game in the menu or loading', ''];
  const truck = state.truck;
  const name = truck ? `${truck.name}${truck.variant ? ` (hook ${truck.variant} m)` : ''}` : 'Unknown vehicle';
  let muted = '';
  if (state.silenced && pose.paused && state.settings.pauseBehavior === 'muted') muted = ' · muted';
  else if (state.silenced) muted = ` · muted, ${state.settings.muteWhen === 'engine' ? 'engine' : 'electrics'} off`;
  if (pose.paused) return [name, `paused${muted}`];
  const head = (state.heard ?? pose).head;
  const lookNote = Math.round(state.turn * 360) ? ` (turn look ${angleText(turnsToDeg(state.turn), 2)})` : '';
  let cameraNote = state.view.source ? ` · camera: ${state.view.source}` : '';
  if (state.settings.headFrom === 'telemetry') cameraNote = ' · camera: adjusted telemetry';
  if (state.settings.headFrom === 'vr') cameraNote = ' · camera: raw telemetry';
  const angles = `yaw ${angleText(turnsToDeg(head.heading), 3)}${lookNote} · pitch ${angleText(turnsToDeg(head.pitch), 2)} · roll ${angleText(turnsToDeg(state.roll), 2)}`;
  return [name, `${angles}${cameraNote}${muted}`];
}

let lastStatus = 0;
const frameWatch = createFrameWatch();
const rampBlinker = createRamp();
const holdPause = createPauseHold();
const cameraWatch = createCameraWatch();
const fallbackWatch = createFallbackWatch();
// presets/ changed: new, edited or removed shared files. A picked file that is gone
// leaves the choice to Auto.
window.aux.onCollection(({ collection, warnings }) => {
  const before = playing().key;
  state.store = { ...state.store, collection };
  state.collectionWarnings = warnings;
  if (state.selection.mode === 'truck' && isCollectionKey(state.selection.key) && !collection[state.selection.key]) {
    state.selection = { mode: 'auto' };
  }
  if (playing().key !== before) resetSession();
  syncEngine();
  render();
});

window.aux.onPose((pose) => {
  state.pose = pose;
  state.inWorld = Boolean(pose?.sdkActive) && frameWatch(pose.renderTime, performance.now());
  const revisionWarning = pluginWarning(pose);
  if (revisionWarning !== state.pluginWarning) {
    state.pluginWarning = revisionWarning;
    render();
  }
  const truck = pose && pose.sdkActive ? pose.truck : null;
  // The axis may arrive a frame after the truck's name, so it counts as a change too.
  // Another chassis of the same model, or another truck with its own plate, counts too.
  const identity = (t) => (t ? `${variantKey(t)}#${t.plate ?? ''}` : null);
  const otherTruck = identity(truck) !== identity(state.truck);
  if (otherTruck || (truck?.centerX ?? null) !== (state.truck?.centerX ?? null)) {
    const left = state.truck;
    state.truck = truck;
    if (otherTruck) resetSession();
    // Getting out of a cab (another vehicle, or the game gone): the next vehicle plays in Auto,
    // whatever was picked. After trying variants with the cab's buttons, the one tried stays the
    // cab's, remembered as a pick on the card is (by the hook, or your vehicle's plate).
    if (otherTruck && (left || state.selection.cycled)) {
      if (left && state.selection.cycled) {
        remember();
        state.store = chooseVariant(state.store, left, state.selection.key);
        scheduleSave();
      }
      state.selection = { mode: 'auto' };
    }
    // Its name, game and brand name the model's scopes while you drive something else; a model
    // new to the app gets its first variant, a hook new to you remembers what it plays.
    const learned = adoptVehicle(rememberVehicle(state.store, truck), truck);
    if (learned !== state.store) {
      state.store = learned;
      scheduleSave();
    }
    syncEngine();
    render();
  }
  // The head is placed from the truck's axis: left of it by what the game reports, and
  // turned by the game's look into turns and toward the blinker, which the telemetry
  // leaves out. With trucker_aux_camera.dll the view comes from the game's camera, those
  // included, an outside camera leaves the head at rest and the free camera takes the head
  // where it is; without it they are emulated from the Camera settings, the blinker's step
  // ramped in. In VR the telemetry's head is the headset's: nothing is added.
  const headX = headRestX(state.truck);
  // The telemetry by choice (Camera › Mode: Raw or Adjusted Telemetry): the camera is not read.
  const way = state.settings.headFrom;
  const camera = way === 'game' ? pose?.camera : null;
  const view = cameraView(pose, camera, cameraWatch(camera, performance.now()));
  const fallback = fallbackWatch({ inWorld: state.inWorld, truck: pose?.truck, source: view.source }, performance.now());
  if (view.source !== state.view.source || fallback !== state.cameraFallback) {
    state.view = view;
    state.cameraFallback = fallback;
    render(); // "+ Speaker" goes to the free camera; the turn look's settings show without the camera
  }
  state.view = view;
  let heard;
  if (view.source) {
    state.turn = 0;
    heard = withCameraView(pose, view);
  } else {
    const look = way === 'vr' ? { steer: 0, blinker: 0 } : turnLook(pose, state.settings.turnLook);
    state.turn = look.steer + rampBlinker(look.blinker, performance.now());
    heard = withTurnLook(pose, state.turn);
  }
  heard = holdPause(heard); // paused: the head stays where it was in the game
  state.roll = heard?.head?.roll ?? 0;
  // The axes locked for this mode (the roll at first: the ears level in the cab); the free
  // camera's turns are its own.
  if (view.source !== 'free') heard = lockAxes(heard, state.settings.axisLocks[way]);
  state.heard = heard;
  audio?.engine.setPose(heard, headX);
  applySilence();
  views.setPose(heard, headX);
  overview?.setPose(heard, headX);
  const now = performance.now();
  if (now - lastStatus >= STATUS_PERIOD_MS) {
    lastStatus = now;
    panel.setStatus(statusText());
  }
});

// The menu bar (main.js appMenu). An import of data saves what is waiting, then saves nothing
// until the window reloads with what it brought; an export of data saves first too.
window.aux.onMenu(async (action) => {
  const [name, kind] = action.split(':');
  if (name === 'import-data') {
    await saveNow();
    frozen = true;
    const result = await window.aux.importData(kind);
    if (result.ok) {
      location.reload();
      return;
    }
    frozen = false;
    if (result.warning) {
      state.storeWarnings = [result.warning];
      render();
    }
  } else if (name === 'export-data') {
    await saveNow();
    const result = await window.aux.exportData();
    if (result.canceled) return;
    state.storeWarnings = [result.warning ?? `Exported all data${result.presets ? ` and ${result.presets} preset file(s)` : ''} to ${result.path}.`];
    render();
  } else if (name === 'export-all-presets') actions.exportAllPresets();
  else if (name === 'export-presets') actions.exportPresets();
  else if (name === 'import-presets') actions.importPresets();
  else if (name === 'undo') actions.undo();
  else if (name === 'redo') actions.redo();
  else if (name === 'reset-layout') {
    panel.resetLayout();
    keyTree.resetLayout();
  }
});

window.aux.onControl(controlAction);
window.aux.onControlWarning((message) => {
  if (message === state.controlWarning) return;
  state.controlWarning = message;
  render();
});

navigator.mediaDevices.addEventListener('devicechange', async () => {
  const active = [state.inputId, state.outputId];
  state.devices = await listDevices();
  const present = new Set(state.devices.map((d) => d.deviceId));
  // A device in use gone, or a cable plugged in while there was no input: picked again.
  const cableNow = !state.inputId && pickDevice(state.devices, 'audioinput', state.settings.input).device;
  if (active.some((id) => id && !present.has(id)) || cableNow) restartAudio();
  else render();
});

// Keyboard, outside text fields: arrows nudge the selection (Shift: 10 cm), Delete removes
// it, Esc clears it; Ctrl+A / C / V / D select all, copy, paste, duplicate the speakers, or,
// while the tree was clicked last, copy, paste and duplicate the preset picked there.
const SHORTCUTS = {
  z: (shift) => (shift ? actions.redo() : actions.undo()),
  y: () => actions.redo(),
  a: () => actions.selectAll(),
  c: () => (keyTree.isActive() ? actions.copyPreset() : actions.copySelected()),
  v: () => (keyTree.isActive() ? actions.pastePreset() : actions.paste()),
  d: () => (keyTree.isActive() ? actions.duplicatePicked() : actions.duplicateSelected()),
};
// While a binding is pressed (Controls) the keys are for it alone.
for (const type of ['keydown', 'keyup']) {
  document.addEventListener(type, (event) => {
    if (!state.capturing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
document.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
  const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && SHORTCUTS[event.key.toLowerCase()];
  if (shortcut) {
    event.preventDefault();
    shortcut(event.shiftKey);
  } else if (event.key === 'Delete') {
    actions.deleteSelected();
  } else if (event.key === 'Escape') {
    actions.selectSpeaker(null);
  } else if (state.picked.ids.length && actions.nudgeSelection(event.key, event.shiftKey)) {
    event.preventDefault();
  }
});

render();
restartAudio();
applyControls();
