"use strict";

const state = {
  topics: [], currentTopic: null, dashboard: null, config: null,
  activeRunId: null, pollTimer: null, sentimentFilter: "all",
};

const el = (id) => document.getElementById(id);
const labels = { positive: "Positif", neutral: "Netral", negative: "Negatif" };
const runLabels = { queued: "Menunggu", running: "Berjalan", succeeded: "Selesai", failed: "Gagal" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    notation: number >= 10000 ? "compact" : "standard", maximumFractionDigits: 1,
  }).format(number);
}

function formatDate(value, includeTime = false) {
  if (!value) return "Belum ada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tidak diketahui";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
  return payload;
}

function toast(message, isError = false) {
  const node = el("toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => { node.hidden = true; }, 4200);
}

function setNotice(message = "", isError = false) {
  const node = el("global-notice");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.hidden = !message;
}

function openModal(id) {
  el(id).hidden = false;
  const first = el(id).querySelector("input, textarea, button");
  window.setTimeout(() => first?.focus(), 20);
}

function closeModal(id) { el(id).hidden = true; }

function initials(name) {
  return String(name || "X").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function renderAvatar(person, size = "") {
  const extra = size ? ` ${size}` : "";
  if (person.author_avatar) {
    return `<span class="avatar${extra}"><img src="${escapeHtml(person.author_avatar)}" alt=""></span>`;
  }
  return `<span class="avatar${extra}" aria-hidden="true">${escapeHtml(initials(person.author_name))}</span>`;
}

async function loadConfig() {
  try {
    state.config = await api("/api/config");
    const ready = state.config.token_configured;
    el("token-indicator").className = `status-indicator ${ready ? "connected" : "error"}`;
    el("token-status").textContent = ready ? "Apify Udah Nyambung" : "Mode demo aktif";
    el("actor-status").textContent = ready ? "Token udah nyambung" : "Isi token untuk data nyata";
    el("confirm-cost").textContent = `US$${Number(state.config.max_charge_usd).toFixed(2).replace(".", ",")}`;
  } catch (error) {
    el("token-indicator").className = "status-indicator error";
    el("token-status").textContent = "Server bermasalah";
    el("actor-status").textContent = error.message;
  }
}

async function loadTopics(preferredId = null) {
  const payload = await api("/api/topics");
  state.topics = payload.topics;
  renderTopicList();
  if (!state.topics.length) {
    showEmpty();
    return;
  }
  const next = state.topics.find((topic) => topic.id === preferredId)
    || state.topics.find((topic) => topic.id === state.currentTopic?.id)
    || state.topics[0];
  await selectTopic(next.id);
}

function renderTopicList() {
  const list = el("topic-list");
  if (!state.topics.length) {
    list.innerHTML = '<div class="sidebar-empty">Belum ada topik.</div>';
    return;
  }
  list.innerHTML = state.topics.map((topic) => `
    <button class="topic-item ${state.currentTopic?.id === topic.id ? "active" : ""}" type="button" data-topic-id="${topic.id}">
      <span><strong>${escapeHtml(topic.name)}</strong><small>${topic.is_demo ? "Data contoh" : `${topic.lookback_days} hari terakhir`}</small></span>
      <span class="topic-count">${formatNumber(topic.post_count)}</span>
    </button>
  `).join("");
  list.querySelectorAll("[data-topic-id]").forEach((button) => {
    button.addEventListener("click", () => selectTopic(Number(button.dataset.topicId)));
  });
}

function showEmpty() {
  state.currentTopic = null;
  state.dashboard = null;
  el("empty-state").hidden = false;
  el("dashboard").hidden = true;
  el("topbar-actions").hidden = true;
  el("page-title").textContent = "Ringkasan percakapan";
  el("page-query").textContent = "Buat topik untuk melihat data.";
  setNotice("");
}

async function selectTopic(id) {
  const topic = state.topics.find((item) => item.id === id);
  if (!topic) return;
  state.currentTopic = topic;
  renderTopicList();
  el("empty-state").hidden = true;
  el("dashboard").hidden = false;
  el("topbar-actions").hidden = false;
  el("page-title").textContent = topic.name;
  el("page-query").textContent = topic.query;
  el("export-button").href = `/api/topics/${topic.id}/export.csv`;
  el("collect-button").textContent = topic.is_demo ? "Buat topik nyata" : "Ambil data";
  el("date-window").textContent = `${topic.lookback_days} hari`;
  document.querySelector(".sidebar").classList.remove("open");
  if (topic.is_demo) {
    setNotice("Ini data contoh untuk melihat seluruh fungsi dashboard. Buat topik baru untuk mengambil data nyata dari X.");
  } else if (!state.config?.token_configured) {
    setNotice("Topik sudah dibuat, tetapi token Apify belum diisi di file .env.", true);
  } else {
    setNotice("");
  }
  await loadDashboard();
}

async function loadDashboard() {
  if (!state.currentTopic) return;
  try {
    state.dashboard = await api(`/api/topics/${state.currentTopic.id}/dashboard`);
    renderDashboard();
    const run = state.dashboard.last_run;
    if (run && ["queued", "running"].includes(run.status)) {
      state.activeRunId = run.id;
      showRunBanner(run.status);
      startRunPolling();
    } else {
      el("run-banner").hidden = true;
    }
  } catch (error) {
    toast(error.message, true);
  }
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return;
  el("metric-mentions").textContent = formatNumber(data.summary.mentions);
  el("metric-engagement").textContent = formatNumber(data.summary.engagement);
  el("metric-authors").textContent = formatNumber(data.summary.authors);
  el("metric-audience").textContent = formatNumber(data.summary.audience);
  renderSentiment(data.sentiment);
  renderVolumeChart(data.timeline);
  renderAuthors(data.top_authors);
  renderHashtags(data.hashtags);
  renderRunDetails(data.last_run);
  renderConversations();
}

function renderSentiment(values) {
  const total = values.positive + values.neutral + values.negative;
  const positive = total ? Math.round(values.positive / total * 100) : 0;
  const neutral = total ? Math.round(values.neutral / total * 100) : 0;
  const negative = total ? Math.max(0, 100 - positive - neutral) : 0;
  el("sentiment-total").textContent = formatNumber(total);
  el("positive-value").textContent = `${positive}%`;
  el("neutral-value").textContent = `${neutral}%`;
  el("negative-value").textContent = `${negative}%`;
  el("sentiment-donut").style.background = total
    ? `conic-gradient(var(--positive) 0 ${positive}%, var(--neutral) ${positive}% ${positive + neutral}%, var(--negative) ${positive + neutral}% 100%)`
    : "conic-gradient(var(--neutral) 0 100%)";
}

function renderVolumeChart(points) {
  const canvas = el("volume-chart");
  const empty = el("chart-empty");
  empty.hidden = points.length > 0;
  if (!points.length) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = rect.width;
  const height = rect.height;
  const pad = { top: 18, right: 16, bottom: 34, left: 36 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const styles = getComputedStyle(document.documentElement);
  const border = styles.getPropertyValue("--border").trim();
  const muted = styles.getPropertyValue("--muted").trim();
  const accent = styles.getPropertyValue("--accent").trim();
  const maxValue = Math.max(...points.map((point) => point.count), 1);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.strokeStyle = border;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  for (let index = 0; index <= 3; index += 1) {
    const y = pad.top + chartHeight * index / 3;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    const rawLabel = maxValue * (1 - index / 3);
    const label = maxValue < 4 ? rawLabel.toFixed(1).replace(".0", "") : Math.round(rawLabel);
    ctx.fillText(String(label), 4, y + 3);
  }
  const x = (index) => pad.left + (points.length === 1 ? chartWidth / 2 : chartWidth * index / (points.length - 1));
  const y = (value) => pad.top + chartHeight - (value / maxValue) * chartHeight;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.count)) : ctx.moveTo(x(index), y(point.count)));
  ctx.strokeStyle = accent; ctx.lineWidth = 2.2; ctx.stroke();
  points.forEach((point, index) => {
    ctx.beginPath(); ctx.arc(x(index), y(point.count), 3.4, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
    const label = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(`${point.day}T00:00:00`));
    ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.fillText(label, x(index), height - 9);
  });
  ctx.textAlign = "start";
}

