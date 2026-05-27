// AI Usage Widget — Scriptable (iOS)
// Compact medium widget (4×2) showing session + weekly usage per provider
//
// Install: https://apps.apple.com/app/scriptable/id1405459188
// 1. Open Scriptable, create new script, paste this
// 2. Add a Scriptable medium widget to home screen, pick this script
// 3. Set widget parameter to your API key (or leave blank to use default)

const API_BASE = "https://a1-instance.tail61c8f0.ts.net";
const DEFAULT_KEY = "47231abd3599f55975518ea17a6f96c6";
const API_KEY = args.widgetParameter || DEFAULT_KEY;

// ── Colours ──
const BG = "#1a1a2e";
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
let data = null;
try {
  const req = new Request(`${API_BASE}/api/usage?key=${encodeURIComponent(API_KEY)}`);
  req.timeoutInterval = 15;
  data = await req.loadJSON();
} catch (e) {
  showErr("Network error");
}

if (!data || !data.ok) {
  showErr((data && data.error) || "Unknown error");
}

function showErr(msg) {
  const w = new ListWidget();
  w.backgroundColor = new Color(BG, 1);
  const t = w.addText(msg);
  t.textColor = new Color(DANGER_COL, 1);
  Script.setWidget(w);
  Script.complete();
}

const providers = (data && data.data && data.data.providers) || {};

// ── Helpers ──
function pickPeriod(periods, type) {
  if (!periods || !periods.length) return null;
  return periods.find(function(p) { return p.period_type === type; })
    || periods.find(function(p) { return (p.name || "").toLowerCase().includes(type); })
    || null;
}

function pctColorHex(pct) {
  if (pct >= 90) return DANGER_COL;
  if (pct >= 70) return WARN_COL;
  return TEXT_COL;
}

function resetShort(resetsAt) {
  if (!resetsAt) return "";
  var diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "";
  var h = Math.floor(diff / 3600000);
  var m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return Math.floor(h / 24) + "d";
  if (h > 0) return h + "h";
  return m + "m";
}

// Draw a progress bar image
function makeBarImg(width, height, pct, colorHex) {
  var dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.setFillColor(new Color(BAR_BG_COL, 1));
  dc.fillRoundedRect(new Rect(0, 0, width, height), 2);
  dc.setFillColor(new Color(colorHex, 1));
  var fillW = Math.max((pct / 100) * width, 0);
  dc.fillRoundedRect(new Rect(0, 0, fillW, height), 2);
  return dc.getImage();
}

// ── Build widget ──
var widget = new ListWidget();
widget.backgroundColor = new Color(BG, 1);
widget.setPadding(10, 12, 10, 12);

var BAR_H = 5;
var BAR_W = 340; // medium widget width minus padding

// Title
var titleRow = widget.addStack();
titleRow.layoutHorizontally();
titleRow.centerAlignContent();
var title = titleRow.addText("🤖 AI Usage");
title.font = Font.boldSystemFont(13);
title.textColor = new Color(TEXT_COL, 1);
titleRow.addSpacer();
if (data.age_seconds != null) {
  var age = titleRow.addText(data.age_seconds + "s");
  age.font = Font.systemFont(9);
  age.textColor = new Color(MUTED_COL, 1);
}

widget.addSpacer(6);

// ── Provider rows ──
for (var i = 0; i < PROVIDERS.length; i++) {
  var prov = PROVIDERS[i];
  var p = providers[prov.id] || null;

  // Header line
  var row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  // Dot + Name
  var dot = row.addText("● ");
  dot.font = Font.systemFont(11);
  dot.textColor = new Color(prov.color, 1);
  var nameText = row.addText(prov.label);
  nameText.font = Font.boldSystemFont(11);
  nameText.textColor = new Color(TEXT_COL, 1);

  if (!p) {
    row.addSpacer();
    var na = row.addText("—");
    na.font = Font.systemFont(9);
    na.textColor = new Color(MUTED_COL, 1);
    if (i < PROVIDERS.length - 1) widget.addSpacer(6);
    continue;
  }

  var periods = (p.periods || []).filter(function(pp) { return pp.utilization != null; });
  var sess = pickPeriod(periods, "session");
  var weekly = pickPeriod(periods, "weekly");
  if (!weekly && prov.id === "zai") {
    weekly = periods.find(function(pp) { return (pp.name || "").toLowerCase() === "quota"; }) || null;
  }

  row.addSpacer(8);

  // Session
  if (sess) {
    var sLab = row.addText("Ses");
    sLab.font = Font.systemFont(8);
    sLab.textColor = new Color(MUTED_COL, 1);
    var sVal = row.addText(" " + sess.utilization + "%");
    sVal.font = Font.boldSystemFont(10);
    sVal.textColor = new Color(pctColorHex(sess.utilization), 1);
    var srs = resetShort(sess.resets_at);
    if (srs) {
      var srt = row.addText(" " + srs);
      srt.font = Font.systemFont(8);
      srt.textColor = new Color(MUTED_COL, 1);
    }
  }

  row.addSpacer(8);

  // Weekly
  if (weekly) {
    var wLab = row.addText("Wk");
    wLab.font = Font.systemFont(8);
    wLab.textColor = new Color(MUTED_COL, 1);
    var wVal = row.addText(" " + weekly.utilization + "%");
    wVal.font = Font.boldSystemFont(10);
    wVal.textColor = new Color(pctColorHex(weekly.utilization), 1);
    var wrs = resetShort(weekly.resets_at);
    if (wrs) {
      var wrt = row.addText(" " + wrs);
      wrt.font = Font.systemFont(8);
      wrt.textColor = new Color(MUTED_COL, 1);
    }
  }

  // Progress bars
  var bars = widget.addStack();
  bars.layoutHorizontally();
  bars.spacing = 4;

  if (sess) {
    var sessBarW = weekly ? Math.floor(BAR_W / 2) - 2 : BAR_W;
    var sessImg = bars.addImage(makeBarImg(sessBarW, BAR_H, sess.utilization, prov.color));
    sessImg.imageSize = new Size(sessBarW, BAR_H);
  }
  if (weekly) {
    var weekBarW = sess ? Math.floor(BAR_W / 2) - 2 : BAR_W;
    var weekImg = bars.addImage(makeBarImg(weekBarW, BAR_H, weekly.utilization, prov.color));
    weekImg.imageSize = new Size(weekBarW, BAR_H);
  }

  if (i < PROVIDERS.length - 1) widget.addSpacer(6);
}

Script.setWidget(widget);
Script.complete();
