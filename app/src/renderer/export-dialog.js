// The export window, as a package export in Unity: the key tree with a box at every key that
// has a preset (yours or a shared file), the unused presets and files below. A folder's box
// ticks everything under it; a box is half-ticked when only some of it is. Resolves to the
// ticked [{ scope, key }] (scope null: on no key), or null when cancelled.
// map: presetTree(...); checked: the ids ticked at first (a key's scope, or "~" + preset key);
// check(picks): exportFiles(...) for what is ticked, for the notes under the tree.
import { labelBadge } from './badge.js';

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const FOLDER = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" fill="#e8b84a" stroke="#b8862a" stroke-width="1"/></svg>';

// The ids of the presets in the map: { id: { scope, key } }, in the tree's order.
export function exportItems(map) {
  const items = new Map();
  (function walk(node) {
    if (node.own) items.set(node.scope, { scope: node.scope, key: node.own.key });
    node.children.forEach(walk);
  })(map.root);
  for (const p of [...map.unassigned, ...map.files]) items.set(`~${p.key}`, { scope: null, key: p.key });
  return items;
}

// The ids under a node (itself included).
export function branchIds(node, keep = () => true) {
  return [...(node.own && keep(node) ? [node.scope] : []), ...node.children.flatMap((c) => branchIds(c, keep))];
}

export function chooseExport({ map, checked, check }) {
  const items = exportItems(map);
  const ticked = new Set(checked.filter((id) => items.has(id)));
  const collapsed = new Set();
  const tree = el('ul', { className: 'reg-tree' });
  const loose = el('div');
  const notes = el('div', { className: 'export-notes' });
  const exportButton = el('button', { className: 'primary', textContent: 'Export…' });
  const dialog = el('dialog', { className: 'ask export' }, [
    el('h3', { textContent: 'Export presets' }),
    el('p', {
      className: 'hint',
      textContent: 'Tick what to share. Each preset becomes a file for its key; a vehicle\'s own (by plate) goes for its chassis, so the plate stays private.',
    }),
    el('div', { className: 'export-tree' }, [tree, loose]),
    notes,
    el('div', { className: 'ask-buttons' }, [
      el('button', { textContent: 'All', onclick: () => { items.forEach((_, id) => ticked.add(id)); draw(); } }),
      el('button', { textContent: 'None', onclick: () => { ticked.clear(); draw(); } }),
      el('span', { className: 'spacer' }),
      el('button', { textContent: 'Cancel', onclick: () => done(null) }),
      exportButton,
    ]),
  ]);
  document.body.append(dialog);

  // A box for a set of ids: ticks them all, or clears them when all are ticked.
  const box = (ids) => {
    const all = ids.every((id) => ticked.has(id));
    const input = el('input', { type: 'checkbox', checked: all, indeterminate: !all && ids.some((id) => ticked.has(id)) });
    input.onchange = () => {
      for (const id of ids) {
        if (all) ticked.delete(id);
        else ticked.add(id);
      }
      draw();
    };
    return input;
  };
  const badge = (own) => {
    const text = own.label || (own.default ? 'default' : own.file ? 'shared file' : 'preset');
    return labelBadge(text, `reg-badge${own.label ? ` tag-${own.labelColor}` : own.default ? ' tag-gray' : ''}`);
  };

  function row(node) {
    const ids = branchIds(node);
    if (!ids.length) return null; // nothing to export under it
    const children = node.children.map(row).filter(Boolean);
    const open = !collapsed.has(node.scope);
    const toggle = el('span', { className: 'reg-toggle', textContent: children.length ? (open ? '▾' : '▸') : '' });
    toggle.onclick = () => {
      if (open) collapsed.add(node.scope);
      else collapsed.delete(node.scope);
      draw();
    };
    const line = el('div', { className: `reg-row${node.own ? ` ${node.own.default ? 'default' : node.own.file ? 'file' : 'own'}` : ''}`, title: node.own?.name ?? '' }, [
      toggle,
      el('label', { className: 'export-pick' }, [
        box(ids),
        el('span', { className: 'reg-icon', innerHTML: FOLDER }),
        el('span', { className: 'reg-name', textContent: node.label }),
        ...(node.own ? [badge(node.own)] : []),
      ]),
    ]);
    return el('li', {}, [line, ...(open && children.length ? [el('ul', {}, children)] : [])]);
  }

  function draw() {
    tree.replaceChildren(...[row(map.root)].filter(Boolean));
    const unused = [...map.unassigned.map((p) => ({ ...p, file: false })), ...map.files.map((f) => ({ ...f, file: true }))];
    loose.replaceChildren(...(unused.length ? [
      el('h3', { textContent: 'Unused presets' }),
      ...unused.map((p) => el('label', { className: `reg-row export-pick${p.file ? ' file' : ''}`, title: p.file ? 'A shared file' : '' }, [
        box([`~${p.key}`]),
        el('span', { className: 'reg-name', textContent: p.name }),
        ...(p.label ? [labelBadge(p.label, `reg-badge tag-${p.labelColor ?? 'blue'}`)] : []),
      ])),
    ] : []));
    const picks = [...items].filter(([id]) => ticked.has(id)).map(([, item]) => item);
    const { clashes, plates } = check(picks);
    notes.replaceChildren(
      el('p', { textContent: picks.length ? `${picks.length} preset(s) ticked.` : 'Nothing ticked.' }),
      ...(plates ? [el('p', { className: 'hint', textContent: `${plates} vehicle preset(s) go for their chassis.` })] : []),
      ...clashes.map((label) => el('p', { className: 'warn', textContent: `More than one preset goes for ${label}: only one of them would play there.` })),
    );
    exportButton.disabled = !picks.length;
    return picks;
  }

  let resolve;
  const done = (result) => {
    dialog.close();
    dialog.remove();
    resolve(result);
  };
  exportButton.onclick = () => done(draw());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    done(null);
  });
  draw();
  dialog.showModal();
  return new Promise((r) => { resolve = r; });
}
