function money(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "?";
  return n.toFixed(2);
}

export function formatTrade(t) {
  // Alpaca trade shape (stocks): { T: 't', S: 'AAPL', p: 212.44, s: 100, t: '...' }
  const sym = t?.S ?? "?";
  const price = money(t?.p);
  const size = t?.s ?? "?";
  return `📈 Trade | ${sym} | $${price} | Size: ${size}`;
}

export function formatQuote(q) {
  // Alpaca quote shape (stocks): { T: 'q', S: 'TSLA', bp: 171.22, ap: 171.28, bs, as, t }
  const sym = q?.S ?? "?";
  const bid = money(q?.bp);
  const ask = money(q?.ap);
  return `💬 Quote | ${sym} | Bid: $${bid} | Ask: $${ask}`;
}

export function formatBar(b) {
  // Alpaca bar shape (stocks): { T: 'b', S: 'NVDA', o, h, l, c, v, t }
  const sym = b?.S ?? "?";
  const o = money(b?.o);
  const h = money(b?.h);
  const l = money(b?.l);
  const c = money(b?.c);
  return `🕯️ Bar | ${sym} | O: ${o} H: ${h} L: ${l} C: ${c}`;
}

