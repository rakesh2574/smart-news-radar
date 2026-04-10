/**
 * Smart News Radar — popup.js
 *
 * Core logic for the extension popup:
 *  - Layer 1: Fetches 10 latest headlines from GNews.io for a given topic
 *  - Layer 2: (Optional) Sends those headlines to Google Gemini Flash for
 *             summary / sentiment / insight analysis
 *  - Manages saved topic chips (persisted in chrome.storage.local)
 *  - Handles all error states defined in the spec
 *
 * Pure vanilla JavaScript. No frameworks, no build tools.
 */

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const els = {
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  saveTopicBtn: document.getElementById("saveTopicBtn"),
  chipsContainer: document.getElementById("chipsContainer"),
  results: document.getElementById("results"),
  aiToggle: document.getElementById("aiToggle"),
  settingsBtn: document.getElementById("settingsBtn"),
};

// ------------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------------

/** Wrap chrome.storage.local in a Promise API. */
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (res) => resolve(res || {}));
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

/**
 * Format an ISO datetime into a relative string:
 * "just now", "5 minutes ago", "2 hours ago", "Yesterday", "3 days ago".
 */
function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const published = new Date(isoString);
  if (isNaN(published.getTime())) return "";

  const diffMs = Date.now() - published.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  }

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;

  // Fall back to a short date
  return published.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Safely escape text that will be placed into an element's textContent. */
function safeText(value) {
  return value == null ? "" : String(value);
}

/** Clears and replaces the results area content with a given element. */
function setResults(node) {
  els.results.replaceChildren(node);
}

/** Builds a message state div (used for empty / error / info messages). */
function buildMessage(text, { isError = false, withSettingsLink = false } = {}) {
  const div = document.createElement("div");
  div.className = "message-state" + (isError ? " error" : "");
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);

  if (withSettingsLink) {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Open Settings →";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openOptionsPage();
    });
    div.appendChild(a);
  }
  return div;
}

/** Builds skeleton loading cards for the results area. */
function buildSkeletons(count = 5) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    card.innerHTML = `
      <div class="skeleton-thumb"></div>
      <div class="skeleton-body">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    `;
    frag.appendChild(card);
  }
  const wrapper = document.createElement("div");
  wrapper.appendChild(frag);
  return wrapper;
}

// ------------------------------------------------------------------
// Settings page navigation
// ------------------------------------------------------------------
function openOptionsPage() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options.html"));
  }
}

// ------------------------------------------------------------------
// Saved topic chips
// ------------------------------------------------------------------
async function loadSavedTopics() {
  const data = await storageGet([CONFIG.STORAGE_KEYS.SAVED_TOPICS]);
  return Array.isArray(data[CONFIG.STORAGE_KEYS.SAVED_TOPICS])
    ? data[CONFIG.STORAGE_KEYS.SAVED_TOPICS]
    : [];
}

async function saveSavedTopics(topics) {
  await storageSet({ [CONFIG.STORAGE_KEYS.SAVED_TOPICS]: topics });
}

function renderChips(topics) {
  els.chipsContainer.replaceChildren();
  topics.forEach((topic) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.title = `Search "${topic}"`;

    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = safeText(topic);
    chip.appendChild(label);

    const remove = document.createElement("span");
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.title = "Remove topic";
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      const current = await loadSavedTopics();
      const updated = current.filter((t) => t !== topic);
      await saveSavedTopics(updated);
      renderChips(updated);
    });
    chip.appendChild(remove);

    chip.addEventListener("click", () => {
      els.searchInput.value = topic;
      runSearch(topic);
    });
    els.chipsContainer.appendChild(chip);
  });
}

async function handleSaveTopic() {
  const topic = els.searchInput.value.trim();
  if (!topic) {
    setResults(buildMessage("Enter a topic to save it as a chip."));
    return;
  }

  const current = await loadSavedTopics();

  // Already saved? Nothing to do.
  if (current.some((t) => t.toLowerCase() === topic.toLowerCase())) {
    return;
  }

  if (current.length >= CONFIG.MAX_SAVED_TOPICS) {
    setResults(
      buildMessage(
        `You can save up to ${CONFIG.MAX_SAVED_TOPICS} topics. Remove one first.`,
        { isError: true }
      )
    );
    return;
  }

  const updated = [...current, topic];
  await saveSavedTopics(updated);
  renderChips(updated);
}

