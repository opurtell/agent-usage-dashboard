// AI Usage Widget — Scriptable (iOS)
// Compact medium widget (4×2) showing session + weekly usage per provider
//
// Install: https://apps.apple.com/app/scriptable/id1405459188
// 1. Open Scriptable, create new script, paste this
// 2. Add a Scriptable medium widget to home screen, pick this script
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
const BG = "#1a1a2e";
const CARD_BG = "#16213e";
const TEXT_COL = "#e0e0e0";
const MUTED_COL = "#777";
const BAR_BG_COL = "#2a2a3e";
const CLAUDE_COL = "#d97757";
const OPENAI_COL = "#10a37f";
const ZAI_COL = "#7c5cfc";
const DANGER_COL = "#ef4444";
const WARN_COL = "#f59e0b";

const PROVIDERS = [
  { id: "claude", label: "Claude", color: CLAUDE_COL },
  { id: "zai",    label: "Z.ai",   color: ZAI_COL },
  { id: "codex",  label: "Codex",  color: OPENAI_COL },
];

// ── Fetch ──
let data;
try {
  const req = new Request(`${API_BASE}/api/usage?key=${encodeURIComponent(API_KEY)}`);
  req.timeoutInterval = 15;
  data = await req.loadJSON();
} catch (e) {
  showErr("Fetch error");
}
if (!data?.ok) showErr(data?.error || "Error");

function showErr(msg) {
  const w = new ListWidget();
  w.backgroundColor = new Color(BG, 1);
  const t = w.addText(msg);
  t.textColor = new Color(DANGER_COL, 1);
  Script.setWidget(w);
  Script.complete();
  throw new Error(msg);
}

const providers = (data && data.data && data.data.providers) || {};

// ── Helpers ──
function pickPeriod(periods, type) {
  return periods.find(p => p.period_type === type)
    || periods.find(p => (p.name || "").toLowerCase().includes(type))
    || null;
}

function pctColorHex(pct) {
  if (pct >= 90) return DANGER_COL;
  if (pct >= 70) return WARN_COL;
  return TEXT_COL;
}

function resetShort(resetsAt) {
  if (!resetsAt) return "";
  const diff = new Date(resetsAt) - Date.now();
  if (diff <= 0) return "";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h/24)}d`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// Draw a progress bar image
function makeBarImg(width, height, pct, colorHex) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.setFillColor(new Color(BAR_BG_COL, 1));
  const bgRect = new Rect(0, 0, width, height);
  dc.fillRoundedRect(bgRect, 2);
  dc.setFillColor(new Color(colorHex, 1));
  const fillW = Math.max((pct / 100) * width, 0);
  const fillRect = new Rect(0, 0, fillW, height);
  dc.fillRoundedRect(fillRect, 2);
  return dc.getImage();
}

// ── Build widget ──
const widget = new ListWidget();
widget.backgroundColor = new Color(BG, 1);
widget.setPadding(10, 12, 10, 12);

// Use medium widget dimensions
const W = 364;
const BAR_H = 5;
const BAR_W = W - 24; // minus padding

// Title
const titleRow = widget.addStack();
titleRow.layoutHorizontally();
titleRow.centerAlignContent();
const title = titleRow.addText("🤖 AI Usage");
title.font = Font.boldSystemFont(13);
title.textColor = new Color(TEXT_COL, 1);
titleRow.addSpacer();
if (data.age_seconds != null) {
  const age = titleRow.addText(`${data.age_seconds}s`);
  age.font = Font.systemFont(9);
  age.textColor = new Color(MUTED_COL, 1);
}

widget.addSpacer(6);

// ── Provider rows ──
for (let i = 0; i < PROVIDERS.length; i++) {
  const prov = PROVIDERS[i];
  const p = providers[prov.id];

  // Header line
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  // Dot + Name
  const dot = row.addText("● ");
  dot.font = Font.systemFont(11);
  dot.textColor = new Color(prov.color, 1);
  const name = row.addText(prov.label);
  name.font = Font.boldSystemFont(11);
  name.textColor = new Color(TEXT_COL, 1);
  name.textOpacity = p ? 1 : 0.4;

  if (!p) {
    row.addSpacer();
    const na = row.addText("—");
    na.font = Font.systemFont(9);
    na.textColor = new Color(MUTED_COL, 1);
    if (i < PROVIDERS.length - 1) widget.addSpacer(8);
    continue;
  }

  const periods = (p.periods || []).filter(pp => pp.utilization != null);
  const sess = pickPeriod(periods, "session");
  let weekly = pickPeriod(periods, "weekly");
  if (!weekly && prov.id === "zai") {
    weekly = periods.find(pp => (pp.name || "").toLowerCase() === "quota");
  }

  row.addSpacer(8);

  // Session
  if (sess) {
    const sLab = row.addText("Ses");
    sLab.font = Font.systemFont(8);
    sLab.textColor = new Color(MUTED_COL, 1);
    const sVal = row.addText(` ${sess.utilization}%`);
    sVal.font = Font.boldSystemFont(10);
    sVal.textColor = new Color(pctColorHex(sess.utilization), 1);
    const rs = resetShort(sess.resets_at);
    if (rs) {
      const rt = row.addText(` ${rs}`);
      rt.font = Font.systemFont(8);
      rt.textColor = new Color(MUTED_COL, 1);
    }
  }

  // Spacer between session & weekly
  row.addSpacer(8);

  // Weekly
  if (weekly) {
    const wLab = row.addText("Wk");
    wLab.font = Font.systemFont(8);
    wLab.textColor = new Color(MUTED_COL, 1);
    const wVal = row.addText(` ${weekly.utilization}%`);
    wVal.font = Font.boldSystemFont(10);
    wVal.textColor = new Color(pctColorHex(weekly.utilization), 1);
    const rs = resetShort(weekly.resets_at);
    if (rs) {
      const rt = row.addText(` ${rs}`);
      rt.font = Font.systemFont(8);
      rt.textColor = new Color(MUTED_COL, 1);
    }
  }

  // Progress bars
  const bars = widget.addStack();
  bars.layoutHorizontally();
  bars.spacing = 4;

  if (sess) {
    const barW = weekly ? Math.floor(BAR_W / 2) - 2 : BAR_W;
    const sessImg = bars.addImage(makeBarImg(barW, BAR_H, sess.utilization, prov.color));
    sessImg.imageSize = new Size(barW, BAR_H);
  }
  if (weekly) {
    const barW = sess ? Math.floor(BAR_W / 2) - 2 : BAR_W;
    const weekImg = bars.addImage(makeBarImg(barW, BAR_H, weekly.utilization, prov.color));
    weekImg.imageSize = new Size(barW, BAR_H);
  }

  if (i < PROVIDERS.length - 1) widget.addSpacer(6);
}

Script.setWidget(widget);
Script.complete();
