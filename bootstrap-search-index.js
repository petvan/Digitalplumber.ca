// One-time script: builds archives/search-index.json from existing archive HTML files
const fs = require('fs');
const path = require('path');

const archivesDir = path.join(__dirname, 'archives');
const indexJson = JSON.parse(fs.readFileSync(path.join(archivesDir, 'index.json'), 'utf8'));

const entries = [];

for (const { date, label } of indexJson) {
  const htmlPath = path.join(archivesDir, `${date}.html`);
  if (!fs.existsSync(htmlPath)) { console.log(`  skip ${date} (no file)`); continue; }
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Extract cards from newsGrid
  const cardRegex = /<div class="card" data-topic="([^"]*)">([\s\S]*?)<\/div><!-- \/.card -->|<div class="card" data-topic="([^"]*)">([\s\S]*?)(?=<div class="card"|<\/div>\s*<\/div>\s*<div class="no-results")/g;

  // Simpler: split on card boundaries
  const cardBlocks = html.split(/<div class="card" data-topic="/).slice(1);

  for (const block of cardBlocks) {
    const topicMatch = block.match(/^([^"]*)">/);
    const topic = topicMatch ? topicMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';

    const titleMatch = block.match(/<h2>([\s\S]*?)<\/h2>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim() : '';

    const summaryMatch = block.match(/class="card-summary">([\s\S]*?)<\/p>/);
    const summary = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim() : '';

    const sourceMatch = block.match(/class="source-tag">([\s\S]*?)<\/span>/);
    const source = sourceMatch ? sourceMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').trim() : '';

    const urlMatch = block.match(/class="read-link" href="([^"]*)"/);
    const url = urlMatch ? urlMatch[1].replace(/&amp;/g,'&') : '';

    if (title && url) {
      entries.push({ date, dateLabel: label, title, summary, source, url, topic, tags: [] });
    }
  }
  console.log(`  ${date}: ${cardBlocks.length} cards`);
}

const outPath = path.join(archivesDir, 'search-index.json');
fs.writeFileSync(outPath, JSON.stringify(entries), 'utf8');
console.log(`\nWrote ${entries.length} entries to archives/search-index.json`);
