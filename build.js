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
// Each topic returns up to MAX_PER_TOPIC items. With 5 topics x up to 4 items,
// total output stays in the 10-20 article range the audience wants.
const MAX_PER_TOPIC = 4;

const TOPICS = [
  {
    label: 'Agentic AI & MCP',
    query: 'agentic AI networking operations MCP Model Context Protocol multi-agent systems news 2026'
  },
  {
    label: 'AI Ops & Observability',
    query: 'AIOps observability Dynatrace Datadog Splunk New Relic ServiceNow Selector.ai Exaforce AI operations news 2026'
  },
  {
    label: 'Network Automation',
    query: 'network automation NetDevOps Itential Cisco Juniper Arista HPE automation Packet Pushers John Capobianco news 2026'
  },
  {
    label: 'AI Infrastructure',
    query: 'AI infrastructure networking Cisco Juniper Arista HPE data center AI networking news 2026'
  },
  {
    label: 'Security Automation',
    query: 'security operations automation AI Palo Alto Fortinet Versa SASE AI-driven security news 2026'
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a technical news curator writing for experienced network and IT operations practitioners — senior network engineers, NetDevOps/automation engineers, and AIOps/SRE leads. They are busy and want to cut to the chase.

Use web search to find real, recent, substantive developments related to the given topic area. Today's date will be provided.

WHAT TO PRIORITIZE:
- Actual news: product releases with real technical detail, research papers, protocol/standards developments, open-source projects, conference talks (e.g. AutoCon, NANOG, Cisco Live), practitioner blog posts, and credible industry analysis.
- Practitioner and community voices: Packet Pushers, AutoCon, personal/technical blogs (e.g. John Capobianco, other network automation engineers), The New Stack, and similar.
- Vendors of interest include (but are not limited to): Cisco, Juniper, HPE/Aruba, Arista, Palo Alto Networks, Fortinet, Versa, Itential, ServiceNow, Dynatrace, Datadog, Splunk, New Relic, and emerging AI-ops/agentic-ops vendors like Selector.ai and Exaforce. Adjacent and competing vendors in these same spaces (networking, security, observability, AIOps, automation) are also fair game — the named vendors are anchors, not an exhaustive list.
- Core themes: agentic AI and the agentic ecosystem (including MCP and agent-to-agent protocols), AI/ML applied to networking and IT operations, automation and orchestration (NetDevOps), and AIOps.

WHAT TO AVOID OR DEPRIORITIZE:
- Generic vendor press releases or marketing copy with no real technical substance ("Company X is excited to announce...").
- Pure sales/partnership announcements unless they signal a meaningful technical or market shift.
- Content unrelated to AI/ML, agentic systems, automation, or operations.

Return ONLY a JSON array (no markdown, no preamble, no code fences) with up to ${MAX_PER_TOPIC} of the BEST items for this topic — fewer is fine if there isn't enough substantive news. Each item must have:
- "title": concise, specific headline (avoid vague marketing language)
- "source": the publication, blog, or company (e.g. "Packet Pushers", "Cisco Blog", "John Capobianco's Blog", "The New Stack")
- "date": the article date like "Jun 2026" or "May 2026"
- "category": one of: "Product Launch", "Research", "Industry Trend", "Standards", "Acquisition", "Opinion", "Community"
- "summary": 2-3 sentences written for a peer practitioner — what actually happened, the technical detail that matters, and why it's worth their attention. No fluff, no marketing tone.
- "url": the actual source URL

Be selective. Quality and technical substance over quantity.`;

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

// ── Fetch news for a single topic ─────────────────────────────────────────────
async function fetchTopicNews(topic) {
  console.log(`  Fetching: ${topic.label}…`);

  const today = new Date().toISOString().split('T')[0];
  const messages = [{
    role: 'user',
    content: `Today is ${today}. Find up to ${MAX_PER_TOPIC} of the most important recent, substantive news items about: ${topic.query}`
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
    // Small pause between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nTotal articles fetched: ${allItems.length}`);

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
