/* Hồ sơ hướng nghiệp cá nhân: tự lưu trên trình duyệt, tổng hợp kết quả và xuất bản in PDF. */

const PROFILE_STORAGE_KEY = "dhnn_personal_profile_v1";
const PROFILE_EXPORT_VERSION = 2;
const PROFILE_FIELDS = ["favoriteSubjects", "talents", "strengths", "interests", "careerGoal"];
const MAX_RESULT_IMAGES = 5;
const MAX_IMAGE_EDGE = 1200;
const RESULT_IMAGE_QUALITY = 0.74;
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
    resultImages: [],
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
  clean.resultImages = Array.isArray(input.resultImages)
    ? input.resultImages
      .filter((image) => image && typeof image.dataUrl === "string" && /^data:image\/(?:jpeg|png|webp);base64,/i.test(image.dataUrl))
      .slice(0, MAX_RESULT_IMAGES)
      .map((image, index) => ({
        id: typeof image.id === "string" && image.id ? image.id.slice(0, 80) : `image-${index + 1}`,
        name: typeof image.name === "string" && image.name ? image.name.slice(0, 120) : `Ảnh kết quả ${index + 1}`,
        dataUrl: image.dataUrl,
      }))
    : [];
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
    showSaveState("Không đủ dung lượng lưu ảnh. Hãy xóa bớt ảnh và thử lại.", "is-saving");
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
}

function renderProfileSummary() {
  const imageCount = profileState.resultImages.length;

  document.getElementById("profile-avatar").textContent = "HS";
  document.getElementById("profile-code").textContent = `MÃ HỒ SƠ ${profileState.profileId}`;
  document.getElementById("profile-glance-title").textContent = "Hồ sơ của bạn";
  document.getElementById("profile-glance-meta").textContent = "Ghi lại sở thích, năng khiếu và sở trường để hoàn thiện hồ sơ.";
  document.getElementById("profile-progress-text").textContent = `${imageCount}/5 ảnh`;
  document.getElementById("profile-progress-fill").style.width = `${imageCount * 20}%`;
  renderStatus(imageCount, document.getElementById("profile-status"));
  renderResultImages();
}

function renderStatus(imageCount, el) {
  if (!imageCount) {
    el.innerHTML = "<p>Chưa có ảnh kết quả. Hãy thêm ảnh để đưa vào hồ sơ PDF.</p>";
    return;
  }
  el.innerHTML = `<p>Đã lưu ${imageCount} ảnh kết quả trong hồ sơ.</p>${imageCount === MAX_RESULT_IMAGES ? '<p class="result-highlight">Đã đủ 5 ảnh kết quả!</p>' : ""}`;
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

function renderResultImages() {
  const grid = document.getElementById("result-images-grid");
  const empty = document.getElementById("result-images-empty");
  if (!grid || !empty) return;

  empty.hidden = profileState.resultImages.length > 0;
  grid.innerHTML = profileState.resultImages.map((image, index) => `
    <figure class="result-image-card">
      <img src="${image.dataUrl}" alt="Ảnh kết quả học sinh ${index + 1}" />
      <figcaption>
        <span>${escapeHtml(image.name)}</span>
        <button type="button" data-remove-result-image="${escapeHtml(image.id)}" aria-label="Xóa ${escapeHtml(image.name)}">Xóa ảnh</button>
      </figcaption>
    </figure>
  `).join("");
}

function compressResultImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      reject(new Error("Định dạng ảnh không được hỗ trợ"));
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      reject(new Error("Ảnh lớn hơn 15 MB"));
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("Không thể đọc ảnh")));
    reader.addEventListener("load", () => {
      const sourceImage = new Image();
      sourceImage.addEventListener("error", () => reject(new Error("Ảnh không hợp lệ")));
      sourceImage.addEventListener("load", () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceImage.width, sourceImage.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceImage.width * scale));
        canvas.height = Math.max(1, Math.round(sourceImage.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
        resolve({
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name.slice(0, 120) || "Ảnh kết quả",
          dataUrl: canvas.toDataURL("image/jpeg", RESULT_IMAGE_QUALITY),
        });
      });
      sourceImage.src = String(reader.result);
    });
    reader.readAsDataURL(file);
  });
}

async function addResultImages(files) {
  const availableSlots = MAX_RESULT_IMAGES - profileState.resultImages.length;
  const selectedFiles = Array.from(files || []).slice(0, availableSlots);
  if (!availableSlots) {
    window.alert("Hồ sơ đã có đủ 5 ảnh. Hãy xóa một ảnh trước khi thêm ảnh mới.");
    return;
  }
  if (!selectedFiles.length) return;

  const previousImages = [...profileState.resultImages];
  showSaveState("Đang xử lý hình ảnh...", "is-saving");
  try {
    const newImages = [];
    for (const file of selectedFiles) newImages.push(await compressResultImage(file));
    profileState.resultImages.push(...newImages);
    if (!persistProfile()) {
      profileState.resultImages = previousImages;
      renderProfileSummary();
      return;
    }
    showSaveState(`Đã thêm ${newImages.length} ảnh kết quả`, "is-saved");
  } catch (error) {
    profileState.resultImages = previousImages;
    renderProfileSummary();
    window.alert(`${error.message}. Vui lòng chọn ảnh JPG, PNG hoặc WebP khác.`);
  }
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
    <section class="print-profile-section print-result-images-section">
      <h2>Hình ảnh kết quả của học sinh</h2>
      ${profileState.resultImages.length ? `
        <div class="print-result-images">
          ${profileState.resultImages.map((image, index) => `
            <figure>
              <img src="${image.dataUrl}" alt="Ảnh kết quả học sinh ${index + 1}" />
              <figcaption>${escapeHtml(image.name)}</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : "<p>Chưa thêm hình ảnh kết quả.</p>"}
    </section>
    <footer class="print-profile-footer">Kết quả chỉ mang tính tham khảo và nên được kết hợp với năng lực học tập, hoàn cảnh thực tế cùng tư vấn chuyên môn.</footer>
  `;
}

async function downloadProfilePdf() {
  window.clearTimeout(saveTimer);
  persistProfile();
  buildPrintableProfile();
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

  const resultImagesInput = document.getElementById("result-images-input");
  document.getElementById("add-result-images").addEventListener("click", () => resultImagesInput.click());
  resultImagesInput.addEventListener("change", async () => {
    await addResultImages(resultImagesInput.files);
    resultImagesInput.value = "";
  });
  document.getElementById("result-images-grid").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-result-image]");
    if (!removeButton) return;
    profileState.resultImages = profileState.resultImages.filter((image) => image.id !== removeButton.dataset.removeResultImage);
    persistProfile();
  });

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