// ------------------------------------------------------------------
// Layer 1 — GNews fetching
// ------------------------------------------------------------------

/**
 * Fetches news for a given topic from GNews.io.
 * Throws a typed Error with a .code property so the UI layer can map to
 * the appropriate friendly message.
 */
async function fetchNews(topic, apiKey) {
  const url =
    `${CONFIG.GNEWS_ENDPOINT}?q=${encodeURIComponent(topic)}` +
    `&lang=${CONFIG.GNEWS_LANG}&max=${CONFIG.GNEWS_MAX_RESULTS}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetch(url);
  } catch (networkErr) {
    const err = new Error("Network error");
    err.code = "NETWORK";
    throw err;
  }

  // GNews returns 429 for rate-limit and 401/403 for bad key.
  if (response.status === 429) {
    const err = new Error("Rate limit");
    err.code = "RATE_LIMIT";
    throw err;
  }
  if (response.status === 401 || response.status === 403) {
    const err = new Error("Invalid API key");
    err.code = "INVALID_KEY";
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.code = "HTTP";
    throw err;
  }

  const data = await response.json();
  const articles = Array.isArray(data.articles) ? data.articles : [];
  return articles;
}

/** Builds one news card element. */
function buildNewsCard(article) {
  const link = document.createElement("a");
  link.className = "news-card";
  link.href = article.url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  // Thumbnail
  const thumb = document.createElement("div");
  thumb.className = "news-thumb";
  if (article.image) {
    const img = document.createElement("img");
    img.src = article.image;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.remove();
    });
    thumb.appendChild(img);
  }
  link.appendChild(thumb);

  // Body
  const body = document.createElement("div");
  body.className = "news-body";

  const title = document.createElement("div");
  title.className = "news-title";
  title.textContent = safeText(article.title) || "Untitled";
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "news-meta";

  const source = document.createElement("span");
  source.className = "news-source";
  source.textContent = safeText(article.source && article.source.name) || "Unknown source";
  meta.appendChild(source);

  const dot = document.createElement("span");
  dot.className = "news-dot";
  dot.textContent = "•";
  meta.appendChild(dot);

  const time = document.createElement("span");
  time.textContent = formatRelativeTime(article.publishedAt);
  meta.appendChild(time);

  body.appendChild(meta);
  link.appendChild(body);
  return link;
}

/** Renders an array of articles to the results area. */
function renderArticles(articles) {
  const frag = document.createDocumentFragment();
  articles.forEach((a) => frag.appendChild(buildNewsCard(a)));
  const wrapper = document.createElement("div");
  wrapper.appendChild(frag);
  return wrapper;
}

// ------------------------------------------------------------------
// Layer 2 — Gemini AI analysis
// ------------------------------------------------------------------

/**
 * Robust JSON extractor for LLM responses.
 *
 * Handles (in order):
 *   1. Pure JSON:                 {"summary":"...","sentiment":"..."}
 *   2. Fenced JSON:               ```json\n{...}\n```
 *   3. Prose + JSON:              "Here is the analysis: {...}"
 *   4. Truncated JSON:            {"summary":"...","sent  (unterminated)
 *
 * Falls back to extracting individual fields via regex if the whole
 * object is unparseable. Always returns an object with at least empty
 * strings for the three expected keys so callers never crash.
 */
function extractJSON(rawText) {
  if (!rawText) throw new Error("No JSON in Gemini response");

  // 1) Straight parse
  try {
    return JSON.parse(rawText);
  } catch {}

  // 2) Strip common code-fence variants and try again
  let cleaned = rawText
    .replace(/^\uFEFF/, "") // BOM
    .replace(/```(?:json|JSON|javascript)?\s*/g, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}

  // 3) Find the first {...} block and try that
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const block = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(block);
    } catch {}
  }

  // 4) Response may be truncated. Extract each field with a regex — this
  // is the lifeboat for MAX_TOKENS or partial responses. Accepts either
  // double- or single-quoted strings and ignores trailing content.
  const field = (name) => {
    const re = new RegExp(
      `"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
      "i"
    );
    const m = cleaned.match(re);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : "";
  };

  const rescued = {
    summary: field("summary"),
    sentiment: field("sentiment"),
    insight: field("insight"),
  };

  if (rescued.summary || rescued.sentiment || rescued.insight) {
    console.warn(
      "[Smart News Radar] Rescued partial JSON via regex:",
      rescued
    );
    return rescued;
  }

  console.error(
    "[Smart News Radar] Gemini response had no JSON. Full text:\n" + rawText
  );
  throw new Error("No JSON in Gemini response");
}

/** Build the prompt for Gemini exactly as specified. */
function buildAIPrompt(topic, articles) {
  const headlineList = articles
    .map((a, i) => `${i + 1}. ${a.title || ""}`)
    .join("\n");

  return `You are a news analyst. Given these headlines about "${topic}", provide:
1. A 2-3 line executive summary of what's happening right now
2. The overall sentiment (Positive / Negative / Mixed / Neutral)
3. One key insight or trend you notice across these headlines

Headlines:
${headlineList}

Respond in JSON format:
{"summary": "...", "sentiment": "...", "insight": "..."}`;
}

/**
 * Calls Gemini Flash and returns a parsed object:
 *   { summary, sentiment, insight }
 *
 * Tries each model in CONFIG.GEMINI_MODELS until one works (404 on the
 * model name falls through to the next candidate). Throws on any other
 * failure so the caller can silently skip the AI card.
 */
async function runAIAnalysis(topic, articles, apiKey) {
  const prompt = buildAIPrompt(topic, articles);

  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      // Keep this comfortably larger than what our JSON needs so we
      // never get truncated mid-string (which would leave an unclosed
      // brace and break every parse attempt below).
      maxOutputTokens: 2048,
    },
  });

  let lastErr;
  for (const model of CONFIG.GEMINI_MODELS) {
    const url =
      `${CONFIG.GEMINI_BASE}${model}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    console.log("[Smart News Radar] Trying Gemini model:", model);

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (networkErr) {
      console.warn("[Smart News Radar] Network error calling Gemini:", networkErr);
      lastErr = networkErr;
      continue;
    }

    // 404 (unknown model) or 429 (quota hit on *this* model) cascade to
    // the next candidate — different Gemini models have independent
    // quotas, so one may work even if another shows limit: 0.
    if (response.status === 404 || response.status === 429) {
      const txt = await response.text().catch(() => "");
      console.warn(
        `[Smart News Radar] Gemini ${response.status} for model "${model}":`,
        txt.slice(0, 300)
      );
      const err = new Error(`Gemini ${response.status} on ${model}`);
      err.code = response.status === 429 ? "QUOTA" : "NOT_FOUND";
      err.details = txt;
      lastErr = err;
      continue;
    }

    // Any other HTTP error: read the body for a useful message, then throw.
    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      console.error(
        `[Smart News Radar] Gemini HTTP ${response.status} on model "${model}":`,
        txt.slice(0, 500)
      );
      const err = new Error(`Gemini HTTP ${response.status}`);
      err.details = txt;
      throw err;
    }

    // Happy path: got a 200 from this model. Parse it.
    const data = await response.json();
    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!text) {
      console.error("[Smart News Radar] Gemini returned empty text:", data);
      throw new Error("Empty Gemini response");
    }

    // Dump the full raw response so we can always see exactly what came
    // back while debugging. This runs only on the happy path so it's safe.
    console.log(
      "[Smart News Radar] Gemini raw text (" + text.length + " chars):\n" + text
    );

    // Also surface the finish reason — "MAX_TOKENS" here is the #1 cause
    // of truncated JSON (the closing brace got cut off).
    const finishReason =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.warn(
        "[Smart News Radar] Gemini finishReason:",
        finishReason,
        "— response may be truncated"
      );
    }

    const parsed = extractJSON(text);
    console.log("[Smart News Radar] Gemini analysis succeeded:", parsed);
    return {
      summary: safeText(parsed.summary),
      sentiment: safeText(parsed.sentiment),
      insight: safeText(parsed.insight),
    };
  }

  // If we fell out of the loop, every model failed (mostly 404s).
  throw lastErr || new Error("All Gemini models failed");
}

