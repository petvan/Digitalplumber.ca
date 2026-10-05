# Digital Plumber: setup and disaster recovery

Everything needed to rebuild digitalplumber.ca from scratch. The code and every published page live in this repo; this guide covers what lives outside it: accounts, settings, secrets and DNS.

**This repo is public.** Record names and settings here, never secret values or subscriber data.

Last reviewed: 2026-09-28.

## How it works

1. **GitHub Actions** runs the *Daily News Build* workflow (`.github/workflows/daily-build.yml`) every morning at 10:00 UTC (6 AM Toronto in summer, 5 AM in winter; GitHub often starts scheduled runs late). It can also be started by hand from the Actions tab.
2. The workflow runs `node build.js`, which calls the Anthropic API: `claude-haiku-4-5` with web search finds and writes up stories for each topic, and `claude-opus-5` picks the top stories and writes headlines.
3. The build writes the site's pages and commits them to `main` as "Daily news update YYYY-MM-DD".
4. **Netlify** deploys every push to `main` to digitalplumber.ca.
5. The build also creates that day's email in **Buttondown**, which sends it to subscribers.

## Accounts and services

| Service | Used for | Account details |
|---|---|---|
| GitHub | Code, published pages, the daily workflow, secrets | Repo `petvan/Digitalplumber.ca` (public) |
| Anthropic Console | API key for the build | console.anthropic.com |
| Netlify | Hosting and HTTPS | Site `loquacious-phoenix-d6fc63`, custom domains `digitalplumber.ca` and `www.digitalplumber.ca`, Let's Encrypt certificate managed by Netlify |
| GoDaddy | Domain registration (Go Daddy Domains Canada), DNS, and the Microsoft 365 mailbox | Domain `digitalplumber.ca`, nameservers `ns37.domaincontrol.com` and `ns38.domaincontrol.com` |
| Microsoft 365 from GoDaddy | The `@digitalplumber.ca` mailbox, Email Essentials plan | Aliases `hello@` (newsletter replies, and the site's "Report a correction" link) and `dmarc@` (DMARC reports) |
| Buttondown | Email subscribers and sending | Username `pvo`, sending domain `mail.digitalplumber.ca` (managed setup), sender `briefing@mail.digitalplumber.ca`, newsletter name "Digital Plumber" |
| ESPN public API | Toronto sports scores in the page header | No account or key; called from visitors' browsers |

Keep the logins for each of these in a password manager.

## GitHub secrets and variables

Settings → Secrets and variables → Actions. Secret values can't be read back from GitHub; if they're lost, create new ones at the source.

| Name | Kind | Value or source | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | Create a key at console.anthropic.com → API Keys | All Claude calls in the build |
| `BUTTONDOWN_API_KEY` | Secret | Buttondown → Settings → API | Creating each day's email |
| `BUTTONDOWN_USERNAME` | Variable | `pvo` | Sign-up forms post to `https://buttondown.com/api/emails/embed-subscribe/pvo` |
| `BUTTONDOWN_MODE` | Variable | `send` | `send` schedules each email 10 minutes after it's created; unset or anything else creates drafts only |

Set them from a terminal (the secret command prompts for the value, so it stays out of your shell history):

```bash
gh secret set ANTHROPIC_API_KEY --repo petvan/Digitalplumber.ca
gh secret set BUTTONDOWN_API_KEY --repo petvan/Digitalplumber.ca
gh variable set BUTTONDOWN_USERNAME --repo petvan/Digitalplumber.ca --body pvo
gh variable set BUTTONDOWN_MODE --repo petvan/Digitalplumber.ca --body send
```

## Netlify

- Connected to the GitHub repo, deploying the `main` branch.
- Build settings live in `netlify.toml`: publish directory is the repo root, and there is no build step on Netlify.
- Domains: `digitalplumber.ca` (primary) and `www.digitalplumber.ca`, both with Netlify-managed HTTPS.

## DNS (GoDaddy)

Snapshot of every record, taken 2026-09-28. These records are public, so they're safe to keep here.

| Type | Name | Value | Purpose |
|---|---|---|---|
| A | `@` | `75.2.60.5` | Website (Netlify's load balancer) |
| CNAME | `www` | `loquacious-phoenix-d6fc63.netlify.app` | Website |
| MX | `@` | `digitalplumber-ca.mail.protection.outlook.com` (priority 0) | Microsoft 365 mailbox |
| TXT | `@` | `v=spf1 include:secureserver.net -all` | SPF for the mailbox |
| TXT | `@` | `NETORG21164288.onmicrosoft.com` | Microsoft domain verification |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | Mail app setup |
| NS | `mail` | `ns1.onbuttondown.com` | Hands the newsletter subdomain to Buttondown |
| NS | `mail` | `ns2.onbuttondown.com` | Same |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@digitalplumber.ca` | DMARC policy (monitoring only) |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com` | GoDaddy default |

GoDaddy also lists the two `NS @` records (`ns37`/`ns38.domaincontrol.com`) and an SOA record; those are GoDaddy's own and aren't edited. The records under `mail.digitalplumber.ca` (reply handling and email authentication) live on Buttondown's servers and are managed by Buttondown.

To check any record from a terminal: `dig +short digitalplumber.ca MX`, or for the newsletter subdomain `dig +short mail.digitalplumber.ca NS`.

## Buttondown

- **Sending domain:** `mail.digitalplumber.ca`, managed setup (Buttondown runs the DNS for that subdomain via the two NS records above).
- **Sender:** "Digital Plumber" `<briefing@mail.digitalplumber.ca>`.
- **Replies:** handled in Buttondown and delivered to `hello@digitalplumber.ca`, either as the account email or as a custom reply-to (Settings → Sending domain → Add-ons). Confirm which is in use and note it here.
- **Email design:** the email's masthead is generated by `build.js`, so Buttondown's email Header setting is left empty.
- **Subscribers exist only in Buttondown.** Export the list regularly (Buttondown → Subscribers → Export) and keep the file somewhere private. Never commit it to this repo.

## Data that isn't in the repo

- **Subscriber list:** Buttondown only; see the export note above.
- **Mailbox contents:** Microsoft 365 only.
- **Secret values:** GitHub only, and unreadable there; regenerate at the source.

Everything else, including every edition since 2026-06-11, is in this repo.

## Rebuilding from scratch

1. **Code.** Restore the repo from GitHub or from a local clone (`git push` a clone to a new GitHub repo if the old one is gone).
2. **Secrets and variables.** Set the four entries in *GitHub secrets and variables* above.
3. **Hosting.** In Netlify, create a site from the GitHub repo; `netlify.toml` supplies the settings. Add the custom domains `digitalplumber.ca` and `www.digitalplumber.ca`.
4. **DNS.** In GoDaddy, recreate the records in the DNS table. If Netlify gives a different site address, update the `www` CNAME (and the A record if Netlify gives a different IP).
5. **Mailbox.** Set up Microsoft 365 for `digitalplumber.ca` in GoDaddy; it adds the MX, SPF, autodiscover and verification records itself. Add the `hello@` and `dmarc@` aliases.
6. **Newsletter.** In Buttondown, add `mail.digitalplumber.ca` as the sending domain (managed setup), put its two NS records in GoDaddy, set the sender and reply handling, and import the latest subscriber export.
7. **First build.** Run the *Daily News Build* workflow from the Actions tab, then check the checklist below.

### After a rebuild, check

- https://digitalplumber.ca loads with today's date and stories, and https://www.digitalplumber.ca redirects to it.
- https://digitalplumber.ca/vendors/, /topics/, /week.html, /archive/ and /about.html load.
- Search finds older stories (it reads `archives/search-index.json`).
- The sign-up form under the masthead is present.
- The workflow log shows `✓ Email:` and the email appears in Buttondown.
- `dig` returns the values in the DNS table.

## Maintenance tools

- `tools/offline-build.js` runs the whole build on a throwaway copy with every network call stubbed: no API costs, no emails, and the repo isn't touched. See the comment at the top of the file for usage.
- `bootstrap-search-index.js` rebuilds `archives/index.json` and `archives/search-index.json` entries from the archive HTML pages, adding any missing days. Safe to re-run.
- `tools/og-image.py` regenerates `og-image.png`, the image shown when a link to the site is shared. The font download links are at the top of the file.

## Costs

- Anthropic API: every build (scheduled or manual) makes about a dozen web-search calls and two editor calls.
- Buttondown: free up to 100 subscribers; its API is included on every plan.
- Microsoft 365 Email Essentials from GoDaddy: C$2.99 a month for the first year, then C$11.99 a month (as listed in September 2026).
- Domain renewal: GoDaddy.
- Netlify and GitHub Actions: free tiers.
