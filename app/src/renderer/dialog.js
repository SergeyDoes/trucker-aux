// A modal dialog with a message, optional checkboxes and buttons. Resolves to
// { button, checked } (the button's value, the boxes' values that are ticked), or null on
// Esc. confirm() has two buttons only; moving a preset down asks Move / Copy / Cancel.
export function ask({ title, lines = [], checks = [], buttons }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ask';
  const heading = document.createElement('h3');
  heading.textContent = title;
  dialog.append(heading);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    dialog.append(p);
  }
  const boxes = checks.map(({ value, label, checked = true }) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.value = value;
    const row = document.createElement('label');
    row.append(box, ` ${label}`);
    dialog.append(row);
    return box;
  });
  const bar = document.createElement('div');
  bar.className = 'ask-buttons';
  dialog.append(bar);
  document.body.append(dialog);
  return new Promise((resolve) => {
    const done = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    for (const { value, label, primary } of buttons) {
      const button = document.createElement('button');
      button.textContent = label;
      if (primary) button.className = 'primary';
      button.onclick = () => done(value === null ? null : { button: value, checked: boxes.filter((b) => b.checked).map((b) => b.value) });
      bar.append(button);
    }
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      done(null);
    });
    dialog.showModal();
    bar.querySelector('.primary')?.focus();
  });
}
