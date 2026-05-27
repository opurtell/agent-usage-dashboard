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

### 5. Configure the dashboard

Open the dashboard with the API URL as a query param:

```
https://opurtell.github.io/agent-usage-dashboard/?api=https://your-vps-url
```

Or edit `index.html` and set `window.__API_URL__` in a build step.

### 6. (Optional) GitHub Actions snapshots

Add `ZAI_API_KEY` as a repository secret. The workflow runs twice daily and commits a snapshot to `data/usage.json` as a fallback when the VPS API is unreachable.

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

## Notes

- vibeusage has its own 60-second cache; the API server adds another 45s
- `?fresh=1` bypasses both caches for instant refresh
- Claude and Codex use **OAuth tokens** (not API keys) — consumer plan usage isn't available through the Anthropic/OpenAI APIs
- The dashboard is a single `index.html` file with zero build step
