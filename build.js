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
    slug: 'aiops',
    about: 'AIOps, observability and AI-assisted operations: monitoring, event correlation, incident response and the platforms behind them.',
    short: 'AI ops',
    maxItems: 8,
    query: 'AIOps observability AI operations LogicMonitor Selector.ai net.ai Honeycomb Last9 Chronosphere Dynatrace Datadog New Relic ServiceNow Exaforce news 2026'
  },
  {
    label: 'Agentic AI & MCP',
    slug: 'agentic-ai',
    about: 'AI agents in operations: agent frameworks, the Model Context Protocol, multi-agent systems and agentic NetOps.',
    short: 'Agentic AI',
    maxItems: 7,
    query: 'agentic AI MCP Model Context Protocol multi-agent systems AI agents networking operations news 2026'
  },
  {
    label: 'Network Automation',
    slug: 'network-automation',
    about: 'NetDevOps, intent-based networking, orchestration and the tools that automate network change.',
    short: 'Networking',
    maxItems: 7,
    query: 'network automation NetDevOps Itential Cisco Juniper Arista HPE OpenConfig NANOG LogicMonitor news 2026'
  },
  {
    label: 'Security Automation',
    slug: 'security',
    about: 'Security operations and automation: SOC tooling, SASE, zero trust, and AI on both sides of attack and defence.',
    short: 'Security',
    maxItems: 3,
    query: 'security operations automation AI SASE zero trust Palo Alto Fortinet Versa CrowdStrike news 2026'
  },
  {
    label: 'AI Infrastructure',
    slug: 'ai-infrastructure',
    about: 'The networks under AI: data center fabrics, optics, GPU clusters and the hardware roadmap.',
    short: 'Infrastructure',
    maxItems: 3,
    query: 'AI infrastructure networking data center GPU fabric Nvidia Cisco Juniper Arista HPE news 2026'
  },
  {
    label: 'Research, Standards & Industry',
    slug: 'research',
    about: 'Research papers, standards work such as IETF, OpenConfig and OpenTelemetry, and notable industry moves.',
    short: 'Research',
    maxItems: 6,
    query: 'AI ML research paper networking AIOps MLOps agents arxiv IETF NANOG OpenTelemetry OpenConfig standards acquisitions funding platform engineering news 2026'
  },
  {
    label: 'AI Model Providers',
    slug: 'ai-models',
    about: 'Model releases and changes from Anthropic, OpenAI, Google and others that affect operations tooling.',
    short: 'Models',
    maxItems: 3,
    query: 'Anthropic Claude OpenAI Google DeepMind Cohere Mistral xAI AI model announcement product launch shutdown 2026'
  },
  {
    label: 'Telco & Cable AI',
    slug: 'telco',
    about: 'How telecom and cable operators are applying AI and automation to their networks.',
    short: 'Telco',
    maxItems: 5,
    query: 'AT&T Verizon Lumen Singtel Bell Canada Rogers Cogeco Comcast Charter Cox Telus BCE telco cable operator AI artificial intelligence automation network deployment 2026'
  },
  {
    label: 'AI Industry & Policy',
    slug: 'industry-policy',
    about: 'AI regulation, policy, funding and enterprise adoption.',
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

// ── Vendors ───────────────────────────────────────────────────────────────────
const TRENDING_TERMS = [
  'MCP', 'Agentic AI', 'AIOps', 'Digital Twin', 'RAG', 'LLM',
  'OpenTelemetry', 'OpenConfig', 'eBPF', 'SASE', 'Zero Trust',
  'NetDevOps', 'MLOps', 'SRE', 'Kubernetes', 'observability',
  'GenAI', 'inference', 'fine-tuning', 'automation', 'agent',
];

// Tracked vendors: the name as it appears in stories, the /vendors/ URL slug,
// and a one-line description for the vendor page.
const VENDORS = [
  { name: 'LogicMonitor', slug: 'logicmonitor', about: 'Hybrid observability platform for infrastructure, network and cloud monitoring, with AI-driven operations features.' },
  { name: 'Honeycomb', slug: 'honeycomb', about: 'Observability platform built around high-cardinality event data and distributed tracing.' },
  { name: 'Last9', slug: 'last9', about: 'Observability platform focused on high-cardinality metrics, logs and traces at scale.' },
  { name: 'Chronosphere', slug: 'chronosphere', about: 'Cloud-native observability platform for metrics, traces and logs, built on Prometheus-compatible tooling.' },
  { name: 'Selector', slug: 'selector-ai', about: 'Selector AI builds an AIOps and network observability platform that uses AI to correlate events across network and IT infrastructure.' },
  { name: 'Dynatrace', slug: 'dynatrace', about: 'Observability and application security platform with AI-assisted root-cause analysis.' },
  { name: 'Datadog', slug: 'datadog', about: 'Cloud monitoring, observability and security platform for infrastructure, applications and logs.' },
  { name: 'New Relic', slug: 'new-relic', about: 'Observability platform covering application performance, infrastructure and logs.' },
  { name: 'Itential', slug: 'itential', about: 'Network automation and orchestration platform for multi-vendor and hybrid infrastructure.' },
  { name: 'CrowdStrike', slug: 'crowdstrike', about: 'Endpoint, cloud and identity security company, best known for its Falcon platform.' },
  { name: 'Palo Alto', slug: 'palo-alto', about: 'Palo Alto Networks: network security, SASE and security operations platforms.' },
  { name: 'Arista', slug: 'arista', about: 'Arista Networks: data center, campus and AI networking switches and the EOS operating system.' },
  { name: 'Juniper', slug: 'juniper', about: 'Juniper Networks, now part of HPE: routing, switching and AI-driven networking including Mist and Apstra.' },
  { name: 'Cisco', slug: 'cisco', about: 'Networking, security and observability company, including Splunk and ThousandEyes.' },
  { name: 'ServiceNow', slug: 'servicenow', about: 'IT service and operations management platform, with AI agents for IT workflows.' },
  { name: 'net.ai', slug: 'net-ai', about: 'Coverage of net.ai in Digital Plumber briefings.' },
];
const TRACKED_VENDORS = VENDORS.map(v => v.name);

// Names match as whole words, case-sensitively ("Cisco" must not match "San
// Francisco", "Selector" must not match a Kubernetes label selector). An
// all-lowercase entry such as 'net.ai' matches in any case.
const VENDOR_PATTERNS = VENDORS.map(v => ({
  ...v,
  vendor: v.name,
  re: new RegExp(
    `(?<![\\w-])${v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
    v.name === v.name.toLowerCase() ? 'i' : ''
  ),
}));

// The text a story is matched against for vendor mentions
function mentionText(a) {
  return [a.title, a.headline, a.summary, a.source, ...(a.tags || [])].join(' ');
}

// [{ vendor, articles }] for every tracked vendor the articles mention, most-mentioned first
function vendorMentions(articles) {
  return VENDOR_PATTERNS
    .map(({ vendor, re }) => ({ vendor, articles: articles.filter(a => re.test(mentionText(a))) }))
    .filter(m => m.articles.length > 0)
    .sort((a, b) => b.articles.length - a.articles.length);
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
- "source_type": what kind of source this is, one of:
    "Primary source" (the originator explaining its own work in substance: standards documents, project release notes, engineering blogs, official documentation, government publications),
    "Research" (academic or industry papers, surveys and studies),
    "Vendor release" (a company's press release or product announcement),
    "Industry news" (reporting by a news publication),
    "Analysis" (commentary, opinion or analysis by an analyst, practitioner or publication)
- "summary": what happened, in two short sentences (under 50 words) for a peer practitioner: the facts and the one technical detail that matters most. No fluff, no marketing tone, and no significance — that goes in why_it_matters. The detail field carries everything else.
- "why_it_matters": one sentence, under 30 words, on what this means specifically for network, infrastructure, NetDevOps or IT operations practitioners. Concrete ("changes how you size X", "a new option for Y"), not generic hype.
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

// ── Story labels ──────────────────────────────────────────────────────────────
const SOURCE_TYPES = ['Primary source', 'Research', 'Vendor release', 'Industry news', 'Analysis'];
const CATEGORY_SOURCE_TYPES = {
  'Research': 'Research', 'Standards': 'Primary source', 'Product Launch': 'Vendor release',
  'Industry Trend': 'Industry news', 'Acquisition': 'Industry news', 'Opinion': 'Analysis', 'Community': 'Analysis',
};

// The source type the curator gave, or one inferred from the category for older stories
function sourceTypeOf(a) {
  const given = SOURCE_TYPES.find(t => t.toLowerCase() === String(a.sourceType || '').trim().toLowerCase());
  return given || CATEGORY_SOURCE_TYPES[a.category] || '';
}

function topicShort(label) {
  return (TOPICS.find(t => t.label === label) || {}).short || label;
}

function topicHref(label) {
  const slug = (TOPICS.find(t => t.label === label) || {}).slug;
  return slug ? `/topics/${slug}/` : '';
}

// Whole sentences from the start of a summary, up to about `maxChars` (always at least one)
function leadSentences(text, maxChars = 200) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/);
  let out = sentences[0] || '';
  for (const s of sentences.slice(1)) {
    if (out.length + s.length + 1 > maxChars) break;
    out += ` ${s}`;
  }
  return out;
}

function metaLine(a, date) {
  const type = sourceTypeOf(a);
  return `<p class="meta"><b>${esc(a.source)}</b> · ${esc(date)}${type ? ` · <span class="stype">${esc(type)}</span>` : ''}</p>`;
}

function whyLine(why) {
  return why ? `<p class="why-line"><span class="label">Why it matters</span> ${esc(why)}</p>` : '';
}

// ── Daily briefing ────────────────────────────────────────────────────────────
// A compact card: headline, source line, what happened, why it matters
function storyHtml(item) {
  const paras = detailParas(item);
  return `
        <article class="story" data-topic="${esc(item.topicLabel)}" data-title="${esc(item.title)}" id="${esc(item.id)}">
          <h3><a href="${esc(item.url)}" target="_blank" rel="noopener" title="${esc(item.title)}">${esc(item.headline || item.title)}</a></h3>
          ${metaLine(item, displayDate(item.date))}
          <p class="summary">${esc(item.summary)}</p>
          ${whyLine(item.why)}
          ${paras ? `<div class="story-detail">${paras}${sourceLink(item)}</div>
          <button type="button" class="more" aria-expanded="false" onclick="toggleDetail(this)">Full briefing ↓</button>` : sourceLink(item)}
        </article>`;
}

// Today's 3 things that matter: short headline, one or two sentences, why it matters, links
function threeThingsHtml(picks) {
  if (picks.length === 0) return '';
  const heading = picks.length === 1 ? "Today's one thing that matters" : `Today's ${picks.length} things that matter`;
  return `
  <section class="three home-extra" aria-labelledby="three-head">
    <div class="section-head"><h2 id="three-head">${heading}</h2><span class="label">Picked by the AI editor</span></div>
    <ol class="three-list">${picks.map(({ item, why }) => {
      const type = sourceTypeOf(item);
      return `
      <li>
        <p class="kicker label">${esc(topicShort(item.topicLabel))}${type ? `<span class="sep">·</span>${esc(type)}` : ''}</p>
        <h3><a href="#${esc(item.id)}">${esc(item.headline || item.title)}</a></h3>
        <p class="three-summary">${esc(leadSentences(item.summary))}</p>
        ${whyLine(item.why || why)}
        <p class="three-links"><a href="#${esc(item.id)}">Full item ↓</a><a href="${esc(item.url)}" target="_blank" rel="noopener">Read at ${esc(item.source)} ↗</a></p>
      </li>`;
    }).join('')}
    </ol>
  </section>`;
}

// Every story, grouped into topic sections in TOPICS order
function sectionsHtml(items) {
  return TOPICS
    .map(topic => ({ topic, stories: items.filter(i => i.topicLabel === topic.label) }))
    .filter(({ stories }) => stories.length > 0)
    .map(({ topic, stories }) => `
    <section class="paper-section" data-topic="${esc(topic.label)}">
      <div class="section-head"><h2>${topic.slug ? `<a href="/topics/${topic.slug}/">${esc(topic.label)}</a>` : esc(topic.label)}</h2><span class="label">${stories.length} ${stories.length === 1 ? 'story' : 'stories'}</span></div>
      <div class="story-grid">${stories.map(storyHtml).join('')}
      </div>
    </section>`).join('');
}

// Topic filter links for the topics in today's briefing
function sectionLinksHtml(items) {
  return TOPICS
    .map(topic => ({ topic, n: items.filter(i => i.topicLabel === topic.label).length }))
    .filter(({ n }) => n > 0)
    .map(({ topic, n }) =>
      `<button class="section-link" data-topic="${esc(topic.label)}" onclick="filterTopic(this, this.dataset.topic)">${esc(topic.short)}<span class="n">${n}</span></button>`)
    .join('\n      ');
}

// Tracked companies in today's briefing, each linking to its stories on the page
function vendorsTodayHtml(articles) {
  const active = vendorMentions(articles);
  if (active.length === 0) {
    return `<p class="empty-note">None of the ${TRACKED_VENDORS.length} tracked companies are in today's briefing.</p>`;
  }
  return active.map(({ vendor, articles: hits }) => {
    const v = VENDORS.find(x => x.name === vendor);
    return `
        <div class="company">
          <div class="company-name"><a href="/vendors/${v.slug}/">${esc(vendor)}</a><span class="n">${hits.length} ${hits.length === 1 ? 'story' : 'stories'}</span></div>
          <ul>${hits.slice(0, 3).map(a => `<li><a href="#${esc(a.id)}">${esc(a.headline || a.title)}</a></li>`).join('')}</ul>
        </div>`;
  }).join('');
}

// ── Trends ────────────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// "2026-09-25" → "Sep 25"
function shortDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Story counts for the 7 days to `today`, the 7 days before that, and the last 30 days
function periodCounts(all, today) {
  const count = (from, to) => all.filter(a => a.date >= from && a.date <= to).length;
  return {
    cur: count(addDays(today, -6), today),
    prev: count(addDays(today, -13), addDays(today, -7)),
    d30: count(addDays(today, -29), today),
  };
}

// Per-vendor coverage across the whole archive; `all` is newest first
function vendorStats(index, today) {
  return VENDOR_PATTERNS.map(v => {
    const all = index.filter(a => v.re.test(mentionText(a)));
    return { kind: 'vendor', label: v.name, about: v.about, href: `/vendors/${v.slug}/`, all, ...periodCounts(all, today) };
  });
}

// Per-topic coverage across the whole archive; `all` is newest first
function topicStats(index, today) {
  return TOPICS.filter(t => t.slug).map(t => {
    const all = index.filter(a => a.topic === t.label);
    return { kind: 'topic', label: t.label, short: t.short, about: t.about, href: `/topics/${t.slug}/`, all, ...periodCounts(all, today) };
  });
}

function trendHtml({ cur, prev }) {
  if (cur > prev) return `<span class="trend up" title="Up from ${prev} the previous 7 days"><span aria-hidden="true">↑</span><span class="sr-only">up from ${prev}</span></span>`;
  if (cur < prev) return `<span class="trend down" title="Down from ${prev} the previous 7 days"><span aria-hidden="true">↓</span><span class="sr-only">down from ${prev}</span></span>`;
  return '';
}

// A dotted-leader tally of 7-day counts with trend arrows, busiest first
function tallyHtml(stats, limit, empty) {
  const rows = stats.filter(s => s.cur > 0 || s.prev > 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev)
    .slice(0, limit);
  if (rows.length === 0) return `<p class="empty-note">${esc(empty)}</p>`;
  return `<ul class="tally">${rows.map(s => `
          <li><a class="tally-name" href="${s.href}">${esc(s.short || s.label)}</a><span class="dots"></span><span class="n">${s.cur}</span><span class="trend-slot">${trendHtml(s)}</span></li>`).join('')}
        </ul>`;
}

// The biggest week-over-week changes in coverage, as sentences
function changesHtml(stats, limit) {
  const stories = n => `${n} ${n === 1 ? 'story' : 'stories'}`;
  const moved = stats.filter(s => Math.abs(s.cur - s.prev) >= 2)
    .sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev) || b.cur - a.cur)
    .slice(0, limit);
  if (moved.length === 0) return '<p class="empty-note">Coverage was steady compared with the previous 7 days.</p>';
  return `<ul class="changes">${moved.map(s => {
    const name = `<a href="${s.href}">${esc(s.label)}</a>${s.kind === 'topic' ? ' coverage' : ''}`;
    const text = s.prev === 0
      ? `${name} appeared in ${stories(s.cur)}, after none the week before`
      : `${name} ${s.cur > s.prev ? 'rose' : 'fell'} to ${stories(s.cur)}, from ${s.prev}`;
    return `
          <li>${trendHtml(s)} ${text}</li>`;
  }).join('')}
        </ul>`;
}

// The most-used trending terms across a set of stories
function termsHtml(articles) {
  const allText = articles.map(a => [a.title, a.summary].join(' ')).join(' ').toLowerCase();
  const termCounts = TRENDING_TERMS
    .map(term => ({ term, count: (allText.match(new RegExp(term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxT = termCounts[0]?.count || 1;
  const terms = termCounts.slice(0, 12)
    .map(({ term, count }) => count >= maxT * 0.4 ? `<span class="hot">${esc(term)}</span>` : esc(term))
    .join(' · ');
  return terms ? `<p class="terms">${terms}</p>` : '';
}

// Homepage: Vendor Radar, then what changed this week and trending topics
function homeIntelHtml(newsItems, vStats, tStats, weekEntries) {
  return `
  <section class="paper-section home-extra" id="vendor-radar">
    <div class="section-head"><h2><a href="/vendors/">Vendor Radar</a></h2><span class="label">Last 7 days · arrows compare with the 7 before</span></div>
    <div class="intel-grid">
      <div>
        <h3 class="label">Most active</h3>
        ${tallyHtml(vStats, 10, 'No tracked vendors in the news in the last two weeks.')}
        <p class="more-link label"><a href="/vendors/">Every tracked vendor →</a></p>
      </div>
      <div>
        <h3 class="label">In today's briefing</h3>
        ${vendorsTodayHtml(newsItems)}
      </div>
    </div>
  </section>

  <section class="paper-section home-extra" id="what-changed">
    <div class="section-head"><h2><a href="/week.html">What changed this week</a></h2><span class="label">Last 7 days vs the 7 before</span></div>
    <div class="intel-grid">
      <div>
        <h3 class="label">Biggest moves</h3>
        ${changesHtml([...tStats, ...vStats], 5)}
        <p class="more-link label"><a href="/week.html">The week in network intelligence →</a></p>
      </div>
      <div>
        <h3 class="label">Trending topics</h3>
        ${tallyHtml(tStats, 9, 'No stories in the last two weeks.')}
        ${termsHtml(weekEntries)}
      </div>
    </div>
  </section>`;
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
      why:     stripCites(item.why_it_matters || ''),
      sourceType: stripCites(item.source_type || ''),
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
      <title>${esc(a.headline || a.title)}</title>
      <link>${esc(a.url)}</link>
      <guid isPermaLink="true">${esc(a.url)}</guid>
      <pubDate>${new Date(`${a.date}T10:00:00Z`).toUTCString()}</pubDate>
      <category>${esc(a.topic)}</category>
      <description>${esc(`<p>${esc(a.summary)}</p>${a.why ? `<p><strong>Why it matters:</strong> ${esc(a.why)}</p>` : ''}<p>Source: ${esc(a.source)} · <a href="https://digitalplumber.ca/archives/${a.date}.html">${esc(a.dateLabel)} briefing</a></p>`)}</description>
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

// ── Editor's picks (daily briefing and week in review) ───────────────────────
// Asks Claude to rank the most important stories and write short newspaper
// headlines. Returns { picks: [{ entry, why }], headlines: Map(entry → headline), watch };
// headlines cover every story for 'today' and only the picks for 'week', and
// `watch` (things to watch next) is only asked for on 'week'.
// Falls back to the newest story per topic, and source titles, if the call fails.
async function editStories(entries, { count, scope }) {
  const fallback = () => {
    const seenTopics = new Set();
    const picks = entries.filter(a => !seenTopics.has(a.topic) && seenTopics.add(a.topic))
      .slice(0, count).map(entry => ({ entry, why: '' }));
    return { picks, headlines: new Map(), watch: [] };
  };
  if (entries.length === 0) return { picks: [], headlines: new Map(), watch: [] };

  const list = entries.map((a, i) => `${i}. [${a.topic}] ${a.title} (${a.source}, ${a.dateLabel}): ${a.summary}`).join('\n');
  const task = scope === 'today'
    ? `Below are today's stories, numbered. Pick the ${count} that matter most to that audience, most important first. Then write a headline for every story, picked or not.`
    : `Below are this week's stories, numbered. Pick the ${count} that matter most to that audience, most important first, and write a headline for each pick. Finally, list 3 things to watch in the coming week: specific follow-ups, decisions, launches or events these stories point to, one sentence each. Ground each in the stories and don't invent dates.`;
  const properties = {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, why: { type: 'string' } },
        required: ['id', 'why'],
        additionalProperties: false,
      },
    },
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, headline: { type: 'string' } },
        required: ['id', 'headline'],
        additionalProperties: false,
      },
    },
    ...(scope === 'week' ? { watch: { type: 'array', items: { type: 'string' } } } : {}),
  };
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
              properties,
              required: Object.keys(properties),
              additionalProperties: false,
            },
          },
        },
        messages: [{
          role: 'user',
          content: `You edit Digital Plumber, a daily briefing for senior network engineers, NetDevOps/automation engineers and AIOps/SRE leads. ${task}

Favour concrete developments in networking, network automation, AIOps, observability and AI infrastructure over general AI-industry news, and substance over press releases. Never pick two stories about the same event. For each pick, write one sentence (under 30 words) on why it matters to a practitioner.

Headlines are for a newspaper front page: at most 10 words, sentence case, plain and factual, one clause (no colons or semicolons), no clickbait or questions. Keep the company or product name when it is the news. Report the finding, not the report: "Most operators are ready to let AI change the network", not "Cisco and Omdia study reveals AI readiness findings".

${list}`,
        }],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    if (json.stop_reason === 'refusal') throw new Error('refused');
    const result = JSON.parse(json.content.find(b => b.type === 'text')?.text);
    const seen = new Set();
    const picks = result.picks
      .filter(p => Number.isInteger(p.id) && entries[p.id] && !seen.has(p.id) && seen.add(p.id))
      .slice(0, count)
      .map(p => ({ entry: entries[p.id], why: p.why }));
    if (picks.length === 0) throw new Error('no valid picks');
    const headlines = new Map(result.headlines
      .filter(h => Number.isInteger(h.id) && entries[h.id] && h.headline.trim())
      .map(h => [entries[h.id], h.headline.trim()]));
    const watch = (result.watch || []).map(w => String(w).trim()).filter(Boolean).slice(0, 3);
    console.log(`✓ ${scope === 'today' ? 'Daily briefing' : 'Week in review'}: ${picks.length} picks, ${headlines.size} headlines${scope === 'week' ? `, ${watch.length} to watch` : ''}`);
    return { picks, headlines, watch };
  } catch (err) {
    console.warn(`  ⚠ Top-story pick (${scope}) failed (${err.message}); using newest story per topic`);
    return fallback();
  }
}

