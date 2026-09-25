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

// Hard cutoff for article publication dates — the prompt asks for 72 hours,
// with one extra day of slack for timezone/date ambiguity. Anything older
// (or undated, or malformed) is dropped after fetch rather than trusted.
const MAX_AGE_DAYS = 4;

const TOPICS = [
  {
    label: 'AI Ops & Observability',
    short: 'AI ops',
    maxItems: 8,
    query: 'AIOps observability AI operations LogicMonitor Selector.ai net.ai Honeycomb Last9 Chronosphere Dynatrace Datadog New Relic ServiceNow Exaforce news 2026'
  },
  {
    label: 'Agentic AI & MCP',
    short: 'Agentic AI',
    maxItems: 7,
    query: 'agentic AI MCP Model Context Protocol multi-agent systems AI agents networking operations news 2026'
  },
  {
    label: 'Network Automation',
    short: 'Networking',
    maxItems: 7,
    query: 'network automation NetDevOps Itential Cisco Juniper Arista HPE OpenConfig NANOG LogicMonitor news 2026'
  },
  {
    label: 'Security Automation',
    short: 'Security',
    maxItems: 3,
    query: 'security operations automation AI SASE zero trust Palo Alto Fortinet Versa CrowdStrike news 2026'
  },
  {
    label: 'AI Infrastructure',
    short: 'Infrastructure',
    maxItems: 3,
    query: 'AI infrastructure networking data center GPU fabric Nvidia Cisco Juniper Arista HPE news 2026'
  },
  {
    label: 'Research, Standards & Industry',
    short: 'Research',
    maxItems: 6,
    query: 'AI ML research paper networking AIOps MLOps agents arxiv IETF NANOG OpenTelemetry OpenConfig standards acquisitions funding platform engineering news 2026'
  },
  {
    label: 'AI Model Providers',
    short: 'Models',
    maxItems: 3,
    query: 'Anthropic Claude OpenAI Google DeepMind Cohere Mistral xAI AI model announcement product launch shutdown 2026'
  },
  {
    label: 'Telco & Cable AI',
    short: 'Telco',
    maxItems: 5,
    query: 'AT&T Verizon Lumen Singtel Bell Canada Rogers Cogeco Comcast Charter Cox Telus BCE telco cable operator AI artificial intelligence automation network deployment 2026'
  },
  {
    label: 'AI Industry & Policy',
    short: 'Industry and policy',
    maxItems: 5,
    query: 'artificial intelligence industry news regulation policy enterprise adoption AI governance geopolitics funding acquisitions 2026'
  },
  {
    label: 'Podcasts & Talks',
    short: 'Listening',
    maxItems: 4,
    query: 'Packet Pushers podcast episode networking AutoCon NANOG presentation talk Cisco Live KubeCon network automation AIOps DevOps operations 2026'
  },
];

// ── Ledger: companies and signals ─────────────────────────────────────────────
const TRENDING_TERMS = [
  'MCP', 'Agentic AI', 'AIOps', 'Digital Twin', 'RAG', 'LLM',
  'OpenTelemetry', 'OpenConfig', 'eBPF', 'SASE', 'Zero Trust',
  'NetDevOps', 'MLOps', 'SRE', 'Kubernetes', 'observability',
  'GenAI', 'inference', 'fine-tuning', 'automation', 'agent',
];

