// Backfill: adds any archives/YYYY-MM-DD.html day that is missing from
// archives/index.json and archives/search-index.json. Existing entries are left
// untouched, so it is safe to re-run.  Usage: node bootstrap-search-index.js
const fs = require('fs');
const path = require('path');

const archivesDir = path.join(__dirname, 'archives');
const indexPath = path.join(archivesDir, 'index.json');
const searchPath = path.join(archivesDir, 'search-index.json');

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; } };
const archives = readJson(indexPath);
const searchIndex = readJson(searchPath);

const decode = s => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .trim();

const label = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-CA', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

const known = new Set(archives.map(a => a.date));
const files = fs.readdirSync(archivesDir).filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f));

let addedDays = 0, addedEntries = 0;
for (const file of files) {
  const date = file.slice(0, 10);
  if (known.has(date)) continue;
  // Scripts hold card templates of their own, so drop them before parsing
  const html = fs.readFileSync(path.join(archivesDir, file), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dateLabel = label(date);

  // Only the main news grid — podcast cards use a different class
  const blocks = html.split('<div class="card" data-topic="').slice(1);
  const entries = blocks.map(block => {
    const pick = re => (block.match(re) || [])[1];
    return {
      date,
      dateLabel,
      title: decode(pick(/<h2>([\s\S]*?)<\/h2>/)),
      summary: decode(pick(/class="card-summary">([\s\S]*?)<\/p>/)),
      source: decode(pick(/class="source-tag">([\s\S]*?)<\/span>/)),
      url: decode(pick(/class="source-link" href="([^"]*)"/) || pick(/class="read-link" href="([^"]*)"/)),
      topic: decode(pick(/^([^"]*)"/)),
      category: decode(pick(/class="card-category"[^>]*>([\s\S]*?)<\/span>/)),
      tags: [...block.split(/class="card-footer"/)[0].matchAll(/class="card-tag">([\s\S]*?)<\/span>/g)].map(m => decode(m[1])),
    };
  }).filter(e => e.title && e.url);

  archives.push({ date, label: dateLabel, count: entries.length });
  searchIndex.push(...entries);
  addedDays++;
  addedEntries += entries.length;
  console.log(`  + ${date}: ${entries.length} articles`);
}

archives.sort((a, b) => b.date.localeCompare(a.date));
searchIndex.sort((a, b) => b.date.localeCompare(a.date));
fs.writeFileSync(indexPath, JSON.stringify(archives, null, 2), 'utf8');
fs.writeFileSync(searchPath, JSON.stringify(searchIndex), 'utf8');
console.log(`\nAdded ${addedDays} days / ${addedEntries} articles. Index now covers ${archives.length} days, ${searchIndex.length} articles.`);
