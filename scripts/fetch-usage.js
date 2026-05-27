#!/usr/bin/env node
// Fetch usage data from Z.ai, OpenAI, and Anthropic APIs
// Outputs: data/usage.json

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT = path.join(DATA_DIR, 'usage.json');

// Ensure data dir exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const result = {
  fetched_at: new Date().toISOString(),
  zai: null,
  openai: null,
  anthropic: null,
  errors: {}
};

// Helper: HTTP request with timeout
async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Z.ai
// ============================================================
async function fetchZai() {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    result.errors.zai = 'ZAI_API_KEY not set';
    return;
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // Fetch quota limits
    const quotaData = await fetchJSON(
      'https://api.z.ai/api/monitor/usage/quota/limit',
      { headers }
    );

    // Fetch model usage (last 7 days)
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const modelUsage7d = await fetchJSON(
      `https://api.z.ai/api/monitor/usage/model-usage?startTime=${weekAgo.toISOString()}&endTime=${now.toISOString()}`,
      { headers }
    );

    const modelUsage30d = await fetchJSON(
      `https://api.z.ai/api/monitor/usage/model-usage?startTime=${monthAgo.toISOString()}&endTime=${now.toISOString()}`,
      { headers }
    );

    // Aggregate 7d and 30d totals
    let tokens7d = 0, calls7d = 0;
    let tokens30d = 0, calls30d = 0;
    const modelBreakdown = {};

    if (modelUsage7d?.modelUsage?.timeSeries) {
      for (const bucket of modelUsage7d.modelUsage.timeSeries) {
        tokens7d += bucket.tokens || 0;
        calls7d += bucket.calls || 0;
      }
    }

    if (modelUsage30d?.modelUsage?.timeSeries) {
      for (const bucket of modelUsage30d.modelUsage.timeSeries) {
        tokens30d += bucket.tokens || 0;
        calls30d += bucket.calls || 0;
      }
    }

    // Build daily token series for chart
    const dailyTokens = [];
    if (modelUsage7d?.modelUsage?.timeSeries) {
      for (const bucket of modelUsage7d.modelUsage.timeSeries) {
        dailyTokens.push({
          date: bucket.fullTime ? bucket.fullTime.split(' ')[0] : bucket.time,
          tokens: bucket.tokens || 0,
          calls: bucket.calls || 0
        });
      }
    }

    result.zai = {
      quota: quotaData || null,
      usage: { tokens_7d: tokens7d, calls_7d: calls7d, tokens_30d: tokens30d, calls_30d: calls30d },
      daily_tokens: dailyTokens,
      model_breakdown: Object.entries(modelBreakdown).map(([model, tokens]) => ({ model, tokens })),
      plan_tier: process.env.ZAI_PLAN_TIER || 'pro',
      plan_cost: parseFloat(process.env.ZAI_PLAN_COST || '0')
    };

  } catch (e) {
    result.errors.zai = e.message;
  }
}