// ── Site pages ────────────────────────────────────────────────────────────────
const SITE = 'https://digitalplumber.ca';
const CORRECTIONS_URL = 'https://github.com/petvan/Digitalplumber.ca/issues/new';
const NAV = [
  ['briefing', 'Daily briefing', '/'],
  ['radar', 'Vendor Radar', '/vendors/'],
  ['week', 'This week', '/week.html'],
  ['archive', 'Archive', '/archive/'],
];

function primaryNavHtml(active) {
  return `<nav class="primary-nav label" aria-label="Primary">${NAV.map(([key, label, href]) =>
    `<a href="${href}"${key === active ? ' class="active" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function ctaHtml() {
  return `
  <section class="cta home-extra" aria-labelledby="cta-head">
    <div>
      <h2 id="cta-head">Get the daily briefing</h2>
      <p>Every edition, as soon as it's published. Add the feed to any RSS reader, or to an RSS-to-email service to get it in your inbox.</p>
    </div>
    <a class="cta-button label" href="/feed.xml">Follow the RSS feed</a>
  </section>`;
}

function footerHtml() {
  return `
<footer class="wrap" id="about">
<div class="colophon">
  <div>
    <h2>About Digital Plumber</h2>
    <p>An independent daily intelligence briefing for network and IT operations practitioners. Each morning an AI editor searches the web, selects the most substantive developments, and writes up what happened and why it matters. It's fully automated with no human review before publishing, so verify before acting on anything here.</p>
    <p><a href="/about.html">How stories are selected</a> · <a href="${CORRECTIONS_URL}" target="_blank" rel="noopener">Report a correction</a></p>
  </div>
  <nav class="label" aria-label="More">
    <a href="/week.html">This week</a>
    <a href="/vendors/">Vendor Radar</a>
    <a href="/topics/">Topics</a>
    <a href="/archive/">Archive</a>
    <a href="/about.html">Methodology</a>
    <a href="/feed.xml">RSS feed</a>
  </nav>
</div>
</footer>`;
}

// Every page except the daily briefing: the briefing's styles, a compact masthead and the primary nav
function pageShell(template, { title, description, pagePath, active, body }) {
  const head = (template.match(/<link rel="preconnect"[\s\S]*?<\/style>/) || [''])[0].replace('<!--ARCHIVE_LIST_SCRIPT-->', '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${pagePath}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Digital Plumber">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${pagePath}">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="Digital Plumber" href="/feed.xml">
<meta name="color-scheme" content="light dark">
${head}
</head>
<body>
<header class="wrap page-masthead">
  <a class="page-nameplate" href="/">Digital Plumber</a>
  <span class="motto">Plumbing the information age</span>
</header>
<div class="wrap"><div class="toolbar">${primaryNavHtml(active)}<a class="label rss-link" href="/feed.xml">RSS</a></div></div>
<main class="wrap page">
${body}
</main>
${footerHtml()}
</body>
</html>
`;
}

// A story in a list on the vendor, topic and week pages
function entryHtml(a, { full = false } = {}) {
  return `
      <li class="entry">
        ${metaLine(a, displayDate(a.sourceDate || a.date))}
        <h3><a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.title)}">${esc(a.headline || a.title)}</a></h3>
        ${full ? `<p class="summary">${esc(a.summary)}</p>${whyLine(a.why)}` : ''}
        <p class="edition label"><a href="/archives/${esc(a.date)}.html">${esc(a.dateLabel)} edition</a></p>
      </li>`;
}

function monthLabel(yyyymm) {
  return new Date(`${yyyymm}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Older stories as compact rows, grouped by month
function historyHtml(entries) {
  const byMonth = new Map();
  entries.forEach(a => {
    const m = a.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(a);
  });
  return [...byMonth].map(([m, list]) => `
    <h3 class="month label">${esc(monthLabel(m))} <span class="n">${list.length}</span></h3>
    <ul class="history">${list.map(a => `
      <li><span class="when">${esc(shortDate(a.date))}</span><a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.title)}">${esc(a.headline || a.title)}</a><span class="src">${esc(a.source)}</span></li>`).join('')}
    </ul>`).join('');
}

// Stories per week for the 12 weeks to `today`, as a bar chart
function activityHtml(all, today) {
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const to = addDays(today, -7 * (11 - i));
    const from = addDays(to, -6);
    return { from, n: all.filter(a => a.date >= from && a.date <= to).length };
  });
  const max = Math.max(1, ...weeks.map(w => w.n));
  return `
    <div class="activity" role="img" aria-label="Stories per week over the last 12 weeks, oldest first: ${weeks.map(w => w.n).join(', ')}">${weeks.map(w => `
      <div class="bar-col" title="Week of ${esc(shortDate(w.from))}: ${w.n} ${w.n === 1 ? 'story' : 'stories'}">
        <span class="bar-n">${w.n || ''}</span>
        <div class="bar-track"><div class="bar" style="height:${Math.round((w.n / max) * 100)}%"></div></div>
        <span class="bar-label">${esc(shortDate(w.from))}</span>
      </div>`).join('')}
    </div>`;
}

// A vendor or topic page: description, counts, weekly activity, latest stories, history
function subjectPageHtml(template, subject, today) {
  const { kind, label, about, href, all, cur, prev, d30 } = subject;
  const latest = all.slice(0, 10);
  const older = all.slice(10);
  const first = all[all.length - 1];
  const section = kind === 'vendor' ? ['Vendor Radar', '/vendors/'] : ['Topics', '/topics/'];
  const body = `
  <p class="kicker label"><a href="${section[1]}">${section[0]}</a></p>
  <h1 class="page-title">${esc(label)}</h1>
  <p class="page-dek">${esc(about)}</p>
  <div class="stat-row">
    <div><span class="stat">${all.length}</span><span class="label">stories in the archive</span></div>
    <div><span class="stat">${cur} ${trendHtml(subject)}</span><span class="label">last 7 days · ${prev} the 7 before</span></div>
    <div><span class="stat">${d30}</span><span class="label">last 30 days</span></div>
    ${first ? `<div><span class="stat">${esc(shortDate(first.date))}</span><span class="label">first covered · ${esc(first.date.slice(0, 4))}</span></div>` : ''}
  </div>
  <section class="paper-section">
    <div class="section-head"><h2>Recent activity</h2><span class="label">Stories per week</span></div>
    ${activityHtml(all, today)}
  </section>
  <section class="paper-section">
    <div class="section-head"><h2>Latest stories</h2><span class="label">${latest.length} most recent</span></div>
    ${latest.length ? `<ol class="entry-list">${latest.map(a => entryHtml(a, { full: true })).join('')}
    </ol>` : `<p class="empty-note">No coverage yet. Stories will appear here as they're published.</p>`}
  </section>
  ${older.length ? `<section class="paper-section">
    <div class="section-head"><h2>Coverage history</h2><span class="label">${older.length} earlier ${older.length === 1 ? 'story' : 'stories'}</span></div>
    ${historyHtml(older)}
  </section>` : ''}`;
  return pageShell(template, {
    title: `${label} — ${section[0]} — Digital Plumber`,
    description: `${label} in Digital Plumber's daily briefings: ${all.length} stories, ${cur} in the last 7 days. ${about}`,
    pagePath: href,
    active: kind === 'vendor' ? 'radar' : '',
    body,
  });
}

