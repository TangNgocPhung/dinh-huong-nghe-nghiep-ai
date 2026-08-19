/* Hồ sơ hướng nghiệp cá nhân: tự lưu trên trình duyệt, tổng hợp kết quả và xuất bản in PDF. */

const PROFILE_STORAGE_KEY = "dhnn_personal_profile_v1";
const PROFILE_EXPORT_VERSION = 1;
const PROFILE_FIELDS = ["favoriteSubjects", "talents", "strengths", "interests", "careerGoal"];
const TEST_IDS = ["holland", "mi", "mbti", "disc", "motivators"];
const TEST_LABELS = {
  holland: "Holland (RIASEC)",
  mi: "Đa trí thông minh",
  mbti: "MBTI",
  disc: "DISC",
  motivators: "Động lực",
};

let profileState = loadProfile();
let legacyResults = {};
let saveTimer = null;

function createProfileId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID().split("-")[0].toUpperCase();
  }
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function emptyProfile() {
  return {
    profileId: createProfileId(),
    createdAt: new Date().toISOString(),
    updatedAt: "",
    favoriteSubjects: "",
    talents: "",
    strengths: "",
    interests: "",
    careerGoal: "",
    assessmentResults: { holland: "", mi: "", mbti: "", disc: "", motivators: "" },
  };
}

function normalizeProfile(input) {
  const clean = emptyProfile();
  if (!input || typeof input !== "object") return clean;

  clean.profileId = typeof input.profileId === "string" && input.profileId.trim() ? input.profileId.trim().slice(0, 32) : clean.profileId;
  clean.createdAt = typeof input.createdAt === "string" ? input.createdAt : clean.createdAt;
  clean.updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : "";

  PROFILE_FIELDS.forEach((field) => {
    clean[field] = typeof input[field] === "string" ? input[field].slice(0, 500) : "";
  });
  TEST_IDS.forEach((id) => {
    const value = input.assessmentResults && input.assessmentResults[id];
    clean.assessmentResults[id] = typeof value === "string" ? value.slice(0, 300) : "";
  });
  return clean;
}

function loadProfile() {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null"));
  } catch {
    return emptyProfile();
  }
}

function showSaveState(message, className = "") {
  const el = document.getElementById("profile-save-state");
  if (!el) return;
  el.textContent = message;
  el.className = `profile-save-state ${className}`.trim();
}

function persistProfile() {
  profileState.updatedAt = new Date().toISOString();
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileState));
  showSaveState(`Đã tự động lưu lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`, "is-saved");
  renderProfileSummary();
}

function scheduleSave() {
  showSaveState("Đang lưu thay đổi...", "is-saving");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistProfile, 350);
  renderProfileSummary();
}

function fillProfileForm() {
  document.querySelectorAll("[data-profile-field]").forEach((input) => {
    input.value = profileState[input.name] || "";
    input.addEventListener("input", () => {
      profileState[input.name] = input.value;
      scheduleSave();
    });
  });

  document.querySelectorAll("[data-assessment-result]").forEach((input) => {
    const id = input.dataset.assessmentResult;
    input.value = profileState.assessmentResults[id] || "";
    input.addEventListener("input", () => {
      profileState.assessmentResults[id] = input.value;
      scheduleSave();
    });
  });
}

function hasResult(id) {
  return Boolean(profileState.assessmentResults[id].trim() || legacyResults[id]);
}

function completedTestIds() {
  return TEST_IDS.filter(hasResult);
}

function renderProfileSummary() {
  const completed = completedTestIds();

  document.getElementById("profile-avatar").textContent = "HS";
  document.getElementById("profile-code").textContent = `MÃ HỒ SƠ ${profileState.profileId}`;
  document.getElementById("profile-glance-title").textContent = "Hồ sơ của bạn";
  document.getElementById("profile-glance-meta").textContent = "Ghi lại sở thích, năng khiếu và sở trường để hoàn thiện hồ sơ.";
  document.getElementById("profile-progress-text").textContent = `${completed.length}/5 kết quả`;
  document.getElementById("profile-progress-fill").style.width = `${completed.length * 20}%`;

  TEST_IDS.forEach((id) => {
    const card = document.querySelector(`[data-result-card="${id}"]`);
    if (card) card.classList.toggle("is-complete", hasResult(id));
  });

  renderStatus(completed, document.getElementById("profile-status"));
}