// ============================================================
// OpenAI
// ============================================================
async function fetchOpenAI() {
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) {
    result.errors.openai = 'OPENAI_ADMIN_KEY not set';
    return;
  }

  const headers = {
    'Authorization': `Bearer ${adminKey}`,
    'Content-Type': 'application/json'
  };

  try {
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 24 * 60 * 60;
    const monthStart = now - 30 * 24 * 60 * 60;

    // Fetch completions usage (7d, grouped by day)
    let allUsage = [];
    let cursor = null;
    do {
      const params = new URLSearchParams({
        start_time: weekAgo.toString(),
        bucket_width: '1d',
        limit: '7'
      });
      if (cursor) params.set('page', cursor);

      const usageData = await fetchJSON(
        `https://api.openai.com/v1/organization/usage/completions?${params}`,
        { headers }
      );
      allUsage = allUsage.concat(usageData.data || []);
      cursor = usageData.next_page || null;
    } while (cursor);

    // Fetch costs (this month)
    let costData = [];
    cursor = null;
    do {
      const params = new URLSearchParams({
        start_time: monthStart.toString(),
        limit: '30',
        bucket_width: '1d'
      });
      if (cursor) params.set('page', cursor);

      const costResp = await fetchJSON(
        `https://api.openai.com/v1/organization/costs?${params}`,
        { headers }
      );
      costData = costData.concat(costResp.data || []);
      cursor = costResp.next_page || null;
    } while (cursor);

    // Aggregate usage
    let inputTokens7d = 0, outputTokens7d = 0, requests7d = 0;
    const dailyTokens = [];
    const modelCosts = {};

    for (const bucket of allUsage) {
      let dayInput = 0, dayOutput = 0, dayReqs = 0;
      const date = new Date(bucket.start_time * 1000).toISOString().split('T')[0];

      for (const r of bucket.results || []) {
        dayInput += r.input_tokens || 0;
        dayOutput += r.output_tokens || 0;
        dayReqs += r.num_model_requests || 0;
      }
      inputTokens7d += dayInput;
      outputTokens7d += dayOutput;
      requests7d += dayReqs;
      dailyTokens.push({
        date,
        input_tokens: dayInput,
        output_tokens: dayOutput,
        requests: dayReqs
      });
    }

    // Aggregate costs
    let cost7d = 0, costThisMonth = 0;
    const sevenDaysAgoSec = now - 7 * 24 * 60 * 60;

    for (const bucket of costData) {
      const bucketTime = bucket.start_time;
      let dayCost = 0;

      for (const r of bucket.results || []) {
        const c = r.cost || 0;
        dayCost += c;

        // Track by model if available
        if (r.model) {
          modelCosts[r.model] = (modelCosts[r.model] || 0) + c;
        }
      }

      costThisMonth += dayCost;
      if (bucketTime >= sevenDaysAgoSec) {
        cost7d += dayCost;
      }
    }

    result.openai = {
      usage: {
        input_tokens_7d: inputTokens7d,
        output_tokens_7d: outputTokens7d,
        requests_7d: requests7d
      },
      costs: {
        cost_7d: cost7d / 100, // costs are in cents
        cost_this_month: costThisMonth / 100
      },
      daily_tokens: dailyTokens,
      cost_by_model: Object.entries(modelCosts)
        .map(([model, cost]) => ({ model, cost: cost / 100 }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 8)
    };

  } catch (e) {
    result.errors.openai = e.message;
  }
}

// ============================================================
// Anthropic
// ============================================================
async function fetchAnthropic() {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) {
    result.errors.anthropic = 'ANTHROPIC_ADMIN_KEY not set';
    return;
  }

  // Anthropic admin API base
  const headers = {
    'x-api-key': adminKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json'
  };

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch message usage report
    let inputTokens7d = 0, outputTokens7d = 0, requests7d = 0;
    let cost7d = 0, costThisMonth = 0;

    try {
      const usageResp = await fetchJSON(
        `https://api.anthropic.com/v1/organizations/usage_report/messages?start_date=${weekAgo.toISOString().split('T')[0]}&end_date=${now.toISOString().split('T')[0]}&interval=daily`,
        { headers }
      );

      if (usageResp?.data) {
        for (const day of usageResp.data) {
          inputTokens7d += day.input_tokens || 0;
          outputTokens7d += day.output_tokens || 0;
          requests7d += day.num_requests || 0;
        }
      }
    } catch (e) {
      // Usage endpoint might not be available for all plans
      console.error('Anthropic usage fetch failed:', e.message);
    }

    try {
      const costResp = await fetchJSON(
        `https://api.anthropic.com/v1/organizations/cost_report?start_date=${monthAgo.toISOString().split('T')[0]}&end_date=${now.toISOString().split('T')[0]}&interval=daily`,
        { headers }
      );

      if (costResp?.data) {
        for (const day of costResp.data) {
          costThisMonth += day.cost || 0;
          const dayDate = new Date(day.date || day.start_time);
          if (dayDate >= weekAgo) {
            cost7d += day.cost || 0;
          }
        }
      }
    } catch (e) {
      console.error('Anthropic cost fetch failed:', e.message);
    }

    result.anthropic = {
      usage: {
        input_tokens_7d: inputTokens7d,
        output_tokens_7d: outputTokens7d,
        requests_7d: requests7d
      },
      costs: {
        cost_7d: cost7d,
        cost_this_month: costThisMonth
      }
    };

  } catch (e) {
    result.errors.anthropic = e.message;
  }
}

// ============================================================
// Main
// ============================================================
(async () => {
  console.log('Fetching AI usage data...');
  await Promise.allSettled([fetchZai(), fetchOpenAI(), fetchAnthropic()]);

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log(`Data written to ${OUTPUT}`);
  console.log('Providers fetched:', [
    result.zai ? 'zai' : null,
    result.openai ? 'openai' : null,
    result.anthropic ? 'anthropic' : null
  ].filter(Boolean).join(', ') || 'none');

  if (Object.keys(result.errors).length) {
    console.log('Errors:', JSON.stringify(result.errors));
  }
})();
