# AI Usage Dashboard

Live usage tracking for **Claude**, **Codex/ChatGPT**, and **Z.ai (GLM Coding Plan)** — powered by [vibeusage](https://github.com/joshuadavidthomas/vibeusage).

## Architecture

```
Browser (GH Pages) → VPS API (port 3199) → vibeusage --json → Provider APIs
```

- **Static HTML** hosted on GitHub Pages
- **Tiny API server** on the VPS runs `vibeusage --json` on demand
- **Refresh button** fetches live data instantly
- **45-second cache** prevents hammering provider APIs
- **GitHub Action** snapshots data twice daily as a fallback
- **Zero OpenClaw dependency** — completely self-sufficient

## Setup

### 1. Install vibeusage on the VPS

```bash
curl -fsSL https://raw.githubusercontent.com/joshuadavidthomas/vibeusage/main/install.sh | sh
```

### 2. Authenticate providers

```bash
# Claude — auto-detects Claude Code OAuth credentials
vibeusage auth claude

# Codex/ChatGPT — auto-detects Codex CLI credentials
vibeusage auth codex

# Z.ai — needs an API key from https://z.ai/manage-apikey/apikey-list
vibeusage auth zai
```

### 3. Start the API server

```bash
# Install as systemd user service
cp vibeusage-api.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now vibeusage-api

# Verify
curl http://127.0.0.1:3199/api/health
curl http://127.0.0.1:3199/api/usage
```

### 4. Expose the API

The API listens on `127.0.0.1:3199`. To make it accessible from GH Pages, either:

- **Tailscale Funnel**: `tailscale funnel 3199` (gives you a public HTTPS URL)
- **Caddy/nginx reverse proxy** with a domain + TLS
- **SSH tunnel** from your local machine

### 5. Set the API key

```bash
# Generate a random shared secret
openssl rand -hex 16

# Store it (never committed to the repo)
mkdir -p ~/.config
echo 'VIBEUSAGE_API_KEY=your-generated-key-here' > ~/.config/vibeusage-api.env
```

This key is never in the repo. It goes in the URL **hash** (after `#`) which browsers don't send to servers or include in referrers.

### 6. Open the dashboard

```
https://opurtell.github.io/agent-usage-dashboard/#api=https://your-vps-url&key=your-secret
```

### 7. (Optional) GitHub Actions snapshots

Add `ZAI_API_KEY` as a repository secret (for the snapshot workflow only). The workflow runs twice daily and commits a fallback snapshot to `data/usage.json`.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/usage` | Returns vibeusage JSON with cache metadata |
| `GET /api/usage?fresh=1` | Forces fresh fetch (bypasses cache) |
| `GET /api/health` | Health check |

## What you need from each provider

| Provider | How it authenticates | What you get |
|----------|---------------------|--------------|
| Claude | Claude Code OAuth (`~/.claude/.credentials.json`) or session cookie | Session (5h) + weekly usage % |
| Codex/ChatGPT | Codex CLI OAuth (`~/.codex/auth.json`) or bearer token | Session + weekly usage % |
| Z.ai | API key (`z.ai/manage-apikey`) | Token quota, MCP usage, model breakdown |

## iOS Widget (Scriptable)

A compact home screen widget showing session + weekly usage for each provider. Built for [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) — no App Store submission needed.

### Install

1. Install **Scriptable** from the App Store
2. Create a new script, paste the contents of `scriptable-widget.js`
3. Add a **Scriptable medium widget** (4×2) to your home screen
4. Select the script — the API key is embedded as a default, no widget parameter needed

### What it shows

Per provider (Claude, Z.ai, Codex):
- **Session** usage % with time until reset
- **Weekly** usage % with time until reset
- Colour-coded progress bars (orange → yellow → red as usage climbs)

### How it connects

The widget fetches from the same Tailscale Funnel URL used by the dashboard (`https://a1-instance.tail61c8f0.ts.net/api/usage`). The API key is hardcoded as a fallback in the script so the widget works without any parameter configuration.

### Sizing

Optimised for **iPhone 16 Pro** medium widget (~364×170 pts). Fonts and bars are sized to fill the space with comfortable edge and column padding.

## Notes

- vibeusage has its own 60-second cache; the API server adds another 45s
- `?fresh=1` bypasses both caches for instant refresh
- Claude and Codex use **OAuth tokens** (not API keys) — consumer plan usage isn't available through the Anthropic/OpenAI APIs
- The dashboard is a single `index.html` file with zero build step
- No secrets are ever stored in the repo — API key lives in `~/.config/vibeusage-api.env` on the VPS only
- Dashboard URL hash (`#api=...&key=...`) is never sent to any server, never appears in logs or referrers
- Z.ai "Quota" period is labelled "monthly" by vibeusage but resets weekly — the dashboard and widget both relabel it to "Weekly Quota"
