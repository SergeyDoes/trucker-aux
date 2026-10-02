// Multi-selection of speakers: { ids, primary }. ids follow the layout's order; primary is
// the speaker clicked last (the anchor of a shift+click range): it leads group drags and
// nudges, and the form shows its values where the selection differs.

export const EMPTY = { ids: [], primary: null };

const inOrder = (ids, order) => order.filter((id) => ids.includes(id));

// id null is a click on empty space. toggle: ctrl+click; range: shift+click in the list.
export function clickSelect(selection, id, { toggle = false, range = false } = {}, order = []) {
  if (id === null) return toggle ? selection : EMPTY;
  if (toggle) {
    if (!selection.ids.includes(id)) return { ids: inOrder([...selection.ids, id], order), primary: id };
    const ids = selection.ids.filter((x) => x !== id);
    if (!ids.length) return EMPTY;
    return { ids, primary: selection.primary === id ? ids[ids.length - 1] : selection.primary };
  }
  const anchor = order.indexOf(selection.primary);
  const target = order.indexOf(id);
  if (range && anchor !== -1 && target !== -1) {
    return { ids: order.slice(Math.min(anchor, target), Math.max(anchor, target) + 1), primary: selection.primary };
  }
  return { ids: [id], primary: id };
}

// Speakers inside a rubber band; add (ctrl) keeps the current selection.
export function boxSelect(selection, ids, add, order) {
  const all = inOrder(add ? [...selection.ids, ...ids] : ids, order);
  if (!all.length) return EMPTY;
  return { ids: all, primary: all.includes(selection.primary) ? selection.primary : all[0] };
}

export function selectAll(selection, order) {
  if (!order.length) return EMPTY;
  return { ids: [...order], primary: order.includes(selection.primary) ? selection.primary : order[0] };
}

// Drops speakers that are gone; returns the same object when nothing changed.
export function pruneSelection(selection, order) {
  const ids = inOrder(selection.ids, order);
  if (ids.length === selection.ids.length) return selection;
  if (!ids.length) return EMPTY;
  return { ids, primary: ids.includes(selection.primary) ? selection.primary : ids[ids.length - 1] };
}
