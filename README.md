# SEO Pro AI

An evidence-first SEO auditing starter project. It scans publicly reachable HTML pages, extracts on-page signals, parses JSON-LD, checks robots.txt and common sitemap locations, optionally queries Google PageSpeed Insights, and can ask an AI model to explain the observed findings.

## Features

- Mobile-friendly dark dashboard
- Limited same-origin crawl (configurable, default 15 pages)
- Page status, title, meta description, H1/H2, canonical, robots meta, word count, images/alt, links
- JSON-LD parsing and basic syntax-error detection
- robots.txt and sitemap discovery
- Prioritized findings with evidence, fixes and verification instructions
- Optional PageSpeed Insights API integration
- Optional OpenAI-compatible Chat Completions API integration; key stays server-side
- Export audit results as JSON

## Requirements

- Node.js 20 or newer
- Optional API keys for AI review and PageSpeed

## Run locally

1. Download or clone this repository.
2. In a terminal, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Add `OPENAI_API_KEY` if you want AI reports. Add `PAGESPEED_API_KEY` if you want PageSpeed metrics.
5. Run `npm start`.
6. Open `http://localhost:3000`.

Do not commit `.env` or put secret API keys in browser JavaScript.

## Deploying

Deploy the Node app to a host that supports Node.js (for example, Render, Railway, or another trusted Node host). Configure environment variables in the host dashboard. GitHub Pages alone cannot run `server.js`, perform server-side crawling, or keep API keys secret.

## Phone-only GitHub setup

1. Open `https://github.com/new` in your phone browser.
2. Create a repository named `seo-pro-ai`. Choose Public or Private as you prefer; do not add a README if uploading the ZIP's files as a batch.
3. Download `seo-pro-ai.zip` from the project artifact supplied with this project, then extract it using your phone's Files app.
4. In the repository, use **Add file → Upload files** (or the equivalent mobile menu). Upload the project files and the `public` folder. GitHub's mobile interface may vary; if uploading folders is unavailable, create the files individually or use GitHub's desktop-site mode.
5. Commit the files.
6. To run the app, deploy the repository to a Node.js host. GitHub Pages will not run this backend.

## How to interpret findings

- Findings are heuristic checks based on fetched HTML and server responses. The score is a rough internal indicator, not a Google ranking score.
- Missing JSON-LD does not prove that a page has no structured data; this starter primarily parses JSON-LD and does not fully validate Microdata/RDFa or all Schema.org requirements.
- This is not a full browser-rendering crawler. JavaScript-rendered text, actual Google index status, backlinks, keyword search volume, rankings, and field Core Web Vitals are not measured.
- PageSpeed results, when configured, are Lighthouse lab data and not a substitute for field data.
- Always verify recommendations with browser tools, Google Search Console and the appropriate validators.

## Security notes

This project includes basic SSRF defenses: HTTP(S) only, standard ports, DNS resolution checks against non-public IP ranges, manual redirect validation, timeouts and a bounded crawl. This is a starter, not a hardened public scanning service. DNS rebinding and other network edge cases may require stronger egress controls at deployment. Do not expose it publicly without rate limiting, authentication, resource limits and abuse monitoring. Scan only websites you own or have permission to assess.

## API endpoints

- `POST /api/audit` JSON body: `{ "url": "https://example.com" }`
- `POST /api/ai-review` JSON body: `{ "audit": <audit response> }`
- `GET /api/health`

## License

Choose and add a license before accepting external contributions or distributing under specific terms.
