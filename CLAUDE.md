# Digital Plumber (digitalplumber.ca)

A daily AI-curated intelligence briefing for network and IT operations practitioners. A GitHub Action runs `build.js` every morning; it asks Claude to search and write up the news, renders static pages from `template.html`, commits them to `main`, and Netlify deploys the push. The same build creates the day's email in Buttondown.

Full setup, accounts, DNS and disaster recovery: `docs/RECOVERY.md`.

## How the code fits together

- `build.js` is the whole pipeline: topic searches (`TOPICS`), dedupe, editor picks and headlines (`editStories`), the homepage and dated archive page (from `template.html`), the week page, vendor and topic pages, archive and methodology pages, RSS, sitemap, and the email.
- `template.html` holds all CSS and the homepage markup; every other page reuses its `<style>` block through `pageShell()` in build.js.
- Generated files are committed: `index.html`, `week.html`, `feed.xml`, `about.html`, `sitemap.xml`, `archive/`, `vendors/`, `topics/`, `archives/`. Change build.js or template.html, not these; they're overwritten on the next build. Only patch a generated file to fix the live site immediately, and make the same change in the source.
- `archives/search-index.json` is the story database (every edition since June 11, 2026); vendor, topic and trend pages are computed from it. `archives/index.json` lists editions. `archives/emails.json` records which dates already had an email.
- Topics renamed later keep their history through `aliases` in `TOPICS`; look labels up with `topicFor()`, not by comparing strings.

## Working rules

- Always `git pull --rebase origin main` before pushing: the daily bot commits to `main` every day, often more than once.
- Every build (scheduled or manual) calls the Anthropic API and costs money, replaces today's edition with a fresh fetch, and, with `BUTTONDOWN_MODE=send`, sends today's email if it hasn't gone out yet. Check `archives/emails.json` before starting a build by hand.
- Test changes offline first: `node tools/offline-build.js` builds a throwaway copy with all network calls stubbed. This Mac has no Node; use `ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" tools/offline-build.js`.
- Workflow runs on branches other than `main` build fine but fail at the commit step (shallow checkout), so their pages are lost; use them only to read real API output in the logs.
- The repo is public: never commit secret values, API keys or subscriber data.
- Claude API calls use raw `fetch`; the curator uses `claude-haiku-4-5` with web search, the editor uses `claude-opus-5` with structured output and `fallbacks: "default"`.
