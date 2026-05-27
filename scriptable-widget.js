// AI Usage Widget — Scriptable (iOS)
// 2×4 landscape widget showing session + weekly usage per provider
//
// Install: https://apps.apple.com/app/scriptable/id1405459188
// 1. Open Scriptable, create new script, paste this
// 2. Add a Scriptable widget (2×4) to home screen, pick this script
// 3. Set widget parameter to your API key

const API_BASE = "https://a1-instance.tail61c8f0.ts.net";
const API_KEY = args.widgetParameter || "";

if (!API_KEY) {
  const w = new ListWidget();
  w.addText("Set widget param to API key");
  Script.setWidget(w);
  Script.complete();
}

// ── Colours ──
const BG = new Color("#1a1a2e", 1);
const TEXT = new Color("#e0e0e0", 1);
const MUTED = new Color("#666", 1);
const BAR_BG = new Color("#333", 1);
const CLAUDE = new Color("#d97757", 1);
const OPENAI = new Color("#10a37f", 1);
const ZAI = new Color("#7c5cfc", 1);

const PROVIDERS = [
  { id: "claude", label: "Claude", color: CLAUDE },
  { id: "zai",    label: "Z.ai",   color: ZAI },
  { id: "codex",  label: "Codex",  color: OPENAI },
];

// ── Fetch ──
let data;
try {
  const req = new Request(`${API_BASE}/api/usage?key=${encodeURIComponent(API_KEY)}`);
  req.timeoutInterval = 15;
  data = await req.loadJSON();
} catch (e) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.addText("Fetch error").textColor = new Color("#ef4444", 1);
  Script.setWidget(w);
  Script.complete();
}

if (!data?.ok) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.addText(data?.error || "Error").textColor = new Color("#ef4444", 1);
  Script.setWidget(w);
  Script.complete();
}

const providers = data.data?.providers || {};

// ── Helpers ──
function pickPeriod(periods, type) {
  // Match by period_type first, fall back to name contains
  return periods.find(p => p.period_type === type)
    || periods.find(p => (p.name || "").toLowerCase().includes(type))
    || null;
}

function pctColor(pct) {
  if (pct >= 90) return new Color("#ef4444", 1);
  if (pct >= 70) return new Color("#f59e0b", 1);
  return TEXT;
}

function resetTimeLeft(resetsAt) {
  if (!resetsAt) return "";
  const diff = new Date(resetsAt) - Date.now();
  if (diff <= 0) return "";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Build widget ──
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(8, 10, 8, 10);

// Title
const titleRow = widget.addStack();
titleRow.layoutHorizontally();
titleRow.centerAlignContent();
const title = titleRow.addText("🤖 AI Usage");
title.font = Font.boldSystemFont(12);
title.textColor = TEXT;

// ── Provider rows ──
for (const prov of PROVIDERS) {
  const p = providers[prov.id];
  widget.addSpacer(5);

  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  // Dot + name
  const dot = row.addText("● ");
  dot.font = Font.systemFont(10);
  dot.textColor = prov.color;
  const name = row.addText(prov.label);
  name.font = Font.boldSystemFont(10);
  name.textColor = TEXT;
  row.addSpacer(6);

  if (!p) {
    const na = row.addText("—");
    na.font = Font.systemFont(9);
    na.textColor = MUTED;
    continue;
  }

  const periods = (p.periods || []).filter(pp => pp.utilization != null);

  // Session
  const sess = pickPeriod(periods, "session");
  if (sess) {
    const s = row.addText(`${sess.utilization}%`);
    s.font = Font.boldSystemFont(9);
    s.textColor = pctColor(sess.utilization);
    const rt = resetTimeLeft(sess.resets_at);
    if (rt) {
      const st = row.addText(` ${rt}`);
      st.font = Font.systemFont(8);
      st.textColor = MUTED;
    }
  }

  // Separator
  row.addSpacer(6);
  const sep = row.addText("│");
  sep.font = Font.systemFont(8);
  sep.textColor = MUTED;
  row.addSpacer(6);

  // Weekly/Quota
  let weekly = pickPeriod(periods, "weekly");
  if (!weekly && prov.id === "zai") {
    weekly = periods.find(pp => (pp.name || "").toLowerCase() === "quota");
  }
  if (weekly) {
    const wLabel = row.addText("W:");
    wLabel.font = Font.systemFont(8);
    wLabel.textColor = MUTED;
    row.addSpacer(2);
    const w = row.addText(`${weekly.utilization}%`);
    w.font = Font.boldSystemFont(9);
    w.textColor = pctColor(weekly.utilization);
    const rt = resetTimeLeft(weekly.resets_at);
    if (rt) {
      const wt = row.addText(` ${rt}`);
      wt.font = Font.systemFont(8);
      wt.textColor = MUTED;
    }
  }
}

Script.setWidget(widget);
Script.complete();
