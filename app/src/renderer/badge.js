// A preset's label as a badge: in the key tree, under Unused presets and in the export window.
// A label longer than LABEL_FIT characters runs like a ticker in a badge about 11 letters wide
// (style.css .marquee): the text twice in a row, moved left by one copy, over and over.
export const LABEL_FIT = 16;

export function labelBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = className;
  if (text.length <= LABEL_FIT) {
    badge.textContent = text;
    return badge;
  }
  badge.classList.add('marquee');
  badge.title = text;
  const track = document.createElement('span');
  track.className = 'marquee-track';
  // About three characters a second, whatever the length.
  track.style.setProperty('--marquee-time', `${((text.length + 3) / 3).toFixed(1)}s`);
  for (const hidden of [false, true]) {
    const copy = document.createElement('span');
    copy.textContent = text;
    if (hidden) copy.setAttribute('aria-hidden', 'true');
    track.append(copy);
  }
  badge.append(track);
  return badge;
}