function renderAuthors(authors) {
  el("top-authors").innerHTML = authors.length ? authors.map((author) => `
    <div class="rank-row">
      ${renderAvatar(author)}
      <div class="rank-name"><strong>${escapeHtml(author.author_name)}</strong><span>@${escapeHtml(author.author_username)} · ${formatNumber(author.followers)} pengikut</span></div>
      <div class="rank-value"><strong>${formatNumber(author.engagement)}</strong><span>interaksi</span></div>
    </div>
  `).join("") : '<div class="list-placeholder">Belum ada data akun.</div>';
}

function renderHashtags(hashtags) {
  el("hashtag-list").innerHTML = hashtags.length ? hashtags.map((item) => `
    <span class="hashtag-chip">#${escapeHtml(item.tag)} <strong>${formatNumber(item.count)}</strong></span>
  `).join("") : '<div class="list-placeholder">Belum ada hashtag terkait.</div>';
}

function renderRunDetails(run) {
  if (!run) {
    el("run-details").innerHTML = '<div><dt>Status</dt><dd>Belum pernah dijalankan</dd></div>';
    return;
  }
  el("run-details").innerHTML = `
    <div><dt>Status</dt><dd class="status-text ${escapeHtml(run.status)}">${escapeHtml(runLabels[run.status] || run.status)}</dd></div>
    <div><dt>Waktu</dt><dd>${escapeHtml(formatDate(run.finished_at || run.requested_at, true))}</dd></div>
    <div><dt>Diterima</dt><dd>${formatNumber(run.items_received)} tweet</dd></div>
    <div><dt>Data baru</dt><dd>${formatNumber(run.items_new)} tweet</dd></div>
  `;
}

