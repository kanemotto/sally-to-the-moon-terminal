const STORAGE_KEY = "sally-moon-terminal-watchlist-v1";

const state = {
  scan: null,
  directory: [],
  watchlist: [],
  filter: "ALL",
  query: "",
  directoryQuery: "",
  directoryTurningOnly: false,
};

const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const money = (value) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number(value) < 1 ? 4 : 2, maximumFractionDigits: Number(value) < 1 ? 4 : 2 }).format(value)
  : "—";
const pillClass = (value) => value.toLowerCase().replaceAll(" ", "-");

function sparkline(values = [], up = true) {
  if (values.length < 2) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 150},${42 - ((value - low) / range) * 38}`).join(" ");
  return `<svg viewBox="0 0 150 46" role="img" aria-label="30 session price trend"><path d="M0 42H150" class="spark-base"/><polyline points="${points}" fill="none" stroke="${up ? "#6df4b3" : "#ff7185"}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function quoteMap() {
  return new Map((state.scan?.quotes || []).map((quote) => [quote.symbol, quote]));
}

function saveWatchlist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.watchlist));
}

function showNotice(message) {
  $("#notice").textContent = message;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { $("#notice").textContent = ""; }, 2800);
}

function renderSummary() {
  const map = quoteMap();
  const watched = state.watchlist.map((symbol) => map.get(symbol)).filter(Boolean);
  $("#watching").textContent = state.watchlist.length;
  $("#buyWatch").textContent = watched.filter((quote) => quote.verdict === "BUY WATCH").length;
  $("#turning").textContent = state.scan.quotes.filter((quote) => quote.turnaround).length;
  $("#updated").textContent = state.scan.updatedShort || "Pending";
  const status = $(".live");
  status.innerHTML = `<i></i> US MARKET · ${esc(state.scan.marketSignal || "DELAYED").toUpperCase()} ${state.scan.marketScore ?? "—"}/100`;
}

function renderBest() {
  const map = quoteMap();
  const watched = state.watchlist.map((symbol) => map.get(symbol)).filter(Boolean);
  const choices = [...watched].sort((a, b) => {
    const priority = (quote) => (quote.verdict === "BUY WATCH" ? 1000 : 0) + (quote.turnaround ? 100 : 0) + quote.score;
    return priority(b) - priority(a);
  });
  const quote = choices[0];
  if (!quote) {
    $("#best").innerHTML = `<small>BEST SETUP NOW</small><p>Market scan is loading.</p>`;
    return;
  }
  const setupLine = quote.turnaround ? "Possible turnaround · momentum improving" : `${quote.trend} trend · ${quote.volumeRatio.toFixed(1)}× volume`;
  $("#best").innerHTML = `
    <small>BEST SETUP NOW</small>
    <div class="best-row"><b>${esc(quote.symbol)}</b><strong class="pill ${pillClass(quote.verdict)}">${esc(quote.verdict)}</strong></div>
    <p>${esc(setupLine)}</p>
    <div class="best-levels">
      <span>ENTRY ZONE<b>${money(quote.entryLow)}–${money(quote.entryHigh)}</b></span>
      <span>EXIT TARGET<b>${money(quote.target)}</b></span>
      <span>STOP<b>${money(quote.stop)}</b></span>
    </div>`;
}

