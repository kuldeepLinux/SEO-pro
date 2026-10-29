const $ = (s) => document.querySelector(s);
let latestAudit = null;
const form = $("#audit-form");
const message = $("#message");
const results = $("#results");
function showMessage(text, error = false) {
  message.textContent = text;
  message.classList.add("show");
  message.style.background = error ? "#402129" : "#342c1b";
  message.style.color = error ? "#ffb0b5" : "#ffdc8b";
}
function clearMessage() { message.textContent = ""; message.classList.remove("show"); }
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeLink(url, text) {
  const a = el("a", "", text || url);
  a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  return a;
}
function renderChecks(audit) {
  const host = $("#tech-summary"); host.replaceChildren();
  const checks = [
    [audit.robots.fetched, `robots.txt: ${audit.robots.note}`],
    [audit.sitemap.found, audit.sitemap.found ? `Sitemap found (${audit.sitemap.count} URLs listed)` : "Sitemap not detected at common locations"],
    [audit.pageSpeed?.performance != null, audit.pageSpeed?.performance != null ? `Mobile PageSpeed performance: ${audit.pageSpeed.performance}/100` : "PageSpeed not measured (optional API key required)"],
    [audit.pageSpeed?.seo != null, audit.pageSpeed?.seo != null ? `Lighthouse SEO: ${audit.pageSpeed.seo}/100` : "Lighthouse SEO score unavailable"]
  ];
  checks.forEach(([ok, label]) => {
    const row = el("div", "check");
    row.append(el("i", `dot ${ok ? "" : "warn"}`), el("span", "", label));
    host.append(row);
  });
  const types = [...new Set(audit.pages.flatMap(p => p.schemaTypes || []))];
  $("#schema-types").textContent = types.length ? types.join(", ") : "No JSON-LD types detected in scanned pages.";
}
function renderFindings() {
  if (!latestAudit) return;
  const filter = $("#priority-filter").value;
  const all = latestAudit.findings.filter(f => filter === "all" || f.priority === filter);
  $("#finding-count").textContent = `(${all.length})`;
  const host = $("#findings"); host.replaceChildren();
  if (!all.length) { host.append(el("div", "panel", "No findings in this priority group.")); return; }
  all.forEach(f => {
    const card = el("article", "finding");
    const top = el("div", "finding-top");
    const left = el("div");
    left.append(el("h4", "", f.title), el("span", "muted tiny", f.category));
    top.append(left, el("span", `pill ${f.priority}`, f.priority));
    card.append(top);
    const evidence = el("p"); evidence.append(el("b", "", "Evidence: "), document.createTextNode(f.evidence || "No evidence text supplied."));
    const fix = el("p", "fix"); fix.append(el("b", "", "Recommended fix: "), document.createTextNode(f.fix || ""));
    const verify = el("p"); verify.append(el("b", "", "Verify: "), document.createTextNode(f.verify || ""));
    card.append(evidence, fix, verify);
    host.append(card);
  });
}
function render(audit) {
  latestAudit = audit;
  results.hidden = false;
  $("#result-domain").textContent = new URL(audit.startUrl).hostname;
  $("#scan-meta").textContent = `Scanned ${new Date(audit.scannedAt).toLocaleString()} · ${audit.pagesScanned} page(s)`;
  $("#score").textContent = audit.score;
  $("#pages-count").textContent = audit.pagesScanned;
  $("#high-count").textContent = audit.summary.high;
  $("#medium-count").textContent = audit.summary.medium;
  $("#low-count").textContent = audit.summary.low;
  renderChecks(audit);
  renderFindings();
  const tbody = $("#pages-table"); tbody.replaceChildren();
  audit.pages.forEach(p => {
    const tr = el("tr");
    const urlTd = el("td"); urlTd.append(safeLink(p.url, p.url));
    const schema = p.schemaTypes?.length ? p.schemaTypes.join(", ") : "—";
    [urlTd, el("td", "", String(p.status)), el("td", "", p.title || "(missing)"), el("td", "", String(p.wordCount)), el("td", "", schema)].forEach(td => tr.append(td));
    tbody.append(tr);
  });
  $("#ai-report-card").hidden = true;
}
form.addEventListener("submit", async (e) => {
  e.preventDefault(); clearMessage();
  const url = $("#url").value.trim();
  $("#scan-button").disabled = true; $("#scan-button").textContent = "Scanning…";
  showMessage("Scanning the start page and a limited number of same-site links. Larger sites may take a little longer.");
  results.hidden = true;
  try {
    const response = await fetch("/api/audit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Audit failed.");
    clearMessage(); render(data);
    showMessage(`Audit complete: ${data.pagesScanned} page(s) scanned. Review each finding and verify before making changes.`);
    message.style.background = "#18362e"; message.style.color = "#9ce8c8";
  } catch (err) { showMessage(err.message || "Could not complete audit.", true); }
  finally { $("#scan-button").disabled = false; $("#scan-button").innerHTML = 'Scan website <span aria-hidden="true">→</span>'; }
});
$("#priority-filter").addEventListener("change", renderFindings);
$("#export-button").addEventListener("click", () => {
  if (!latestAudit) return;
  const blob = new Blob([JSON.stringify(latestAudit, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `seo-audit-${new URL(latestAudit.startUrl).hostname}.json`; a.click();
  URL.revokeObjectURL(a.href);
});
$("#ai-button").addEventListener("click", async () => {
  if (!latestAudit) return;
  $("#ai-button").disabled = true; $("#ai-button").textContent = "Generating report…";
  $("#ai-state").textContent = "AI is reviewing the scan evidence.";
  try {
    const response = await fetch("/api/ai-review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audit: latestAudit })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI review failed.");
    $("#ai-report").textContent = data.report;
    $("#ai-report-card").hidden = false;
    $("#ai-state").textContent = "AI recommendations are based on the scan data; verify before implementing.";
    $("#ai-report-card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) { $("#ai-state").textContent = err.message; }
  finally { $("#ai-button").disabled = false; $("#ai-button").textContent = "✦ Generate AI fix plan"; }
});
$("#copy-ai").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#ai-report").textContent); $("#copy-ai").textContent = "Copied"; }
  catch { $("#copy-ai").textContent = "Select text to copy"; }
});