// The ledger's two right-hand columns: vendor mentions over 7 days, and today's terms
function intelligencePanelHtml(articles, weekArticles) {
  const topVendors = vendorMentions(weekArticles).slice(0, 8);
  const tally = topVendors.length
    ? `<ul class="tally">${topVendors.map(({ vendor, articles: hits }) => `
        <li onclick="searchVendor('${esc(vendor).replace(/'/g, "\\'")}')"><span class="tally-name">${esc(vendor)}</span><span class="dots"></span><span class="n">${hits.length}</span></li>`).join('')}
      </ul>`
    : '<p class="empty-note">No tracked vendors in the news this week.</p>';

  const allText = articles.map(a => [a.title, a.summary].join(' ')).join(' ').toLowerCase();
  const termCounts = TRENDING_TERMS
    .map(term => ({ term, count: (allText.match(new RegExp(term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxT = termCounts[0]?.count || 1;
  const terms = termCounts.slice(0, 14)
    .map(({ term, count }) => count >= maxT * 0.4 ? `<span class="hot">${esc(term)}</span>` : esc(term))
    .join(' · ');

  return `
      <div>
        <h3 class="label">Most mentioned · 7 days</h3>
        ${tally}
      </div>
      <div>
        <h3 class="label">In the pipes today</h3>
        ${terms ? `<p class="terms">${terms}</p>` : '<p class="empty-note">Nothing trending yet.</p>'}
      </div>`;
}

// ── Vendor Radar ──────────────────────────────────────────────────────────────
const TRACKED_VENDORS = [
  'LogicMonitor', 'Honeycomb', 'Last9', 'Chronosphere', 'Selector',
  'Dynatrace', 'Datadog', 'New Relic', 'Itential', 'CrowdStrike',
  'Palo Alto', 'Arista', 'Juniper', 'Cisco', 'ServiceNow',
  'net.ai',
];

// Names match as whole words, case-sensitively ("Cisco" must not match "San
// Francisco", "Selector" must not match a Kubernetes label selector). An
// all-lowercase entry such as 'net.ai' matches in any case.
const VENDOR_PATTERNS = TRACKED_VENDORS.map(vendor => ({
  vendor,
  re: new RegExp(
    `(?<![\\w-])${vendor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
    vendor === vendor.toLowerCase() ? 'i' : ''
  ),
}));

// [{ vendor, articles }] for every tracked vendor the articles mention, most-mentioned first
function vendorMentions(articles) {
  return VENDOR_PATTERNS
    .map(({ vendor, re }) => ({
      vendor,
      articles: articles.filter(a => re.test([a.title, a.summary, a.source, ...(a.tags || [])].join(' '))),
    }))
    .filter(m => m.articles.length > 0)
    .sort((a, b) => b.articles.length - a.articles.length);
}

// Tracked companies in today's paper, each linking to its stories on the page
function vendorRadarHtml(articles) {
  const active = vendorMentions(articles);
  const activeNames = new Set(active.map(m => m.vendor));
  const quiet = TRACKED_VENDORS.filter(v => !activeNames.has(v));
  if (active.length === 0) {
    return `<p class="empty-note">None of the ${TRACKED_VENDORS.length} tracked companies made today's paper.</p>`;
  }
  return active.map(({ vendor, articles: hits }) => `
        <div class="company">
          <div class="company-name">${esc(vendor)}<span class="n">${hits.length} ${hits.length === 1 ? 'story' : 'stories'}</span></div>
          <ul>${hits.slice(0, 3).map(a => `<li><a href="#${esc(a.id)}">${esc(a.title)}</a></li>`).join('')}</ul>
          <button type="button" class="coverage" onclick="searchVendor('${esc(vendor).replace(/'/g, "\\'")}')">All ${esc(vendor)} coverage →</button>
        </div>`).join('') +
    (quiet.length ? `
        <p class="quiet">Quiet today: ${quiet.map(esc).join(', ')}</p>` : '');
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
- "date": the article's exact publication date in ISO format "YYYY-MM-DD" (e.g. "2026-06-26"). If you cannot determine the exact publication date, exclude the article.
- "category": one of: "Product Launch", "Research", "Industry Trend", "Standards", "Acquisition", "Opinion", "Community"
- "summary": 2-3 sentences written for a peer practitioner — what actually happened, the technical detail that matters, and why it's worth their attention. No fluff, no marketing tone. This is the teaser shown on the card.
- "detail": a longer 150-250 word briefing that expands on the summary so a reader gets the full gist WITHOUT leaving to read the source. Cover: what happened and the key specifics (numbers, versions, benchmark results, architectural choices), why it matters to a network/AIOps/SRE practitioner, and any notable caveats or context. Write 2-3 tight paragraphs of substance — no marketing tone, no filler, no restating the title. Base it only on what the source actually says; do not invent details.
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

// Valid ISO date, no older than MAX_AGE_DAYS, no more than a day in the future
function isFreshIsoDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return false;
  const ageDays = (Date.now() - Date.parse(dateStr + 'T00:00:00Z')) / 86400000;
  return ageDays <= MAX_AGE_DAYS && ageDays >= -1;
}

