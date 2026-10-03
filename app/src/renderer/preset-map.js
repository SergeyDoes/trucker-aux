// The preset map (presets.js presetTree), laid out like the registry editor: keys in a tree
// on the left, the selected key on the right. A key with a preset of its own is bold (it
// overrides what it would inherit, as a prefab override in Unity); a shared file's is
// italic; the others show, grey, what they inherit.
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const FOLDER = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" fill="#e8b84a" stroke="#b8862a" stroke-width="1"/></svg>';

export function createPresetMap(actions) {
  const tree = el('ul', { className: 'reg-tree', role: 'tree' });
  const details = el('div', { className: 'reg-details' });
  const close = el('button', { textContent: 'Close', title: 'Esc' });
  const root = el('section', { className: 'preset-map', hidden: true }, [
    el('header', {}, [
      el('h2', { textContent: 'Preset map' }),
      el('p', { className: 'hint', textContent: 'Bold: a preset set on that key. Grey: inherited from above. ● the vehicle in the game, ▶ what plays now. Drag a preset onto a key to move it there; hold Ctrl to set it there as well.' }),
      close,
    ]),
    el('div', { className: 'reg-panes' }, [el('div', { className: 'reg-left' }, [tree]), details]),
  ]);
  document.body.append(root);
  close.onclick = () => actions.toggleMap(false);

  const expanded = new Set();
  // Dragging: { from, key } of what is dragged (from: its key, or null for one on no key).
  const DRAG_TYPE = 'application/x-trucker-aux-preset';
  let dragging = null;
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
  let seeded = false;
  let selected = null;
  let last = null; // { map, presets }

  function find(node, scope) {
    if (node.scope === scope) return node;
    for (const c of node.children) {
      const hit = find(c, scope);
      if (hit) return hit;
    }
    return null;
  }

  // Opened at first: all vehicles, the games, and the way to the vehicle in the game.
  function seed(node) {
    if (node.scope === 'all' || node.scope.startsWith('game:') || (node.current && node.children.some((c) => c.current))) expanded.add(node.scope);
    node.children.forEach(seed);
  }

  function row(node) {
    const open = expanded.has(node.scope);
    const toggle = el('span', { className: 'reg-toggle', textContent: node.children.length ? (open ? '▾' : '▸') : '' });
    toggle.onclick = (event) => {
      event.stopPropagation();
      if (open) expanded.delete(node.scope);
      else expanded.add(node.scope);
      draw();
    };
    const icon = el('span', { className: 'reg-icon', innerHTML: FOLDER });
    let kind = 'inherited';
    if (node.own) kind = node.own.file ? 'file' : 'own';
    const value = node.own ? node.own.name : node.inherited?.name ?? '';
    const line = el('div', {
      className: `reg-row ${kind}${node.current ? ' current' : ''}${node.scope === selected ? ' selected' : ''}`,
    }, [
      toggle, icon,
      el('span', { className: 'reg-name', textContent: node.label }),
      el('span', { className: 'reg-value', textContent: value }),
      el('span', { className: 'reg-mark', textContent: node.plays ? '▶' : node.current ? '●' : '' }),
    ]);
    line.onclick = () => {
      selected = node.scope;
      draw();
    };
    // Drag a preset of yours (or a shared file) by its key; drop on another key.
    if (node.own) dragSource(line, { from: node.own.file ? null : node.scope, key: node.own.key });
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
    line.ondblclick = () => toggle.onclick(new Event('click'));
    const li = el('li', { role: 'treeitem' }, [line]);
    if (open && node.children.length) li.append(el('ul', {}, node.children.map(row)));
    return li;
  }

  function path(node, scope, trail = []) {
    const here = [...trail, node.label];
    if (node.scope === scope) return here;
    for (const c of node.children) {
      const hit = path(c, scope, here);
      if (hit) return hit;
    }
    return null;
  }

  function select(placeholder, options, onpick) {
    const box = el('select', {}, [el('option', { value: '', textContent: placeholder }), ...options.map((o) => el('option', { value: o.value, textContent: o.label }))]);
    box.onchange = () => box.value && onpick(box.value);
    return box;
  }

  function showDetails(map, presets) {
    const node = find(map.root, selected) ?? map.root;
    const parts = [el('h3', { textContent: path(map.root, node.scope).join(' › ') })];
    if (node.pseudo) {
      parts.push(el('p', { className: 'hint', textContent: 'Models whose game is not known yet. Drive one once and it moves under its game and brand, where it can take brand and game presets.' }));
      details.replaceChildren(...parts);
      return;
    }
    const pick = (key) => el('button', { textContent: 'Pick in the list', onclick: () => actions.selectPreset(`truck:${key}`) });
    if (node.own) {
      parts.push(el('p', {}, [
        node.own.file ? 'Shared file: ' : 'Set here: ',
        el('b', { textContent: node.own.name }),
      ]), el('div', { className: 'inline buttons' }, [pick(node.own.key)]));
    } else if (node.inherited) {
      parts.push(el('p', {}, ['Inherited from ', el('i', { textContent: node.inherited.from }), ': ', node.inherited.name]),
        el('div', { className: 'inline buttons' }, [pick(node.inherited.key)]));
    }
    const actionsRow = el('div', { className: 'reg-actions' });
    actionsRow.append(el('label', {}, ['Set preset ', select('choose…', presets.filter((p) => p.key !== node.own?.key).map((p) => ({ value: p.key, label: p.label })), (key) => actions.assignInMap(node.scope, key))]));
    if (node.moveTo.length) actionsRow.append(el('label', {}, ['Move this preset ', select('to…', node.moveTo, (to) => actions.moveInMap(node.scope, to))]));
    if (node.own && !node.own.file && node.scope !== 'all') {
      actionsRow.append(el('button', { textContent: 'Unassign', title: 'Free this key; the preset stays in the list', onclick: () => actions.unassignScope(node.scope) }));
    }
    parts.push(actionsRow);
    if (map.unassigned.length || map.files.length) {
      parts.push(el('h3', { textContent: 'Not on any key' }));
      for (const p of [...map.unassigned, ...map.files]) {
        const item = el('div', { className: 'reg-loose', title: 'Drag onto a key to set it there' }, [pick(p.key), ` ${p.name}`]);
        dragSource(item, { from: null, key: p.key });
        parts.push(item);
      }
    }
    details.replaceChildren(...parts);
  }

  function draw() {
    if (!last) return;
    tree.replaceChildren(row(last.map.root));
    showDetails(last.map, last.presets);
  }

  return {
    get open() {
      return !root.hidden;
    },
    show(open) {
      root.hidden = !open;
      if (open) close.focus();
    },
    // presets: [{ key, label }] that can be set on a key (yours and the shared files).
    update(map, presets) {
      if (!seeded) {
        seed(map.root);
        seeded = true;
      }
      if (!selected || !find(map.root, selected)) {
        const playing = (function first(n) { return n.plays ? n : n.children.map(first).find(Boolean); })(map.root);
        selected = playing?.scope ?? 'all';
      }
      last = { map, presets };
      draw();
    },
  };
}
