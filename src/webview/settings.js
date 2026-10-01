// Settings persistence. Every plegma setting lives in localStorage (never
// in VS Code configuration): view state and dialog defaults are per-machine
// UI choices, and the webview reads them synchronously. Each key holds one
// JSON value; corrupt or missing storage falls back to the default.
export function loadStored(key, fallback, coerce) {
  try {
    if (typeof localStorage === "undefined") {
      return fallback;
    }
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return fallback;
    }
    const value = JSON.parse(raw);
    if (typeof coerce === "function") {
      return coerce(value, fallback);
    }
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function storeValue(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Persistence is best-effort.
  }
}

// Coercers for the common shapes.
export function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

export function asOneOf(options) {
  return (value, fallback) => (options.includes(value) ? value : fallback);
}
