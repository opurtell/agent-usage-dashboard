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
const CARD_BG = new Color("#16213e", 1);
const TEXT = new Color("#e0e0e0", 1);
const MUTED = new Color("#777", 1);
const BAR_BG = new Color("#2a2a3e", 1);
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
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function addBar(stack, pct, color, height) {
  const barOuter = stack.addStack();
  barOuter.layoutHorizontally();
  barOuter.cornerRadius = 3;
  barOuter.size = new Size(0, height);
  barOuter.backgroundColor = BAR_BG;

  const fill = barOuter.addStack();
  fill.backgroundColor = color;
  fill.cornerRadius = 3;
  const fillPct = Math.min(pct, 100);
  // Use layoutConstraints doesn't exist, so we use a spacer trick
  barOuter.setPadding(0, 0, 0, 0);
  fill.setPadding(0, 0, 0, 0);

  // We need to use addSpacer for relative sizing
  // Scriptable doesn't support % width directly, so we draw manually
  return { barOuter, fill };
}

// ── Build widget ──
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(10, 14, 10, 14);

// Use the full height with a vertical stack
const mainStack = widget.addStack();
mainStack.layoutVertically();
mainStack.size = new Size(0, 0);

// Title row
const titleRow = mainStack.addStack();
titleRow.layoutHorizontally();
titleRow.centerAlignContent();
const title = titleRow.addText("🤖 AI Usage");
title.font = Font.boldSystemFont(14);
title.textColor = TEXT;
titleRow.addSpacer();
if (data.age_seconds != null) {
  const age = titleRow.addText(`${data.age_seconds}s ago`);
  age.font = Font.systemFont(9);
  age.textColor = MUTED;
}

mainStack.addSpacer(8);

// ── Provider cards ──
for (const prov of PROVIDERS) {
  const p = providers[prov.id];

  const card = mainStack.addStack();
  card.layoutVertically();
  card.backgroundColor = CARD_BG;
  card.cornerRadius = 8;
  card.setPadding(8, 10, 8, 10);

  // Provider header
  const header = card.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();

  const dot = header.addText("● ");
  dot.font = Font.systemFont(12);
  dot.textColor = prov.color;
  const name = header.addText(prov.label);
  name.font = Font.boldSystemFont(12);
  name.textColor = TEXT;

  if (!p) {
    header.addSpacer();
    const na = header.addText("Not configured");
    na.font = Font.systemFont(10);
    na.textColor = MUTED;
    mainStack.addSpacer(6);
    continue;
  }

  const periods = (p.periods || []).filter(pp => pp.utilization != null);
  const sess = pickPeriod(periods, "session");
  let weekly = pickPeriod(periods, "weekly");
  if (!weekly && prov.id === "zai") {
    weekly = periods.find(pp => (pp.name || "").toLowerCase() === "quota");
  }

  header.addSpacer();

  // Session % on right of header
  if (sess) {
    const sLabel = header.addText("Ses ");
    sLabel.font = Font.systemFont(9);
    sLabel.textColor = MUTED;
    const sVal = header.addText(`${sess.utilization}%`);
    sVal.font = Font.boldSystemFont(12);
    sVal.textColor = pctColor(sess.utilization);
    const rt = resetTimeLeft(sess.resets_at);
    if (rt) {
      const st = header.addText(` ${rt}`);
      st.font = Font.systemFont(8);
      st.textColor = MUTED;
    }
  }

  card.addSpacer(4);

  // Session bar
  if (sess) {
    addBar(card, sess.utilization, prov.color, 5);
  }

  card.addSpacer(6);

  // Weekly row
  if (weekly) {
    const wRow = card.addStack();
    wRow.layoutHorizontally();
    wRow.centerAlignContent();

    const wLabel = wRow.addText("Weekly ");
    wLabel.font = Font.systemFont(9);
    wLabel.textColor = MUTED;
    const wVal = wRow.addText(`${weekly.utilization}%`);
    wVal.font = Font.boldSystemFont(11);
    wVal.textColor = pctColor(weekly.utilization);
    wRow.addSpacer();
    const rt = resetTimeLeft(weekly.resets_at);
    if (rt) {
      const wt = wRow.addText(`resets ${rt}`);
      wt.font = Font.systemFont(8);
      wt.textColor = MUTED;
    }

    card.addSpacer(3);
    addBar(card, weekly.utilization, prov.color, 5);
  }

  mainStack.addSpacer(6);
}

Script.setWidget(widget);
Script.complete();
