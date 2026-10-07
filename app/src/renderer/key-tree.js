// The preset map (presets.js presetTree) as a standing panel on the left, like the registry
// editor's key tree. A key with a preset of its own is bold with a "preset" mark (it
// overrides what it would inherit, as a prefab override in Unity); a shared file's says
// "shared file"; the others inherit. Click a key to play and edit what it has; right-click
// for its menu; drag a key's preset onto another key to move it (Ctrl: set it there as well).
import { labelBadge } from './badge.js';

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

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
    el('p', { className: 'hint', textContent: 'Drag a key\'s preset here to take it off the key (Ctrl: a copy). Double-click or F2 to rename; drag onto a key to use it.' }),
    unusedList,
  ]);
  const splitter = el('div', { className: 'reg-split', title: 'Drag to resize' });
  root.replaceChildren(
    el('header', {}, [el('h2', { textContent: 'Presets' }), auto, take, share, undo, redo]),
    el('p', {
      className: 'hint',
      textContent: 'Click a key to play and edit it; right-click for more. Bold "preset": set on that key; "default": comes with the app; the rest inherit. ● the vehicle in the game, ▶ what plays in Auto. Drag a preset onto a key to move it (Ctrl: also there).',
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
  edge.ondblclick = () => {
    document.documentElement.style.removeProperty('--tree-width');
    localStorage.removeItem(WIDTH_KEY);
  };

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

  function showMenu(event, node, map) {
    event.preventDefault();
    const item = (label, run, disabled = false) => el('button', {
      textContent: label,
      disabled,
      onclick: () => {
        closeMenu();
        run();
      },
    });
    const items = [];
    if (!node.pseudo) {
      items.push(
        item('Set the current preset here', () => actions.assignCurrent(node.scope), node.own && node.own.key === map.currentKey),
        item('Copy the current preset here', () => actions.copyCurrent(node.scope)),
      );
      if (node.own && !node.own.file && node.scope !== 'all') items.push(item('Unassign', () => actions.unassignScope(node.scope)));
      items.push(item('Export…', () => actions.exportPresets(node.scope)));
      items.push(el('hr'));
    }
    if (node.children.length) {
      items.push(item(expanded.has(node.scope) ? 'Collapse' : 'Expand', () => {
        if (expanded.has(node.scope)) expanded.delete(node.scope);
        else expanded.add(node.scope);
        draw();
      }));
    }
    if (!items.length) return;
    menu.replaceChildren(el('div', { className: 'reg-menu-title', textContent: node.label }), ...items);
    menu.hidden = false;
    const { innerWidth, innerHeight } = window;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, innerWidth - box.width - 4)}px`;
    menu.style.top = `${Math.min(event.clientY, innerHeight - box.height - 4)}px`;
  }

  function row(node, map) {
    const open = expanded.has(node.scope);
    const toggle = el('span', { className: 'reg-toggle', textContent: node.children.length ? (open ? '▾' : '▸') : '' });
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
    // a key that inherits shows nothing.
    const KIND_BADGE = { default: 'default', file: 'shared file', own: 'preset' };
    const badge = node.own ? node.own.label || KIND_BADGE[kind] : '';
    const line = el('div', {
      className: `reg-row ${kind}${node.current ? ' current' : ''}${node.picked ? ' selected' : ''}${node.pseudo ? ' pseudo' : ''}`,
      title: node.own ? `${node.own.name}${node.own.default ? ' (comes with the app; editing gives the key a copy of yours)' : ''}` : node.inherited ? `inherits ${node.inherited.name} from ${node.inherited.from}` : '',
    }, [
      toggle,
      el('span', { className: 'reg-icon', innerHTML: FOLDER }),
      el('span', { className: 'reg-name', textContent: node.label, title: node.label }),
      ...(badge ? [labelBadge(badge, `reg-badge${node.own.label ? ` tag-${node.own.labelColor}` : kind === 'default' ? ' tag-gray' : ''}`)] : []),
      el('span', { className: 'reg-mark', textContent: node.plays ? '▶' : node.current ? '●' : '' }),
    ]);
    line.onclick = () => (node.pseudo ? flip() : actions.selectScope(node.scope));
    line.ondblclick = flip;
    line.oncontextmenu = (event) => showMenu(event, node, map);
    if (node.own) dragSource(line, { from: node.own.file ? null : node.scope, key: node.own.key, file: node.own.file });
    if (!node.pseudo) {
      line.addEventListener('dragover', (event) => {
        if (!dragging || dragging.from === node.scope || node.own?.key === dragging.key) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = event.ctrlKey || !dragging.from ? 'copy' : 'move';
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
    // A closed folder opens when something is held over it, as in Explorer.
    if (node.children.length && !open) {
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
    if (open && node.children.length) li.append(el('ul', {}, node.children.map((c) => row(c, map))));
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
