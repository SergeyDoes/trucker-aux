import { createEngine } from './engine.js';
import { createPanel } from './panel.js';
import { createViews } from './views.js';
import { listDevices, openInput, probeOutput } from './audio-io.js';
import {
  MAX_SPEAKERS, addPair, addSpeaker, copySpeakers, linkPair, moveSpeakers, pasteSpeakers, patchSpeakers,
  defaultLayout, removeSpeakers, setCoordinate, setBoundsEdge, setWidth, shiftGains, unlinkPair,
} from '../shared/layout.js';
import { nudge } from '../shared/view.js';
import {
  EMPTY, boxSelect, clickSelect, pruneSelection, selectAll,
} from '../shared/selection.js';
import {
  adoptPicked, allPresetKey, bindPreset, boundAt, createPreset, deletePreset, editLayout, exportPreset, ownPreset,
  parseSelection, presetOptions, rememberVehicle, resolvePlaying, scopeLabel, scopesOf, selectionValue, truckStatus, unbind,
  variantKey,
} from '../shared/presets.js';
import { isCollectionKey } from '../shared/collection.js';
import { channelsWarning, pickDevice, rateWarning } from '../shared/devices.js';
import { normalizeSettings } from '../shared/settings.js';
import { isSilenced } from '../shared/dsp.js';
import { trimFromLevels } from '../shared/loudness.js';
import { measureLoudness } from './loudness-meter.js';
import {
  DEFAULT_HEAD_X, createEase, createFrameWatch, headRestX, musicSilenced, turnLook, turnsToDeg,
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
  picked: EMPTY,   // selected speakers { ids, primary } (state.selection is the preset choice)
  loudnessDb: null, // the playing layout's loudness-matching trim, once measured
  clipboard: [],   // copied speakers, kept across presets for this session
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
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { collection, ...own } = state.store;
    const warning = await window.aux.saveLayouts(own);
    state.storeWarnings = warning ? [warning] : [];
    render();
  }, SAVE_DELAY_MS);
}

async function saveSettings() {
  const warning = await window.aux.saveSettings(state.settings);
  if (warning) {
    state.storeWarnings = [warning];
    render();
  }
}