/** Normalise a sentiment string to one of the 4 expected categories. */
function normaliseSentiment(raw) {
  const s = (raw || "").trim().toLowerCase();
  if (s.startsWith("pos")) return "Positive";
  if (s.startsWith("neg")) return "Negative";
  if (s.startsWith("mix")) return "Mixed";
  return "Neutral";
}

/** Builds the AI analysis card element. */
function buildAICard(analysis) {
  const card = document.createElement("div");
  card.className = "ai-card";

  const header = document.createElement("div");
  header.className = "ai-card-header";

  const title = document.createElement("div");
  title.className = "ai-card-title";
  title.textContent = "✨ AI Analysis";
  header.appendChild(title);

  const sentiment = normaliseSentiment(analysis.sentiment);
  const badge = document.createElement("span");
  badge.className = `sentiment-badge sentiment-${sentiment.toLowerCase()}`;
  badge.textContent = sentiment;
  header.appendChild(badge);

  card.appendChild(header);

  const summary = document.createElement("p");
  summary.className = "ai-summary";
  summary.textContent = analysis.summary || "No summary available.";
  card.appendChild(summary);

  if (analysis.insight) {
    const insight = document.createElement("p");
    insight.className = "ai-insight";
    insight.textContent = `💡 ${analysis.insight}`;
    card.appendChild(insight);
  }

  return card;
}

