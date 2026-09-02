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

  const navDropdowns = Array.from(document.querySelectorAll(".site-nav-dropdown"));
  navDropdowns.forEach((dropdown) => {
    dropdown.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => dropdown.removeAttribute("open"));
    });
  });
  document.addEventListener("click", (event) => {
    navDropdowns.forEach((dropdown) => {
      if (dropdown.open && !dropdown.contains(event.target)) dropdown.removeAttribute("open");
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") navDropdowns.forEach((dropdown) => dropdown.removeAttribute("open"));
  });

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

  const revealTargets = document.querySelectorAll(".career-card, .about-panel, .pillar, .quiz-question, .overview-copy, .overview-tool, .overview-note, .theory-copy, .riasec-type, .mi-type, .mbti-axis, .mbti-code-pill, .disc-type, .motive-type, .guide-step, .riasec-guide-chip, .document-card, .resource-video-card, .resource-article-card, .profile-panel, .profile-glance, .profile-result-card, .profile-download-panel, .onet-embed-section, .external-assessment, section > h2");
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

  const siteFooter = document.querySelector(".site-footer");
  if (siteFooter) {
    const periodLabels = (now = new Date()) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "numeric",
      }).formatToParts(now);
      const year = parts.find((part) => part.type === "year")?.value;
      const month = parts.find((part) => part.type === "month")?.value;
      return {
        month: month ? `Tháng ${month}` : "Tháng này",
        year: year ? `Năm ${year}` : "Năm nay",
      };
    };
    const initialLabels = periodLabels();

    const statsWrap = document.createElement("div");
    statsWrap.className = "container visitor-stats-wrap";
    statsWrap.innerHTML = `
      <section class="visitor-stats" aria-labelledby="visitor-stats-title">
        <div class="visitor-stats-heading">
          <span class="visitor-stats-icon" aria-hidden="true">📊</span>
          <div>
            <strong id="visitor-stats-title">Thống kê lượt truy cập</strong>
            <small>Bộ đếm không lưu họ tên hay địa chỉ IP.</small>
          </div>
        </div>
        <div class="visitor-stats-grid" aria-live="polite">
          <div class="visitor-stat"><strong data-visit-stat="month">—</strong><span data-visit-label="month">${initialLabels.month}</span></div>
          <div class="visitor-stat"><strong data-visit-stat="year">—</strong><span data-visit-label="year">${initialLabels.year}</span></div>
          <div class="visitor-stat"><strong data-visit-stat="total">—</strong><span>Tổng lượt</span></div>
        </div>
        <span class="visitor-stats-status" data-visit-status>Đang cập nhật…</span>
      </section>`;

    const advisory = siteFooter.querySelector(".footer-advisory")?.parentElement;
    siteFooter.insertBefore(statsWrap, advisory || null);

    const loadVisitStats = async () => {
      const apiBase = "https://dhnn-visit-counter.tangphung126.workers.dev";
      const countedKey = "dhnn_visit_counted_v1";
      let shouldRecord = false;
      try {
        shouldRecord = sessionStorage.getItem(countedKey) !== "1";
      } catch {
        shouldRecord = false;
      }

      try {
        const response = await fetch(`${apiBase}/${shouldRecord ? "visit" : "stats"}`, {
          method: shouldRecord ? "POST" : "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Visit statistics are unavailable");
        const stats = await response.json();
        const formatter = new Intl.NumberFormat("vi-VN");
        ["month", "year", "total"].forEach((key) => {
          const value = Number(stats[key]);
          const target = statsWrap.querySelector(`[data-visit-stat="${key}"]`);
          if (target) target.textContent = formatter.format(Number.isFinite(value) ? value : 0);
        });
        const monthNumber = Number(String(stats.monthKey || "").split("-")[1]);
        if (Number.isFinite(monthNumber)) {
          const monthLabel = statsWrap.querySelector('[data-visit-label="month"]');
          if (monthLabel) monthLabel.textContent = `Tháng ${monthNumber}`;
        }
        if (stats.yearKey) {
          const yearLabel = statsWrap.querySelector('[data-visit-label="year"]');
          if (yearLabel) yearLabel.textContent = `Năm ${stats.yearKey}`;
        }
        if (shouldRecord) {
          try {
            sessionStorage.setItem(countedKey, "1");
          } catch {
            // Không lưu được trạng thái phiên: vẫn chỉ hiển thị số liệu đã nhận.
          }
        }
        const status = statsWrap.querySelector("[data-visit-status]");
        if (status) status.textContent = "Cập nhật theo thời gian thực";
      } catch {
        const status = statsWrap.querySelector("[data-visit-status]");
        if (status) status.textContent = "Số liệu sẽ được cập nhật lại sau";
      }
    };

    void loadVisitStats();
  }
})();
