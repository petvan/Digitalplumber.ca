/**
 * digitalplumber.ca — Daily News Builder
 *
 * Fetches AI-curated networking news for each topic via the Anthropic API,
 * then bakes the results into index.html from template.html.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node build.js
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Topics to fetch ──────────────────────────────────────────────────────────
// maxItems per topic reflects editorial priority. Total possible ~30, trimmed to 20.
const DEFAULT_MAX = 3;

const TOPICS = [
  {
    label: 'AI Ops & Observability',
    maxItems: 8,
    query: 'AIOps observability AI operations LogicMonitor Selector.ai Honeycomb Last9 Chronosphere Dynatrace Datadog New Relic ServiceNow Exaforce news 2026'
  },
  {
    label: 'Agentic AI & MCP',
    maxItems: 7,
    query: 'agentic AI MCP Model Context Protocol multi-agent systems AI agents networking operations news 2026'
  },
  {
    label: 'Network Automation',
    maxItems: 7,
    query: 'network automation NetDevOps Itential Cisco Juniper Arista HPE OpenConfig NANOG LogicMonitor news 2026'
  },
  {
    label: 'Security Automation',
    maxItems: 3,
    query: 'security operations automation AI SASE zero trust Palo Alto Fortinet Versa CrowdStrike news 2026'
  },
  {
    label: 'AI Infrastructure',
    maxItems: 3,
    query: 'AI infrastructure networking data center GPU fabric Nvidia Cisco Juniper Arista HPE news 2026'
  },
  {
    label: 'Research, Standards & Industry',
    maxItems: 6,
    query: 'AI ML research paper networking AIOps MLOps agents arxiv IETF NANOG OpenTelemetry OpenConfig standards acquisitions funding platform engineering news 2026'
  },
  {
    label: 'AI Model Providers',
    maxItems: 3,
    query: 'Anthropic Claude OpenAI Google DeepMind Cohere Mistral xAI AI model announcement product launch shutdown 2026'
  },
  {
    label: 'Telco & Cable AI',
    maxItems: 5,
    query: 'AT&T Verizon Lumen Singtel Bell Canada Rogers Cogeco Comcast Charter Cox Telus BCE telco cable operator AI artificial intelligence automation network deployment 2026'
  },
  {
    label: 'AI Industry & Policy',
    maxItems: 5,
    query: 'artificial intelligence industry news regulation policy enterprise adoption AI governance geopolitics funding acquisitions 2026'
  },
  {
    label: 'Podcasts & Talks',
    maxItems: 4,
    query: 'Packet Pushers podcast episode networking AutoCon NANOG presentation talk Cisco Live KubeCon network automation AIOps DevOps operations 2026'
  },
];

// ── Intelligence Panel ────────────────────────────────────────────────────────
const TRENDING_TERMS = [
  'MCP', 'Agentic AI', 'AIOps', 'Digital Twin', 'RAG', 'LLM',
  'OpenTelemetry', 'OpenConfig', 'eBPF', 'SASE', 'Zero Trust',
  'NetDevOps', 'MLOps', 'SRE', 'Kubernetes', 'observability',
  'GenAI', 'inference', 'fine-tuning', 'automation', 'agent',
];

function intelligencePanelHtml(articles) {
  // Today's Topics — count per topicLabel, sorted by count
  const topicCounts = {};
  articles.forEach(a => { topicCounts[a.topicLabel] = (topicCounts[a.topicLabel] || 0) + 1; });
  const topicRows = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) =>
      `<div class="intel-topic-row" onclick="filterTopic(null,'${label.replace(/'/g, "\\'")}')">` +
      `<span>${esc(label)}</span><span class="intel-topic-count">${count}</span></div>`
    ).join('');

  // Top Vendors — count article-level mentions, show top 6 with bar chart
  const vendorCounts = {};
  TRACKED_VENDORS.forEach(v => {
    const n = articles.filter(a =>
      [a.title, a.summary, a.source].join(' ').toLowerCase().includes(v.toLowerCase())
    ).length;
    if (n > 0) vendorCounts[v] = n;
  });
  const topVendors = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxV = topVendors[0]?.[1] || 1;
  const vendorRows = topVendors.length
    ? topVendors.map(([v, n]) =>
        `<div class="intel-vendor-item">` +
        `<span class="intel-vendor-name">${esc(v)}</span>` +
        `<div class="intel-vendor-bar-wrap"><div class="intel-vendor-bar" style="width:${Math.round((n/maxV)*100)}%"></div></div>` +
        `<span class="intel-vendor-count">${n}</span></div>`
      ).join('')
    : '<p style="color:var(--muted);font-size:0.8rem;padding:0.25rem 0">No vendor mentions today</p>';

  // Trending Terms — count occurrences across all article text
  const allText = articles.map(a => [a.title, a.summary].join(' ')).join(' ').toLowerCase();
  const termCounts = TRENDING_TERMS
    .map(term => ({ term, count: (allText.match(new RegExp(term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxT = termCounts[0]?.count || 1;
  const termTags = termCounts.slice(0, 14)
    .map(({ term, count }) => `<span class="intel-term${count >= maxT * 0.4 ? ' hot' : ''}">${esc(term)}</span>`)
    .join('') || '<span style="color:var(--muted);font-size:0.8rem">Scanning…</span>';

  return `
  <div class="intel-widget">
    <div class="intel-widget-title">Today's Topics</div>
    ${topicRows}
  </div>
  <div class="intel-widget">
    <div class="intel-widget-title">Top Vendors</div>
    ${vendorRows}
  </div>
  <div class="intel-widget">
    <div class="intel-widget-title">Trending Terms</div>
    <div class="intel-term-list">${termTags}</div>
  </div>`;
}

// ── Vendor Radar ──────────────────────────────────────────────────────────────
const TRACKED_VENDORS = [
  'LogicMonitor', 'Honeycomb', 'Last9', 'Chronosphere', 'Selector',
  'Dynatrace', 'Datadog', 'New Relic', 'Itential', 'CrowdStrike',
  'Palo Alto', 'Arista', 'Juniper', 'Cisco', 'ServiceNow',
];

function vendorRadarHtml(articles) {
  const cards = TRACKED_VENDORS.map(vendor => {
    const match = articles.find(a =>
      [a.title, a.summary, a.source].join(' ').toLowerCase().includes(vendor.toLowerCase())
    );
    if (match) {
      return `
    <a class="vendor-card vendor-active" href="${esc(match.url)}" target="_blank" rel="noopener">
      <div class="vendor-name">${esc(vendor)}</div>
      <div class="vendor-headline">${esc(match.title)}</div>
      <div class="vendor-source">${esc(match.source)} · ${esc(match.date)}</div>
    </a>`;
    }
    return `
    <div class="vendor-card vendor-quiet">
      <div class="vendor-name">${esc(vendor)}</div>
      <div class="vendor-headline">No news today</div>
    </div>`;
  });
  return cards.join('\n');
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a technical news curator writing for experienced network and IT operations practitioners — senior network engineers, NetDevOps/automation engineers, and AIOps/SRE leads. They are busy and want to cut to the chase.

Use web search to find real, recent, substantive developments related to the given topic area. Today's date will be provided.

RECENCY: This is a strict rule — only include articles published within the last 72 hours. Check the publication date of every article before including it. If an article has no clear date, or if the date is older than 72 hours, exclude it. Return an empty array [] rather than including stale content.

PREFERRED SOURCES — weight these heavily:
- AI research: arXiv (cs.AI, cs.LG, cs.NI), Anthropic blog, OpenAI blog, Google DeepMind blog, Meta AI blog, Google Research blog
- MLOps/AIOps practitioners: ML Ops Community (mlops.community), The New Stack, Honeycomb blog, Last9 blog, Chronosphere blog
- Networking practitioners: Packet Pushers, Network World, SDxCentral, NANOG presentations/mailing list
- Standards & open source: IETF working group drafts, OpenTelemetry, OpenConfig, CNCF project blogs
- AI industry & policy: AI News (artificialintelligence-news.com), VentureBeat AI, MIT Technology Review, The Register, TechCrunch AI
- Quality engineering blogs: Cloudflare Blog, Stripe Engineering, Netflix Tech Blog, Uber Engineering, AWS News Blog (for technically substantive posts)

WHAT TO PRIORITIZE:
- Research papers and technical write-ups with real depth
- Practitioner posts: hands-on experience, lessons learned, benchmark results, architectural decisions
- Standards and protocol developments (IETF, NANOG, OpenConfig, OpenTelemetry)
- Product releases or open-source projects with concrete technical detail
- Conference talks and write-ups (AutoCon, NANOG, Cisco Live, KubeCon)

WHAT TO AVOID — these are common but low-quality sources for this audience:
- SEO-optimised vendor blogs written for search rankings, not practitioners ("Top 10 ways AI transforms networking...")
- Generic press releases with no technical substance ("Company X is excited to announce a partnership...")
- Pure sales or analyst-summary content that recaps what vendors say about themselves
- Any content that reads like it was written to rank in search rather than inform a practitioner
- Articles older than 72 hours

NOTE on vendor/engineering blogs: blogs from engineering-led companies (Cloudflare, Stripe, Netflix, Uber, etc.) often publish genuinely substantive technical content — include these if they have real depth. Exclude vendor marketing blogs that only promote their own products without technical substance.

Return ONLY a JSON array (no markdown, no preamble, no code fences) with exactly the requested number of items if they exist — only return fewer if there genuinely are not enough qualifying articles after searching. Each item must have:
- "title": concise, specific headline (avoid vague marketing language)
- "source": the publication, blog, or outlet (e.g. "arXiv", "Packet Pushers", "The New Stack", "ML Ops Community", "Network World")
- "date": the article date like "Jun 2026" or "May 2026"
- "category": one of: "Product Launch", "Research", "Industry Trend", "Standards", "Acquisition", "Opinion", "Community"
- "summary": 2-3 sentences written for a peer practitioner — what actually happened, the technical detail that matters, and why it's worth their attention. No fluff, no marketing tone.
- "url": the actual source URL
- "tags": array of 3–5 short tags pulled directly from the article — company names, product names, or key technology terms (e.g. ["Cisco", "AIOps", "MCP"], ["Anthropic", "Claude", "Agents"])

Aim for the full requested number of items. Search broadly across the preferred sources before concluding there isn't enough news.`;

// ── HTML helpers ──────────────────────────────────────────────────────────────
function stripCites(str) {
  return String(str || '').replace(/<cite[^>]*>|<\/cite>/gi, '').trim();
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cardHtml(item) {
  return `
    <div class="card" data-topic="${esc(item.topicLabel)}">
      <div class="card-meta">
        <span class="source-tag">${esc(item.source)}</span>
        <span class="card-date">${esc(item.date)}</span>
        <span class="card-category">${esc(item.category)}</span>
      </div>
      <h2>${esc(item.title)}</h2>
      <p class="card-summary">${esc(item.summary)}</p>
      ${(item.tags && item.tags.length) ? `<div class="card-tags">${item.tags.map(t => `<span class="card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="card-footer">
        <a class="read-link" href="${esc(item.url)}" target="_blank" rel="noopener">Read more →</a>
        <span class="ai-badge"><span class="ai-dot"></span> AI-summarized</span>
      </div>
    </div>`;
}

// ── Fetch news for a single topic (with retry on 429) ────────────────────────
async function fetchTopicNews(topic, attempt = 1) {
  const maxItems = topic.maxItems || DEFAULT_MAX;
  console.log(`  Fetching: ${topic.label} (target: ${maxItems})…`);

  const today = new Date().toISOString().split('T')[0];
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString().split('T')[0];
  const messages = [{
    role: 'user',
    content: `Today is ${today}. Find ${maxItems} substantive news articles published on or after ${cutoff} (last 72 hours) about: ${topic.query} after:${cutoff}`
  }];

  try {
    let response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages,
    });

    // Handle multi-turn: model may call web_search one or more times
    // before producing the final text response.
    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < 2) {
      iterations++;
      messages.push({ role: 'assistant', content: response.content });

      // Return empty tool_result for each tool_use block (Anthropic executes
      // web_search server-side; we just need to acknowledge).
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));

      messages.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
        messages,
      });
    }

    let textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in final response');

    // Strip markdown code fences the model sometimes wraps output in
    const stripFences = t => t.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

    // If the model returned prose instead of JSON, send one follow-up to force output
    const stripped = stripFences(textBlock.text);
    if (!stripped.startsWith('[')) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: 'Return ONLY the JSON array now — no prose, no explanation, no markdown fences. Just the raw JSON array of the articles you found, or [] if none qualify.'
      });
      const forced = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages,
      });
      textBlock = forced.content.find(b => b.type === 'text');
      if (!textBlock) throw new Error('No text block in forced JSON response');
    }

    // Extract the JSON array, stripping any code fences and recovering truncated output
    let text = stripFences(textBlock.text);
    let jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Truncated output — close the array after the last complete object
      const lastClose = text.lastIndexOf('}');
      if (lastClose !== -1 && text.includes('[')) {
        try {
          text = text.slice(0, lastClose + 1) + ']';
          // Remove trailing comma before the synthetic ]
          text = text.replace(/,\s*\]$/, ']');
          jsonMatch = text.match(/\[[\s\S]*/);
          if (jsonMatch) jsonMatch[0] = text.slice(text.indexOf('['));
        } catch {}
      }
    }
    if (!jsonMatch) throw new Error(`No JSON array found. Raw: ${textBlock.text.slice(0, 200)}`);

    const items = JSON.parse(jsonMatch[0]);
    console.log(`    ✓ ${items.length} articles`);
    return items.map(item => ({
      ...item,
      title:   stripCites(item.title),
      summary: stripCites(item.summary),
      source:  stripCites(item.source),
      topicLabel: topic.label,
    }));

  } catch (err) {
    // Retry on rate limit with exponential backoff (max 3 attempts)
    if (err.status === 429 && attempt < 3) {
      const wait = attempt * 30000; // 30s, then 60s
      console.warn(`    ⏳ Rate limited on "${topic.label}", retrying in ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
      return fetchTopicNews(topic, attempt + 1);
    }
    console.error(`    ✗ Error for "${topic.label}": ${err.message}`);
    if (err.status) console.error(`      HTTP status: ${err.status}`);
    if (err.error) console.error(`      API error body: ${JSON.stringify(err.error)}`);
    if (err.cause) console.error(`      Cause: ${err.cause.code || ''} ${err.cause.message || err.cause}`);
    // Dump full error object keys for debugging
    console.error(`      Error keys: ${Object.keys(err).join(', ')}`);
    try { console.error(`      Full error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`); } catch {}
    return [];
  }
}

// ── Podcast card HTML ─────────────────────────────────────────────────────────
function podcastCardHtml(item) {
  return `
    <div class="podcast-card">
      <div class="podcast-card-meta">
        <span class="podcast-source-tag">${esc(item.source)}</span>
        <span class="podcast-date">${esc(item.date)}</span>
        <span class="podcast-category">${esc(item.category)}</span>
      </div>
      <h3>${esc(item.title)}</h3>
      <p class="podcast-summary">${esc(item.summary)}</p>
      <a class="read-link" href="${esc(item.url)}" target="_blank" rel="noopener">Listen / Watch →</a>
    </div>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('digitalplumber.ca — Daily build starting…\n');

  // Quick raw-fetch diagnostic to see actual API error body
  try {
    const diagRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      }),
    });
    const diagText = await diagRes.text();
    console.log(`  Diagnostic: HTTP ${diagRes.status} — ${diagText.slice(0, 500)}\n`);
  } catch (e) {
    console.log(`  Diagnostic fetch error: ${e.message}\n`);
  }

  // Fetch all topics (sequentially to avoid rate limits)
  const rawItems = [];
  for (const topic of TOPICS) {
    const items = await fetchTopicNews(topic);
    rawItems.push(...items);
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\nTotal articles fetched: ${rawItems.length}`);

  if (rawItems.length === 0) {
    console.error('No articles fetched. Aborting to preserve existing index.html.');
    process.exit(1);
  }

  // Separate podcasts from main news feed
  const podcastItems = rawItems.filter(i => i.topicLabel === 'Podcasts & Talks');
  const newsItems = rawItems.filter(i => i.topicLabel !== 'Podcasts & Talks');

  // Cap main feed at 25 articles
  const MAX_TOTAL = 35;
  if (newsItems.length > MAX_TOTAL) newsItems.length = MAX_TOTAL;
  console.log(`News: ${newsItems.length}, Podcasts: ${podcastItems.length}`);

  // Build date string
  const now = new Date();
  const buildDate = now.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'America/Toronto',
  });
  // YYYY-MM-DD in Toronto time
  const torDate = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Toronto',
  }).format(now);
  const dateStr = torDate; // en-CA gives YYYY-MM-DD natively

  // Read template
  const templatePath = path.join(__dirname, 'template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Error: template.html not found.');
    process.exit(1);
  }

  // ── Load / update archives.json ────────────────────────────────────────────
  const archivesDir = path.join(__dirname, 'archives');
  if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir);

  const archivesJsonPath = path.join(archivesDir, 'index.json');
  let archives = [];
  if (fs.existsSync(archivesJsonPath)) {
    try { archives = JSON.parse(fs.readFileSync(archivesJsonPath, 'utf8')); } catch {}
  }
  archives = archives.filter(a => a.date !== dateStr);
  archives.unshift({ date: dateStr, label: buildDate, count: newsItems.length });
  archives = archives.slice(0, 30);
  fs.writeFileSync(archivesJsonPath, JSON.stringify(archives, null, 2), 'utf8');

  // ── Build / update search index ────────────────────────────────────────────
  const searchIndexPath = path.join(archivesDir, 'search-index.json');
  let searchIndex = [];
  if (fs.existsSync(searchIndexPath)) {
    try { searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8')); } catch {}
  }
  searchIndex = searchIndex.filter(a => a.date !== dateStr);
  const todayEntries = newsItems.map(item => ({
    date: dateStr,
    dateLabel: buildDate,
    title: item.title,
    summary: item.summary,
    source: item.source,
    url: item.url,
    topic: item.topicLabel,
    tags: item.tags || [],
  }));
  searchIndex = [...todayEntries, ...searchIndex];
  // Keep 30 days × ~35 articles max
  const keepDates = new Set(archives.map(a => a.date));
  searchIndex = searchIndex.filter(a => keepDates.has(a.date));
  fs.writeFileSync(searchIndexPath, JSON.stringify(searchIndex), 'utf8');
  console.log(`✓ archives/search-index.json written (${searchIndex.length} total articles)`);

  // ── Build the page HTML (shared by index.html and archive) ────────────────
  function buildHtml(template, { isArchive = false } = {}) {
    const cardsHtml = newsItems.length > 0
      ? newsItems.map(cardHtml).join('\n')
      : '<div style="text-align:center;padding:3rem;color:#6b7280"><p>No articles available today. Check back soon.</p></div>';

    const podcastHtml = podcastItems.length > 0
      ? podcastItems.map(podcastCardHtml).join('\n')
      : '<p class="no-podcast">No podcast or talk summaries today — check back tomorrow.</p>';

    const archiveListScript = `<script>window.__archives=${JSON.stringify(archives)};window.__buildDate=${JSON.stringify(dateStr)};</script>`;
    const archiveBanner = isArchive
      ? `<div class="archive-notice">You're viewing the archive for ${esc(buildDate)}. <a href="/">← Back to today</a></div>`
      : '';

    let html = template;
    const topicCount = new Set(newsItems.map(i => i.topicLabel)).size;
    html = html.replace('<!--NEWS_CARDS-->', cardsHtml);
    html = html.replace(/<!--BUILD_DATE-->/g, buildDate);
    html = html.replace(/<!--ARTICLE_COUNT-->/g, String(newsItems.length));
    html = html.replace(/<!--TOPIC_COUNT-->/g, String(topicCount));
    html = html.replace('<!--PODCAST_CARDS-->', podcastHtml);
    html = html.replace('<!--VENDOR_RADAR-->', vendorRadarHtml(newsItems));
    html = html.replace('<!--INTELLIGENCE_PANEL-->', intelligencePanelHtml(newsItems));
    html = html.replace('<!--ARCHIVE_LIST_SCRIPT-->', archiveListScript);
    html = html.replace('<!--ARCHIVE_NOTICE-->', archiveBanner);
    return html;
  }

  const template = fs.readFileSync(templatePath, 'utf8');

  // Write index.html
  fs.writeFileSync(path.join(__dirname, 'index.html'), buildHtml(template), 'utf8');
  console.log(`✓ index.html written`);

  // Write dated archive file
  const archiveHtmlPath = path.join(archivesDir, `${dateStr}.html`);
  fs.writeFileSync(archiveHtmlPath, buildHtml(template, { isArchive: true }), 'utf8');
  console.log(`✓ archives/${dateStr}.html written`);

  console.log(`\nDone! ${newsItems.length} articles + ${podcastItems.length} podcasts · ${buildDate}`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
