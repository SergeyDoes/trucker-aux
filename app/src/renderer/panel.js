// The control panel on the left. Built once; update(view) refreshes values in place
// so a field the user is typing into keeps its focus.
import { LABEL_COLORS, LABEL_MAX, TYPES, TYPE_NAMES } from '../shared/layout.js';
import { bandText } from '../shared/dsp.js';
import { speakerIcon } from './marks.js';

const CHANNEL_OPTIONS = [
  { value: 'L', label: 'Left' },
  { value: 'R', label: 'Right' },
  { value: 'M', label: 'Mono (L+R)' },
];
const TYPE_OPTIONS = TYPES.map((value) => {
  const band = bandText(value);
  return { value, label: band ? `${TYPE_NAMES[value]}, ${band}` : TYPE_NAMES[value] };
});
const TYPE_BADGE = { full: '', small: 'small', tweeter: 'tweeter', mid: 'mid', midbass: 'midbass', sub: 'sub' };
const MUTE_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'engine', label: 'Engine is off' },
  { value: 'electric', label: 'Electrics are off' },
];

// While the game is paused (settings.js PAUSE_BEHAVIORS).
const PAUSE_OPTIONS = [
  { value: 'active', label: 'Always active' },
  { value: 'muted', label: 'Always muted' },
  { value: 'vehicle', label: 'Active vehicle' },
];

// The game's options for looking into turns on the reverse gear (settings.js TURN_LOOK_REVERSE).
const REVERSE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
  { value: 'inverted', label: 'Inverted' },
];

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...[].concat(children));
  return node;
}

function row(label, control) {
  return el('label', { className: 'row' }, [el('span', { textContent: label }), control]);
}

// options: { value, label } entries, or { group, options } for a group of them. An entry
// may have `full`: the text it shows while selected, as a closed list hides the group.
function fillSelect(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    const option = (o) => {
      const node = el('option', { value: o.value, textContent: o.label });
      node.dataset.label = o.label;
      if (o.full) node.dataset.full = o.full;
      return node;
    };
    select.replaceChildren(...options.map((o) => (o.group ? el('optgroup', { label: o.group }, o.options.map(option)) : option(o))));
    select.dataset.key = key;
  }
  select.value = value ?? '';
  for (const node of select.options) {
    const text = node.selected && node.dataset.full ? node.dataset.full : node.dataset.label;
    if (text !== undefined && node.textContent !== text) node.textContent = text;
  }
}

// Sets a field unless the user is editing that very field.
function setValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function toggleButton(text, action, on, title) {
  const button = el('button', { textContent: text, title, className: on ? 'on' : '' });
  button.dataset.action = action;
  return button;
}

