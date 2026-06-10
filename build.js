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
const TOPICS = [
  { label: 'AI Networking',  query: 'AI networking infrastructure latest news announcements' },
  { label: 'Cisco',          query: 'Cisco networking AI products announcements news' },
  { label: 'Juniper',        query: 'Juniper Networks AI automation Mist news' },
  { label: 'Arista',         query: 'Arista Networks AI cloud networking news' },
  { label: 'SD-WAN',         query: 'SD-WAN AI automation SASE news' },
  { label: 'Automation',     query: 'network automation AI tools DevNet news' },
  { label: 'BGP & Routing',  query: 'BGP routing AI networking developments news' },
  { label: 'Hyperscalers',   query: 'hyperscaler data center networking AI AWS Azure Google news' },
];

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an industry analyst specializing in networking and AI infrastructure. Use web search to find the latest news about the given topic.

Return ONLY a JSON array (no markdown, no preamble, no code fences) with 3-4 news items. Each item must have:
- "title": concise news headline
- "source": the media outlet or company name (e.g. "Cisco Blog", "Network World", "Light Reading", "The Register")
- "date": the article date like "Jun 2026" or "May 2026"
- "category": one of: "Product Launch", "Research", "Industry Trend", "Standards", "Acquisition", "Opinion"
- "summary": 2-3 sentence expert summary from the perspective of a senior network engineer — what it means, the technical implications, why it matters
- "url": the actual source URL

Focus on real, recent developments. Be technically precise.`;

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
    content: `Today is ${today}. Find the 3-4 most important recent news items about: ${topic.query}`
  }];

  try {
    let response = await client.messages.create({
      model: 'claude-sonnet-4-5',
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
        model: 'claude-sonnet-4-5',
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
