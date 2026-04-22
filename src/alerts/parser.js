function normalizeSymbol(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function parseNumber(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^\$/, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isHelpWord(s) {
  return s === "help" || s === "?" || s === "h";
}

/**
 * Parse a DM message into an intent.
 *
 * Supported:
 * - `help`
 * - `list`
 * - `cancel <id>`
 * - `AAPL 250` (defaults op)
 * - `TSLA >= 400` (explicit op)
 */
export function parseDmIntent(text, { defaultOp = ">=" } = {}) {
  let raw = String(text || "").trim();
  // In guild channels, users often type `@Bot help`. Strip a leading mention token.
  raw = raw.replace(/^<@!?\d+>\s*/u, "").trim();
  if (!raw) return { type: "ignore" };

  const lower = raw.toLowerCase();
  if (isHelpWord(lower)) return { type: "help" };
  if (lower === "list" || lower === "ls") return { type: "list" };

  if (lower.startsWith("cancel")) {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { type: "error", message: "Usage: cancel <id>" };
    return { type: "cancel", alertId: parts[1] };
  }

  // Create alert forms:
  // 1) SYMBOL PRICE
  // 2) SYMBOL OP PRICE
  // tolerate extra spaces: "TSLA   >=   400"
  const m = raw.match(/^([A-Za-z.]{1,15})\s*(>=|<=|>|<|=)?\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (!m) {
    return {
      type: "error",
      message: 'Unrecognized command. Send `help` for usage, or e.g. `AAPL 250`, `TSLA >= 400`, `NVDA <= 180`.',
    };
  }

  const symbol = normalizeSymbol(m[1]);
  const op = (m[2] || defaultOp || ">=").trim();
  const targetPrice = parseNumber(m[3]);

  if (!symbol) return { type: "error", message: "Symbol is required." };
  if (!["<", "<=", ">", ">=", "="].includes(op)) return { type: "error", message: `Unsupported operator: ${op}` };
  if (targetPrice == null) return { type: "error", message: "Price must be a number." };

  return { type: "create", symbol, op, targetPrice };
}

export function helpText() {
  return [
    "**DM Alerts — Usage**",
    "",
    "Create an alert:",
    "- `AAPL 250` (defaults to `>=`)",
    "- `TSLA >= 400`",
    "- `NVDA <= 180`",
    "- Operators: `>=`, `<=`, `>`, `<`, `=`",
    "",
    "Manage alerts:",
    "- `list`",
    "- `cancel <id>`",
    "- `help`",
  ].join("\n");
}

