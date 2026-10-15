// The preset map (presets.js presetTree) as a standing panel on the left, like the registry
// editor's key tree. A key with a preset of its own is bold with a "preset" mark (it
// overrides what it would inherit, as a prefab override in Unity); a shared file's says
// "shared file"; the others inherit. A model lists its variants as rows, each with its mark (the
// model's row has none), and "+N" while folded. Click a key to play and edit what it
// has; right-click for its menu; drag a preset onto a key to add it to that key's variants (moved
// from its key; Ctrl: a copy). Ctrl+C / V / D copy, paste and duplicate the preset picked here.
import { labelBadge } from './badge.js';
import { variantLabel } from '../shared/presets.js';

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

// Where a model's variant plays: the hooks and your vehicles remembering it ("hook 2.7 m,
// WP-1"), or its plate for a vehicle's own preset ("only WP-1"); "" when none.
function whereList(v) {
  if (v.plate) return `only ${v.plate}`;
  return [...(v.hooks ?? []).map((h) => `hook ${h} m`), ...(v.plates ?? [])].join(', ');
}

// A key's or a variant's badge without a label of its own: what it is.
const KIND_BADGE = { default: 'default', file: 'shared file', own: 'preset' };

const FOLDER = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" fill="#e8b84a" stroke="#b8862a" stroke-width="1"/></svg>';
const DRAG_TYPE = 'application/x-trucker-aux-preset';

