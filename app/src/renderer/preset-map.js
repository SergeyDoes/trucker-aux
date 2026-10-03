// The preset map (presets.js presetTree): every scope with what it plays, as a tree over the
// views. A preset's name picks it in the list; Unassign frees that scope (the preset stays).
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export function createPresetMap(actions) {
  const tree = el('ul', { className: 'map-tree' });
  const extra = el('div');
  const close = el('button', { textContent: 'Close', title: 'Esc' });
  const root = el('section', { className: 'preset-map', hidden: true }, [
    el('header', {}, [
      el('h2', { textContent: 'Preset map' }),
      el('p', {
        className: 'hint',
        textContent: 'What plays where. ● the vehicle in the game, ▶ what plays now; names in brackets are inherited from above. Click a preset to pick it in the list.',
      }),
      close,
    ]),
    tree,
    extra,
  ]);
  document.body.append(root);
  close.onclick = () => actions.toggleMap(false);

  const presetButton = (own) => {
    const button = el('button', { className: `map-preset${own.file ? ' file' : ''}`, textContent: own.name, title: own.file ? 'A file in the collection' : 'Pick it in the list' });
    button.onclick = () => actions.selectPreset(`truck:${own.key}`);
    return button;
  };

  function item(node) {
    const row = el('div', { className: `map-row${node.current ? ' current' : ''}${node.plays ? ' plays' : ''}` }, [
      el('span', { className: 'map-mark', textContent: node.plays ? '▶' : node.current ? '●' : '' }),
      el('span', { className: 'map-label', textContent: node.label }),
    ]);
    if (node.own) {
      row.append(presetButton(node.own));
      if (!node.own.file && node.scope !== 'all') {
        const unassign = el('button', { className: 'map-unassign', textContent: 'Unassign', title: 'Free this scope; the preset stays in the list' });
        unassign.onclick = () => actions.unassignScope(node.scope);
        row.append(unassign);
      }
    } else if (node.inherited) row.append(el('span', { className: 'map-inherited', textContent: `(${node.inherited})` }));
    const li = el('li', {}, [row]);
    if (node.children.length) li.append(el('ul', {}, node.children.map(item)));
    return li;
  }

  function list(title, entries) {
    if (!entries.length) return [];
    return [el('h3', { textContent: title }), el('div', { className: 'map-list' }, entries.map((e) => presetButton(e)))];
  }

  return {
    get open() {
      return !root.hidden;
    },
    show(open) {
      root.hidden = !open;
      if (open) close.focus();
    },
    update(map) {
      tree.replaceChildren(item(map.root));
      extra.replaceChildren(
        ...list('Unassigned', map.unassigned),
        ...list('Collection, for no vehicle', map.files.map((f) => ({ ...f, file: true }))),
      );
    },
  };
}