export function createPanel(root, actions) {
  const status = el('div', { className: 'status', textContent: 'Starting…' });
  const warnings = el('ul', { className: 'warnings' });

  const input = el('select');
  const output = el('select');
  const sourceInput = el('input', { type: 'radio', name: 'source', value: 'input' });
  const sourceFile = el('input', { type: 'radio', name: 'source', value: 'file' });
  const file = el('input', { type: 'file', accept: 'audio/*' });
  const playerSlot = el('div', { className: 'player' });
  const fileRow = el('div', {}, [file, playerSlot]);
  // Debug only (view.debug): the test file instead of the input device.
  const sourceRow = row('Source', el('div', { className: 'inline' }, [
    el('label', {}, [sourceInput, ' Input device']),
    el('label', {}, [sourceFile, ' Test file']),
  ]));
  const muteWhen = el('select', { title: 'Mute the music like a car radio while the vehicle is switched off in the game' });
  const pauseBehavior = el('select', {
    title: 'While the game is paused: keep playing, mute, or play while the vehicle is on, as "Mute when" says',
  });
  // The game's camera options, set as in the game (pose.js turnLook).
  const turnLookOn = el('input', { type: 'checkbox', title: 'The game\'s "look into turns"' });
  // Shown while the view comes from the game's camera (trucker_aux_camera.dll, shared/camera.js).
  const cameraNote = el('p', {
    className: 'hint',
    textContent: 'The game\'s camera is read (trucker_aux_camera.dll): the sound turns with it, so these settings are not used now.',
  });
  const turnLookPercent = el('input', {
    type: 'number', min: 0, max: 200, step: 5, className: 'narrow', title: 'As in the game: 100 % turns 35° at full lock',
  });
  const turnLookReverse = el('select', { title: '"Look into turns" on the reverse gear, as in the game' });
  const turnLookBlinkers = el('input', {
    type: 'checkbox', title: 'The game\'s "look toward the blinker": while a blinker is on, 20° toward the driver\'s side or 40° across (in a left-hand-drive cab 20° left, 40° right)',
  });

  const preset = el('select');
  // The truck in the game: what plays, what it applies to, and what can be done
  // (presets.js truckStatus). Buttons carry an action name.
  const cardTruck = el('span');
  const cardPlays = el('span');
  // Applies to: text, or the vehicle's ladder to move the preset that plays (Auto).
  const cardScopeText = el('span');
  const cardScopeSelect = el('select', { title: 'Move the preset that plays to a narrower or wider scope' });
  const cardScope = el('span', {}, [cardScopeText, cardScopeSelect]);
  const cardUseIn = el('select', { title: 'Put the preset picked in the list to use in this vehicle' });
  const cardNote = el('p', { className: 'hint card-note' });
  const cardUseInLabel = el('span', { className: 'cab-label', textContent: 'Use it in' });
  const cardButtons = el('div', { className: 'inline buttons' });
  const truckCard = el('div', { className: 'cab-card' }, [
    el('span', { className: 'cab-label', textContent: 'Vehicle' }), cardTruck,
    el('span', { className: 'cab-label', textContent: 'Plays' }), cardPlays,
    el('span', { className: 'cab-label', textContent: 'Applies to' }), cardScope,
    cardNote,
    cardUseInLabel, cardUseIn,
    el('span'), cardButtons,
  ]);
  cardScopeSelect.onchange = () => actions.moveToScope(cardScopeSelect.value);
  cardUseIn.onchange = () => actions.useInScope(cardUseIn.value);
  cardButtons.onclick = (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action) actions.truckAction(action);
  };
  const presetName = el('input', { type: 'text', title: 'Name of this preset' });
  const presetLabel = el('input', {
    type: 'text', maxLength: LABEL_MAX, className: 'narrow-text', placeholder: 'short tag',
    title: 'A short label, shown beside the keys that use this preset in the preset map',
  });
  const presetLabelColor = el('select', { title: 'Colour of the label in the preset map' });
  const newPreset = el('button', {
    textContent: 'New preset',
    title: 'Copy the current layout into a new preset and switch to it. Auto never picks it: choose it in the list.',
  });
  const deletePreset = el('button', { textContent: 'Delete preset' });
  // Shared presets: one file each in presets/, listed under Collection (collection.js).
  const exportButton = el('button', { textContent: 'Export…', title: 'Save presets as files to share, this one ticked' });
  const width = el('input', {
    type: 'range', min: 0, max: 2, step: 0.05, title: 'How different the left and right channels are before they reach the speakers',
  });
  const widthValue = el('span', { className: 'value' });
  const matchLoudness = el('input', { type: 'checkbox' });
  const loudnessNote = el('span', { className: 'hint' });

  const list = el('ul', { className: 'speakers' });
  const add = el('button', { textContent: '+ Speaker' });
  const addPair = el('button', { textContent: '+ Pair' });
  const duplicate = el('button', { textContent: 'Duplicate', title: 'Duplicate the selected speakers (Ctrl+D)' });
  const copy = el('button', { textContent: 'Copy', title: 'Copy the selected speakers, also to another preset (Ctrl+C)' });
  const paste = el('button', { textContent: 'Paste', title: 'Paste the copied speakers (Ctrl+V)' });

  const name = el('input', { type: 'text' });
  const channel = el('select');
  const type = el('select');
  const gain = el('input', { type: 'range', min: -30, max: 12, step: 0.5 });
  const gainValue = el('span', { className: 'value' });
  const pair = el('select');
  const coords = [0, 1, 2].map(() => el('input', { type: 'number', step: 1 }));
  const remove = el('button', { textContent: 'Delete speaker' });
  fillSelect(channel, CHANNEL_OPTIONS, 'L');
  fillSelect(type, TYPE_OPTIONS, 'full');

  const formTitle = el('legend', { textContent: 'Speaker' });
  const speakerForm = el('fieldset', {}, [
    formTitle,
    row('Name', name),
    row('Channel', channel),
    row('Type', type),
    row('Level', el('div', { className: 'inline' }, [gain, gainValue])),
    row('Mirror of', pair),
    row('X / Y / Z, cm', el('div', { className: 'coords' }, coords)),
    el('p', { className: 'hint', textContent: 'X right, Y up, Z back, from the zero point (0 in the views).' }),
    remove,
  ]);

  // The bounds: a box around the zero point, a guide for placing speakers. Symmetric about
  // the truck's axis, so one width; the other walls as positive distances from zero.
  const WALLS = [
    { label: 'Width', read: (b) => b.max[0] - b.min[0], write: (cm) => actions.setBoundsEdge(0, 'max', cm / 200) },
    { label: 'Bottom', read: (b) => -b.min[1], write: (cm) => actions.setBoundsEdge(1, 'min', -cm / 100) },
    { label: 'Top', read: (b) => b.max[1], write: (cm) => actions.setBoundsEdge(1, 'max', cm / 100) },
    { label: 'Front', read: (b) => -b.min[2], write: (cm) => actions.setBoundsEdge(2, 'min', -cm / 100) },
    { label: 'Back', read: (b) => b.max[2], write: (cm) => actions.setBoundsEdge(2, 'max', cm / 100) },
  ];
  const walls = WALLS.map((wall) => {
    const input = el('input', { type: 'number', step: 1, min: 0 });
    input.onchange = () => wall.write(Number(input.value));
    return { ...wall, input, label: el('label', {}, [wall.label, input]) };
  });
  const headNote = el('p', { className: 'hint' });
  const boundsForm = el('fieldset', {}, [
    el('legend', { textContent: 'Bounds, cm' }),
    el('div', { className: 'walls' }, walls.map((w) => w.label)),
    el('p', { className: 'hint', textContent: 'The bounds do not change the sound: they only frame the views for placing speakers.' }),
    headNote,
  ]);

  root.replaceChildren(
    status,
    warnings,
    el('fieldset', {}, [
      el('legend', { textContent: 'Audio' }),
      row('Input', input),
      row('Output', output),
      sourceRow,
      fileRow,
      row('Mute when', muteWhen),
      row('Pause behavior', pauseBehavior),
    ]),
    el('fieldset', {}, [
      el('legend', { textContent: 'Game camera' }),
      row('Into turns', el('div', { className: 'inline' }, [
        turnLookOn,
        el('label', { className: 'inline' }, [turnLookPercent, '%']),
      ])),
      row('In reverse', turnLookReverse),
      row('Blinkers', el('div', { className: 'inline' }, [turnLookBlinkers, 'Look toward them'])),
      cameraNote,
      el('p', {
        className: 'hint',
        textContent: 'Set these as in the game\'s Accessibility options: the game turns the camera without telling the telemetry, so the sound is turned here. 100 % is 35° at full lock; a blinker turns it 20° to the driver\'s side or 40° across.',
      }),
    ]),
    el('fieldset', {}, [
      el('legend', { textContent: 'Layout' }),
      row('Preset', preset),
      truckCard,
      row('Name', presetName),
      row('Label', el('div', { className: 'inline' }, [presetLabel, presetLabelColor])),
      el('div', { className: 'inline buttons' }, [newPreset, deletePreset, exportButton]),
      row('Stereo width', el('div', { className: 'inline' }, [width, widthValue])),
      el('p', { className: 'hint', textContent: '0 mono · 1 as recorded · 2 extra wide. Mono speakers are not affected.' }),
      el('label', {
        className: 'inline',
        title: 'Every preset plays as loud as the default two doors, whatever its number and kind of speakers. Speaker levels still apply on top.',
      }, [matchLoudness, 'Match loudness across presets', loudnessNote]),
    ]),
    boundsForm,
    el('fieldset', {}, [
      el('legend', { textContent: 'Speakers' }),
      list,
      el('div', { className: 'inline buttons' }, [add, addPair, duplicate, copy, paste]),
      el('p', { className: 'hint', textContent: 'Ctrl+click or drag a box in a view to select several; Shift+click a range; Ctrl+A all.' }),
    ]),
    speakerForm,
  );

  input.onchange = () => actions.selectInput(input.value);
  output.onchange = () => actions.selectOutput(output.value);
  for (const radio of [sourceInput, sourceFile]) radio.onchange = () => actions.setSource(radio.value);
  muteWhen.onchange = () => actions.setMuteWhen(muteWhen.value);
  pauseBehavior.onchange = () => actions.setPauseBehavior(pauseBehavior.value);
  turnLookOn.onchange = () => actions.setTurnLook({ on: turnLookOn.checked });
  turnLookPercent.onchange = () => actions.setTurnLook({ percent: Number(turnLookPercent.value) });
  turnLookReverse.onchange = () => actions.setTurnLook({ reverse: turnLookReverse.value });
  turnLookBlinkers.onchange = () => actions.setTurnLook({ blinkers: turnLookBlinkers.checked });
  file.onchange = () => {
    if (file.files[0]) actions.pickFile(file.files[0]);
  };
  preset.onchange = () => actions.selectPreset(preset.value);
  deletePreset.onclick = () => actions.deleteCurrentPreset();
  exportButton.onclick = () => actions.exportPresets('playing');
  newPreset.onclick = () => {
    actions.newPreset();
    presetName.focus();
    presetName.select();
  };
  presetName.onchange = () => actions.renamePreset(presetName.value);
  presetLabel.onchange = () => actions.setPresetLabel(presetLabel.value);
  presetLabelColor.onchange = () => actions.setPresetLabelColor(presetLabelColor.value);
  presetLabel.onkeydown = (event) => {
    if (event.key === 'Enter') presetLabel.blur();
  };
  presetName.onkeydown = (event) => {
    if (event.key === 'Enter') presetName.blur();
  };
  width.oninput = () => actions.setWidth(Number(width.value));
  matchLoudness.onchange = () => actions.setMatchLoudness(matchLoudness.checked);
  add.onclick = () => actions.addSpeaker();
  addPair.onclick = () => actions.addPair();
  duplicate.onclick = () => actions.duplicateSelected();
  copy.onclick = () => actions.copySelected();
  paste.onclick = () => actions.paste();
  list.onmousedown = (event) => {
    if (event.shiftKey) event.preventDefault(); // no text selection on shift+click
  };
  list.onclick = (event) => {
    const item = event.target.closest('li[data-id]');
    if (!item) return;
    const { id } = item.dataset;
    const what = event.target.dataset.action;
    if (what === 'solo') actions.toggleSolo(id);
    else if (what === 'mute') actions.toggleMute(id);
    else actions.selectSpeaker(id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
  };
  name.onchange = () => actions.updateSelected({ name: name.value });
  // With several speakers selected, a "Mixed" entry is shown until a real value is chosen.
  channel.onchange = () => channel.value && actions.updateSelected({ channel: channel.value });
  type.onchange = () => type.value && actions.updateSelected({ type: type.value });
  gain.oninput = () => actions.setLevel(Number(gain.value));
  pair.onchange = () => actions.setPair(pair.value || null);
  coords.forEach((coord, axis) => {
    coord.onchange = () => coord.value !== '' && actions.setCoordinate(axis, Number(coord.value) / 100);
  });
  remove.onclick = () => actions.deleteSelected();

  function speakerItem(s, view) {
    const item = el('li', { className: view.picked.includes(s.id) ? 'selected' : '' }, [
      speakerIcon(s, view.silentIds.includes(s.id)),
      el('span', { textContent: s.name }),
      el('span', { className: 'badge', textContent: TYPE_BADGE[s.type] }),
      toggleButton('S', 'solo', view.solo === s.id, 'Solo'),
      toggleButton('M', 'mute', view.muted.has(s.id), 'Mute'),
    ]);
    item.dataset.id = s.id;
    return item;
  }

  function update(view) {
    warnings.replaceChildren(...view.warnings.map((text) => el('li', { textContent: text })));
    fillSelect(input, view.inputs.map((d) => ({ value: d.deviceId, label: d.label || 'Unnamed input' })), view.inputId);
    fillSelect(output, view.outputs.map((d) => ({ value: d.deviceId, label: d.label || 'Unnamed output' })), view.outputId);
    sourceInput.checked = view.source === 'input';
    sourceFile.checked = view.source === 'file';
    sourceRow.hidden = !view.debug;
    fileRow.hidden = view.source !== 'file';
    fillSelect(muteWhen, MUTE_OPTIONS, view.muteWhen);
    fillSelect(pauseBehavior, PAUSE_OPTIONS, view.pauseBehavior);
    const look = view.turnLook;
    const fromGame = Boolean(view.cameraSource);
    turnLookOn.checked = look.on;
    turnLookOn.disabled = fromGame;
    setValue(turnLookPercent, look.percent);
    turnLookPercent.disabled = !look.on || fromGame;
    fillSelect(turnLookReverse, REVERSE_OPTIONS, look.reverse);
    turnLookReverse.disabled = !look.on || fromGame;
    turnLookBlinkers.checked = look.blinkers;
    turnLookBlinkers.disabled = fromGame;
    cameraNote.hidden = !fromGame;
    if (playerSlot.firstChild !== view.player) playerSlot.replaceChildren(...(view.player ? [view.player] : []));

    fillSelect(preset, view.presets, view.preset);
    const { card } = view;
    cardTruck.textContent = card.truck;
    cardPlays.textContent = card.plays;
    cardScopeText.textContent = card.appliesTo;
    cardScopeText.hidden = Boolean(card.scope);
    cardScopeSelect.hidden = !card.scope;
    if (card.scope) fillSelect(cardScopeSelect, card.scope.options, card.scope.value);
    cardUseIn.hidden = !card.useIn;
    if (card.useIn) fillSelect(cardUseIn, card.useIn.options, '');
    cardNote.textContent = card.note ?? '';
    cardNote.hidden = !card.note;

    const key = JSON.stringify(card.buttons);
    if (cardButtons.dataset.key !== key) {
      cardButtons.replaceChildren(...card.buttons.map((b) => {
        const button = el('button', { textContent: b.label });
        button.dataset.action = b.action;
        return button;
      }));
      cardButtons.dataset.key = key;
    }
    cardButtons.hidden = !card.buttons.length;
    cardUseInLabel.hidden = !card.useIn;
    deletePreset.disabled = !view.canDelete;
    presetName.disabled = !view.canRename; // a shared file keeps its name
    setValue(presetName, view.presetName);
    presetLabel.disabled = !view.canRename;
    setValue(presetLabel, view.presetLabel);
    fillSelect(presetLabelColor, LABEL_COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })), view.presetLabelColor);
    presetLabelColor.disabled = !view.canRename || !view.presetLabel;
    presetLabelColor.className = `label-color tag-${view.presetLabelColor}`;
    setValue(width, view.width);
    widthValue.textContent = view.width.toFixed(2);
    matchLoudness.checked = view.matchLoudness;
    // The trim this preset gets, or would get with the box ticked.
    if (view.loudnessDb === null) loudnessNote.textContent = 'measuring…';
    else {
      const db = Math.abs(view.loudnessDb) < 0.05 ? 0 : view.loudnessDb;
      const trim = `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
      loudnessNote.textContent = view.matchLoudness ? trim : `(would be ${trim})`;
    }
    for (const w of walls) setValue(w.input, Math.round(w.read(view.bounds) * 100));
    const headCm = Math.round(view.headX * 100);
    headNote.textContent = view.headFromGame
      ? `Driver's head: X ${headCm} cm, from the game.`
      : `Driver's head: X ${headCm} cm, typical (no vehicle in the game).`;

    list.replaceChildren(...view.speakers.map((s) => speakerItem(s, view)));
    add.disabled = view.speakers.length >= view.maxSpeakers;
    addPair.disabled = view.speakers.length + 2 > view.maxSpeakers;
    const atCamera = view.cameraSource === 'free';
    add.title = atCamera ? 'Adds a speaker where the game\'s free camera is' : '';
    addPair.title = atCamera ? 'Adds a pair: the speaker on the free camera\'s side where the camera is, the other mirrored' : '';
    duplicate.disabled = !view.canDuplicate;
    copy.disabled = !view.selected.length;
    paste.disabled = !view.canPaste;

    const chosen = view.selected;
    const s = view.primary;
    speakerForm.hidden = !s;
    if (!s) return;
    const many = chosen.length > 1;
    // A value shared by every selected speaker, or null when they differ.
    const common = (get) => (chosen.every((o) => get(o) === get(s)) ? get(s) : null);
    formTitle.textContent = many ? `${chosen.length} speakers` : 'Speaker';
    remove.textContent = many ? `Delete ${chosen.length} speakers` : 'Delete speaker';
    name.disabled = many;
    setValue(name, many ? '' : s.name);
    for (const [select, options, key] of [[channel, CHANNEL_OPTIONS, 'channel'], [type, TYPE_OPTIONS, 'type']]) {
      const value = common((o) => o[key]);
      fillSelect(select, value === null ? [{ value: '', label: 'Mixed' }, ...options] : options, value ?? '');
    }
    setValue(gain, s.gainDb);
    const level = common((o) => o.gainDb);
    gainValue.textContent = level === null ? `${s.gainDb.toFixed(1)} dB, mixed` : `${s.gainDb.toFixed(1)} dB`;
    gain.title = many ? 'Moves the levels of all selected speakers by the same amount' : '';
    pair.disabled = many;
    fillSelect(pair, [
      { value: '', label: 'None' },
      ...view.speakers.filter((o) => o.id !== s.id).map((o) => ({ value: o.id, label: o.name })),
    ], many ? '' : s.pair ?? '');
    coords.forEach((c, i) => {
      const value = common((o) => o.position[i]);
      c.placeholder = value === null ? 'mixed' : '';
      setValue(c, value === null ? '' : Math.round(value * 100));
    });
  }

  return {
    update,
    setStatus(text) {
      status.textContent = text;
    },
  };
}