function card(quote) {
  const up = quote.changePercent >= 0;
  const hasPlan = quote.verdict === "BUY WATCH";
  const targetPercent = ((quote.target / ((quote.entryLow + quote.entryHigh) / 2)) - 1) * 100;
  return `
    <article class="card" data-symbol="${esc(quote.symbol)}">
      <button class="remove" data-remove="${esc(quote.symbol)}" title="Remove ${esc(quote.symbol)}" aria-label="Remove ${esc(quote.symbol)}">×</button>
      <div class="card-head">
        <div class="ticker"><i>${esc(quote.symbol.slice(0, 2))}</i><span><b>${esc(quote.symbol)}</b><small>${esc(quote.name)}</small></span></div>
        <div class="card-badges">${quote.turnaround ? '<strong class="turn-badge">↗ TURNING</strong>' : ""}<strong class="pill ${pillClass(quote.verdict)}">${esc(quote.verdict)}</strong></div>
      </div>
      <div class="price"><span><b>${money(quote.price)}</b><small class="${up ? "up" : "down"}">${up ? "+" : ""}${quote.changePercent.toFixed(2)}%</small></span>${sparkline(quote.sparkline, up)}</div>
      <div class="score"><span><small>SETUP SCORE</small><b>${quote.score}<em>/100</em></b></span><div><i style="width:${quote.score}%"></i></div></div>
      ${hasPlan ? `
        <div class="entry"><small>IDEAL ENTRY ZONE</small><b>${money(quote.entryLow)} → ${money(quote.entryHigh)}</b></div>
        <div class="targets"><span><small>EXIT TARGET</small><b>${money(quote.target)}</b><em>+${targetPercent.toFixed(1)}%</em></span><span><small>STOP</small><b>${money(quote.stop)}</b><em class="red">protect capital</em></span><span><small>REWARD / RISK</small><b>${quote.rewardRisk.toFixed(1)}×</b><em>planned</em></span></div>` : `
        <div class="waiting-plan"><small>${quote.verdict === "WAIT" ? "WAIT FOR CONFIRMATION" : "NO ENTRY PLAN YET"}</small><b>${quote.trend === "Bearish" ? "Trend needs repair" : "Setup is still forming"}</b></div>`}
      <div class="signals"><span>RSI <b>${quote.rsi.toFixed(0)}</b></span><span>VOL <b>${quote.volumeRatio.toFixed(1)}×</b></span><span>TREND <b class="${quote.trend.toLowerCase()}">${esc(quote.trend)}</b></span></div>
      <div class="range"><span>Support ${money(quote.support)}</span><span>Resistance ${money(quote.resistance)}</span></div>
    </article>`;
}

function renderCards() {
  const map = quoteMap();
  const query = state.query.trim().toLowerCase();
  const stocks = state.watchlist
    .map((symbol) => map.get(symbol))
    .filter(Boolean)
    .filter((quote) => state.filter === "ALL" || (state.filter === "TURNAROUND" ? quote.turnaround : quote.verdict === state.filter))
    .filter((quote) => !query || `${quote.symbol} ${quote.name}`.toLowerCase().includes(query));
  $("#grid").innerHTML = stocks.length ? stocks.map(card).join("") : `<div class="empty"><i>◌</i><b>No matching stocks</b><span>Try another filter, or add a stock from the US directory.</span></div>`;
}

function renderDirectory() {
  const map = quoteMap();
  const query = state.directoryQuery.trim().toLowerCase();
  const allMatches = state.directory
    .filter((item) => !query || `${item.symbol} ${item.name} ${item.sector}`.toLowerCase().includes(query))
    .filter((item) => !state.directoryTurningOnly || map.get(item.symbol)?.turnaround);
  const matches = allMatches.slice(0, 120);
  $("#directoryCount").textContent = `${allMatches.length} ${allMatches.length === 1 ? "result" : "results"}${allMatches.length > 120 ? " · first 120 shown" : ""}`;
  $("#directoryList").innerHTML = matches.length ? matches.map((item) => {
    const added = state.watchlist.includes(item.symbol);
    const quote = map.get(item.symbol);
    return `<div class="directory-row"><div><b>${esc(item.symbol)}</b><span>${esc(item.name)}</span><small>${esc(item.sector || item.universe || "US stock")}</small></div>${quote?.turnaround ? '<em>↗ TURNING</em>' : ""}<button type="button" data-add="${esc(item.symbol)}" ${added ? "disabled" : ""}>${added ? "Added" : "+ Add"}</button></div>`;
  }).join("") : `<div class="directory-empty">No stocks match this search.</div>`;
}

