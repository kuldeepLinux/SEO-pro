import express from "express";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_PAGES = Math.min(25, Math.max(1, Number(process.env.MAX_PAGES || 15)));
const TIMEOUT_MS = Math.min(20000, Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || 10000)));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.disable("x-powered-by");

function isPublicIp(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === "unicast";
  } catch { return false; }
}
async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Enter a valid absolute URL, including https://"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (u.username || u.password) throw new Error("URLs containing usernames or passwords are not allowed.");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("Only standard web ports 80 and 443 are allowed.");
  if (!u.hostname || u.hostname === "localhost" || u.hostname.endsWith(".localhost") || u.hostname.endsWith(".local")) {
    throw new Error("Local and private hosts are not allowed.");
  }
  let addresses;
  try {
    addresses = await dns.lookup(u.hostname, { all: true, verbatim: true });
  } catch { throw new Error("The hostname could not be resolved."); }
  if (!addresses.length || addresses.some(a => !isPublicIp(a.address))) {
    throw new Error("This hostname resolves to a non-public IP address and cannot be scanned.");
  }
  return u;
}
async function safeFetch(raw, opts = {}, redirects = 0) {
  const u = await validatePublicUrl(raw);
  if (redirects > 4) throw new Error("Too many redirects.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(u.href, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "SEO-Pro-AI/1.0 (+user-initiated SEO audit)",
        "accept": "text/html,application/xhtml+xml,application/xml,text/xml,*/*;q=0.5",
        ...(opts.headers || {})
      }
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Request timed out.");
    throw new Error("Could not fetch this URL. Check that it is publicly accessible.");
  } finally { clearTimeout(timer); }
  if ([301,302,303,307,308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, u).href;
    return safeFetch(next, opts, redirects + 1);
  }
  return response;
}
function cleanText(value = "") { return String(value).replace(/\s+/g, " ").trim(); }
function normalizedUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  return u.href;
}
function priority(score) { return score >= 8 ? "high" : score >= 5 ? "medium" : "low"; }
function finding(category, title, impact, evidence, fix, verify, score = 5) {
  return { category, title, priority: priority(score), impact, evidence, fix, verify, score };
}
function extractPage(html, url, status, contentType = "") {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const title = cleanText($("title").first().text());
  const metaDescription = cleanText($('meta[name="description"]').attr("content") || "");
  const robots = cleanText($('meta[name="robots"]').attr("content") || "");
  const canonicalRaw = $('link[rel="canonical"]').first().attr("href") || "";
  let canonical = "";
  try { if (canonicalRaw) canonical = new URL(canonicalRaw, url).href; } catch {}
  const h1 = $("h1").map((_, el) => cleanText($(el).text())).get().filter(Boolean);
  const h2 = $("h2").map((_, el) => cleanText($(el).text())).get().filter(Boolean);
  const bodyText = cleanText($("body").text());
  const links = $("a[href]").map((_, el) => {
    try {
      const href = new URL($(el).attr("href"), url);
      if (!["http:", "https:"].includes(href.protocol)) return null;
      href.hash = "";
      return { url: href.href, text: cleanText($(el).text()).slice(0, 160) };
    } catch { return null; }
  }).get().filter(Boolean);
  const images = $("img").map((_, el) => ({
    src: $(el).attr("src") || "",
    alt: cleanText($(el).attr("alt") || ""),
    hasAlt: $(el).attr("alt") !== undefined
  })).get();
  const headings = $("h1,h2,h3,h4,h5,h6").map((_, el) => ({
    tag: (el.tagName || "").toLowerCase(), text: cleanText($(el).text()).slice(0, 180)
  })).get();
  const schemaScripts = $('script[type="application/ld+json"]').map((_, el) => $(el).contents().text()).get();
  const schema = [];
  const schemaErrors = [];
  for (const raw of schemaScripts) {
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (node && node["@graph"] && Array.isArray(node["@graph"])) schema.push(...node["@graph"]);
        else schema.push(node);
      }
    } catch { schemaErrors.push("A JSON-LD script could not be parsed as valid JSON."); }
  }
  const types = schema.flatMap(n => {
    const t = n && n["@type"];
    return Array.isArray(t) ? t : t ? [t] : [];
  });
  const findings = [];
  if (status >= 400) findings.push(finding("Technical SEO", "Page returns an error status", 9, `HTTP ${status} for ${url}`, "Restore the page or redirect it to the closest relevant live URL. Do not redirect every error to the homepage.", "Check the response status and Google Search Console Page indexing.", 9));
  if (!title) findings.push(finding("On-Page SEO", "Missing title tag", 8, "No non-empty <title> was found in the fetched HTML.", "Add a unique, descriptive title that accurately represents this page.", "Inspect rendered HTML and the browser tab title.", 8));
  else if (title.length < 20 || title.length > 65) findings.push(finding("On-Page SEO", "Title length may need review", 4, `Title is ${title.length} characters: “${title.slice(0, 140)}”`, "Review for clarity and intent; character length is a guideline, not a Google ranking rule.", "Check the title in rendered HTML and review the search snippet over time.", 4));
  if (!metaDescription) findings.push(finding("On-Page SEO", "Missing meta description", 5, "No non-empty meta description was found in the fetched HTML.", "Write a unique, useful summary of the page. Google may still choose another snippet.", "Inspect the <meta name=\"description\"> element.", 5));
  else if (metaDescription.length < 70 || metaDescription.length > 170) findings.push(finding("On-Page SEO", "Meta description length may need review", 3, `Description is ${metaDescription.length} characters.`, "Review whether it communicates the page's value clearly; there is no fixed Google character limit.", "Inspect rendered HTML and monitor Search Console CTR.", 3));
  if (h1.length === 0) findings.push(finding("On-Page SEO", "No H1 heading found", 5, "The fetched HTML contains no <h1>.", "Add a clear primary heading for users and page structure.", "Inspect the rendered heading outline.", 5));
  if (h1.length > 1) findings.push(finding("On-Page SEO", "Multiple H1 headings found", 3, `Found ${h1.length} H1 headings: ${h1.slice(0, 4).join(" | ")}`, "Check that the heading hierarchy is clear. Multiple H1s are not automatically a Google penalty.", "Review the page's rendered heading outline.", 3));
  if (!canonical) findings.push(finding("Technical SEO", "Canonical tag not found", 5, "No <link rel=\"canonical\"> was found in fetched HTML.", "If this page has duplicate or parameterized versions, add an appropriate canonical. Not every page requires a manually added canonical.", "Inspect HTML and compare canonical URL with the preferred indexable URL.", 5));
  else if (new URL(canonical).origin !== new URL(url).origin) findings.push(finding("Technical SEO", "Cross-origin canonical detected", 7, `Canonical points to ${canonical}`, "Confirm that cross-domain canonicalization is intentional and that the target is the preferred equivalent page.", "Inspect both URLs and verify canonical selection in Search Console.", 7));
  if (/\bnoindex\b/i.test(robots)) findings.push(finding("Indexing", "Meta robots contains noindex", 9, `robots meta: ${robots}`, "Remove noindex only if this page should appear in search results; some pages should intentionally remain excluded.", "Inspect rendered HTML and use Search Console URL Inspection.", 9));
  const missingAlt = images.filter(i => !i.hasAlt || !i.alt.trim()).length;
  if (missingAlt) findings.push(finding("Accessibility / Content", "Images have missing or empty alt text", 4, `${missingAlt} of ${images.length} images have no alt attribute or an empty alt value. Empty alt is appropriate for decorative images.`, "Add descriptive alt text to informative images and keep decorative images with alt=\"\".", "Inspect image elements and check that alt text reflects each image's purpose.", 4));
  if (schemaErrors.length) findings.push(finding("Schema", "Invalid JSON-LD syntax detected", 8, schemaErrors.join(" "), "Fix malformed JSON in the JSON-LD script. Validate types and required properties separately.", "Run the URL or code through Schema Markup Validator and Rich Results Test.", 8));
  if (!schema.length) findings.push(finding("Schema", "No JSON-LD structured data detected", 3, "No parseable <script type=\"application/ld+json\"> was found. Microdata/RDFa were not fully evaluated.", "Add only schema that accurately represents visible content and is appropriate for the page.", "Use Schema Markup Validator; absence of JSON-LD alone does not prove all structured data is missing.", 3));
  if (bodyText.length < 300) findings.push(finding("Content Quality", "Very little extractable page text", 6, `Only about ${bodyText.length} characters of body text were extracted. JavaScript-rendered content may not be included.`, "Confirm the page serves meaningful primary content in rendered HTML. Do not add filler solely to increase word count.", "Compare fetched HTML with browser-rendered DOM and inspect URL Inspection's rendered page.", 6));
  if (links.length === 0) findings.push(finding("Internal Linking", "No crawlable links detected", 4, "No absolute or relative HTTP(S) links were extracted.", "Add useful navigational links where appropriate.", "Inspect rendered <a href> elements.", 4));
  return {
    url, status, contentType, title, titleLength: title.length, metaDescription, metaDescriptionLength: metaDescription.length,
    robots, canonical, h1, h2: h2.slice(0, 30), headings: headings.slice(0, 80),
    wordCount: bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0,
    textLength: bodyText.length, images: images.length, imagesMissingAlt: missingAlt,
    links, schemaTypes: [...new Set(types)], schemaCount: schema.length, schemaErrors, findings
  };
}
async function fetchText(url) {
  const res = await safeFetch(url);
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  return { res, type, text: text.slice(0, 2_000_000) };
}
async function getRobots(origin) {
  try {
    const { res, text } = await fetchText(new URL("/robots.txt", origin).href);
    if (!res.ok) return { status: res.status, parser: null, text: "" };
    return { status: res.status, parser: robotsParser(new URL("/robots.txt", origin).href, text), text: text.slice(0, 10000) };
  } catch { return { status: 0, parser: null, text: "" }; }
}
async function getSitemap(origin, robotsText) {
  const candidates = [...robotsText.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map(m => m[1]);
  candidates.push(new URL("/sitemap.xml", origin).href);
  for (const candidate of [...new Set(candidates)].slice(0, 4)) {
    try {
      const { res, text } = await fetchText(candidate);
      if (res.ok && /<urlset|<sitemapindex/i.test(text)) {
        const urls = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim()).slice(0, 500);
        return { found: true, url: candidate, count: urls.length, urls };
      }
    } catch {}
  }
  return { found: false, url: "", count: 0, urls: [] };
}
async function pageSpeed(url) {
  if (!process.env.PAGESPEED_API_KEY) return { configured: false };
  try {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("key", process.env.PAGESPEED_API_KEY);
    endpoint.searchParams.append("category", "PERFORMANCE");
    endpoint.searchParams.append("category", "SEO");
    endpoint.searchParams.set("strategy", "mobile");
    const res = await fetch(endpoint.href, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return { configured: true, error: `PageSpeed API returned HTTP ${res.status}` };
    const data = await res.json();
    const cats = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};
    return {
      configured: true,
      performance: cats.performance?.score == null ? null : Math.round(cats.performance.score * 100),
      seo: cats.seo?.score == null ? null : Math.round(cats.seo.score * 100),
      lcp: audits["largest-contentful-paint"]?.displayValue || null,
      cls: audits["cumulative-layout-shift"]?.displayValue || null,
      inp: audits["interaction-to-next-paint"]?.displayValue || audits["total-blocking-time"]?.displayValue || null,
      source: "Google PageSpeed Insights API; lab data, not a substitute for field data."
    };
  } catch { return { configured: true, error: "PageSpeed request failed or timed out." }; }
}
app.post("/api/audit", async (req, res) => {
  try {
    const raw = String(req.body?.url || "").trim();
    if (!raw) return res.status(400).json({ error: "Please enter a website URL." });
    const startUrl = await validatePublicUrl(raw);
    startUrl.hash = "";
    const origin = startUrl.origin;
    const robots = await getRobots(origin);
    const sitemap = await getSitemap(origin, robots.text);
    const queue = [normalizedUrl(startUrl.href)];
    const visited = new Set();
    const pages = [];
    const crawlFindings = [];
    while (queue.length && pages.length < MAX_PAGES) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      if (robots.parser && !robots.parser.isAllowed(current, "SEO-Pro-AI")) {
        crawlFindings.push(finding("Crawlability", "URL may be disallowed by robots.txt", 7, `${current} is disallowed for user-agent SEO-Pro-AI according to fetched robots.txt.`, "Confirm whether the URL should be crawlable; do not remove intentional crawl restrictions.", "Check robots.txt rules and Google Search Console URL Inspection.", 7));
        continue;
      }
      try {
        const { res: response, type, text: html } = await fetchText(current);
        if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
          if (current === normalizedUrl(startUrl.href)) crawlFindings.push(finding("Technical SEO", "URL did not return HTML", 5, `Content-Type was ${type || "not provided"}.`, "Use a URL that serves an HTML page for this audit, or inspect the resource with a suitable tool.", "Check response headers in browser developer tools.", 5));
          continue;
        }
        const page = extractPage(html, current, response.status, type);
        pages.push(page);
        for (const link of page.links) {
          try {
            const u = new URL(link.url);
            if (u.origin === origin && !visited.has(normalizedUrl(u.href)) && queue.length < MAX_PAGES * 3) queue.push(normalizedUrl(u.href));
          } catch {}
        }
      } catch (e) {
        crawlFindings.push(finding("Technical SEO", "Page could not be fetched", 6, `${current}: ${e.message}`, "Check availability, redirects and server responses. This scanner only supports publicly reachable standard HTTP(S) URLs.", "Open the URL and check its HTTP status.", 6));
      }
    }
    if (!pages.length) return res.status(422).json({ error: "No HTML pages could be audited. Check the URL and whether the site is publicly accessible.", crawlFindings });
    const allFindings = [...pages.flatMap(p => p.findings), ...crawlFindings];
    const seen = new Set();
    const uniqueFindings = allFindings.filter(f => {
      const key = `${f.title}|${f.evidence}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a,b) => b.score - a.score);
    const ps = await pageSpeed(startUrl.href);
    const total = pages.length;
    const possible = total * 100;
    const penalty = uniqueFindings.reduce((sum, f) => sum + (f.priority === "high" ? 8 : f.priority === "medium" ? 4 : 1), 0);
    const score = Math.max(0, Math.min(100, Math.round(100 - penalty / Math.max(1, total) * 2)));
    res.json({
      scannedAt: new Date().toISOString(), startUrl: startUrl.href, origin, pagesScanned: total, pageLimit: MAX_PAGES,
      score, scoreNote: "Heuristic summary score based on detected findings; not a Google ranking score.",
      robots: { status: robots.status, fetched: robots.status === 200, note: robots.status === 0 ? "Could not fetch robots.txt" : `HTTP ${robots.status}` },
      sitemap, pageSpeed: ps, pages, findings: uniqueFindings,
      summary: {
        high: uniqueFindings.filter(f => f.priority === "high").length,
        medium: uniqueFindings.filter(f => f.priority === "medium").length,
        low: uniqueFindings.filter(f => f.priority === "low").length
      }
    });
  } catch (e) { res.status(400).json({ error: e.message || "Audit failed." }); }
});
app.post("/api/ai-review", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: "AI is not configured. Add OPENAI_API_KEY to your server .env file and restart." });
  const audit = req.body?.audit;
  if (!audit || !Array.isArray(audit.findings)) return res.status(400).json({ error: "Run an audit first." });
  const payload = {
    startUrl: audit.startUrl,
    pagesScanned: audit.pagesScanned,
    summary: audit.summary,
    pages: audit.pages.slice(0, 12).map(p => ({
      url: p.url, status: p.status, title: p.title, metaDescription: p.metaDescription,
      h1: p.h1, wordCount: p.wordCount, schemaTypes: p.schemaTypes, canonical: p.canonical
    })),
    findings: audit.findings.slice(0, 60).map(f => ({
      category: f.category, title: f.title, priority: f.priority, evidence: f.evidence,
      fix: f.fix, verify: f.verify
    })),
    pageSpeed: audit.pageSpeed
  };
  const prompt = `You are an evidence-first technical SEO consultant. Analyze ONLY the JSON evidence supplied. Do not claim checks were performed if they were not. Separate observed facts from hypotheses and unknowns. Prioritize fixes by impact, give concrete implementation steps, and include a verification step for every recommendation. Mention that the audit is limited to the pages scanned and that the heuristic score is not a Google score. Return concise Markdown with: Executive summary, High impact, Medium impact, Low impact, Content opportunities, Schema notes, Verification checklist. JSON evidence:\n${JSON.stringify(payload)}`;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "system", content: "You are SEO Pro. Evidence-first, concise, no invented findings." }, { role: "user", content: prompt }],
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: data.error?.message || `AI provider returned HTTP ${response.status}` });
    res.json({ report: data.choices?.[0]?.message?.content || "No report returned." });
  } catch { res.status(502).json({ error: "AI request failed or timed out." }); }
});
app.get("/api/health", (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), pageSpeedConfigured: Boolean(process.env.PAGESPEED_API_KEY) }));
app.listen(PORT, () => console.log(`SEO Pro AI running on http://localhost:${PORT}`));
