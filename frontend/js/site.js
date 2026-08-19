/* Tiện ích giao diện dùng chung: theme, hiệu ứng cuộn và tiến độ học sinh. */
(function () {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem("dhnn_theme");
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = savedTheme || (systemDark ? "dark" : "light");

  const headerContainer = document.querySelector(".site-header .container");
  if (headerContainer) {
    const themeButton = document.createElement("button");
    themeButton.className = "theme-toggle";
    themeButton.type = "button";
    themeButton.setAttribute("aria-label", "Đổi chế độ sáng tối");

    const refreshThemeIcon = () => {
      themeButton.textContent = root.dataset.theme === "dark" ? "☀️" : "🌙";
      themeButton.title = root.dataset.theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối";
    };
    refreshThemeIcon();

    themeButton.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("dhnn_theme", root.dataset.theme);
      refreshThemeIcon();
    });
    headerContainer.appendChild(themeButton);
  }

  const scrollProgress = document.createElement("div");
  scrollProgress.className = "scroll-progress";
  scrollProgress.setAttribute("aria-hidden", "true");
  document.body.appendChild(scrollProgress);

  const backToTop = document.createElement("button");
  backToTop.className = "back-to-top";
  backToTop.type = "button";
  backToTop.textContent = "↑";
  backToTop.setAttribute("aria-label", "Quay lên đầu trang");
  document.body.appendChild(backToTop);
  backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  const updateScroll = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const percent = maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0;
    scrollProgress.style.width = `${Math.min(100, percent)}%`;
    backToTop.classList.toggle("visible", window.scrollY > 420);
  };
  window.addEventListener("scroll", updateScroll, { passive: true });
  updateScroll();

  const revealTargets = document.querySelectorAll(".card, .career-card, .about-panel, .pillar, .quiz-question, .overview-copy, .overview-tool, .overview-note, .theory-copy, .riasec-type, .mi-type, .mbti-axis, .mbti-code-pill, .disc-type, .motive-type, .guide-step, .riasec-guide-chip, .document-card, .profile-panel, .profile-glance, .profile-result-card, .profile-download-panel, .onet-embed-section, .external-assessment, section > h2");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    revealTargets.forEach((element, index) => {
      element.classList.add("reveal");
      element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
      observer.observe(element);
    });
  }

  const progressBox = document.getElementById("home-progress");
  if (progressBox) {
    const ids = ["holland", "mi", "mbti", "disc", "motivators"];
    let manualResults = {};
    try {
      manualResults = JSON.parse(localStorage.getItem("dhnn_personal_profile_v1") || "{}").assessmentResults || {};
    } catch {
      manualResults = {};
    }
    const completed = ids.filter((id) => localStorage.getItem(`dhnn_result_${id}`) || String(manualResults[id] || "").trim()).length;
    const progressText = progressBox.querySelector("[data-progress-text]");
    const progressFill = progressBox.querySelector("[data-progress-fill]");
    if (progressText) progressText.textContent = `${completed}/5 bài đã hoàn thành`;
    requestAnimationFrame(() => {
      if (progressFill) progressFill.style.width = `${completed * 20}%`;
    });
  }
})();