function renderAll() {
  renderSummary();
  renderBest();
  renderCards();
  if ($("#addDialog").open) renderDirectory();
}

function addStock(symbol) {
  if (!state.watchlist.includes(symbol)) {
    state.watchlist.push(symbol);
    saveWatchlist();
    renderAll();
    renderDirectory();
    showNotice(`${symbol} added to mission control`);
  }
}

function removeStock(symbol) {
  state.watchlist = state.watchlist.filter((item) => item !== symbol);
  saveWatchlist();
  renderAll();
  showNotice(`${symbol} removed`);
}

async function load() {
  $("#refresh").classList.add("spinning");
  try {
    const bust = Date.now();
    const productionDataRoot = "https://raw.githubusercontent.com/kanemotto/sally-to-the-moon-terminal/main/dist";
    const dataRoot = window.location.hostname === "kanemotto.github.io" ? productionDataRoot : ".";
    const [scanResponse, directoryResponse, defaultResponse] = await Promise.all([
      fetch(`${dataRoot}/scan.json?v=${bust}`, { cache: "no-store" }),
      fetch(`${dataRoot}/stocks.json?v=${bust}`, { cache: "no-store" }),
      fetch(`watchlist.json?v=${bust}`, { cache: "no-store" }),
    ]);
    if (!scanResponse.ok || !directoryResponse.ok || !defaultResponse.ok) throw new Error("scan unavailable");
    state.scan = await scanResponse.json();
    state.directory = await directoryResponse.json();
    const defaults = await defaultResponse.json();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      state.watchlist = Array.isArray(saved) ? saved : defaults;
    } catch {
      state.watchlist = defaults;
    }
    saveWatchlist();
    renderAll();
  } catch (error) {
    $("#notice").textContent = "The market scan is updating. Please refresh again shortly.";
  } finally {
    $("#refresh").classList.remove("spinning");
  }
}

$("#filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll("#filters button").forEach((item) => item.classList.toggle("active", item === button));
  renderCards();
});
$("#search").addEventListener("input", (event) => { state.query = event.target.value; renderCards(); });
$("#refresh").addEventListener("click", load);
$("#addStock").addEventListener("click", () => { $("#addDialog").showModal(); renderDirectory(); setTimeout(() => $("#directorySearch").focus(), 60); });
$("#directorySearch").addEventListener("input", (event) => { state.directoryQuery = event.target.value; renderDirectory(); });
$("#turnaroundOnly").addEventListener("click", (event) => {
  state.directoryTurningOnly = !state.directoryTurningOnly;
  event.currentTarget.setAttribute("aria-pressed", String(state.directoryTurningOnly));
  renderDirectory();
});
$("#directoryList").addEventListener("click", (event) => { const symbol = event.target.closest("button[data-add]")?.dataset.add; if (symbol) addStock(symbol); });
$("#grid").addEventListener("click", (event) => { const symbol = event.target.closest("button[data-remove]")?.dataset.remove; if (symbol) removeStock(symbol); });

function registerWebMCP() {
  const context = navigator.modelContext;
  if (!context?.registerTool) return;
  context.registerTool({ name: "get_market_summary", description: "Get the current Sally To The Moon US market summary", inputSchema: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: JSON.stringify({ updated: state.scan?.updated, marketScore: state.scan?.marketScore, marketSignal: state.scan?.marketSignal, watched: state.watchlist.length }) }] }) });
  context.registerTool({ name: "set_watchlist_filter", description: "Filter cards by ALL, BUY WATCH, WAIT, AVOID, or TURNAROUND", inputSchema: { type: "object", properties: { filter: { type: "string", enum: ["ALL", "BUY WATCH", "WAIT", "AVOID", "TURNAROUND"] } }, required: ["filter"] }, execute: async ({ filter }) => { state.filter = filter; renderCards(); return { content: [{ type: "text", text: `Filter set to ${filter}` }] }; } });
}

load().then(registerWebMCP);
window.setInterval(load, 5 * 60 * 1000);