function renderConversations() {
  const posts = state.dashboard?.posts || [];
  const filtered = state.sentimentFilter === "all" ? posts : posts.filter((post) => post.sentiment === state.sentimentFilter);
  el("conversation-list").innerHTML = filtered.map((post) => `
    <article class="conversation">
      <div class="conversation-author">
        ${renderAvatar(post)}
        <div><strong>${escapeHtml(post.author_name)}</strong><span>@${escapeHtml(post.author_username)}</span><span>${formatNumber(post.author_followers)} pengikut</span></div>
      </div>
      <div class="conversation-body">
        <p>${escapeHtml(post.text)}</p>
        <div class="conversation-meta"><span class="sentiment-badge ${escapeHtml(post.sentiment)}">${escapeHtml(labels[post.sentiment] || post.sentiment)}</span><span>${escapeHtml(formatDate(post.created_at, true))}</span>${post.hashtags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
      <div class="conversation-stats">
        <div class="stat-cell"><span>Like</span><strong>${formatNumber(post.like_count)}</strong></div>
        <div class="stat-cell"><span>Repost</span><strong>${formatNumber(post.retweet_count)}</strong></div>
        <div class="stat-cell"><span>Balasan</span><strong>${formatNumber(post.reply_count)}</strong></div>
        <div class="stat-cell"><span>Dilihat</span><strong>${formatNumber(post.view_count)}</strong></div>
        <a class="source-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">Buka sumber</a>
      </div>
    </article>
  `).join("");
  el("conversation-empty").hidden = filtered.length > 0;
}