export function createKeyTree(root, actions) {
  // Auto follows the vehicle in the game; picking a key or a preset stops that until pressed.
  const auto = el('button', { className: 'reg-auto', textContent: 'Auto', onclick: () => actions.selectPreset('auto') });
  const undo = el('button', { textContent: '↶', title: 'Undo (Ctrl+Z)', onclick: () => actions.undo() });
  const redo = el('button', { textContent: '↷', title: 'Redo (Ctrl+Y)', onclick: () => actions.redo() });
  const share = el('button', { className: 'reg-file', textContent: 'Export…', title: 'Pick presets to save as files to share', onclick: () => actions.exportPresets() });
  const take = el('button', { className: 'reg-file', textContent: 'Import…', title: 'Make preset files your presets, on the keys they are for', onclick: () => actions.importPresets() });
  const tree = el('ul', { className: 'reg-tree', role: 'tree' });
  // Below the keys: presets on no key, to keep, rename and put on keys again.
  const unusedList = el('div', { className: 'reg-unused-list' });
  const unused = el('section', { className: 'reg-unused' }, [
    el('h3', { textContent: 'Unused presets' }),
    el('p', { className: 'hint', textContent: 'Drag a key\'s preset here to take it off the key (Ctrl: a copy). Double-click or F2 to rename; drag onto a key to add it to its variants.' }),
    unusedList,
  ]);
  const splitter = el('div', { className: 'reg-split', title: 'Drag to resize' });
  root.replaceChildren(
    el('header', {}, [el('h2', { textContent: 'Presets' }), auto, take, share, undo, redo]),
    el('p', {
      className: 'hint',
      textContent: 'Click a key to play and edit it; right-click for more. A model lists its presets as rows ◆ under it (click one to play and edit it): "preset" yours, "default" comes with the app, or their labels; "+N" while folded. Another key is bold with such a mark when set there; the rest inherit. ● the vehicle in the game, ▶ what plays in Auto. Drag a preset onto a key to add it to its variants (Ctrl: a copy); Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate the preset picked here.',
    }),
    el('div', { className: 'reg-keys' }, [tree]),
    splitter,
    unused,
  );
  // The right edge sets the panel's width (kept in this browser profile, between runs).
  const WIDTH_KEY = 'truckerAux.treeWidth';
  const setWidth = (px) => {
    const width = Math.round(Math.max(200, Math.min(700, px)));
    document.documentElement.style.setProperty('--tree-width', `${width}px`);
    return width;
  };
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (saved) setWidth(saved);
  const edge = el('div', { className: 'reg-width', title: 'Drag to resize' });
  root.append(edge);
  edge.addEventListener('pointerdown', (event) => {
    edge.setPointerCapture(event.pointerId);
    edge.classList.add('dragging');
    const left = root.getBoundingClientRect().left;
    const move = (e) => setWidth(e.clientX - left);
    const stop = (e) => {
      localStorage.setItem(WIDTH_KEY, String(setWidth(e.clientX - left)));
      edge.classList.remove('dragging');
      edge.removeEventListener('pointermove', move);
      edge.removeEventListener('pointerup', stop);
    };
    edge.addEventListener('pointermove', move);
    edge.addEventListener('pointerup', stop);
  });
  const resetWidth = () => {
    document.documentElement.style.removeProperty('--tree-width');
    localStorage.removeItem(WIDTH_KEY);
  };
  edge.ondblclick = resetWidth;

  // The splitter sets the height of the unused presets (remembered for this session).
  splitter.addEventListener('pointerdown', (event) => {
    splitter.setPointerCapture(event.pointerId);
    const start = event.clientY;
    const height = unused.getBoundingClientRect().height;
    const move = (e) => { unused.style.height = `${Math.max(60, Math.min(root.clientHeight - 160, height - (e.clientY - start)))}px`; };
    const stop = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', stop);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', stop);
  });
  // A key's preset dropped here leaves the key (with Ctrl, or from all vehicles, a copy).
  unused.addEventListener('dragover', (event) => {
    if (!dragging?.from && !dragging?.file) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.ctrlKey || dragging.from === 'all' || dragging.file ? 'copy' : 'move';
    unused.classList.add('drop');
  });
  unused.addEventListener('dragleave', (event) => {
    if (!unused.contains(event.relatedTarget)) unused.classList.remove('drop');
  });
  unused.addEventListener('drop', (event) => {
    event.preventDefault();
    unused.classList.remove('drop');
    const payload = dragging;
    dragging = null;
    if (payload) actions.dropToUnused(payload, event.ctrlKey);
  });

  const menu = el('div', { className: 'reg-menu', hidden: true });
  document.body.append(menu);
  const closeMenu = () => { menu.hidden = true; };
  // Ctrl+C, V and D are for the preset picked here while the tree (or its menu) was clicked last
  // (app.js SHORTCUTS); elsewhere they are the speakers'.
  let active = false;
  document.addEventListener('pointerdown', (event) => { active = root.contains(event.target) || menu.contains(event.target); }, true);
  document.addEventListener('mousedown', (event) => { if (!menu.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);

  const expanded = new Set();
  let seeded = false;
  let last = null;
  let dragging = null; // { from, key } of what is dragged (from: its key, or null for one on no key)
  let openTimer = null;

  const dragSource = (element, payload) => {
    element.draggable = true;
    element.addEventListener('dragstart', (event) => {
      dragging = payload;
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = 'copyMove';
    });
    element.addEventListener('dragend', () => {
      dragging = null;
      clearTimeout(openTimer);
      for (const r of tree.querySelectorAll('.drop')) r.classList.remove('drop');
    });
  };

  // Opened at first: all vehicles, the games, and the way to the vehicle in the game; later
  // also the way to the key picked.
  function seed(node) {
    if (node.scope === 'all' || node.scope.startsWith('game:') || (node.current && node.children.some((c) => c.current))) expanded.add(node.scope);
    node.children.forEach(seed);
  }
  function openTo(node, scope) {
    if (node.scope === scope) return true;
    const inside = node.children.some((c) => openTo(c, scope));
    if (inside) expanded.add(node.scope);
    return inside;
  }

  // A key's variants as rows of their own under it (a model's cabs, two or more): the one the
  // key shows first, then the others.
  // A key's variants as rows under it, the one shown on the key first: a model's even when it is
  // the only one, so a model always lists what it has; another key's only beside others.
  const variantsOf = (node) => (node.pseudo || !node.own || (!node.alternates.length && node.level !== 'model') ? [] : [{ ...node.own, shown: true }, ...node.alternates]);

  const menuAt = (event, title, items) => {
    menu.replaceChildren(el('div', { className: 'reg-menu-title', textContent: title }), ...items);
    menu.hidden = false;
    const { innerWidth, innerHeight } = window;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, innerWidth - box.width - 4)}px`;
    menu.style.top = `${Math.min(event.clientY, innerHeight - box.height - 4)}px`;
  };
  // keys: the shortcut shown beside the item.
  const menuItem = (label, run, disabled = false, title = '', keys = '') => el('button', {
    disabled,
    title,
    onclick: () => {
      closeMenu();
      run();
    },
  }, [label, ...(keys ? [el('span', { className: 'reg-shortcut', textContent: keys })] : [])]);
  // A preset's Duplicate, Copy and Paste (for a key: onto it) and Delete; copies join the key's
  // variants, what plays there stays.
  const presetItems = (scope, key, deletable) => [
    ...(key ? [menuItem('Duplicate', () => actions.copyToKey(scope, key), false, '', 'Ctrl+D'), menuItem('Copy', () => actions.copyPreset(key), false, '', 'Ctrl+C')] : []),
    menuItem('Paste', () => actions.pastePreset(scope), !actions.canPaste(), '', 'Ctrl+V'),
    ...(key && deletable ? [menuItem('Delete', () => actions.deleteVariant(scope, key))] : []),
  ];

  function showMenu(event, node) {
    event.preventDefault();
    const variants = variantsOf(node);
    const items = [];
    if (!node.pseudo) {
      if (!(node.own && node.own.key === last.map.currentKey)) items.push(menuItem('Set the current preset here', () => actions.assignCurrent(node.scope)));
      items.push(menuItem('Copy the current preset here', () => actions.copyCurrent(node.scope)));
      // A copy of what plays now, labelled "new", among the key's variants.
      items.push(menuItem('Add current as variant', () => actions.newVariant(node.scope)));
      items.push(el('hr'));
      // A shared file is taken off a model only: it stays in its folder, hidden from the variants.
      const removable = node.own && node.scope !== 'all' && (!node.own.file || node.level === 'model');
      items.push(...presetItems(node.scope, node.own?.key, removable));
      if (!node.alternates.length && removable) items.push(menuItem('Unassign', () => actions.dropVariant(node.scope, node.own.key)));
      items.push(menuItem('Export…', () => actions.exportPresets(node.scope)));
      if (node.children.length || variants.length) items.push(el('hr'));
    }
    if (node.children.length || variants.length) {
      items.push(menuItem(expanded.has(node.scope) ? 'Collapse' : 'Expand', () => {
        if (expanded.has(node.scope)) expanded.delete(node.scope);
        else expanded.add(node.scope);
        draw();
      }));
    }
    if (items.length) menuAt(event, node.label, items);
  }

  // A variant's menu: play it (on the model in the game: in that vehicle, remembered by its hook
  // or plate; elsewhere: the key's current), Duplicate, Copy, Paste, Delete, Export.
  function showVariantMenu(event, node, v) {
    event.preventDefault();
    const inGame = node.current && node.level === 'model';
    const playing = inGame ? node.plays && v.shown : v.active;
    menuAt(event, variantLabel(v), [
      menuItem(inGame ? 'Play in this vehicle' : 'Make current', () => actions.playVariant(node.scope, v.key), playing),
      el('hr'),
      ...presetItems(node.scope, v.key, node.scope !== 'all' && (!v.file || node.level === 'model')),
      menuItem('Export…', () => actions.exportPresets({ key: v.key })),
    ]);
  }

  // A row things are dropped on: the key's (a variant's row stands for its key). A drop adds to
  // the key's variants: a copy with Ctrl, from all vehicles or of a file (app.js dropInMap).
  function dropTarget(line, node) {
    line.addEventListener('dragover', (event) => {
      if (!dragging) return;
      const copy = event.ctrlKey || dragging.file || dragging.from === 'all';
      const there = dragging.from === node.scope || node.own?.key === dragging.key || (node.alternates ?? []).some((v) => v.key === dragging.key);
      if (there && !copy) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = copy ? 'copy' : 'move';
      line.classList.add('drop');
    });
    line.addEventListener('dragleave', () => line.classList.remove('drop'));
    line.addEventListener('drop', (event) => {
      event.preventDefault();
      line.classList.remove('drop');
      const payload = dragging ?? JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || 'null');
      dragging = null; // the source row may be gone (a folder opened while dragging redraws)
      clearTimeout(openTimer);
      if (payload) actions.dropInMap(payload, node.scope, event.ctrlKey);
    });
  }

  // A variant's row: its badge, where it plays (hooks, plates), ▶ when Auto plays it. A click
  // plays it to edit (a file: your copy in its place at the first edit), as a key's click does.
  function variantRow(node, v) {
    const kind = v.default ? 'default' : v.file ? 'file' : 'own';
    const where = whereList(v);
    const line = el('div', {
      className: `reg-row reg-variant ${kind}${v.picked ? ' selected' : ''}`,
      title: [v.name, where && (v.plate ? where : `plays on ${where}`)].filter(Boolean).join('\n'),
    }, [
      el('span', { className: 'reg-toggle' }),
      el('span', { className: 'reg-icon reg-variant-icon', textContent: '◆' }),
      labelBadge(v.label || KIND_BADGE[kind], `reg-badge${v.label ? ` tag-${v.labelColor}` : kind === 'default' ? ' tag-gray' : ''}`),
      el('span', { className: 'reg-where', textContent: where }),
      el('span', { className: 'reg-mark', textContent: node.plays && v.shown ? '▶' : '' }),
    ]);
    line.onclick = () => actions.selectVariant(node.scope, v.key);
    line.oncontextmenu = (event) => showVariantMenu(event, node, v);
    dragSource(line, { from: v.file ? null : node.scope, key: v.key, file: v.file });
    dropTarget(line, node);
    return el('li', { role: 'treeitem' }, [line]);
  }

  function row(node, map) {
    const open = expanded.has(node.scope);
    const variants = variantsOf(node);
    const opens = node.children.length > 0 || variants.length > 0;
    const toggle = el('span', { className: 'reg-toggle', textContent: opens ? (open ? '▾' : '▸') : '' });
    const flip = () => {
      if (open) expanded.delete(node.scope);
      else expanded.add(node.scope);
      draw();
    };
    toggle.onclick = (event) => {
      event.stopPropagation();
      flip();
    };
    let kind = 'inherited';
    if (node.own) kind = node.own.default ? 'default' : node.own.file ? 'file' : 'own';
    // No preset names in the tree: a key's own preset shows its label, else "preset" (a shared
    // file: its label, else "shared file"; a default, one from presets/default/: "default");
    // a key that inherits shows nothing. A model shows them on its variants' rows only.
    const badge = node.own && node.level !== 'model' ? node.own.label || KIND_BADGE[kind] : '';
    const where = node.own ? whereList(node.own) : '';
    const line = el('div', {
      className: `reg-row ${kind}${node.current ? ' current' : ''}${node.picked ? ' selected' : ''}${node.pseudo ? ' pseudo' : ''}`,
      title: node.own
        ? [`${node.own.name}${node.own.default ? ' (comes with the app; editing gives the key a copy of yours)' : ''}`, where && `plays on ${where}`].filter(Boolean).join('\n')
        : node.inherited ? `inherits ${node.inherited.name} from ${node.inherited.from}` : '',
    }, [
      toggle,
      el('span', { className: 'reg-icon', innerHTML: FOLDER }),
      el('span', { className: 'reg-name', textContent: node.label, title: node.label }),
      ...(badge ? [labelBadge(badge, `reg-badge${node.own.label ? ` tag-${node.own.labelColor}` : kind === 'default' ? ' tag-gray' : ''}`)] : []),
      // The key's other variants (a model's cabs): how many, while their rows are folded away.
      ...(node.alternates.length && !open ? [el('span', {
        className: 'reg-more',
        textContent: `+${node.alternates.length}`,
        title: `Variants: ${node.alternates.map(variantLabel).join(', ')} (unfold the key to see them)`,
      })] : []),
      el('span', { className: 'reg-mark', textContent: node.plays ? '▶' : node.current ? '●' : '' }),
    ]);
    line.onclick = () => (node.pseudo ? flip() : actions.selectScope(node.scope));
    line.ondblclick = flip;
    line.oncontextmenu = (event) => showMenu(event, node);
    if (node.own) dragSource(line, { from: node.own.file ? null : node.scope, key: node.own.key, file: node.own.file });
    if (!node.pseudo) dropTarget(line, node);
    // A closed folder opens when something is held over it, as in Explorer.
    if (opens && !open) {
      line.addEventListener('dragenter', () => {
        if (!dragging) return;
        clearTimeout(openTimer);
        openTimer = setTimeout(() => {
          expanded.add(node.scope);
          draw();
        }, 600);
      });
    }
    const li = el('li', { role: 'treeitem' }, [line]);
    if (open && opens) li.append(el('ul', {}, [...variants.map((v) => variantRow(node, v)), ...node.children.map((c) => row(c, map))]));
    return li;
  }

  // One unused preset: click plays it, drag onto a key uses it, double-click or F2 renames
  // (not a shared file: those are files), right-click for its menu.
  function unusedItem(p, file) {
    const name = el('span', { textContent: p.name });
    const tag = p.label ? [labelBadge(p.label, `reg-badge tag-${p.labelColor ?? 'blue'}`)] : [];
    const item = el('div', { className: `reg-loose${file ? ' file' : ''}`, tabIndex: 0, title: file ? `${p.default ? 'A default' : 'A shared file'} for no vehicle` : 'Click to play; drag onto a key' }, [name, ...tag]);
    dragSource(item, { from: null, key: p.key, file });
    const rename = () => {
      if (file) return;
      const input = el('input', { type: 'text', value: p.name, className: 'reg-rename' });
      renaming = true;
      const done = (commit) => {
        if (!renaming) return; // Enter, then the blur that follows
        renaming = false;
        if (commit && input.value.trim() && input.value.trim() !== p.name) actions.renamePresetKey(p.key, input.value.trim());
        else draw();
      };
      input.onkeydown = (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') done(true);
        if (event.key === 'Escape') done(false);
      };
      input.onblur = () => done(true);
      input.onclick = (event) => event.stopPropagation();
      item.draggable = false;
      name.replaceWith(input);
      input.focus();
      input.select();
    };
    // The first click plays it (and redraws the list), so the second click of a double-click
    // lands on the new item: it renames there.
    item.onclick = (event) => (event.detail === 2 ? rename() : actions.selectPreset(`truck:${p.key}`));
    item.onkeydown = (event) => {
      if (event.key === 'F2') rename();
    };
    item.oncontextmenu = (event) => {
      event.preventDefault();
      const entry = (label, run, disabled = false) => el('button', { textContent: label, disabled, onclick: () => { closeMenu(); run(); } });
      menu.replaceChildren(
        el('div', { className: 'reg-menu-title', textContent: p.name }),
        entry('Play it', () => actions.selectPreset(`truck:${p.key}`)),
        entry('Rename', rename, file),
        entry('Duplicate', () => actions.duplicatePresetKey(p.key)),
        entry('Delete', () => actions.deletePresetKey(p.key), file),
      );
      menu.hidden = false;
      const box = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(event.clientX, window.innerWidth - box.width - 4)}px`;
      menu.style.top = `${Math.min(event.clientY, window.innerHeight - box.height - 4)}px`;
    };
    return item;
  }

  function draw() {
    if (!last) return;
    const { map } = last;
    tree.replaceChildren(row(map.root, map));
    if (renaming) return; // a redraw would drop the name being typed
    unusedList.replaceChildren(
      ...map.unassigned.map((p) => unusedItem(p, false)),
      ...map.files.map((f) => unusedItem(f, true)),
    );
    if (!map.unassigned.length && !map.files.length) unusedList.append(el('p', { className: 'hint', textContent: 'None.' }));
  }

  let lastPicked = null;
  let renaming = false;
  let lastCurrent = null;
  return {
    // Whether the tree (or its menu) was clicked last: the keyboard's copy and paste are its own.
    isActive: () => active,
    // A key opened, and the keys above it, to show variants just added (drawn at the next update).
    reveal(scope) {
      if (last) openTo(last.map.root, scope);
      expanded.add(scope);
    },
    // View › Reset panel layout: the tree's width and the unused presets' height as at first.
    resetLayout() {
      resetWidth();
      unused.style.height = '';
    },
    // map: presetTree(...) plus currentKey (the preset that plays); history: { undo, redo }
    // counts and auto (whether Auto is chosen).
    update(map, history) {
      if (!seeded) {
        seed(map.root);
        seeded = true;
      }
      const picked = (function find(n) { return n.picked ? n.scope : n.children.map(find).find(Boolean); })(map.root) ?? null;
      if (picked && picked !== lastPicked) openTo(map.root, picked);
      lastPicked = picked;
      // The vehicle in the game: its key is opened to whenever another one comes.
      const current = (function deepest(n) { return n.current ? n.children.map(deepest).find(Boolean) ?? n.scope : null; })(map.root);
      if (current && current !== lastCurrent) openTo(map.root, current);
      lastCurrent = current;
      auto.classList.toggle('on', history.auto);
      auto.title = history.auto ? 'Following the vehicle in the game' : 'Back to Auto: follow the vehicle in the game again';
      undo.disabled = !history.undo;
      redo.disabled = !history.redo;
      last = { map };
      draw();
    },
  };
}