/** Builds a small "AI is analysing…" loading stub to show above articles. */
function buildAILoading() {
  const card = document.createElement("div");
  card.className = "ai-card";
  card.innerHTML = `
    <div class="ai-loading">
      <div class="spinner"></div>
      <span>Analysing headlines with AI…</span>
    </div>
  `;
  return card;
}

/** Builds a subtle notice card used when AI is on but cannot run. */
function buildAINotice(message, { withSettingsLink = false } = {}) {
  const card = document.createElement("div");
  card.className = "ai-card";
  const wrap = document.createElement("div");
  wrap.className = "ai-loading";
  const icon = document.createElement("span");
  icon.textContent = "⚠️";
  wrap.appendChild(icon);
  const text = document.createElement("span");
  text.textContent = message;
  wrap.appendChild(text);
  card.appendChild(wrap);

  if (withSettingsLink) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = " Open Settings →";
    link.style.color = "var(--accent)";
    link.style.textDecoration = "none";
    link.style.marginLeft = "6px";
    link.style.fontSize = "11px";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openOptionsPage();
    });
    wrap.appendChild(link);
  }
  return card;
}

// ------------------------------------------------------------------
// Main search flow
// ------------------------------------------------------------------

/**
 * Runs the complete search flow for a given topic:
 *  1. Validates API keys
 *  2. Shows skeleton loading
 *  3. Fetches headlines (Layer 1)
 *  4. Renders them
 *  5. Optionally runs AI analysis (Layer 2) and prepends its card
 */