function showRunBanner(status) {
  el("run-banner").hidden = false;
  el("run-banner-title").textContent = status === "queued" ? "Pengambilan data dijadwalkan" : "Mengambil data dari X";
  el("run-banner-copy").textContent = "Proses berjalan di background. Dashboard akan diperbarui otomatis.";
}

function startRunPolling() {
  window.clearTimeout(state.pollTimer);
  if (!state.activeRunId) return;
  state.pollTimer = window.setTimeout(async () => {
    try {
      const run = await api(`/api/runs/${state.activeRunId}`);
      if (["queued", "running"].includes(run.status)) {
        showRunBanner(run.status);
        startRunPolling();
        return;
      }
      state.activeRunId = null;
      el("run-banner").hidden = true;
      await loadTopics(state.currentTopic?.id);
      if (run.status === "succeeded") toast(`${run.items_new} tweet baru ditambahkan.`);
      else toast(run.error || "Pengambilan data gagal.", true);
    } catch (error) {
      toast(error.message, true);
      startRunPolling();
    }
  }, 2200);
}

function prepareCollection() {
  if (!state.currentTopic) return;
  if (state.currentTopic.is_demo) {
    openModal("topic-modal");
    return;
  }
  if (!state.config?.token_configured) {
    toast("Isi APIFY_API_TOKEN di file .env terlebih dahulu.", true);
    return;
  }
  el("confirm-topic").textContent = state.currentTopic.name;
  el("confirm-limit").textContent = `${formatNumber(state.currentTopic.max_items)} tweet`;
  openModal("collect-modal");
}

async function confirmCollection() {
  if (!state.currentTopic) return;
  const button = el("confirm-collect");
  button.disabled = true;
  button.textContent = "Menjadwalkan...";
  try {
    const result = await api(`/api/topics/${state.currentTopic.id}/collect`, {
      method: "POST", body: JSON.stringify({ confirmed: true }),
    });
    state.activeRunId = result.run_id;
    closeModal("collect-modal");
    showRunBanner(result.status);
    startRunPolling();
    toast("Pengambilan data dimulai.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Mulai pengambilan";
  }
}

async function createTopic(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const errorNode = el("topic-form-error");
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.max_items = Number(payload.max_items);
  payload.lookback_days = Number(payload.lookback_days);
  submit.disabled = true;
  errorNode.hidden = true;
  try {
    const topic = await api("/api/topics", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    closeModal("topic-modal");
    await loadTopics(topic.id);
    toast("Topik dibuat. Klik Ambil data saat Anda siap.");
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function bindEvents() {
  ["add-topic-button", "empty-add-button"].forEach((id) => el(id).addEventListener("click", () => openModal("topic-modal")));
  ["close-topic-modal", "cancel-topic"].forEach((id) => el(id).addEventListener("click", () => closeModal("topic-modal")));
  ["close-collect-modal", "cancel-collect"].forEach((id) => el(id).addEventListener("click", () => closeModal("collect-modal")));
  el("topic-form").addEventListener("submit", createTopic);
  el("collect-button").addEventListener("click", prepareCollection);
  el("confirm-collect").addEventListener("click", confirmCollection);
  el("sentiment-filter").addEventListener("change", (event) => { state.sentimentFilter = event.target.value; renderConversations(); });
  el("mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  el("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("sinyalx-theme", next);
    if (state.dashboard) renderVolumeChart(state.dashboard.timeline);
  });
  ["topic-modal", "collect-modal"].forEach((id) => el(id).addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModal(id); }));
  const observer = new ResizeObserver(() => { if (state.dashboard) renderVolumeChart(state.dashboard.timeline); });
  observer.observe(el("volume-chart").parentElement);
}

async function init() {
  const savedTheme = localStorage.getItem("sinyalx-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  bindEvents();
  try {
    await loadConfig();
    await loadTopics();
  } catch (error) {
    setNotice(`Dashboard tidak dapat dimuat: ${error.message}`, true);
    toast(error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", init);