function renderStatus(done, el) {
  const missing = TEST_IDS.filter((id) => !done.includes(id));
  if (!done.length) {
    el.innerHTML = `<p>Chưa có kết quả. Hãy làm bài test và nhập kết quả vào hồ sơ.</p>`;
    return;
  }

  const doneList = done.map((id) => `<span class="badge badge-done">${TEST_LABELS[id]}</span>`).join(" ");
  el.innerHTML = `<p>Đã lưu:</p><div>${doneList}</div>${missing.length ? `<p>Còn ${missing.length} công cụ để hoàn thiện hồ sơ.</p>` : `<p class="result-highlight">Đã đủ 5 mảnh ghép!</p>`}`;
}

function legacyResultSummary(id, payload) {
  if (!payload || !payload.result) return "";
  if (id === "mbti" && payload.result.code) return payload.result.code;
  if (Array.isArray(payload.result.dimensions)) {
    return payload.result.dimensions.slice(0, 3).map((item) => `${item.name}${Number.isFinite(item.percent) ? ` (${item.percent}%)` : ""}`).join(", ");
  }
  return "Đã hoàn thành";
}

function resultSummary(id) {
  return profileState.assessmentResults[id].trim() || legacyResultSummary(id, legacyResults[id]) || "Chưa nhập kết quả";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valueOrEmpty(value) {
  return value && value.trim() ? escapeHtml(value.trim()) : "Chưa cập nhật";
}

function buildPrintableProfile() {
  const printEl = document.getElementById("print-profile");
  const infoItems = [
    ["Sở thích môn học", profileState.favoriteSubjects, true],
    ["Năng khiếu", profileState.talents],
    ["Sở trường", profileState.strengths],
    ["Sở thích và hoạt động", profileState.interests, true],
    ["Mục tiêu hoặc nghề đang quan tâm", profileState.careerGoal, true],
  ];

  printEl.innerHTML = `
    <header class="print-profile-header">
      <div>
        <div class="print-profile-brand">Định Hướng Nghề Nghiệp AI</div>
        <h1>Hồ sơ của tôi</h1>
        <p class="print-profile-subtitle">Hồ sơ năng lực và định hướng nghề nghiệp cá nhân</p>
      </div>
      <div class="print-profile-date">Mã hồ sơ: ${escapeHtml(profileState.profileId)}<br />Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}</div>
    </header>
    <section class="print-profile-section">
      <h2>Thông tin và chân dung cá nhân</h2>
      <div class="print-info-grid">
        ${infoItems.map(([label, value, wide]) => `<div class="print-info-item ${wide ? "wide" : ""}"><span>${label}</span><p>${valueOrEmpty(value)}</p></div>`).join("")}
      </div>
    </section>
    <section class="print-profile-section">
      <h2>Kết quả các công cụ tự nhận thức</h2>
      <div class="print-result-list">
        ${TEST_IDS.map((id) => `<div class="print-result-item"><strong>${TEST_LABELS[id]}</strong><span>${escapeHtml(resultSummary(id))}</span></div>`).join("")}
      </div>
    </section>
    <footer class="print-profile-footer">Kết quả chỉ mang tính tham khảo và nên được kết hợp với năng lực học tập, hoàn cảnh thực tế cùng tư vấn chuyên môn.</footer>
  `;
}

function downloadProfilePdf() {
  window.clearTimeout(saveTimer);
  persistProfile();
  buildPrintableProfile();
  const oldTitle = document.title;
  document.title = "ho-so-huong-nghiep";
  window.addEventListener("afterprint", () => { document.title = oldTitle; }, { once: true });
  window.setTimeout(() => window.print(), 80);
}

function exportProfileData() {
  window.clearTimeout(saveTimer);
  persistProfile();
  const payload = {
    app: "Dinh Huong Nghe Nghiep AI",
    version: PROFILE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: profileState,
    quizResults: legacyResults,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ho-so-huong-nghiep.json";
  anchor.click();
  URL.revokeObjectURL(url);
  showSaveState("Đã tải bản sao lưu hồ sơ", "is-saved");
}

function importProfileData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result));
      const importedProfile = payload.profile || payload;
      if (!importedProfile || typeof importedProfile !== "object") throw new Error("invalid");
      if (!window.confirm("Khôi phục tệp này sẽ thay thế hồ sơ đang lưu trên trình duyệt. Bạn có muốn tiếp tục?")) return;

      profileState = normalizeProfile(importedProfile);
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileState));
      if (payload.quizResults && typeof payload.quizResults === "object") {
        TEST_IDS.forEach((id) => {
          if (payload.quizResults[id]) localStorage.setItem(`dhnn_result_${id}`, JSON.stringify(payload.quizResults[id]));
        });
      }
      window.location.reload();
    } catch {
      window.alert("Tệp sao lưu không hợp lệ. Vui lòng chọn đúng tệp JSON đã tải từ website này.");
    }
  });
  reader.readAsText(file, "utf-8");
}

