// AI Usage Widget — Scriptable (iOS)
// Install: https://apps.apple.com/app/scriptable/id1405459188
// 1. Open Scriptable, create new script, paste this in
// 2. Add a Scriptable widget to your home screen, pick this script
// 3. Set the widget parameter to your API key

const API_BASE = "https://a1-instance.tail61c8f0.ts.net";
const API_KEY = args.widgetParameter || "";

if (!API_KEY) {
  const w = new ListWidget();
  w.addText("Set widget param to your API key");
  Script.setWidget(w);
  Script.complete();
}

// ── Colours ──
const BG = new Color("#1a1a2e", 1);
const CARD_BG = new Color("#16213e", 1);
const TEXT = new Color("#e0e0e0", 1);
const MUTED = new Color("#888888", 1);
const CLAUDE = new Color("#d97757", 1);
const OPENAI = new Color("#10a37f", 1);
const ZAI = new Color("#7c5cfc", 1);
const WARNING = new Color("#f59e0b", 1);
const DANGER = new Color("#ef4444", 1);
const SUCCESS = new Color("#22c55e", 1);

const PROVIDER_COLORS = { claude: CLAUDE, codex: OPENAI, zai: ZAI };
const PROVIDER_LABELS = { claude: "Claude", codex: "Codex/ChatGPT", zai: "Z.ai" };

// ── Fetch ──
let data;
try {
  const req = new Request(`${API_BASE}/api/usage?key=${encodeURIComponent(API_KEY)}`);
  req.timeoutInterval = 15;
  data = await req.loadJSON();
} catch (e) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.addText("Fetch error").textColor = DANGER;
  Script.setWidget(w);
  Script.complete();
}

if (!data || !data.ok) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.addText(data?.error || "Unknown error").textColor = DANGER;
  Script.setWidget(w);
  Script.complete();
}

const providers = data.data?.providers || {};

// ── Widget ──
const widget = new ListWidget();
widget.backgroundColor = BG;
widget.setPadding(10, 12, 10, 12);

// Title row
const titleRow = widget.addStack();
titleRow.layoutHorizontally();
titleRow.topAlignContent = true;
const title = titleRow.addText("🤖 AI Usage");
title.font = Font.boldSystemFont(14);
title.textColor = TEXT;
titleRow.addSpacer();
const ageLabel = data.age_seconds != null ? `${data.age_seconds}s ago` : "";
if (ageLabel) {
  const age = titleRow.addText(ageLabel);
  age.font = Font.systemFont(9);
  age.textColor = MUTED;
}

widget.addSpacer(6);

// ── Provider cards ──
for (const [id, label] of Object.entries(PROVIDER_LABELS)) {
  const p = providers[id];
  if (!p) continue;

  const card = widget.addStack();
  card.layoutVertically();
  card.backgroundColor = CARD_BG;
  card.cornerRadius = 8;
  card.setPadding(8, 10, 8, 10);

  // Provider name
  const nameRow = card.addStack();
  nameRow.layoutHorizontally();
  const dot = nameRow.addText("● ");
  dot.font = Font.systemFont(11);
  dot.textColor = PROVIDER_COLORS[id] || TEXT;
  const nameText = nameRow.addText(label);
  nameText.font = Font.boldSystemFont(11);
  nameText.textColor = TEXT;

  // Plan badge
  if (p.identity?.plan) {
    nameRow.addSpacer(4);
    const plan = nameRow.addText(p.identity.plan);
    plan.font = Font.systemFont(9);
    plan.textColor = MUTED;
  }

  card.addSpacer(4);

  // Periods
  const periods = (p.periods || []).filter(pp => pp.utilization != null);
  for (const period of periods) {
    const pct = period.utilization || 0;
    let displayName = period.name || period.period_type || "Usage";

    // Z.ai "Quota" is actually weekly
    if (id === "zai" && displayName.toLowerCase() === "quota") {
      displayName = "Weekly Quota";
    }

    const row = card.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    const pLabel = row.addText(displayName);
    pLabel.font = Font.systemFont(9);
    pLabel.textColor = MUTED;
    row.addSpacer();
    const pPct = row.addText(`${pct}%`);
    pPct.font = Font.boldSystemFont(10);
    pPct.textColor = pct >= 90 ? DANGER : pct >= 70 ? WARNING : TEXT;

    // Progress bar
    const bar = card.addStack();
    bar.layoutHorizontally();
    bar.cornerRadius = 2;
    bar.size = new Size(0, 4);
    // Background
    const barBg = bar.addStack();
    barBg.backgroundColor = new Color("#333", 1);
    barBg.cornerRadius = 2;
    barBg.size = new Size(0, 4);
    // We can't do real progress bars easily, so just show the text line

    // Reset time
    if (period.resets_at) {
      const resets = new Date(period.resets_at);
      const now = new Date();
      const diffMs = resets - now;
      if (diffMs > 0) {
        const diffH = Math.floor(diffMs / 3600000);
        const diffM = Math.floor((diffMs % 3600000) / 60000);
        let resetStr;
        if (diffH >= 24) {
          resetStr = `${Math.floor(diffH / 24)}d ${diffH % 24}h`;
        } else if (diffH > 0) {
          resetStr = `${diffH}h ${diffM}m`;
        } else {
          resetStr = `${diffM}m`;
        }
        const resetText = card.addText(`resets in ${resetStr}`);
        resetText.font = Font.systemFont(8);
        resetText.textColor = MUTED;
      }
    }

    card.addSpacer(3);
  }

  widget.addSpacer(6);
}

Script.setWidget(widget);
Script.complete();