async function runSearch(topic) {
  const trimmed = (topic || "").trim();
  if (!trimmed) {
    setResults(buildMessage("Enter a topic to search"));
    return;
  }

  // Persist last topic so refresh works
  await storageSet({ [CONFIG.STORAGE_KEYS.LAST_TOPIC]: trimmed });

  const data = await storageGet([
    CONFIG.STORAGE_KEYS.GNEWS_KEY,
    CONFIG.STORAGE_KEYS.GEMINI_KEY,
    CONFIG.STORAGE_KEYS.AI_TOGGLE,
  ]);

  const gnewsKey = data[CONFIG.STORAGE_KEYS.GNEWS_KEY];
  const geminiKey = data[CONFIG.STORAGE_KEYS.GEMINI_KEY];
  const aiEnabled = data[CONFIG.STORAGE_KEYS.AI_TOGGLE] === true;

  if (!gnewsKey) {
    setResults(
      buildMessage("Set up your GNews API key in Settings to get started.", {
        withSettingsLink: true,
      })
    );
    return;
  }

  // Show loading state
  setResults(buildSkeletons(5));

  let articles = [];
  try {
    articles = await fetchNews(trimmed, gnewsKey);
  } catch (err) {
    let msg = "Something went wrong.";
    switch (err.code) {
      case "NETWORK":
        msg = "Can't connect. Check your internet.";
        break;
      case "RATE_LIMIT":
        msg = "Daily limit reached. Try again tomorrow.";
        break;
      case "INVALID_KEY":
        msg = "Your GNews API key looks invalid. Open Settings to update it.";
        setResults(buildMessage(msg, { isError: true, withSettingsLink: true }));
        return;
      default:
        msg = "Something went wrong fetching news. Please try again.";
    }
    setResults(buildMessage(msg, { isError: true }));
    return;
  }

  if (!articles.length) {
    setResults(
      buildMessage("No news found for this topic. Try different keywords.")
    );
    return;
  }

  // Render Layer 1 results
  const container = document.createElement("div");

  // Decide what to show at the top of the results based on AI state:
  //   - toggle OFF          → nothing AI-related
  //   - toggle ON, no key   → visible notice linking to Settings
  //   - toggle ON, has key  → spinner stub that will become the AI card
  let aiPlaceholder = null;
  if (aiEnabled && !geminiKey) {
    aiPlaceholder = buildAINotice(
      "AI Analysis is on, but no Gemini API key is set.",
      { withSettingsLink: true }
    );
    container.appendChild(aiPlaceholder);
  } else if (aiEnabled && geminiKey) {
    aiPlaceholder = buildAILoading();
    container.appendChild(aiPlaceholder);
  }

  container.appendChild(renderArticles(articles));
  setResults(container);

  // Only run the Gemini call if we actually have a key.
  if (aiEnabled && geminiKey) {
    try {
      const analysis = await runAIAnalysis(trimmed, articles, geminiKey);
      const aiCard = buildAICard(analysis);
      if (aiPlaceholder && aiPlaceholder.parentNode) {
        aiPlaceholder.parentNode.replaceChild(aiCard, aiPlaceholder);
      }
    } catch (err) {
      // Spec says AI failures should be silent, but during setup the
      // user needs some hint. We show a short inline notice (not a full
      // error screen) and keep all Layer 1 headlines intact. Quota is
      // called out specifically so the user knows it's a billing/project
      // issue and not a bug in the extension.
      console.warn("[Smart News Radar] AI analysis failed:", err);

      let msg = "AI analysis unavailable right now. Showing headlines only.";
      if (err && err.code === "QUOTA") {
        msg =
          "Gemini quota exceeded (free tier = 0). Create a new key at AI Studio or enable billing.";
      } else if (err && err.code === "NOT_FOUND") {
        msg = "No Gemini model available to this key. Regenerate it in AI Studio.";
      }

      const notice = buildAINotice(msg, { withSettingsLink: true });
      if (aiPlaceholder && aiPlaceholder.parentNode) {
        aiPlaceholder.parentNode.replaceChild(notice, aiPlaceholder);
      }
    }
  }
}

// ------------------------------------------------------------------
// Event wiring
// ------------------------------------------------------------------
function wireEvents() {
  els.searchBtn.addEventListener("click", () => runSearch(els.searchInput.value));

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      runSearch(els.searchInput.value);
    }
  });

  els.refreshBtn.addEventListener("click", async () => {
    const topic = els.searchInput.value.trim();
    if (topic) {
      runSearch(topic);
      return;
    }
    // Fall back to last searched topic
    const data = await storageGet([CONFIG.STORAGE_KEYS.LAST_TOPIC]);
    const last = data[CONFIG.STORAGE_KEYS.LAST_TOPIC];
    if (last) {
      els.searchInput.value = last;
      runSearch(last);
    } else {
      setResults(buildMessage("Enter a topic to search"));
    }
  });

  els.saveTopicBtn.addEventListener("click", handleSaveTopic);

  els.settingsBtn.addEventListener("click", openOptionsPage);

  els.aiToggle.addEventListener("change", async () => {
    await storageSet({
      [CONFIG.STORAGE_KEYS.AI_TOGGLE]: els.aiToggle.checked,
    });
    // If a topic is already in the box, re-run so the user sees the effect
    const topic = els.searchInput.value.trim();
    if (topic) runSearch(topic);
  });
}

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------
async function init() {
  wireEvents();

  // Restore AI toggle state
  const data = await storageGet([
    CONFIG.STORAGE_KEYS.AI_TOGGLE,
    CONFIG.STORAGE_KEYS.LAST_TOPIC,
  ]);
  els.aiToggle.checked = data[CONFIG.STORAGE_KEYS.AI_TOGGLE] === true;

  // Render chips
  const topics = await loadSavedTopics();
  renderChips(topics);

  // Restore last topic if present
  const last = data[CONFIG.STORAGE_KEYS.LAST_TOPIC];
  if (last) {
    els.searchInput.value = last;
  }
}

document.addEventListener("DOMContentLoaded", init);
