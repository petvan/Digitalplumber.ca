/**
 * Offline build: runs build.js end to end on a throwaway copy of the repo,
 * with every network call stubbed. No Anthropic charges, no emails, and the
 * real repo is never touched.
 *
 * The stubbed "curator" returns the latest edition's real stories (from
 * archives/search-index.json) as if they were published today, so pages render
 * with realistic content. The stubbed "editor" picks the first stories and
 * reuses stored headlines. A Buttondown call, if the build makes one, is saved
 * to offline-email.json and offline-email.html instead of being sent.
 *
 * Usage (from the repo root):
 *   node tools/offline-build.js
 *   BUTTONDOWN_USERNAME=example BUTTONDOWN_API_KEY=offline node tools/offline-build.js   # also exercise sign-up forms and email
 *
 * No Node installed? VS Code's bundled runtime works:
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" tools/offline-build.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalplumber-offline-'));

// Copy the repo, minus git history and local tooling
fs.cpSync(repo, out, {
  recursive: true,
  filter: src => !/^(\.git|node_modules|\.claude)([/\\]|$)/.test(path.relative(repo, src)),
});

// When testing the email path, forget which days already had an email in this copy
if (process.env.BUTTONDOWN_API_KEY) fs.rmSync(path.join(out, 'archives', 'emails.json'), { force: true });

// build.js requires the SDK but calls the API with fetch, so an empty stand-in is enough
const sdkDir = path.join(out, 'node_modules', '@anthropic-ai', 'sdk');
fs.mkdirSync(sdkDir, { recursive: true });
fs.writeFileSync(path.join(sdkDir, 'index.js'), 'module.exports = class Anthropic {};\n');

process.env.ANTHROPIC_API_KEY = 'offline';
global.setTimeout = fn => setImmediate(fn); // skip the build's pauses between topics

const build = require(path.join(out, 'build.js'));
const { TOPICS, topicFor } = build;

const index = JSON.parse(fs.readFileSync(path.join(out, 'archives', 'search-index.json'), 'utf8'));
const latestDate = index[0]?.date;
const latest = index.filter(a => a.date === latestDate);
const byQuery = new Map(TOPICS.map(t => [t.query, t]));
const headlineOf = new Map(latest.filter(a => a.headline).map(a => [a.title, a.headline]));
const today = new Date().toISOString().slice(0, 10);

const reply = obj => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const text = t => reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });

global.fetch = async (url, opts = {}) => {
  // Buttondown: record the email instead of sending it
  if (String(url).includes('buttondown.com')) {
    const body = JSON.parse(opts.body);
    fs.writeFileSync(path.join(out, 'offline-email.json'), JSON.stringify(body, null, 2));
    fs.writeFileSync(path.join(out, 'offline-email.html'),
      `<meta charset="utf-8"><div style="max-width:640px;margin:2rem auto;font-family:Georgia,serif;line-height:1.55">${body.body}</div>`);
    return { ok: true, status: 201, json: async () => ({ id: 'em_offline' }) };
  }

  const body = JSON.parse(opts.body || '{}');
  const content = body.messages?.[0]?.content || '';

  // Editor picks (daily and weekly): the first stories, with any stored headlines
  if (body.output_config) {
    const lines = content.split('\n').filter(l => /^\d+\. \[/.test(l));
    const count = Number((content.match(/Pick the (\d+)/) || [])[1] || 3);
    const ids = lines.slice(0, count).map(l => Number(l.split('.')[0]));
    const headlines = lines.map(l => {
      const title = [...headlineOf.keys()].find(t => l.includes(t));
      return title ? { id: Number(l.split('.')[0]), headline: headlineOf.get(title) } : null;
    }).filter(Boolean);
    const isWeek = content.includes("this week's stories");
    return text(JSON.stringify({
      picks: ids.map(id => ({ id, why: 'Offline stand-in for the editor’s note.' })),
      headlines,
      ...(isWeek ? { watch: ['Offline stand-in: something to watch next week.'] } : {}),
    }));
  }

  // Curator (one call per topic): the latest edition's stories for that topic, dated today.
  // URLs get a suffix so the build doesn't drop them as already published.
  if (body.system) {
    const query = content.split('about: ')[1]?.split(' after:')[0];
    const topic = byQuery.get(query);
    const stories = latest.filter(a => topicFor(a.topic) === topic).map(a => ({
      title: a.title, summary: a.summary, detail: a.detail || '', source: a.source,
      url: `${a.url}#offline`, date: today, category: a.category || '', tags: a.tags || [],
      why_it_matters: a.why || '', source_type: a.sourceType || '',
    }));
    return text(JSON.stringify(stories));
  }

  return reply({ content: [] }); // the build's diagnostic call
};

build.main().then(() => {
  console.log(`\nOffline build written to ${out}`);
  if (fs.existsSync(path.join(out, 'offline-email.html'))) console.log(`Email preview: ${path.join(out, 'offline-email.html')}`);
  console.log(`View it: python3 -m http.server 8000 --directory ${out}`);
});