// "2026-06-26" → "Jun 26, 2026" for card display
function displayDate(iso) {
  const t = Date.parse(iso + 'T12:00:00Z');
  if (isNaN(t)) return String(iso || '');
  return new Date(t).toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function detailParas(item) {
  const detail = stripCites(item.detail || '');
  return detail ? detail.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('') : '';
}

function sourceLink(item) {
  const domain = hostname(item.url);
  return `<a class="source-link" href="${esc(item.url)}" target="_blank" rel="noopener">Read the original${domain ? ` at ${esc(domain)}` : ''} ↗</a>`;
}

// A story inside a newspaper section
function storyHtml(item) {
  const paras = detailParas(item);
  const tags = (item.tags || []).slice(0, 5);
  return `
        <article class="story" data-topic="${esc(item.topicLabel)}" id="${esc(item.id)}">
          ${item.category ? `<p class="kicker label">${esc(item.category)}</p>` : ''}
          <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
          <p class="summary">${esc(item.summary)}</p>
          <p class="byline"><b>${esc(item.source)}</b> · ${esc(displayDate(item.date))}</p>
          ${tags.length ? `<p class="tags">${tags.map(esc).join(' · ')}</p>` : ''}
          ${paras ? `<div class="story-detail">${paras}${sourceLink(item)}</div>
          <button type="button" class="more" aria-expanded="false" onclick="toggleDetail(this)">Continue reading</button>` : `
          ${sourceLink(item)}`}
        </article>`;
}

// The front page: the lead story with its full write-up, and an index of the next picks
function frontPageHtml(lead, inside) {
  if (!lead) return '<p class="empty-note">No stories today. Check back tomorrow morning.</p>';
  const { item, why } = lead;
  const paras = detailParas(item);
  return `
    <article class="story lead" data-topic="${esc(item.topicLabel)}" id="${esc(item.id)}">
      <p class="kicker label">${esc(topicShort(item.topicLabel))}${item.category ? `<span class="sep">·</span>${esc(item.category)}` : ''}</p>
      <h2 class="lead-head"><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h2>
      <p class="lead-deck">${esc(item.summary)}</p>
      <p class="byline"><b>${esc(item.source)}</b> · ${esc(displayDate(item.date))}</p>
      ${paras ? `<div class="lead-body">${paras}</div>` : ''}
      ${why ? `<p class="why"><span class="label">Why it matters</span>${esc(why)}</p>` : ''}
      ${sourceLink(item)}
    </article>
    ${inside.length ? `<aside class="inside">
      <h3 class="rail-head label">Inside today</h3>
      <ol>${inside.map(({ item: i, why: w }) => `
        <li><div>
          <a href="#${esc(i.id)}"><span class="rail-kicker label">${esc(topicShort(i.topicLabel))}</span>${esc(i.title)}</a>
          ${w ? `<p>${esc(w)}</p>` : ''}
        </div></li>`).join('')}
      </ol>
    </aside>` : ''}`;
}

function topicShort(label) {
  return (TOPICS.find(t => t.label === label) || {}).short || label;
}

// Every story except the lead, grouped into sections in TOPICS order
function sectionsHtml(items, leadId) {
  return TOPICS
    .map(topic => ({ topic, stories: items.filter(i => i.topicLabel === topic.label && i.id !== leadId) }))
    .filter(({ stories }) => stories.length > 0)
    .map(({ topic, stories }) => `
    <section class="paper-section" data-topic="${esc(topic.label)}">
      <div class="section-head"><h2>${esc(topic.label)}</h2><span class="label">${stories.length} ${stories.length === 1 ? 'story' : 'stories'}</span></div>
      <div class="story-grid">${stories.map(storyHtml).join('')}
      </div>
    </section>`).join('');
}

// Section bar links for the topics in today's paper
function sectionLinksHtml(items) {
  return TOPICS
    .map(topic => ({ topic, n: items.filter(i => i.topicLabel === topic.label).length }))
    .filter(({ n }) => n > 0)
    .map(({ topic, n }) =>
      `<button class="section-link" data-topic="${esc(topic.label)}" onclick="filterTopic(this, this.dataset.topic)">${esc(topic.short)}<span class="n">${n}</span></button>`)
    .join('\n      ');
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

  const apiCall = async (body) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { status: res.status, error: json?.error });
    return json;
  };

  try {
    let response = await apiCall({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', allowed_callers: ['direct'] }],
      messages,
    });

    // With server-side web_search the API handles tool execution and returns
    // end_turn directly. The loop is a safety net for unexpected tool_use stops.
    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < 2) {
      iterations++;
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
      response = await apiCall({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search', allowed_callers: ['direct'] }],
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
      const forced = await apiCall({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
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

    const parsed = JSON.parse(jsonMatch[0]);
    const items = parsed.filter(item => {
      if (isFreshIsoDate(item.date)) return true;
      console.warn(`    ⤫ Dropped stale/undated ("${item.date || 'no date'}"): ${stripCites(item.title).slice(0, 70)}`);
      return false;
    });
    console.log(`    ✓ ${items.length} articles${parsed.length > items.length ? ` (${parsed.length - items.length} dropped by date filter)` : ''}`);
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

// ── Listening (podcasts & talks) ──────────────────────────────────────────────
function podcastsHtml(items) {
  if (items.length === 0) return '';
  return `
  <section class="paper-section" id="section-listening">
    <div class="section-head"><h2>Listening</h2><span class="label">Podcasts and talks</span></div>
    <ul class="listening">${items.map(item => `
      <li>
        <p class="kicker label">${esc(item.source)}</p>
        <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
        <p>${esc(item.summary)}</p>
        <p class="byline">${esc(displayDate(item.date))}${item.category ? ` · ${esc(item.category)}` : ''}</p>
      </li>`).join('')}
    </ul>
  </section>`;
}

// ── RSS feed ──────────────────────────────────────────────────────────────────
function rssXml(entries, buildIso) {
  const items = entries.slice(0, 100).map(a => `
    <item>
      <title>${esc(a.title)}</title>
      <link>${esc(a.url)}</link>
      <guid isPermaLink="true">${esc(a.url)}</guid>
      <pubDate>${new Date(`${a.date}T10:00:00Z`).toUTCString()}</pubDate>
      <category>${esc(a.topic)}</category>
      <description>${esc(`<p>${esc(a.summary)}</p><p>Source: ${esc(a.source)} · <a href="https://digitalplumber.ca/archives/${a.date}.html">${esc(a.dateLabel)} briefing</a></p>`)}</description>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Digital Plumber — AI Networking Intelligence</title>
    <link>https://digitalplumber.ca/</link>
    <atom:link href="https://digitalplumber.ca/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Daily AI-curated briefing for network engineers, NetDevOps and AIOps practitioners.</description>
    <language>en-ca</language>
    <lastBuildDate>${new Date(buildIso).toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>
`;
}

// ── Top-story picks (front page and week in review) ──────────────────────────
// Asks Claude to rank the most important stories; returns [{ entry, why }].
// Falls back to the newest story from each topic if the call fails.
async function pickTopStories(entries, { count, scope }) {
  const fallback = () => {
    const seenTopics = new Set();
    return entries.filter(a => !seenTopics.has(a.topic) && seenTopics.add(a.topic))
      .slice(0, count).map(entry => ({ entry, why: '' }));
  };
  if (entries.length === 0) return [];

  const list = entries.map((a, i) => `${i}. [${a.topic}] ${a.title} (${a.source}, ${a.dateLabel}): ${a.summary}`).join('\n');
  const task = scope === 'today'
    ? `Below are today's stories, numbered. Pick the ${count} that matter most to that audience, most important first: the first pick leads the front page.`
    : `Below are this week's stories, numbered. Pick the ${count} that matter most to that audience, most important first.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        fallbacks: 'default',
        max_tokens: 16000,
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                picks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { id: { type: 'integer' }, why: { type: 'string' } },
                    required: ['id', 'why'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['picks'],
              additionalProperties: false,
            },
          },
        },
        messages: [{
          role: 'user',
          content: `You edit Digital Plumber, a daily briefing for senior network engineers, NetDevOps/automation engineers and AIOps/SRE leads. ${task}

Favour concrete developments in networking, network automation, AIOps, observability and AI infrastructure over general AI-industry news, and substance over press releases. Never pick two stories about the same event. For each pick, write one sentence (under 30 words) on why it matters to a practitioner.

${list}`,
        }],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    if (json.stop_reason === 'refusal') throw new Error('refused');
    const text = json.content.find(b => b.type === 'text')?.text;
    const seen = new Set();
    const picks = JSON.parse(text).picks
      .filter(p => Number.isInteger(p.id) && entries[p.id] && !seen.has(p.id) && seen.add(p.id))
      .slice(0, count)
      .map(p => ({ entry: entries[p.id], why: p.why }));
    if (picks.length === 0) throw new Error('no valid picks');
    console.log(`✓ ${scope === 'today' ? 'Front page' : 'Week in review'}: ${picks.length} top stories picked`);
    return picks;
  } catch (err) {
    console.warn(`  ⚠ Top-story pick (${scope}) failed (${err.message}); using newest story per topic`);
    return fallback();
  }
}

function weekHtml(template, { entries, picks, rangeLabel, buildDate }) {
  const head = (template.match(/<link rel="preconnect"[\s\S]*?<\/style>/) || [''])[0].replace('<!--ARCHIVE_LIST_SCRIPT-->', '');
  const edition = a => `<a href="/archives/${a.date}.html">${esc(a.dateLabel)} edition</a>`;

  const top = picks.map(({ entry: a, why }) => `
      <li><div>
        <p class="kicker label">${esc(topicShort(a.topic))}${a.category ? `<span class="sep">·</span>${esc(a.category)}` : ''}</p>
        <h3><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></h3>
        <p class="summary">${esc(a.summary)}</p>
        ${why ? `<p class="why"><span class="label">Why it matters</span>${esc(why)}</p>` : ''}
        <p class="byline" style="margin-top:0.6rem"><b>${esc(a.source)}</b> · ${edition(a)}</p>
      </div></li>`).join('');

  const byTopic = TOPICS
    .map(t => ({ label: t.label, items: entries.filter(a => a.topic === t.label) }))
    .filter(t => t.items.length > 0);
  const sections = byTopic.map(({ label, items }) => `
    <section class="paper-section">
      <div class="section-head"><h2>${esc(label)}</h2><span class="label">${items.length} ${items.length === 1 ? 'story' : 'stories'}</span></div>
      <ul class="week-list">${items.map(a => `
        <li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><span class="byline">${esc(a.source)} · ${edition(a)}</span></li>`).join('')}
      </ul>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The week in review — Digital Plumber</title>
<meta name="description" content="The week's most important AI networking, AIOps and network automation stories, ${esc(rangeLabel)}.">
<link rel="canonical" href="https://digitalplumber.ca/week.html">
<link rel="alternate" type="application/rss+xml" title="Digital Plumber" href="/feed.xml">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="color-scheme" content="light dark">
${head}
</head>
<body>
<div class="topstrip">
  <div class="wrap topstrip-inner">
    <div class="ear"><a href="/" style="text-decoration:none">← Today's paper</a></div>
    <div class="ear-links"><a href="/feed.xml">RSS</a></div>
  </div>
</div>

<header class="masthead wrap">
  <div class="dateline label"><span>The week in review · ${esc(rangeLabel)}</span><span>${entries.length} stories · updated ${esc(buildDate)}</span></div>
  <h1 class="nameplate"><a href="/">Digital Plumber</a></h1>
  <p class="motto">Seven days of network news, and the stories that mattered most</p>
</header>

<main class="wrap">
  <div class="section-head" style="border-top-width:3px;border-top-style:double"><h2>The ${picks.length} that mattered</h2><span class="label">Picked by the AI editor</span></div>
  <ol class="week-top">${top || '<li><p class="empty-note">No stories this week yet.</p></li>'}
  </ol>
  ${sections}
</main>

<footer class="wrap" id="about">
<div class="colophon">
  <div>
    <h2>About this paper</h2>
    <p>Digital Plumber is an independent daily briefing for network and IT operations practitioners. Stories are AI-curated and AI-summarized, so verify before acting on anything here.</p>
  </div>
  <nav class="label" aria-label="More">
    <a href="/">Today's paper</a>
    <a href="/feed.xml">RSS feed</a>
  </nav>
</div>
</footer>
</body>
</html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('digitalplumber.ca — Daily build starting…\n');

  // Raw-fetch diagnostic that actually triggers web search
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
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'Search the web for latest AI networking news today. Return one sentence.' }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', allowed_callers: ['direct'] }],
      }),
    });
    const diagText = await diagRes.text();
    console.log(`  Diagnostic: HTTP ${diagRes.status} — ${diagText.slice(0, 800)}\n`);
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

  const archivesDir = path.join(__dirname, 'archives');
  if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir);

  const searchIndexPath = path.join(archivesDir, 'search-index.json');
  let searchIndex = [];
  if (fs.existsSync(searchIndexPath)) {
    try { searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8')); } catch {}
  }

  // ── Dedupe: drop articles already published on a previous day, and repeats
  // across topics within this run (re-runs on the same day are not blocked) ──
  const priorUrls = new Set(searchIndex.filter(a => a.date !== dateStr).map(a => a.url));
  const seenUrls = new Set();
  const dedupedItems = rawItems.filter(item => {
    if (priorUrls.has(item.url)) {
      console.log(`  ⤫ Already ran on a previous day: ${item.title.slice(0, 70)}`);
      return false;
    }
    if (seenUrls.has(item.url)) {
      console.log(`  ⤫ Duplicate across topics: ${item.title.slice(0, 70)}`);
      return false;
    }
    seenUrls.add(item.url);
    return true;
  });
  if (dedupedItems.length < rawItems.length) {
    console.log(`Deduped: ${rawItems.length} → ${dedupedItems.length}`);
  }

  if (dedupedItems.length === 0) {
    console.error('All articles were duplicates. Aborting to preserve existing index.html.');
    process.exit(1);
  }

  // Separate podcasts from main news feed
  const podcastItems = dedupedItems.filter(i => i.topicLabel === 'Podcasts & Talks');
  const newsItems = dedupedItems.filter(i => i.topicLabel !== 'Podcasts & Talks');

  // Cap main feed at 25 articles
  const MAX_TOTAL = 35;
  if (newsItems.length > MAX_TOTAL) newsItems.length = MAX_TOTAL;
  newsItems.forEach((item, i) => { item.id = `s-${i + 1}`; });
  console.log(`News: ${newsItems.length}, Podcasts: ${podcastItems.length}`);

  // Read template
  const templatePath = path.join(__dirname, 'template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Error: template.html not found.');
    process.exit(1);
  }

  // ── Load / update archives.json ────────────────────────────────────────────
  const archivesJsonPath = path.join(archivesDir, 'index.json');
  let archives = [];
  if (fs.existsSync(archivesJsonPath)) {
    try { archives = JSON.parse(fs.readFileSync(archivesJsonPath, 'utf8')); } catch {}
  }
  archives = archives.filter(a => a.date !== dateStr);
  archives.unshift({ date: dateStr, label: buildDate, count: newsItems.length });
  fs.writeFileSync(archivesJsonPath, JSON.stringify(archives, null, 2), 'utf8');

  // ── Build / update search index (loaded earlier, before dedupe) ───────────
  searchIndex = searchIndex.filter(a => a.date !== dateStr);
  const todayEntries = newsItems.map(item => ({
    date: dateStr,
    dateLabel: buildDate,
    sourceDate: item.date,
    title: item.title,
    summary: item.summary,
    detail: stripCites(item.detail || ''),
    source: item.source,
    url: item.url,
    topic: item.topicLabel,
    category: item.category || '',
    tags: item.tags || [],
  }));
  searchIndex = [...todayEntries, ...searchIndex];
  // Every archived day stays searchable; the long-form detail is kept only for
  // the most recent 30 days so the index the browser downloads stays small.
  const keepDates = new Set(archives.map(a => a.date));
  const detailDates = new Set(archives.slice(0, 30).map(a => a.date));
  searchIndex = searchIndex
    .filter(a => keepDates.has(a.date))
    .map(a => {
      if (detailDates.has(a.date)) return a;
      const { detail, ...rest } = a;
      return rest;
    });
  fs.writeFileSync(searchIndexPath, JSON.stringify(searchIndex), 'utf8');
  console.log(`✓ archives/search-index.json written (${searchIndex.length} total articles)`);

  // Everything from the last 7 briefing days (sidebar vendor counts, week page, RSS)
  const weekStart = new Date(Date.parse(`${dateStr}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const weekEntries = searchIndex.filter(a => a.date >= weekStart);

  // ── Front page: Claude picks the lead story and the "Inside today" index ──
  const frontCandidates = newsItems.map(item => ({ ...item, topic: item.topicLabel, dateLabel: displayDate(item.date) }));
  const frontPicks = (await pickTopStories(frontCandidates, { count: 5, scope: 'today' }))
    .map(({ entry, why }) => ({ item: newsItems[frontCandidates.indexOf(entry)], why }));
  const lead = frontPicks[0];
  const leadId = lead ? lead.item.id : null;

  const dateline = now.toLocaleDateString('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });

  // ── Build the page HTML (shared by index.html and archive) ────────────────
  function buildHtml(template, { isArchive = false } = {}) {
    const archiveListScript = `<script>window.__archives=${JSON.stringify(archives)};window.__buildDate=${JSON.stringify(dateStr)};</script>`;
    const archiveBanner = isArchive
      ? `<div class="archive-notice">You're reading the ${esc(dateline)} edition. <a href="/">Today's paper →</a></div>`
      : '';

    // Meta description: up to 3 headline fragments, lead first, capped at 155 chars
    const topTitles = frontPicks.slice(0, 3).map(p => p.item.title.replace(/"/g, "'"));
    let metaDesc = `Daily AI-curated briefing for network engineers. Today: ${topTitles.join(' · ')}`;
    if (metaDesc.length > 155) metaDesc = metaDesc.slice(0, 152) + '…';

    const canonicalUrl = isArchive
      ? `https://digitalplumber.ca/archives/${dateStr}.html`
      : 'https://digitalplumber.ca/';

    let html = template;
    html = html.replace('<!--FRONT_PAGE-->', frontPageHtml(lead, frontPicks.slice(1)));
    html = html.replace('<!--SECTIONS-->', sectionsHtml(newsItems, leadId));
    html = html.replace('<!--SECTION_LINKS-->', sectionLinksHtml(newsItems));
    html = html.replace('<!--PODCASTS-->', podcastsHtml(podcastItems));
    html = html.replace(/<!--DATELINE-->/g, esc(dateline));
    html = html.replace(/<!--EDITION_NO-->/g, String(archives.length));
    html = html.replace(/<!--ARTICLE_COUNT-->/g, String(newsItems.length));
    html = html.replace('<!--VENDOR_RADAR-->', vendorRadarHtml(newsItems));
    html = html.replace('<!--INTELLIGENCE_PANEL-->', intelligencePanelHtml(newsItems, weekEntries));
    html = html.replace('<!--ARCHIVE_LIST_SCRIPT-->', archiveListScript);
    html = html.replace('<!--ARCHIVE_NOTICE-->', archiveBanner);
    html = html.replace(/<!--META_DESCRIPTION-->/g, metaDesc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
    html = html.replace(/<!--CANONICAL_URL-->/g, canonicalUrl);
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

  // ── Week in review + RSS ─────────────────────────────────────────────────
  const rangeLabel = `${displayDate(weekStart)} – ${buildDate}`;
  const picks = await pickTopStories(weekEntries, { count: 8, scope: 'week' });
  fs.writeFileSync(path.join(__dirname, 'week.html'), weekHtml(template, { entries: weekEntries, picks, rangeLabel, buildDate }), 'utf8');
  console.log(`✓ week.html written (${weekEntries.length} stories, ${picks.length} top picks)`);

  fs.writeFileSync(path.join(__dirname, 'feed.xml'), rssXml(weekEntries, now.toISOString()), 'utf8');
  console.log(`✓ feed.xml written (${Math.min(weekEntries.length, 100)} items)`);

  // Write sitemap.xml
  const sitemapUrls = [
    { loc: 'https://digitalplumber.ca/', lastmod: dateStr, priority: '1.0', changefreq: 'daily' },
    { loc: 'https://digitalplumber.ca/week.html', lastmod: dateStr, priority: '0.8', changefreq: 'daily' },
    ...archives.map(a => ({
      loc: `https://digitalplumber.ca/archives/${a.date}.html`,
      lastmod: a.date,
      priority: '0.6',
      changefreq: 'never',
    })),
  ];
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log(`✓ sitemap.xml written (${sitemapUrls.length} URLs)`);

  console.log(`\nDone! ${newsItems.length} articles + ${podcastItems.length} podcasts · ${buildDate}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

module.exports = { storyHtml, frontPageHtml, sectionsHtml, podcastsHtml, vendorMentions, vendorRadarHtml, rssXml, weekHtml, pickTopStories, main };
