const LEVELS = ["debug", "info", "warn", "error"];

function nowIso() {
  return new Date().toISOString();
}

function levelEnabled(current, level) {
  const currentIdx = LEVELS.indexOf(current);
  const levelIdx = LEVELS.indexOf(level);
  if (currentIdx === -1 || levelIdx === -1) return true;
  return levelIdx >= currentIdx;
}

export function createLogger({ level = "info", name = "app" } = {}) {
  const base = { name };

  function logAt(lvl, msg, meta) {
    if (!levelEnabled(level, lvl)) return;
    const payload = {
      ts: nowIso(),
      level: lvl,
      ...base,
      msg,
      ...(meta && typeof meta === "object" ? meta : undefined),
    };
    const line = JSON.stringify(payload);
    // Keep logs structured for production (easy to ship to log drains).
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    debug: (msg, meta) => logAt("debug", msg, meta),
    info: (msg, meta) => logAt("info", msg, meta),
    warn: (msg, meta) => logAt("warn", msg, meta),
    error: (msg, meta) => logAt("error", msg, meta),
  };
}

