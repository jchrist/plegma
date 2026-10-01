// Pure multi-selection helpers for the commit list (CJS for node:test,
// imported by App.jsx through the esbuild bundle).

function toggleCheck(checked, hash) {
  return checked.includes(hash) ? checked.filter((h) => h !== hash) : [...checked, hash];
}

// Shift-click: union the existing selection with the anchor..target range
// in display order. Unknown anchor falls back to a toggle.
function rangeSelect(checked, order, anchor, target) {
  const a = order.indexOf(anchor);
  const b = order.indexOf(target);
  if (a === -1 || b === -1) {
    return toggleCheck(checked, target);
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const result = [...checked];
  for (const h of order.slice(lo, hi + 1)) {
    if (!result.includes(h)) {
      result.push(h);
    }
  }
  return result;
}

module.exports = { toggleCheck, rangeSelect };
