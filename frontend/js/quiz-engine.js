/*
 * Bộ máy trắc nghiệm dùng chung cho Holland, MI, MBTI, DISC, Motivators.
 * Mỗi bài test là 1 file JSON trong /data. Kết quả lưu vào localStorage
 * theo khóa `dhnn_result_<testId>` để trang profile.html tổng hợp lại.
 */

const RESULT_PREFIX = "dhnn_result_";

async function loadQuiz(testId) {
  const res = await fetch(`data/${testId}.json`);
  if (!res.ok) throw new Error(`Không tải được dữ liệu bài test "${testId}"`);
  return res.json();
}

function renderQuiz(quiz, container) {
  const header = document.createElement("div");
  header.className = "quiz-header";
  header.innerHTML = `
    <h1>${quiz.title}</h1>
    <p class="quiz-subtitle">${quiz.subtitle}</p>
    <p class="quiz-instructions">${quiz.instructions}</p>
  `;
  container.appendChild(header);

  const form = document.createElement("form");
  form.id = "quiz-form";
  form.className = "quiz-form";

  if (quiz.scaleType === "likert5") {
    quiz.questions.forEach((q, i) => form.appendChild(renderLikertQuestion(q, i, quiz.scaleLabels)));
  } else if (quiz.scaleType === "binary_choice") {
    quiz.questions.forEach((q, i) => form.appendChild(renderBinaryQuestion(q, i)));
  }

  const progress = document.createElement("div");
  progress.className = "quiz-progress";
  progress.innerHTML = `<div class="quiz-progress-bar" id="quiz-progress-bar"></div>`;
  container.appendChild(progress);

  const submitWrap = document.createElement("div");
  submitWrap.className = "quiz-submit-wrap";
  submitWrap.innerHTML = `
    <p id="quiz-remaining" class="quiz-remaining"></p>
    <button type="submit" class="btn btn-primary" id="quiz-submit-btn">Xem kết quả</button>
  `;
  form.appendChild(submitWrap);

  container.appendChild(form);

  form.addEventListener("change", () => updateProgress(quiz, form));
  updateProgress(quiz, form);

  return form;
}

function renderLikertQuestion(q, index, scaleLabels) {
  const wrap = document.createElement("div");
  wrap.className = "quiz-question";
  const options = scaleLabels
    .map(
      (label, i) => `
      <label class="likert-option">
        <input type="radio" name="${q.id}" value="${i + 1}" required />
        <span class="likert-dot" aria-hidden="true"></span>
        <span class="likert-label">${label}</span>
      </label>`
    )
    .join("");
  wrap.innerHTML = `
    <p class="question-text"><span class="question-index">${index + 1}.</span> ${q.text}</p>
    <div class="likert-scale">${options}</div>
  `;
  return wrap;
}

function renderBinaryQuestion(q, index) {
  const wrap = document.createElement("div");
  wrap.className = "quiz-question";
  wrap.innerHTML = `
    <p class="question-text"><span class="question-index">${index + 1}.</span></p>
    <div class="binary-choice">
      <label class="binary-option">
        <input type="radio" name="${q.id}" value="${q.optionA.letter}" required />
        <span>${q.optionA.text}</span>
      </label>
      <label class="binary-option">
        <input type="radio" name="${q.id}" value="${q.optionB.letter}" required />
        <span>${q.optionB.text}</span>
      </label>
    </div>
  `;
  return wrap;
}

function updateProgress(quiz, form) {
  const total = quiz.questions.length;
  const answered = quiz.questions.filter((q) => form.elements[q.id] && form.elements[q.id].value).length;
  const bar = document.getElementById("quiz-progress-bar");
  const remaining = document.getElementById("quiz-remaining");
  if (bar) bar.style.width = `${Math.round((answered / total) * 100)}%`;
  if (remaining) {
    remaining.textContent =
      answered === total ? "Đã trả lời đủ tất cả câu hỏi." : `Đã trả lời ${answered}/${total} câu.`;
  }
}

function collectAnswers(quiz, form) {
  const answers = {};
  quiz.questions.forEach((q) => {
    const field = form.elements[q.id];
    answers[q.id] = field ? field.value : null;
  });
  return answers;
}

