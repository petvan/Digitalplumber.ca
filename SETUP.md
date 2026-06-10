# digitalplumber.ca — Setup Guide

Follow these steps once and your site will update itself every morning with fresh networking news.

---

## Step 1 — Get an Anthropic API Key

1. Go to https://console.anthropic.com
2. Sign in (or create a free account)
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-…`) — you'll need it in Step 4

> **Cost estimate:** The daily build fetches 8 topics × ~3 articles each. Expect roughly $0.10–0.30 USD per day depending on web search usage.

---

## Step 2 — Create a GitHub Repository

1. Go to https://github.com/new
2. Name it `digitalplumber` (or anything you like)
3. Set it to **Public** (required for free Netlify deploys)
4. Click **Create repository**

### Upload the files

Upload all files from this folder into the repo root. The structure should look like:

```
digitalplumber/
├── .github/
│   └── workflows/
│       └── daily-build.yml
├── template.html
├── build.js
├── package.json
└── index.html          ← will be auto-created on first build
```

The easiest way: drag all files onto the GitHub repo's file list and click **Commit changes**.

> **Note:** You need to also create a blank `index.html` to start. Just upload a copy of `template.html` renamed to `index.html` — the first automated build will replace it with real content.

---

## Step 3 — Add Your Anthropic API Key to GitHub

1. In your GitHub repo, click **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: paste your key from Step 1
5. Click **Add secret**

---

## Step 4 — Run the First Build

1. In your repo, click the **Actions** tab
2. Click **Daily News Build** in the left sidebar
3. Click **Run workflow** → **Run workflow**
4. Wait ~3–5 minutes for it to complete
5. Check that `index.html` appears in your repo with news cards in it

---

## Step 5 — Connect to Netlify

1. Go to https://app.netlify.com → **Add new site** → **Import an existing project**
2. Choose **GitHub** and authorise Netlify
3. Select your `digitalplumber` repo
4. Build settings — leave everything blank (there's no build command; Netlify just serves `index.html`)
5. Click **Deploy site**

Netlify will give you a URL like `https://random-name-123.netlify.app` — your site is live.

---

## Step 6 — Connect Your GoDaddy Domain

### In Netlify
1. Go to **Site configuration** → **Domain management** → **Add a domain**
2. Enter `digitalplumber.ca` → **Verify** → **Add domain**
3. Netlify will show you DNS records to add — note the values

### In GoDaddy
1. Log into GoDaddy → **My Products** → **Domains** → **digitalplumber.ca** → **DNS**
2. Delete any existing `A` records pointing to GoDaddy's placeholder
3. Add these records:

| Type  | Name | Value                        | TTL  |
|-------|------|------------------------------|------|
| A     | @    | 75.2.60.5                    | 600  |
| CNAME | www  | your-site-name.netlify.app   | 600  |

> The A record IP (`75.2.60.5`) is Netlify's load balancer. The CNAME value comes from your Netlify site — replace `your-site-name` with the actual subdomain Netlify assigned.

4. Save changes. DNS propagation takes 10 minutes to a few hours.

### Enable HTTPS (free)
Back in Netlify: **Domain management** → **HTTPS** → **Verify DNS configuration** → **Provision certificate**

---

## Step 7 — Verify the Daily Schedule

The GitHub Action runs every day at **8 AM Eastern Time**. After 24 hours, check that a new commit appears in your repo with a message like `Daily news update 2026-06-10`.

You can also trigger a manual build any time from the **Actions** tab.

---

## Customising Topics

To change the topics or search queries, edit `build.js` and modify the `TOPICS` array near the top of the file:

```js
const TOPICS = [
  { label: 'AI Networking',  query: 'AI networking infrastructure latest news' },
  { label: 'Cisco',          query: 'Cisco networking AI products announcements' },
  // add or change topics here
];
```

Then push the change to GitHub — it takes effect on the next build.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Action fails with `401` | Check the `ANTHROPIC_API_KEY` secret is set correctly |
| Action fails with `no JSON array found` | Transient API issue — re-run manually |
| Site shows old content | Check Netlify → **Deploys** to see if the latest push triggered a deploy |
| GoDaddy domain not resolving | Wait up to 24 hrs for DNS propagation; verify the A record value |