function bindProfileActions() {
  [document.getElementById("download-profile"), ...document.querySelectorAll("[data-download-profile]")].filter(Boolean).forEach((button) => button.addEventListener("click", downloadProfilePdf));
  [document.getElementById("export-profile"), ...document.querySelectorAll("[data-export-profile]")].filter(Boolean).forEach((button) => button.addEventListener("click", exportProfileData));

  const fileInput = document.getElementById("profile-file-input");
  document.getElementById("import-profile").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    importProfileData(fileInput.files[0]);
    fileInput.value = "";
  });
}

function renderLegacySections() {
  const chartSection = document.getElementById("profile-chart-section");
  const mbtiSection = document.getElementById("profile-mbti-section");
  const likertResults = Object.entries(legacyResults).filter(([id, payload]) => id !== "mbti" && payload?.result?.dimensions);

  if (likertResults.length > 0 && typeof Chart !== "undefined") {
    chartSection.style.display = "";
    renderRadarChart(likertResults);
  }
  if (legacyResults.mbti?.result?.code) {
    mbtiSection.style.display = "";
    renderMbtiBadge(legacyResults.mbti);
  }
}

function renderRadarChart(likertResults) {
  const colors = ["#4f46e5", "#0891b2", "#c2410c", "#15803d"];
  const grid = document.getElementById("radar-grid");
  grid.innerHTML = "";
  likertResults.forEach(([testId, payload], index) => {
    const card = document.createElement("div");
    card.className = "radar-card";
    card.innerHTML = `<h3>${TEST_LABELS[testId]}</h3><canvas id="radar-${testId}"></canvas>`;
    grid.appendChild(card);
    const dimensions = payload.result.dimensions;
    const color = colors[index % colors.length];
    new Chart(card.querySelector("canvas").getContext("2d"), {
      type: "radar",
      data: { labels: dimensions.map((item) => item.name), datasets: [{ data: dimensions.map((item) => item.percent), backgroundColor: `${color}33`, borderColor: color, borderWidth: 2, pointBackgroundColor: color }] },
      options: { scales: { r: { min: 0, max: 100, ticks: { stepSize: 25 } } }, plugins: { legend: { display: false } } },
    });
  });
}

function renderMbtiBadge(payload) {
  const el = document.getElementById("mbti-badge");
  const breakdown = Array.isArray(payload.result.breakdown) ? payload.result.breakdown : [];
  el.innerHTML = `<div class="mbti-code">${escapeHtml(payload.result.code)}</div><div class="mbti-breakdown">${breakdown.map((item) => `<div>${escapeHtml(item.axis)}: <strong>${escapeHtml(item.result)}</strong></div>`).join("")}</div>`;
}

function initProfilePage() {
  legacyResults = typeof QuizEngine !== "undefined" ? QuizEngine.getAllResults() : {};
  if (!localStorage.getItem(PROFILE_STORAGE_KEY)) {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileState));
  }
  fillProfileForm();
  bindProfileActions();
  renderProfileSummary();
  renderLegacySections();
  if (profileState.updatedAt) {
    const savedDate = new Date(profileState.updatedAt);
    showSaveState(`Đã lưu gần nhất lúc ${savedDate.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`, "is-saved");
  }
}

document.addEventListener("DOMContentLoaded", initProfilePage);