function scoreLikert(quiz, answers) {
  const totals = {};
  const counts = {};
  quiz.dimensions.forEach((d) => {
    totals[d.code] = 0;
    counts[d.code] = 0;
  });
  quiz.questions.forEach((q) => {
    const val = Number(answers[q.id]);
    if (!val) return;
    totals[q.dimension] += val;
    counts[q.dimension] += 1;
  });
  const scores = quiz.dimensions.map((d) => {
    const avg = counts[d.code] ? totals[d.code] / counts[d.code] : 0;
    const percent = Math.round(((avg - 1) / 4) * 100); // scale 1-5 -> 0-100%
    return { code: d.code, name: d.name, percent: Math.max(0, percent) };
  });
  scores.sort((a, b) => b.percent - a.percent);
  return { type: "likert5", dimensions: scores };
}

function scoreBinary(quiz, answers) {
  const counts = {};
  quiz.axes.forEach((axis) => {
    counts[axis.pair[0]] = 0;
    counts[axis.pair[1]] = 0;
  });
  quiz.questions.forEach((q) => {
    const val = answers[q.id];
    if (val) counts[val] = (counts[val] || 0) + 1;
  });
  const letters = quiz.axes.map((axis) => {
    const [a, b] = axis.pair;
    return counts[a] >= counts[b] ? a : b;
  });
  const code = letters.join("");
  const breakdown = quiz.axes.map((axis, i) => ({
    axis: axis.name,
    pair: axis.pair,
    counts: { [axis.pair[0]]: counts[axis.pair[0]], [axis.pair[1]]: counts[axis.pair[1]] },
    result: letters[i],
  }));
  return { type: "binary_choice", code, breakdown };
}

function renderResults(quiz, result, container) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "results-panel";

  if (result.type === "likert5") {
    const bars = result.dimensions
      .map(
        (d) => `
        <div class="result-bar-row">
          <div class="result-bar-label">${d.name}</div>
          <div class="result-bar-track">
            <div class="result-bar-fill" style="width:${d.percent}%"></div>
          </div>
          <div class="result-bar-value">${d.percent}%</div>
        </div>`
      )
      .join("");
    const top = result.dimensions.slice(0, 3).map((d) => d.name).join(", ");
    wrap.innerHTML = `
      <h2>Kết quả: ${quiz.title}</h2>
      <p class="result-highlight">Xu hướng nổi bật của bạn: <strong>${top}</strong></p>
      <div class="result-bars">${bars}</div>
    `;
  } else if (result.type === "binary_choice") {
    const rows = result.breakdown
      .map(
        (b) => `
        <div class="result-bar-row">
          <div class="result-bar-label">${b.axis}</div>
          <div class="result-bar-value">${b.pair[0]}: ${b.counts[b.pair[0]]} &nbsp;/&nbsp; ${b.pair[1]}: ${b.counts[b.pair[1]]}</div>
        </div>`
      )
      .join("");
    wrap.innerHTML = `
      <h2>Kết quả: ${quiz.title}</h2>
      <p class="result-highlight">Mã tính cách của bạn: <strong>${result.code}</strong></p>
      <div class="result-bars">${rows}</div>
    `;
  }

  const actions = document.createElement("div");
  actions.className = "result-actions";
  actions.innerHTML = `
    <a class="btn btn-primary" href="profile.html">Xem hồ sơ tổng hợp</a>
    <a class="btn btn-secondary" href="assessments.html">Làm bài test khác</a>
  `;
  wrap.appendChild(actions);
  container.appendChild(wrap);
}

function saveResult(testId, result) {
  const payload = { testId, result, completedAt: new Date().toISOString() };
  localStorage.setItem(RESULT_PREFIX + testId, JSON.stringify(payload));
}

function getResult(testId) {
  const raw = localStorage.getItem(RESULT_PREFIX + testId);
  return raw ? JSON.parse(raw) : null;
}

function getAllResults() {
  const ids = ["holland", "mi", "mbti", "disc", "motivators"];
  const results = {};
  ids.forEach((id) => {
    const r = getResult(id);
    if (r) results[id] = r;
  });
  return results;
}

function clearAllResults() {
  ["holland", "mi", "mbti", "disc", "motivators"].forEach((id) => localStorage.removeItem(RESULT_PREFIX + id));
}

// API công khai cho các trang HTML gọi qua thẻ <script> thường (không dùng module)
window.QuizEngine = {
  loadQuiz,
  renderQuiz,
  collectAnswers,
  scoreLikert,
  scoreBinary,
  renderResults,
  saveResult,
  getResult,
  getAllResults,
  clearAllResults,
};
