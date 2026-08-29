/* Hồ sơ hướng nghiệp cá nhân: tự lưu trên trình duyệt, tổng hợp kết quả và xuất bản in PDF. */

const PROFILE_STORAGE_KEY = "dhnn_personal_profile_v1";
const PROFILE_EXPORT_VERSION = 3;
const PROFILE_FIELDS = ["talents", "strengths", "interests", "careerGoal"];
const MAX_SUBJECT_PREFERENCES = 20;
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
    subjectPreferences: [],
    talents: "",
    strengths: "",
    interests: "",
    careerGoal: "",
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

  const subjects = Array.isArray(input.subjectPreferences)
    ? input.subjectPreferences
    : (typeof input.favoriteSubjects === "string" ? input.favoriteSubjects.split(",").map((subject) => ({ subject, score: "" })) : []);
  clean.subjectPreferences = subjects.slice(0, MAX_SUBJECT_PREFERENCES).map((item) => ({
    subject: typeof item === "string" ? item.trim().slice(0, 80) : String(item?.subject || "").trim().slice(0, 80),
    score: typeof item === "object" && item !== null ? String(item.score ?? "").trim().slice(0, 12) : "",
  }));
  clean.favoriteSubjects = clean.subjectPreferences.map((item) => item.subject).filter(Boolean).join(", ").slice(0, 500);
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
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileState));
    showSaveState(`Đã tự động lưu lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`, "is-saved");
    renderProfileSummary();
    return true;
  } catch {
    showSaveState("Không thể lưu hồ sơ trên trình duyệt. Vui lòng thử lại.", "is-saving");
    return false;
  }
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
  fillSubjectPreferencesForm();
}

function syncFavoriteSubjects() {
  profileState.favoriteSubjects = profileState.subjectPreferences
    .map((item) => item.subject.trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 500);
}

function createSubjectPreferenceRow(item, index, total) {
  const row = document.createElement("div");
  row.className = "subject-preference-row";
  if (total > 1) row.classList.add("has-remove");
  row.innerHTML = `
    <label class="subject-preference-input">
      <span>Môn học ${index + 1}</span>
      <input type="text" maxlength="80" value="${escapeHtml(item.subject)}" placeholder="Ví dụ: Toán" data-subject-name="${index}" />
    </label>
    <label class="subject-preference-input">
      <span>Điểm số</span>
      <input type="number" min="0" max="10" step="0.1" value="${escapeHtml(item.score)}" placeholder="Ví dụ: 8" data-subject-score="${index}" />
    </label>
    <button class="subject-remove-button" type="button" data-remove-subject="${index}" aria-label="Xóa môn học ${index + 1}" title="Xóa môn học ${index + 1}" ${total === 1 ? "hidden" : ""}>×</button>
  `;
  return row;
}

function renderSubjectPreferences() {
  const container = document.getElementById("subject-preferences");
  const addButton = document.getElementById("add-subject-preference");
  if (!container || !addButton) return;

  if (!profileState.subjectPreferences.length) {
    profileState.subjectPreferences.push({ subject: "", score: "" });
  }

  container.innerHTML = "";
  profileState.subjectPreferences.forEach((item, index) => {
    container.appendChild(createSubjectPreferenceRow(item, index, profileState.subjectPreferences.length));
  });
  addButton.disabled = profileState.subjectPreferences.length >= MAX_SUBJECT_PREFERENCES;

  container.querySelectorAll("[data-subject-name]").forEach((input) => {
    input.addEventListener("input", () => {
      profileState.subjectPreferences[Number(input.dataset.subjectName)].subject = input.value.slice(0, 80);
      syncFavoriteSubjects();
      scheduleSave();
    });
  });
  container.querySelectorAll("[data-subject-score]").forEach((input) => {
    input.addEventListener("input", () => {
      profileState.subjectPreferences[Number(input.dataset.subjectScore)].score = input.value.slice(0, 12);
      scheduleSave();
    });
  });
  container.querySelectorAll("[data-remove-subject]").forEach((button) => {
    button.addEventListener("click", () => {
      profileState.subjectPreferences.splice(Number(button.dataset.removeSubject), 1);
      syncFavoriteSubjects();
      renderSubjectPreferences();
      scheduleSave();
    });
  });
}

function fillSubjectPreferencesForm() {
  renderSubjectPreferences();
  const addButton = document.getElementById("add-subject-preference");
  if (!addButton) return;
  addButton.addEventListener("click", () => {
    if (profileState.subjectPreferences.length >= MAX_SUBJECT_PREFERENCES) return;
    profileState.subjectPreferences.push({ subject: "", score: "" });
    renderSubjectPreferences();
    scheduleSave();
    document.querySelector(`[data-subject-name="${profileState.subjectPreferences.length - 1}"]`)?.focus();
  });
}

