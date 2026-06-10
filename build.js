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
// Each topic returns up to MAX_PER_TOPIC items. With 8 topics x up to 4 items,
// we target ~20 articles after deduplication and trimming.
const MAX_PER_TOPIC = 4;

const TOPICS = [
  {
    label: 'Agentic AI & MCP',
    query: 'agentic AI MCP Model Context Protocol multi-agent systems news site:thenewstack.io OR site:mlops.community OR site:anthropic.com OR site:openai.com OR site:deepmind.google OR site:ai.meta.com OR site:networkworld.com OR site:sdxcentral.com OR site:packetpushers.net'
  },
  {
    label: 'AI Ops & Observability',
    query: 'AIOps observability MLOps AI operations Selector.ai Honeycomb Last9 Chronosphere news site:thenewstack.io OR site:mlops.community OR site:honeycomb.io OR site:last9.io OR site:chronosphere.io OR site:networkworld.com OR site:sdxcentral.com OR site:packetpushers.net'
  },
  {
    label: 'Network Automation',
    query: 'network automation NetDevOps Itential Cisco Juniper Arista HPE OpenConfig NANOG news site:packetpushers.net OR site:networkworld.com OR site:sdxcentral.com OR site:thenewstack.io OR site:nanog.org'
  },
  {
    label: 'AI Infrastructure',
    query: 'AI infrastructure networking data center GPU fabric Nvidia Cisco Juniper Arista HPE news site:networkworld.com OR site:sdxcentral.com OR site:thenewstack.io OR site:packetpushers.net OR site:openai.com OR site:deepmind.google'
  },
  {
    label: 'Security Automation',
    query: 'security operations automation AI SASE zero trust Palo Alto Fortinet Versa CrowdStrike news site:networkworld.com OR site:sdxcentral.com OR site:thenewstack.io OR site:packetpushers.net'
  },
  {
    label: 'AI Research & Papers',
    query: 'AI ML research paper networking operations AIOps MLOps agents site:arxiv.org OR site:anthropic.com OR site:openai.com OR site:deepmind.google OR site:ai.meta.com OR site:research.google'
  },
  {
    label: 'MLOps & Platform Engineering',
    query: 'MLOps platform engineering observability AI deployment production machine learning operations news site:mlops.community OR site:thenewstack.io OR site:honeycomb.io OR site:last9.io OR site:chronosphere.io'
  },
  {
    label: 'Industry & Standards',
    query: 'networking AI industry IETF NANOG OpenTelemetry OpenConfig standards acquisitions funding news site:nanog.org OR site:networkworld.com OR site:sdxcentral.com OR site:thenewstack.io OR site:packetpushers.net'
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a technical news curator writing for experienced network and IT operations practitioners — senior network engineers, NetDevOps/automation engineers, and AIOps/SRE leads. They are busy and want to cut to the chase.

Use web search to find real, recent, substantive developments related to the given topic area. Today's date will be provided.

RECENCY: Only include articles published within the last 24 hours. If you cannot find ${MAX_PER_TOPIC} articles from the last 24 hours, expand to the last 48 hours before giving up. Do not include articles older than 48 hours.

PREFERRED SOURCES — weight these heavily:
- AI research: arXiv (cs.AI, cs.LG, cs.NI), Anthropic blog, OpenAI blog, Google DeepMind blog, Meta AI blog, Google Research blog
- MLOps/AIOps practitioners: ML Ops Community (mlops.community), The New Stack, Honeycomb blog, Last9 blog, Chronosphere blog
- Networking practitioners: Packet Pushers, Network World, SDxCentral, NANOG presentations/mailing list
- Standards & open source: IETF working group drafts, OpenTelemetry, OpenConfig, CNCF project blogs

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
- Articles older than 48 hours

Return ONLY a JSON array (no markdown, no preamble, no code fences) with exactly ${MAX_PER_TOPIC} items if they exist — only return fewer if there genuinely are not enough qualifying articles after searching. Each item must have:
- "title": concise, specific headline (avoid vague marketing language)
- "source": the publication, blog, or outlet (e.g. "arXiv", "Packet Pushers", "The New Stack", "ML Ops Community", "Network World")
- "date": the article date like "Jun 2026" or "May 2026"
- "category": one of: "Product Launch", "Research", "Industry Trend", "Standards", "Acquisition", "Opinion", "Community"
- "summary": 2-3 sentences written for a peer practitioner — what actually happened, the technical detail that matters, and why it's worth their attention. No fluff, no marketing tone.
- "url": the actual source URL

Aim for the full ${MAX_PER_TOPIC} items. Search broadly across the preferred sources before concluding there isn't enough news.`;

// ── HTML helpers ──────────────────────────────────────────────────────────────
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
      <div class="card-footer">
        <a class="read-link" href="${esc(item.url)}" target="_blank" rel="noopener">Read more →</a>
        <span class="ai-badge"><span class="ai-dot"></span> AI-summarized</span>
      </div>
    </div>`;
}

// ── Fetch news for a single topic (with retry on 429) ────────────────────────
async function fetchTopicNews(topic, attempt = 1) {
  console.log(`  Fetching: ${topic.label}…`);

  const today = new Date().toISOString().split('T')[0];
  const messages = [{
    role: 'user',
    content: `Today is ${today}. Find ${MAX_PER_TOPIC} substantive news articles published in the last 24 hours (expand to 48 hours only if needed) about: ${topic.query}`
  }];

  try {
    let response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    // Handle multi-turn: model may call web_search one or more times
    // before producing the final text response.
    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < 6) {
      iterations++;
      messages.push({ role: 'assistant', content: response.content });

      // Return empty tool_result for each tool_use block (Anthropic executes
      // web_search server-side; we just need to acknowledge).
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));

      messages.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in final response');

    // Extract the JSON array from the text (model may include stray whitespace)
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`No JSON array found. Raw: ${textBlock.text.slice(0, 200)}`);

    const items = JSON.parse(jsonMatch[0]);
    console.log(`    ✓ ${items.length} articles`);
    return items.map(item => ({ ...item, topicLabel: topic.label }));

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
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('digitalplumber.ca — Daily build starting…\n');

  // Fetch all topics (sequentially to avoid rate limits)
  const allItems = [];
  for (const topic of TOPICS) {
    const items = await fetchTopicNews(topic);
    allItems.push(...items);
    // Pause between topics to stay under the 30k tokens/min rate limit
    await new Promise(r => setTimeout(r, 15000));
  }

  console.log(`\nTotal articles fetched: ${allItems.length}`);

  // Refuse to publish a blank page — keep yesterday's index.html intact.
  if (allItems.length === 0) {
    console.error('No articles fetched. Aborting to preserve existing index.html.');
    process.exit(1);
  }

  // Safety cap — keep the feed tight (10-20 articles) even if a topic
  // returns more than expected.
  const MAX_TOTAL = 20;
  if (allItems.length > MAX_TOTAL) {
    allItems.length = MAX_TOTAL;
    console.log(`Trimmed to ${MAX_TOTAL} articles`);
  }

  // Generate cards HTML
  const cardsHtml = allItems.length > 0
    ? allItems.map(cardHtml).join('\n')
    : '<div style="text-align:center;padding:3rem;color:#6b7280"><p>No articles available today. Check back soon.</p></div>';

  // Build date string
  const buildDate = new Date().toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'America/Toronto',
  });

  // Read template
  const templatePath = path.join(__dirname, 'template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Error: template.html not found.');
    process.exit(1);
  }

  let html = fs.readFileSync(templatePath, 'utf8');

  // Inject content
  html = html.replace('<!--NEWS_CARDS-->', cardsHtml);
  html = html.replace(/<!--BUILD_DATE-->/g, buildDate);
  html = html.replace('<!--ARTICLE_COUNT-->', String(allItems.length));

  // Write output
  const outPath = path.join(__dirname, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');

  console.log(`\nDone! index.html written (${allItems.length} articles, ${buildDate})`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