// Every change to a layout goes through here: routing (with auto-created truck
// presets), the engine and saving.
function edit(change) {
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
  const input = pickDevice(state.devices, 'audioinput', state.settings.input, 'CABLE Output');
  const output = pickDevice(state.devices, 'audiooutput', state.settings.output, null);
  warnings.push(...[input.warning, output.warning].filter(Boolean));
  state.inputId = input.device?.deviceId ?? null;
  state.outputId = output.device?.deviceId ?? null;
  const sinkId = !state.outputId || state.outputId === 'default' ? '' : state.outputId;

  let stream = null;
  let rate;
  if (source() === 'input') {
    if (!state.inputId) {
      warnings.push('No input device found.');
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

const deviceRef = (id) => {
  const device = state.devices.find((d) => d.deviceId === id);
  return device ? { id, label: device.label } : null;
};

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
  // { on, percent, reverse, blinkers }: any of them; the next pose applies it.
  setTurnLook(patch) {
    state.settings = normalizeSettings({ ...state.settings, turnLook: { ...state.settings.turnLook, ...patch } });
    saveSettings();
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
    if (trimmed && playing().kind === 'preset') edit((layout) => ({ ...layout, name: trimmed }));
    else render(); // an empty name puts the old one back
  },
  // The truck card's buttons (presets.js truckStatus): a copy of what plays for this
  // chassis or this truck, binding the preset picked in the list, and undoing that.
  truckAction(action) {
    const truck = state.truck;
    if (!truck) return;
    let changesWhatPlays = true;
    if (action === 'own-chassis' || action === 'own-truck') {
      state.store = ownPreset(state.store, truck, action === 'own-truck' ? 'truck' : 'chassis');
      changesWhatPlays = false; // a copy of what plays: the same speakers
    } else if (action === 'bind-truck' || action === 'bind-chassis') {
      const scope = action === 'bind-truck' ? 'truck' : 'chassis';
      // The preset there now is not deleted: it stays in the list, unassigned if it was its only place.
      const taken = boundAt(state.store, truck, scope);
      if (taken && taken !== state.selection.key && !isCollectionKey(taken)) {
        const { name } = state.store.presets[taken];
        const left = scopesOf(state.store, taken).length > 1 ? '' : ' It stays in the list, unassigned.';
        if (!confirm(`"${name}" will no longer apply here.${left}`)) return;
      }
      state.store = bindPreset(state.store, truck, scope, state.selection.key);
      state.selection = { mode: 'auto' };
    } else if (action === 'unbind') {
      state.store = unbind(state.store, truck);
    } else return;
    if (changesWhatPlays) resetSession();
    syncEngine();
    scheduleSave();
    render();
  },
  // Writes what plays as a file in presets/ to share it; main shows it in Explorer.
  async exportPreset() {
    const shared = exportPreset(state.store, playing().key, state.truck);
    if (!shared) return;
    const { warning } = await window.aux.exportPreset(shared.fileName, shared.data);
    state.storeWarnings = warning ? [warning] : [];
    render();
  },
  deleteCurrentPreset() {
    const current = playing();
    if (current.kind !== 'preset' || current.key === allPresetKey(state.store)) return;
    const scopes = scopesOf(state.store, current.key);
    const after = scopes.length
      ? ` It applies to ${scopes.map((s) => scopeLabel(state.store, s, state.truck)).join('; ')}: those will play a wider preset.`
      : '';
    if (!confirm(`Delete the preset "${current.layout.name}"?${after}`)) return;
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
  addSpeaker() {
    edit((layout) => {
      const result = addSpeaker(layout);
      if (result.id) state.picked = { ids: [result.id], primary: result.id };
      return result.layout;
    });
  },
  addPair() {
    edit((layout) => {
      const result = addPair(layout);
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

const panel = createPanel(document.getElementById('panel'), actions);
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

function render() {
  const current = playing();
  const { layout } = current;
  const { ids } = state.picked;
  // Speakers you do not hear (muted, or another one soloed) are drawn grey.
  const silentIds = layout.speakers.filter((s) => isSilenced(s, state.solo, state.muted)).map((s) => s.id);
  panel.update({
    warnings: [...state.storeWarnings, ...state.collectionWarnings, ...state.audioWarnings],
    inputs: state.devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    outputs: state.devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications'),
    inputId: state.inputId,
    outputId: state.outputId,
    debug: state.debug,
    source: source(),
    muteWhen: state.settings.muteWhen,
    turnLook: state.settings.turnLook,
    pauseBehavior: state.settings.pauseBehavior,
    player: audio?.player ?? null,
    presets: presetOptions(state.store, state.truck),
    card: truckStatus(state.store, state.selection, state.truck),
    preset: selectionValue(state.selection),
    canDelete: current.kind === 'preset' && current.key !== allPresetKey(state.store), // all vehicles' preset and files stay
    canRename: current.kind === 'preset',
    canExport: current.kind !== 'collection', // a shared file is one already
    presetName: layout.name,
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

function statusText() {
  const pose = state.pose;
  if (!pose || !pose.sdkActive) return 'Game not running';
  if (!state.inWorld) return 'Game in the menu or loading';
  const truck = state.truck;
  const name = truck ? `${truck.name}${truck.variant ? ` (hook ${truck.variant} m)` : ''}` : 'Unknown vehicle';
  let muted = '';
  if (state.silenced && pose.paused && state.settings.pauseBehavior === 'muted') muted = ' · muted';
  else if (state.silenced) muted = ` · muted, ${state.settings.muteWhen === 'engine' ? 'engine' : 'electrics'} off`;
  if (pose.paused) return `${name} · paused${muted}`;
  const yaw = turnsToDeg(pose.head.heading + state.turn).toFixed(0);
  const lookNote = Math.round(state.turn * 360) ? ` (turn look ${turnsToDeg(state.turn).toFixed(0)}°)` : '';
  return `${name} · yaw ${yaw}°${lookNote} · pitch ${turnsToDeg(pose.head.pitch).toFixed(0)}°${muted}`;
}

let lastStatus = 0;
const frameWatch = createFrameWatch();
const easeBlinker = createEase();
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
  const truck = pose && pose.sdkActive ? pose.truck : null;
  // The axis may arrive a frame after the truck's name, so it counts as a change too.
  // Another chassis of the same model, or another truck with its own plate, counts too.
  const identity = (t) => (t ? `${variantKey(t)}#${t.plate ?? ''}` : null);
  const otherTruck = identity(truck) !== identity(state.truck);
  if (otherTruck || (truck?.centerX ?? null) !== (state.truck?.centerX ?? null)) {
    state.truck = truck;
    if (otherTruck) resetSession();
    // Its name, game and brand name the model's scopes while you drive something else.
    const learned = rememberVehicle(state.store, truck);
    if (learned !== state.store) {
      state.store = learned;
      scheduleSave();
    }
    syncEngine();
    render();
  }
  // The head is placed from the truck's axis: left of it by what the game reports, and
  // turned by the game's look into turns and toward the blinker, which the telemetry
  // leaves out. The blinker's step is eased in.
  const headX = headRestX(state.truck);
  const look = turnLook(pose, state.settings.turnLook);
  state.turn = look.steer + easeBlinker(look.blinker, performance.now());
  const heard = withTurnLook(pose, state.turn);
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

navigator.mediaDevices.addEventListener('devicechange', async () => {
  const active = [state.inputId, state.outputId];
  state.devices = await listDevices();
  const present = new Set(state.devices.map((d) => d.deviceId));
  if (active.some((id) => id && !present.has(id))) restartAudio();
  else render();
});

// Keyboard, outside text fields: arrows nudge the selection (Shift: 10 cm), Delete removes
// it, Esc clears it; Ctrl+A / C / V / D select all, copy, paste, duplicate.
const SHORTCUTS = {
  a: () => actions.selectAll(),
  c: () => actions.copySelected(),
  v: () => actions.paste(),
  d: () => actions.duplicateSelected(),
};
document.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
  const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && SHORTCUTS[event.key.toLowerCase()];
  if (shortcut) {
    event.preventDefault();
    shortcut();
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
