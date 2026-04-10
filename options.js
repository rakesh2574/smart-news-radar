/**
 * Smart News Radar — options.js
 *
 * Settings page logic: stores the two API keys in chrome.storage.local.
 * No keys are ever logged or transmitted anywhere by this script.
 */

const els = {
  gnewsKey: document.getElementById("gnewsKey"),
  geminiKey: document.getElementById("geminiKey"),
  saveBtn: document.getElementById("saveBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),
};

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

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

function setStatus(msg, kind = "") {
  els.status.textContent = msg;
  els.status.className = "status" + (kind ? " " + kind : "");
  if (msg) {
    setTimeout(() => {
      els.status.textContent = "";
      els.status.className = "status";
    }, 2500);
  }
}

async function loadSettings() {
  const data = await storageGet([
    CONFIG.STORAGE_KEYS.GNEWS_KEY,
    CONFIG.STORAGE_KEYS.GEMINI_KEY,
  ]);
  els.gnewsKey.value = data[CONFIG.STORAGE_KEYS.GNEWS_KEY] || "";
  els.geminiKey.value = data[CONFIG.STORAGE_KEYS.GEMINI_KEY] || "";
}

async function saveSettings() {
  const gnews = els.gnewsKey.value.trim();
  const gemini = els.geminiKey.value.trim();

  if (!gnews) {
    setStatus("GNews API key is required.", "error");
    return;
  }

  try {
    await storageSet({
      [CONFIG.STORAGE_KEYS.GNEWS_KEY]: gnews,
      [CONFIG.STORAGE_KEYS.GEMINI_KEY]: gemini,
    });
    setStatus("Saved ✓", "success");
  } catch (err) {
    setStatus("Failed to save settings.", "error");
  }
}

async function clearSettings() {
  try {
    await storageRemove([
      CONFIG.STORAGE_KEYS.GNEWS_KEY,
      CONFIG.STORAGE_KEYS.GEMINI_KEY,
    ]);
    els.gnewsKey.value = "";
    els.geminiKey.value = "";
    setStatus("Keys cleared", "success");
  } catch (err) {
    setStatus("Failed to clear keys.", "error");
  }
}

function wireEvents() {
  els.saveBtn.addEventListener("click", saveSettings);
  els.clearBtn.addEventListener("click", clearSettings);

  // Allow Enter key inside either input to save
  [els.gnewsKey, els.geminiKey].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveSettings();
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  await loadSettings();
});
