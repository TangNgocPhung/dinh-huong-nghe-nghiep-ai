/*
 * Tổng hợp kết quả các bài trắc nghiệm đã lưu trong localStorage thành
 * một hồ sơ năng lực duy nhất, vẽ biểu đồ radar (Chart.js) và gợi ý
 * nhóm ngành nghề phù hợp dựa trên luật đối chiếu đơn giản (rule-based).
 */

const TEST_LABELS = {
  holland: "Holland (RIASEC)",
  mi: "Đa trí thông minh",
  mbti: "MBTI",
  disc: "DISC",
  motivators: "Động lực",
};

async function initProfilePage() {
  const results = QuizEngine.getAllResults();
  const statusEl = document.getElementById("profile-status");
  const chartSection = document.getElementById("profile-chart-section");
  const mbtiSection = document.getElementById("profile-mbti-section");
  const careerSection = document.getElementById("profile-career-section");

  renderStatus(results, statusEl);

  const likertResults = Object.entries(results).filter(([id]) => id !== "mbti");
  if (likertResults.length > 0) {
    chartSection.style.display = "";
    renderRadarChart(likertResults);
  }

  if (results.mbti) {
    mbtiSection.style.display = "";
    renderMbtiBadge(results.mbti);
  }

  if (results.holland) {
    careerSection.style.display = "";
    await renderCareerMatches(results);
  }
}

function renderStatus(results, el) {
  const done = Object.keys(results);
  const all = Object.keys(TEST_LABELS);
  const missing = all.filter((id) => !done.includes(id));

  if (done.length === 0) {
    el.innerHTML = `<p>Bạn chưa hoàn thành bài test nào. Hãy bắt đầu với <a href="quiz.html?test=holland">trắc nghiệm Holland</a> để có gợi ý nghề nghiệp.</p>`;
    return;
  }

  const doneList = done.map((id) => `<span class="badge badge-done">${TEST_LABELS[id]}</span>`).join(" ");
  const missingList = missing
    .map((id) => `<a class="badge badge-missing" href="quiz.html?test=${id}">${TEST_LABELS[id]} +</a>`)
    .join(" ");

  el.innerHTML = `
    <p>Đã hoàn thành: ${doneList}</p>
    ${missing.length ? `<p>Chưa làm: ${missingList}</p>` : `<p class="result-highlight">Bạn đã hoàn thành đủ 5 bài test!</p>`}
  `;
}

function renderRadarChart(likertResults) {
  const labels = [];
  const data = [];
  const colors = ["#4f46e5", "#0891b2", "#c2410c", "#15803d"];
  const datasets = [];

  likertResults.forEach(([testId, payload], idx) => {
    const dims = payload.result.dimensions;
    datasets.push({
      label: TEST_LABELS[testId],
      data: dims.map((d) => d.percent),
      backgroundColor: colors[idx % colors.length] + "33",
      borderColor: colors[idx % colors.length],
      borderWidth: 2,
    });
  });

  // Mỗi bài test có trục riêng nên vẽ radar riêng biệt theo từng bài,
  // xếp cạnh nhau để dễ so sánh trực quan thay vì gộp trục không tương thích.
  const grid = document.getElementById("radar-grid");
  grid.innerHTML = "";
  likertResults.forEach(([testId, payload], idx) => {
    const card = document.createElement("div");
    card.className = "radar-card";
    card.innerHTML = `<h3>${TEST_LABELS[testId]}</h3><canvas id="radar-${testId}"></canvas>`;
    grid.appendChild(card);

    const dims = payload.result.dimensions;
    const ctx = card.querySelector("canvas").getContext("2d");
    new Chart(ctx, {
      type: "radar",
      data: {
        labels: dims.map((d) => d.name),
        datasets: [
          {
            label: TEST_LABELS[testId],
            data: dims.map((d) => d.percent),
            backgroundColor: colors[idx % colors.length] + "33",
            borderColor: colors[idx % colors.length],
            borderWidth: 2,
            pointBackgroundColor: colors[idx % colors.length],
          },
        ],
      },
      options: {
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25 } } },
        plugins: { legend: { display: false } },
      },
    });
  });
}

function renderMbtiBadge(mbtiPayload) {
  const el = document.getElementById("mbti-badge");
  el.innerHTML = `
    <div class="mbti-code">${mbtiPayload.result.code}</div>
    <div class="mbti-breakdown">
      ${mbtiPayload.result.breakdown
        .map(
          (b) => `<div>${b.axis}: <strong>${b.result}</strong> (${b.pair[0]} ${b.counts[b.pair[0]]} / ${b.pair[1]} ${b.counts[b.pair[1]]})</div>`
        )
        .join("")}
    </div>
  `;
}

async function renderCareerMatches(results) {
  const res = await fetch("data/careers.json");
  const { careers } = await res.json();

  const hollandTop = results.holland.result.dimensions.slice(0, 3).map((d) => d.code);
  const miTop = results.mi ? results.mi.result.dimensions.slice(0, 3).map((d) => d.code) : [];

  const scored = careers.map((career) => {
    const hollandOverlap = career.holland.filter((c) => hollandTop.includes(c)).length;
    const miOverlap = career.mi.filter((c) => miTop.includes(c)).length;
    const score = hollandOverlap * 2 + miOverlap; // Holland là yếu tố chính, MI là yếu tố phụ trợ
    return { career, score, hollandOverlap, miOverlap };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, 8);

  const list = document.getElementById("career-match-list");
  if (top.length === 0) {
    list.innerHTML = `<p>Chưa tìm thấy nghề phù hợp rõ rệt — hãy hoàn thành thêm bài test MI để có gợi ý chính xác hơn.</p>`;
    return;
  }

  list.innerHTML = top
    .map(
      ({ career, hollandOverlap, miOverlap }) => `
      <div class="career-card">
        <h3>${career.name}</h3>
        <p>${career.description}</p>
        <p class="career-meta"><strong>Nhóm Holland:</strong> ${career.holland.join(", ")} ${hollandOverlap ? "✓ khớp" : ""}</p>
        ${miOverlap ? `<p class="career-meta"><strong>Trí thông minh liên quan:</strong> ${career.mi.join(", ")} ✓ khớp</p>` : ""}
        <p class="career-meta"><strong>Tổ hợp môn tham khảo:</strong> ${career.subject_combinations.join(", ")}</p>
        <p class="career-meta"><strong>Ngành học liên quan:</strong> ${career.sample_majors.join(", ")}</p>
      </div>`
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", initProfilePage);