function renderProfileSummary() {
  const completed = TEST_IDS.filter((id) => Boolean(legacyResults[id]));

  document.getElementById("profile-avatar").textContent = "HS";
  document.getElementById("profile-code").textContent = `MÃ HỒ SƠ ${profileState.profileId}`;
  document.getElementById("profile-glance-title").textContent = "Hồ sơ của bạn";
  document.getElementById("profile-glance-meta").textContent = "Ghi lại sở thích, năng khiếu và sở trường để hoàn thiện hồ sơ.";
  document.getElementById("profile-progress-text").textContent = `${completed.length}/5 kết quả`;
  document.getElementById("profile-progress-fill").style.width = `${completed.length * 20}%`;
  renderStatus(completed, document.getElementById("profile-status"));
}

function renderStatus(completed, el) {
  if (!completed.length) {
    el.innerHTML = "<p>Chưa có kết quả trắc nghiệm được lưu trên thiết bị này.</p>";
    return;
  }
  const doneList = completed.map((id) => `<span class="badge badge-done">${TEST_LABELS[id]}</span>`).join(" ");
  el.innerHTML = `<p>Đã lưu:</p><div>${doneList}</div>${completed.length === TEST_IDS.length ? '<p class="result-highlight">Đã đủ 5 kết quả!</p>' : ""}`;
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

function formatSubjectPreferences() {
  return profileState.subjectPreferences
    .filter((item) => item.subject.trim() || item.score.trim())
    .map((item, index) => `Môn học ${index + 1}: ${item.subject.trim() || "Chưa cập nhật"}${item.score.trim() ? ` — Điểm số: ${item.score.trim()}` : ""}`)
    .join("\n");
}

function collectResultChartImages() {
  return Array.from(document.querySelectorAll("#radar-grid .radar-card")).map((card, index) => {
    const canvas = card.querySelector("canvas");
    const title = card.querySelector("h3")?.textContent?.trim() || `Kết quả trắc nghiệm ${index + 1}`;
    if (!canvas) return null;
    try {
      return { title, dataUrl: canvas.toDataURL("image/png") };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function buildPrintableProfile(chartImages = []) {
  const printEl = document.getElementById("print-profile");
  const mbtiResult = legacyResults.mbti?.result;
  const infoItems = [
    ["Sở thích môn học", formatSubjectPreferences(), true],
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
    <section class="print-profile-section print-result-images-section">
      <h2>Hình ảnh kết quả trắc nghiệm đã làm</h2>
      ${chartImages.length ? `
        <div class="print-result-images">
          ${chartImages.map((image, index) => `
            <figure>
              <img src="${image.dataUrl}" alt="Biểu đồ kết quả ${escapeHtml(image.title)}" />
              <figcaption>${escapeHtml(image.title)}</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : "<p>Chưa có biểu đồ kết quả được lưu trên thiết bị này.</p>"}
      ${mbtiResult?.code ? `
        <div class="print-mbti-result">
          <span>Kết quả MBTI</span>
          <strong>${escapeHtml(mbtiResult.code)}</strong>
          <p>${Array.isArray(mbtiResult.breakdown) ? mbtiResult.breakdown.map((item) => `${escapeHtml(item.axis)}: ${escapeHtml(item.result)}`).join(" · ") : ""}</p>
        </div>
      ` : ""}
    </section>
    <footer class="print-profile-footer">Kết quả chỉ mang tính tham khảo và nên được kết hợp với năng lực học tập, hoàn cảnh thực tế cùng tư vấn chuyên môn.</footer>
  `;
}

async function downloadProfilePdf() {
  window.clearTimeout(saveTimer);
  persistProfile();
  const chartImages = collectResultChartImages();
  buildPrintableProfile(chartImages);
  const oldTitle = document.title;
  document.title = "ho-so-huong-nghiep";
  window.addEventListener("afterprint", () => { document.title = oldTitle; }, { once: true });
  const printableImages = Array.from(document.querySelectorAll("#print-profile img"));
  await Promise.all(printableImages.map(async (image) => {
    try {
      if (typeof image.decode === "function") await image.decode();
    } catch {
      // The print dialog can still render any image the browser has already loaded.
    }
  }));
  window.print();
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
      options: { animation: false, scales: { r: { min: 0, max: 100, ticks: { stepSize: 25 } } }, plugins: { legend: { display: false } } },
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
