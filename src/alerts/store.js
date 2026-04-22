import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function safeNumber(n) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v;
}

function shortId() {
  // Small, user-friendly id. Collision risk is extremely low for typical alert volumes.
  return crypto.randomBytes(4).toString("hex"); // 8 chars
}

async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function atomicWriteJson(filePath, data) {
  await ensureDirForFile(filePath);
  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, json, "utf8");
  await fs.rename(tmpPath, filePath);
}

export class JsonFileAlertStore {
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;

    /** @type {Map<string, any>} */
    this.alertsById = new Map();

    // Serialize writes to avoid interleaving/corruption.
    this._writeChain = Promise.resolve();
  }

  async init() {
    await this._loadFromDisk();
  }

  async _loadFromDisk() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const alerts = Array.isArray(parsed?.alerts) ? parsed.alerts : [];
      this.alertsById.clear();
      for (const a of alerts) {
        if (!a?.id) continue;
        this.alertsById.set(a.id, a);
      }
      this.logger?.info?.("AlertStore loaded", { filePath: this.filePath, alerts: this.alertsById.size });
    } catch (err) {
      if (err && (err.code === "ENOENT" || String(err).includes("ENOENT"))) {
        this.logger?.info?.("AlertStore file missing; starting fresh", { filePath: this.filePath });
        this.alertsById.clear();
        return;
      }
      this.logger?.error?.("Failed to load alerts; starting fresh", { err: String(err), filePath: this.filePath });
      this.alertsById.clear();
    }
  }

  _snapshot() {
    return {
      version: 1,
      updatedAt: nowIso(),
      alerts: Array.from(this.alertsById.values()),
    };
  }

  async _persist() {
    this._writeChain = this._writeChain
      .then(() => atomicWriteJson(this.filePath, this._snapshot()))
      .catch((err) => {
        this.logger?.error?.("AlertStore persist failed", { err: String(err), filePath: this.filePath });
      });
    await this._writeChain;
  }

  async createAlert(userId, symbol, op, targetPrice) {
    const sym = normalizeSymbol(symbol);
    const price = safeNumber(targetPrice);
    if (!sym) throw new Error("Symbol is required");
    if (!price && price !== 0) throw new Error("Target price must be a number");
    if (!["<", "<=", ">", ">=", "="].includes(op)) throw new Error(`Invalid operator: ${op}`);

    const alert = {
      id: shortId(),
      userId: String(userId),
      symbol: sym,
      op,
      targetPrice: price,
      status: "active",
      createdAt: nowIso(),
      triggeredAt: null,
      triggerPrice: null,
      cancelledAt: null,
    };

    this.alertsById.set(alert.id, alert);
    await this._persist();
    return alert;
  }

  listAlerts(userId) {
    const uid = String(userId);
    const out = [];
    for (const a of this.alertsById.values()) {
      if (a.userId !== uid) continue;
      out.push(a);
    }
    out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return out;
  }

  async cancelAlert(userId, alertId) {
    const uid = String(userId);
    const a = this.alertsById.get(String(alertId));
    if (!a) return { ok: false, reason: "not_found" };
    if (a.userId !== uid) return { ok: false, reason: "forbidden" };
    if (a.status !== "active") return { ok: false, reason: "not_active" };

    a.status = "cancelled";
    a.cancelledAt = nowIso();
    this.alertsById.set(a.id, a);
    await this._persist();
    return { ok: true, alert: a };
  }

  getAllActiveAlerts() {
    const out = [];
    for (const a of this.alertsById.values()) {
      if (a.status === "active") out.push(a);
    }
    return out;
  }

  async markTriggered(alertId, triggeredAt, triggerPrice) {
    const a = this.alertsById.get(String(alertId));
    if (!a) return { ok: false, reason: "not_found" };
    if (a.status !== "active") return { ok: false, reason: "not_active" };

    const price = safeNumber(triggerPrice);
    a.status = "triggered";
    a.triggeredAt = triggeredAt || nowIso();
    a.triggerPrice = price ?? null;
    this.alertsById.set(a.id, a);
    await this._persist();
    return { ok: true, alert: a };
  }
}

