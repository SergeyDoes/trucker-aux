// Versions as GitHub's releases tag them ("v0.3.0") and the app knows its own ("0.3.0").

// [major, minor, patch] of a tag or a version, or null when it is no such thing.
export function versionParts(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? '').trim());
  return match ? match.slice(1).map(Number) : null;
}

// Whether `latest` (a release's tag) is newer than `current` (the app's version).
export function isNewer(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