// The Vendor Radar and topic index pages: every subject with its counts and trend
function subjectIndexHtml(template, stats, kind) {
  const rows = [...stats].sort((a, b) => b.cur - a.cur || b.d30 - a.d30 || b.all.length - a.all.length);
  const isVendor = kind === 'vendor';
  const body = `
  <p class="kicker label">${isVendor ? 'Tracked companies' : 'Coverage areas'}</p>
  <h1 class="page-title">${isVendor ? 'Vendor Radar' : 'Topics'}</h1>
  <p class="page-dek">${isVendor
    ? `How often each tracked company appears in Digital Plumber's daily briefings. Arrows compare the last 7 days with the 7 before. Select a vendor for its full coverage history.`
    : `The areas Digital Plumber covers each day, and how much each is moving. Arrows compare the last 7 days with the 7 before.`}</p>
  <table class="data-table">
    <thead><tr><th scope="col">${isVendor ? 'Vendor' : 'Topic'}</th><th scope="col" class="num">7 days</th><th scope="col" class="num">30 days</th><th scope="col" class="num col-all">All time</th><th scope="col" class="col-latest">Latest</th></tr></thead>
    <tbody>${rows.map(s => `
      <tr>
        <th scope="row"><a href="${s.href}">${esc(s.label)}</a></th>
        <td class="num">${s.cur} ${trendHtml(s)}</td>
        <td class="num">${s.d30}</td>
        <td class="num col-all">${s.all.length}</td>
        <td class="col-latest">${s.all[0] ? `<a href="${esc(s.all[0].url)}" target="_blank" rel="noopener">${esc(s.all[0].headline || s.all[0].title)}</a> <span class="when">${esc(shortDate(s.all[0].date))}</span>` : '<span class="when">No coverage yet</span>'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ${isVendor ? '<p class="more-link label"><a href="/topics/">Coverage by topic →</a></p>' : '<p class="more-link label"><a href="/vendors/">Coverage by vendor →</a></p>'}`;
  return pageShell(template, {
    title: `${isVendor ? 'Vendor Radar' : 'Topics'} — Digital Plumber`,
    description: isVendor
      ? 'Which networking, observability and security vendors are in the news, with 7-day trends and full coverage history.'
      : 'Coverage trends across AIOps, agentic AI, network automation, security, AI infrastructure and more.',
    pagePath: isVendor ? '/vendors/' : '/topics/',
    active: isVendor ? 'radar' : '',
    body,
  });
}

// Every edition, newest first, grouped by month
function archiveIndexHtml(template, archives) {
  const byMonth = new Map();
  archives.forEach((a, i) => {
    const m = a.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push({ ...a, no: archives.length - i });
  });
  const body = `
  <p class="kicker label">Past editions</p>
  <h1 class="page-title">Archive</h1>
  <p class="page-dek">Every daily briefing since ${esc(archives.length ? displayDate(archives[archives.length - 1].date) : 'launch')}, ${archives.length} editions in all. To find a story, search every edition from the <a href="/">daily briefing</a>.</p>
  ${[...byMonth].map(([m, list]) => `
  <section class="paper-section">
    <div class="section-head"><h2>${esc(monthLabel(m))}</h2><span class="label">${list.length} editions</span></div>
    <ul class="editions">${list.map(a => `
      <li><a href="/archives/${a.date}.html">${esc(new Date(`${a.date}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }))}</a><span class="label">No. ${a.no} · ${a.count} stories</span></li>`).join('')}
    </ul>
  </section>`).join('')}`;
  return pageShell(template, {
    title: 'Archive — Digital Plumber',
    description: `Every Digital Plumber daily briefing, ${archives.length} editions of AI networking, AIOps and network automation news.`,
    pagePath: '/archive/',
    active: 'archive',
    body,
  });
}

function aboutHtml(template) {
  const body = `
  <p class="kicker label">Methodology</p>
  <h1 class="page-title">How Digital Plumber works</h1>
  <p class="page-dek">Digital Plumber is an AI-curated daily intelligence briefing for the people who run networks: network engineers, NetDevOps and automation engineers, and AIOps and SRE leads. This page explains where stories come from and how they're chosen.</p>
  <div class="prose">
    <h2>What we monitor</h2>
    <p>Each morning the build searches the web across about ten coverage areas: AIOps and observability, agentic AI and MCP, network automation, security automation, AI infrastructure, research and standards, AI model providers, telco and cable, and AI industry and policy. It weights practitioner sources: research papers such as arXiv, standards bodies and projects such as the IETF, NANOG, OpenConfig and OpenTelemetry, practitioner publications such as Packet Pushers, Network World and The New Stack, and engineering blogs with real technical depth.</p>

    <h2>How stories are selected</h2>
    <p>Only stories published in the last 72 hours qualify, and anything older or undated is dropped automatically. The editor favours concrete developments and technical substance over marketing, and skips search-engine filler and pure sales content. An AI editor then ranks the day's stories to pick the three that matter most, and writes the short headlines.</p>

    <h2>How duplicates are handled</h2>
    <p>A story that already appeared in an earlier edition is dropped, and so is the same link turning up under two topics on the same day. Duplicates are matched by link, so the same event reported by two different outlets can occasionally appear twice.</p>

    <h2>How vendor announcements are treated</h2>
    <p>Vendor news is included when it has technical substance, and labelled <strong>Vendor release</strong> so you can weigh it accordingly. Press releases without technical detail are deprioritized. Vendor Radar counts every story that names a tracked vendor, whoever published it.</p>

    <h2>Source labels</h2>
    <p>Each story carries a source type: <strong>Primary source</strong> (the originator explaining its own work: standards, release notes, engineering blogs, official documentation), <strong>Research</strong> (papers, surveys and studies), <strong>Vendor release</strong> (a company's own announcement), <strong>Industry news</strong> (reporting by a publication) or <strong>Analysis</strong> (commentary and opinion). Older stories are labelled from their original category.</p>

    <h2>How AI is used</h2>
    <p>Anthropic's Claude models run every step: searching and reading sources, writing each story's summary of what happened, its "why it matters" line and the longer briefing, then picking the day's top stories and the week's highlights. Summaries are based on what the source says; they can still contain mistakes.</p>

    <h2>Human review</h2>
    <p>There is none before publishing. The briefing is fully automated and published each morning as the AI produced it, so check the original source before acting on anything here.</p>

    <h2>Corrections</h2>
    <p>If something is wrong, <a href="${CORRECTIONS_URL}" target="_blank" rel="noopener">open an issue on GitHub</a> with a link to the story and what needs fixing.</p>
  </div>`;
  return pageShell(template, {
    title: 'How Digital Plumber works — Methodology',
    description: 'How Digital Plumber selects, summarizes and labels its daily AI networking intelligence briefing, and how to report corrections.',
    pagePath: '/about.html',
    active: '',
    body,
  });
}

// The week in network intelligence
function weekHtml(template, { entries, picks, headlines, watch, vStats, tStats, rangeLabel }) {
  const topicCount = new Set(entries.map(a => a.topic)).size;
  const top = picks.map(({ entry: a, why }) => `
      <li><div>
        <p class="kicker label">${esc(topicShort(a.topic))}${sourceTypeOf(a) ? `<span class="sep">·</span>${esc(sourceTypeOf(a))}` : ''}</p>
        <h3><a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.title)}">${esc(headlines.get(a) || a.headline || a.title)}</a></h3>
        <p class="summary">${esc(leadSentences(a.summary, 260))}</p>
        ${whyLine(why || a.why)}
        <p class="meta" style="margin-top:0.5rem"><b>${esc(a.source)}</b> · <a href="/archives/${a.date}.html">${esc(a.dateLabel)} edition</a></p>
      </div></li>`).join('');

  const byTopic = TOPICS
    .map(t => ({ t, items: entries.filter(a => a.topic === t.label) }))
    .filter(({ items }) => items.length > 0);

  const body = `
  <p class="kicker label">This week · ${esc(rangeLabel)}</p>
  <h1 class="page-title">The week in network intelligence</h1>
  <p class="page-dek">${entries.length} stories across ${topicCount} topics: the developments that mattered, who was busy, what moved and what to watch next.</p>

  <section class="paper-section">
    <div class="section-head"><h2>${picks.length} developments that mattered</h2><span class="label">Picked by the AI editor</span></div>
    <ol class="week-top">${top || '<li><p class="empty-note">No stories this week yet.</p></li>'}
    </ol>
  </section>

  <section class="paper-section">
    <div class="section-head"><h2>Who was busy, and what moved</h2><span class="label">Last 7 days vs the 7 before</span></div>
    <div class="intel-grid three-col">
      <div>
        <h3 class="label">Most active vendors</h3>
        ${tallyHtml(vStats, 8, 'No tracked vendors in the news this week.')}
      </div>
      <div>
        <h3 class="label">Topic momentum</h3>
        ${tallyHtml(tStats, 9, 'No stories this week.')}
        ${termsHtml(entries)}
      </div>
      <div>
        <h3 class="label">Biggest changes</h3>
        ${changesHtml([...tStats, ...vStats], 5)}
      </div>
    </div>
  </section>

  ${watch.length ? `<section class="paper-section">
    <div class="section-head"><h2>What to watch</h2><span class="label">From the AI editor</span></div>
    <ul class="watch">${watch.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
  </section>` : ''}

  ${byTopic.map(({ t, items }) => `
  <section class="paper-section">
    <div class="section-head"><h2>${t.slug ? `<a href="/topics/${t.slug}/">${esc(t.label)}</a>` : esc(t.label)}</h2><span class="label">${items.length} ${items.length === 1 ? 'story' : 'stories'}</span></div>
    <ul class="week-list">${items.map(a => `
      <li><a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.title)}">${esc(a.headline || a.title)}</a><span class="meta">${esc(a.source)}${sourceTypeOf(a) ? ` · <span class="stype">${esc(sourceTypeOf(a))}</span>` : ''} · <a href="/archives/${a.date}.html">${esc(a.dateLabel)}</a></span></li>`).join('')}
    </ul>
  </section>`).join('')}
  ${ctaHtml()}`;

  return pageShell(template, {
    title: 'The week in network intelligence — Digital Plumber',
    description: `The week's most important AI networking, AIOps and network automation developments, ${rangeLabel}: top stories, vendor activity, topic momentum and what to watch.`,
    pagePath: '/week.html',
    active: 'week',
    body,
  });
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

  // ── Daily briefing: Claude picks today's 3 things that matter and writes headlines ──
  const candidates = newsItems.map(item => ({ ...item, topic: item.topicLabel, dateLabel: displayDate(item.date) }));
  const dailyEdit = await editStories(candidates, { count: 3, scope: 'today' });
  candidates.forEach((entry, i) => {
    const headline = dailyEdit.headlines.get(entry);
    if (headline) newsItems[i].headline = headline;
  });
  const topPicks = dailyEdit.picks.map(({ entry, why }) => ({ item: newsItems[candidates.indexOf(entry)], why }));

  // ── Build / update search index (loaded earlier, before dedupe) ───────────
  searchIndex = searchIndex.filter(a => a.date !== dateStr);
  const todayEntries = newsItems.map(item => ({
    date: dateStr,
    dateLabel: buildDate,
    sourceDate: item.date,
    title: item.title,
    ...(item.headline ? { headline: item.headline } : {}),
    summary: item.summary,
    ...(item.why ? { why: item.why } : {}),
    detail: stripCites(item.detail || ''),
    source: item.source,
    url: item.url,
    topic: item.topicLabel,
    category: item.category || '',
    ...(sourceTypeOf(item) ? { sourceType: sourceTypeOf(item) } : {}),
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

  // ── Coverage trends across the archive ─────────────────────────────────────
  const weekStart = addDays(dateStr, -6);
  const weekEntries = searchIndex.filter(a => a.date >= weekStart);
  const vStats = vendorStats(searchIndex, dateStr);
  const tStats = topicStats(searchIndex, dateStr);

  const dateline = now.toLocaleDateString('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
  const updatedAt = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
  const topicCount = new Set(newsItems.map(i => i.topicLabel)).size;
  const statusLine = `${newsItems.length} ${newsItems.length === 1 ? 'story' : 'stories'} · ${topicCount} ${topicCount === 1 ? 'topic' : 'topics'} · Updated ${updatedAt} ET`;

  // ── Build the page HTML (shared by index.html and archive) ────────────────
  function buildHtml(template, { isArchive = false } = {}) {
    const buildDateScript = `<script>window.__buildDate=${JSON.stringify(dateStr)};</script>`;
    const archiveBanner = isArchive
      ? `<div class="archive-notice">You're reading the ${esc(dateline)} edition. <a href="/">Today's briefing →</a></div>`
      : '';

    // Meta description: the top headlines, capped at 155 chars
    const topTitles = topPicks.map(p => (p.item.headline || p.item.title).replace(/"/g, "'"));
    let metaDesc = `AI-curated intelligence for people who run networks. Today: ${topTitles.join(' · ')}`;
    if (metaDesc.length > 155) metaDesc = metaDesc.slice(0, 152) + '…';

    const canonicalUrl = isArchive
      ? `https://digitalplumber.ca/archives/${dateStr}.html`
      : 'https://digitalplumber.ca/';

    let html = template;
    html = html.replace('<!--PRIMARY_NAV-->', primaryNavHtml(isArchive ? 'archive' : 'briefing'));
    html = html.replace('<!--THREE_THINGS-->', threeThingsHtml(topPicks));
    html = html.replace('<!--STATUS_LINE-->', esc(statusLine));
    html = html.replace('<!--SECTION_LINKS-->', sectionLinksHtml(newsItems));
    html = html.replace('<!--SECTIONS-->', sectionsHtml(newsItems));
    html = html.replace('<!--PODCASTS-->', podcastsHtml(podcastItems));
    html = html.replace('<!--HOME_INTEL-->', homeIntelHtml(newsItems, vStats, tStats, weekEntries));
    html = html.replace('<!--CTA-->', ctaHtml());
    html = html.replace('<!--FOOTER-->', footerHtml());
    html = html.replace(/<!--DATELINE-->/g, esc(dateline));
    html = html.replace(/<!--EDITION_NO-->/g, String(archives.length));
    html = html.replace('<!--ARCHIVE_LIST_SCRIPT-->', buildDateScript);
    html = html.replace('<!--ARCHIVE_NOTICE-->', archiveBanner);
    html = html.replace(/<!--META_DESCRIPTION-->/g, esc(metaDesc));
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

  // ── Week in network intelligence + RSS ───────────────────────────────────
  const rangeLabel = `${displayDate(weekStart)} – ${buildDate}`;
  const { picks, headlines, watch } = await editStories(weekEntries, { count: 5, scope: 'week' });
  fs.writeFileSync(path.join(__dirname, 'week.html'), weekHtml(template, { entries: weekEntries, picks, headlines, watch, vStats, tStats, rangeLabel }), 'utf8');
  console.log(`✓ week.html written (${weekEntries.length} stories, ${picks.length} top picks, ${watch.length} to watch)`);

  fs.writeFileSync(path.join(__dirname, 'feed.xml'), rssXml(weekEntries, now.toISOString()), 'utf8');
  console.log(`✓ feed.xml written (${Math.min(weekEntries.length, 100)} items)`);

  // ── Vendor, topic, archive and methodology pages ─────────────────────────
  const writePage = (relPath, html) => {
    const file = path.join(__dirname, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html, 'utf8');
  };
  writePage('vendors/index.html', subjectIndexHtml(template, vStats, 'vendor'));
  vStats.forEach(v => writePage(`${v.href.slice(1)}index.html`, subjectPageHtml(template, v, dateStr)));
  writePage('topics/index.html', subjectIndexHtml(template, tStats, 'topic'));
  tStats.forEach(t => writePage(`${t.href.slice(1)}index.html`, subjectPageHtml(template, t, dateStr)));
  writePage('archive/index.html', archiveIndexHtml(template, archives));
  writePage('about.html', aboutHtml(template));
  console.log(`✓ ${vStats.length} vendor pages, ${tStats.length} topic pages, archive and methodology written`);

  // Write sitemap.xml
  const page = (loc, priority, changefreq) => ({ loc: `${SITE}${loc}`, lastmod: dateStr, priority, changefreq });
  const sitemapUrls = [
    page('/', '1.0', 'daily'),
    page('/week.html', '0.8', 'daily'),
    page('/vendors/', '0.8', 'daily'),
    page('/topics/', '0.7', 'daily'),
    ...vStats.map(v => page(v.href, '0.7', 'daily')),
    ...tStats.map(t => page(t.href, '0.7', 'daily')),
    page('/archive/', '0.6', 'daily'),
    page('/about.html', '0.4', 'monthly'),
    ...archives.map(a => ({
      loc: `${SITE}/archives/${a.date}.html`,
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

module.exports = { storyHtml, sectionsHtml, vendorMentions, vendorStats, topicStats, rssXml, weekHtml, editStories, main };
