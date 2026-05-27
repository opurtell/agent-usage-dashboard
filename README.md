# AI Usage Dashboard

A static HTML dashboard that tracks usage across **Z.ai (GLM Coding Plan)**, **OpenAI (ChatGPT Plus)**, and **Anthropic (Claude)**.

Live at: `https://opurtell.github.io/ai-usage-dashboard/`

## How it works

1. **GitHub Action** runs every 6 hours (or on manual trigger)
2. Fetches usage data from each provider's API
3. Saves data to `data/usage.json`
4. Static `index.html` loads the JSON and renders charts via Chart.js

## Required GitHub Secrets

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `ZAI_API_KEY` | Z.ai API key (`hex32.alphanum16`) | [z.ai/manage-apikey](https://z.ai/manage-apikey/apikey-list) |
| `OPENAI_ADMIN_KEY` | OpenAI Admin API key | [platform.openai.com/settings/organization/admin-keys](https://platform.openai.com/settings/organization/admin-keys) |
| `ANTHROPIC_ADMIN_KEY` | Anthropic Admin API key (`sk-ant-admin-*`) | [console.anthropic.com](https://console.anthropic.com/) → Org Settings → Admin Keys |

### Optional Secrets

| Secret | Description | Default |
|--------|-------------|---------|
| `ZAI_PLAN_TIER` | Your plan: `lite`, `pro`, or `max` | `pro` |
| `ZAI_PLAN_COST` | Monthly subscription cost (USD) | `0` |

## Manual data fetch

Go to **Actions → Fetch AI Usage Data → Run workflow**.

## Local development

```bash
# Generate a sample data file first
node scripts/fetch-usage.js  # (needs env vars set)

# Or create a placeholder
mkdir -p data && echo '{"fetched_at":"2025-01-01T00:00:00Z"}' > data/usage.json

# Serve locally
npx serve .
```

## Tech

- Vanilla HTML/CSS/JS (no build step)
- [Chart.js](https://www.chartjs.org/) for charts
- GitHub Actions for data fetching
- GitHub Pages for hosting
