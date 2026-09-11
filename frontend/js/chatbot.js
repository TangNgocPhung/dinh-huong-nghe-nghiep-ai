/*
 * Giao diện chatbot. Gửi câu hỏi tới backend FastAPI (/api/chat/stream, có
 * dự phòng /api/chat). Hồ sơ và kết quả trắc nghiệm đã lưu trên trình duyệt
 * được gửi kèm tự động để AI tư vấn sát với từng học sinh.
 */

const IS_LOCAL_FRONTEND = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && window.location.port !== "8000";
const BACKEND_URL = window.DHNN_BACKEND_URL
  || (IS_LOCAL_FRONTEND ? "http://localhost:8000" : window.location.origin);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
]);
const PROFILE_ANALYSIS_PROMPT = "Dựa trên hồ sơ của tôi, hãy đề xuất và xếp hạng 10 ngành học/nghề nghiệp phù hợp, nêu rõ cơ sở đề xuất.";
const WELCOME_MESSAGE = "Xin chào! Mình là trợ lý định hướng nghề nghiệp. Bạn có thể hỏi mình về tổ hợp môn, ngành học, hoặc cách chọn nghề phù hợp với bản thân.";

const PROFILE_STORAGE_KEY = "dhnn_personal_profile_v1";
const RESULT_PREFIX = "dhnn_result_";
const SESSION_STORAGE_KEY = "dhnn_chat_session_v1";
const PROFILE_OPT_OUT_KEY = "dhnn_chat_profile_off_v1";
const MAX_HISTORY_MESSAGES = 20;
const TEST_LABELS = {
  holland: "Holland (RIASEC)",
  mi: "Đa trí thông minh",
  mbti: "MBTI",
  disc: "DISC",
  motivators: "Động lực",
};
const QUICK_PROMPTS = [
  { label: "Top 10 nghề hợp với tôi", text: PROFILE_ANALYSIS_PROMPT },
  { label: "Chọn tổ hợp môn nào?", text: "Dựa trên hồ sơ và điểm số của tôi, tôi nên chọn tổ hợp môn nào cho kỳ thi tốt nghiệp THPT? Giải thích lý do." },
  { label: "Điểm mạnh của tôi", text: "Hãy phân tích điểm mạnh, điểm cần cải thiện của tôi dựa trên hồ sơ và kết quả trắc nghiệm đã lưu." },
  { label: "Lộ trình 3 năm tới", text: "Hãy gợi ý lộ trình học tập và trải nghiệm trong 3 năm tới để tôi tiến gần hơn tới nghề nghiệp mong muốn." },
];

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Dùng cách tương thích phía dưới nếu trình duyệt chặn Clipboard API.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy-failed");
}

function appendInlineMarkdown(container, text) {
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > cursor) {
      container.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    }
    const token = match[0];
    let element;
    if (token.startsWith("**") || token.startsWith("__")) {
      element = document.createElement("strong");
      element.textContent = token.slice(2, -2);
    } else if (token.startsWith("`")) {
      element = document.createElement("code");
      element.textContent = token.slice(1, -1);
    } else {
      element = document.createElement("em");
      element.textContent = token.slice(1, -1);
    }
    container.appendChild(element);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    container.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function renderMarkdown(container, text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let currentList = null;

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) {
      currentList = null;
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (bulletMatch || numberedMatch) {
      const listType = numberedMatch ? "ol" : "ul";
      if (!currentList || currentList.tagName.toLowerCase() !== listType) {
        currentList = document.createElement(listType);
        container.appendChild(currentList);
      }
      const item = document.createElement("li");
      appendInlineMarkdown(item, (bulletMatch || numberedMatch)[1]);
      currentList.appendChild(item);
      continue;
    }

    currentList = null;
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    const paragraph = document.createElement("p");
    if (headingMatch) {
      const strong = document.createElement("strong");
      appendInlineMarkdown(strong, headingMatch[1]);
      paragraph.appendChild(strong);
    } else {
      appendInlineMarkdown(paragraph, line);
    }
    container.appendChild(paragraph);
  }
}

function createCopyButton(getText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-copy-message";
  button.title = "Sao chép câu trả lời";
  button.textContent = "⧉ Sao chép";
  button.addEventListener("click", async () => {
    try {
      await copyText(getText());
      button.textContent = "✓ Đã chép";
    } catch {
      button.textContent = "Không chép được";
    }
    window.setTimeout(() => { button.textContent = "⧉ Sao chép"; }, 1800);
  });
  return button;
}

function appendMessage(container, role, text, attachmentName = "") {
  const msg = document.createElement("div");
  msg.className = `chat-msg chat-msg-${role}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  if (attachmentName) {
    const fileChip = document.createElement("span");
    fileChip.className = "chat-message-file";
    fileChip.textContent = `📎 ${attachmentName}`;
    bubble.appendChild(fileChip);
  }
  const messageText = document.createElement("div");
  messageText.className = "chat-message-text";
  if (text) {
    if (role === "bot") renderMarkdown(messageText, text);
    else messageText.textContent = text;
  }
  bubble.appendChild(messageText);
  msg.appendChild(bubble);
  if (role === "bot" && text) bubble.appendChild(createCopyButton(() => text));
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return { msg, bubble, messageText };
}

/* Bong bóng trả lời được cập nhật dần trong lúc AI đang gõ. */
function createStreamingMessage(container) {
  const { msg, bubble, messageText } = appendMessage(container, "bot", "");
  bubble.classList.add("chat-bubble-streaming");
  let raw = "";
  let frame = 0;

  function paint() {
    frame = 0;
    messageText.replaceChildren();
    renderMarkdown(messageText, raw);
    container.scrollTop = container.scrollHeight;
  }

  return {
    push(delta) {
      raw += delta;
      if (!frame) frame = window.requestAnimationFrame(paint);
    },
    replace(text) {
      raw = text;
      paint();
    },
    get text() {
      return raw;
    },
    finish() {
      if (frame) window.cancelAnimationFrame(frame);
      paint();
      bubble.classList.remove("chat-bubble-streaming");
      if (raw) bubble.appendChild(createCopyButton(() => raw));
      return raw;
    },
    remove() {
      if (frame) window.cancelAnimationFrame(frame);
      msg.remove();
    },
  };
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function quizHighlights(payload) {
  const result = payload?.result;
  if (!result) return null;
  if (Array.isArray(result.dimensions)) {
    return {
      code: "",
      highlights: result.dimensions
        .slice(0, 4)
        .map((item) => `${item.name}: ${item.percent}%`),
    };
  }
  if (result.code) {
    return {
      code: String(result.code),
      highlights: Array.isArray(result.breakdown)
        ? result.breakdown.map((item) => `${item.axis}: ${item.result}`)
        : [],
    };
  }
  return null;
}

/* Gom hồ sơ và kết quả trắc nghiệm đang lưu trên máy học sinh để gửi kèm câu hỏi. */
function readStudentProfile() {
  const saved = readJson(PROFILE_STORAGE_KEY);
  const quizzes = [];
  Object.keys(TEST_LABELS).forEach((testId) => {
    const summary = quizHighlights(readJson(RESULT_PREFIX + testId));
    if (!summary) return;
    quizzes.push({ test: TEST_LABELS[testId], ...summary });
  });

  const subjects = Array.isArray(saved?.subjectPreferences)
    ? saved.subjectPreferences
      .filter((item) => String(item?.subject || "").trim())
      .map((item) => ({ subject: String(item.subject).trim(), score: String(item.score ?? "").trim() }))
    : [];

  const profile = {
    subjects,
    talents: String(saved?.talents || "").trim(),
    strengths: String(saved?.strengths || "").trim(),
    interests: String(saved?.interests || "").trim(),
    career_goal: String(saved?.careerGoal || "").trim(),
    quizzes,
  };

  const filled = subjects.length
    + quizzes.length
    + [profile.talents, profile.strengths, profile.interests, profile.career_goal].filter(Boolean).length;
  return filled ? { profile, quizCount: quizzes.length, fieldCount: filled } : null;
}

function loadSession() {
  const saved = readJson(SESSION_STORAGE_KEY);
  return Array.isArray(saved) ? saved.filter((item) => item?.role && typeof item.content === "string") : [];
}

function saveSession(history) {
  try {
    // Tệp đính kèm có thể rất nặng nên chỉ lưu phần chữ của cuộc trò chuyện.
    const light = history.map(({ role, content }) => ({ role, content }));
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(light));
  } catch {
    // Bộ nhớ trình duyệt đầy thì bỏ qua, cuộc trò chuyện vẫn chạy bình thường.
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error("Không thể đọc tệp đã chọn."));
        return;
      }
      resolve({
        name: file.name,
        mime_type: file.type || "application/octet-stream",
        data: result.slice(commaIndex + 1),
      });
    };
    reader.onerror = () => reject(new Error("Không thể đọc tệp đã chọn."));
    reader.readAsDataURL(file);
  });
}

async function sendChatMessage(payload) {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Máy chủ trả về lỗi ${res.status}.`);
  return body.reply || "";
}

/* Đọc luồng SSE từ backend và báo lại từng đoạn chữ mới. */
async function streamChatMessage(payload, handlers) {
  const res = await fetch(`${BACKEND_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 404 || res.status === 405) throw new Error("stream-unsupported");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Máy chủ trả về lỗi ${res.status}.`);
  }
  if (!res.body) throw new Error("stream-unsupported");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const line = block.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.delta) handlers.onDelta(event.delta);
      if (event.replace) handlers.onReplace(event.replace);
    }
  }
}

function initChatbot() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const messages = document.getElementById("chat-messages");
  const fileInput = document.getElementById("chat-file");
  const attachButton = document.getElementById("chat-attach-button");
  const attachmentPreview = document.getElementById("chat-attachment-preview");
  const attachmentName = document.getElementById("chat-attachment-name");
  const attachmentSize = document.getElementById("chat-attachment-size");
  const removeFileButton = document.getElementById("chat-remove-file");
  const profileSuggestion = document.getElementById("chat-profile-suggestion");
  const profilePromptButton = document.getElementById("chat-profile-prompt");
  const copyPromptButton = document.getElementById("chat-copy-prompt");
  const copyPromptStatus = document.getElementById("chat-copy-status");
  const submitButton = document.getElementById("chat-submit");
  const profileChip = document.getElementById("chat-profile-chip");
  const profileChipText = document.getElementById("chat-profile-chip-text");
  const profileToggle = document.getElementById("chat-profile-toggle");
  const resetButton = document.getElementById("chat-reset");
  const quickPromptsBar = document.getElementById("chat-quick-prompts");

  const history = loadSession();
  let selectedFile = null;
  let useProfile = localStorage.getItem(PROFILE_OPT_OUT_KEY) !== "1";

  function autoResizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  function refreshProfileChip() {
    const found = readStudentProfile();
    profileToggle.hidden = !found;
    if (!found) {
      profileChip.className = "chat-profile-chip is-empty";
      profileChipText.innerHTML = 'Chưa có hồ sơ trên thiết bị này. <a href="profile.html">Điền hồ sơ của tôi</a> để AI tư vấn sát hơn.';
      return;
    }
    profileChip.className = `chat-profile-chip${useProfile ? " is-on" : " is-off"}`;
    profileChipText.textContent = useProfile
      ? `Đang dùng hồ sơ của bạn · ${found.quizCount}/5 bài trắc nghiệm đã lưu`
      : "Đang tạm tắt hồ sơ cá nhân — AI sẽ trả lời chung chung hơn.";
    profileToggle.textContent = useProfile ? "Tắt" : "Bật";
  }

  function currentProfile() {
    if (!useProfile) return null;
    return readStudentProfile()?.profile || null;
  }

  profileToggle.addEventListener("click", () => {
    useProfile = !useProfile;
    localStorage.setItem(PROFILE_OPT_OUT_KEY, useProfile ? "0" : "1");
    refreshProfileChip();
  });

  QUICK_PROMPTS.forEach((prompt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-quick-prompt";
    chip.textContent = prompt.label;
    chip.addEventListener("click", () => {
      input.value = prompt.text;
      autoResizeInput();
      form.requestSubmit();
    });
    quickPromptsBar.appendChild(chip);
  });

  input.addEventListener("input", autoResizeInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = "";
    attachmentPreview.hidden = true;
    attachmentName.textContent = "";
    attachmentSize.textContent = "";
    profileSuggestion.hidden = true;
  }

  function showFileError(message) {
    appendMessage(messages, "bot", message);
    clearSelectedFile();
  }

  attachButton.addEventListener("click", () => fileInput.click());
  removeFileButton.addEventListener("click", clearSelectedFile);
  profilePromptButton.addEventListener("click", () => {
    input.value = PROFILE_ANALYSIS_PROMPT;
    autoResizeInput();
    input.focus();
  });
  resetButton.addEventListener("click", () => {
    if (history.length && !window.confirm("Xóa cuộc trò chuyện hiện tại và bắt đầu lại?")) return;
    history.length = 0;
    saveSession(history);
    messages.replaceChildren();
    clearSelectedFile();
    appendMessage(messages, "bot", WELCOME_MESSAGE);
    input.focus();
  });
  copyPromptButton.addEventListener("click", async () => {
    const label = copyPromptButton.querySelector("[data-copy-label]");
    copyPromptButton.classList.remove("is-copied", "copy-error");
    try {
      await copyText(PROFILE_ANALYSIS_PROMPT);
      label.textContent = "Đã sao chép";
      copyPromptStatus.textContent = "Đã sao chép prompt mẫu vào bộ nhớ tạm.";
      copyPromptButton.classList.add("is-copied");
    } catch {
      label.textContent = "Không thể sao chép";
      copyPromptStatus.textContent = "Không thể sao chép tự động. Vui lòng chọn và sao chép nội dung prompt.";
      copyPromptButton.classList.add("copy-error");
    }
    window.setTimeout(() => {
      label.textContent = "Sao chép prompt";
      copyPromptStatus.textContent = "";
      copyPromptButton.classList.remove("is-copied", "copy-error");
    }, 2200);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      showFileError("Tệp này chưa được hỗ trợ. Hãy chọn ảnh, PDF, Word, Excel hoặc PowerPoint.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showFileError("Tệp vượt quá 10 MB. Vui lòng chọn tệp nhỏ hơn.");
      return;
    }
    selectedFile = file;
    attachmentName.textContent = file.name;
    attachmentSize.textContent = formatFileSize(file.size);
    attachmentPreview.hidden = false;
    profileSuggestion.hidden = extension !== "pdf";
    if (extension === "pdf" && /(?:_hs|ho[-_ ]?so)/i.test(file.name) && !input.value.trim()) {
      input.value = PROFILE_ANALYSIS_PROMPT;
      autoResizeInput();
    }
    input.focus();
  });

  if (history.length) {
    history.forEach((item) => appendMessage(messages, item.role === "assistant" ? "bot" : "user", item.content));
  } else {
    appendMessage(messages, "bot", WELCOME_MESSAGE);
  }
  refreshProfileChip();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitButton.disabled) return;
    const text = input.value.trim();
    if (!text && !selectedFile) {
      input.focus();
      return;
    }

    const file = selectedFile;
    const isPdf = file?.name.toLowerCase().endsWith(".pdf");
    const displayText = text || (isPdf
      ? PROFILE_ANALYSIS_PROMPT
      : "Hãy phân tích nội dung tệp này và đưa ra gợi ý phù hợp.");
    appendMessage(messages, "user", displayText, file?.name || "");
    input.value = "";
    autoResizeInput();
    input.disabled = true;
    attachButton.disabled = true;
    submitButton.disabled = true;

    const stream = createStreamingMessage(messages);
    let reply = "";

    try {
      const attachment = file ? await fileToAttachment(file) : null;
      clearSelectedFile();
      const payload = {
        message: displayText,
        history: history.map(({ role, content, attachment: item }) => ({ role, content, attachment: item || null })),
        attachment,
        profile: currentProfile(),
      };

      try {
        await streamChatMessage(payload, {
          onDelta: (delta) => stream.push(delta),
          onReplace: (full) => stream.replace(full),
        });
      } catch (streamError) {
        if (streamError.message !== "stream-unsupported" || stream.text) throw streamError;
        stream.replace(await sendChatMessage(payload));
      }

      reply = stream.finish();
      if (!reply) {
        stream.replace("Xin lỗi, AI chưa trả về nội dung. Bạn thử hỏi lại ngắn gọn hơn nhé.");
        reply = stream.finish();
      }

      if (attachment) {
        history.forEach((item) => {
          if (item.role === "user") delete item.attachment;
        });
      }
      history.push(
        { role: "user", content: displayText, attachment },
        { role: "assistant", content: reply }
      );
      while (history.length > MAX_HISTORY_MESSAGES) history.shift();
      saveSession(history);
    } catch (err) {
      const message = err.message === "stream-unsupported"
        ? "Chatbot đang tạm thời không phản hồi. Vui lòng đợi một chút rồi thử lại."
        : (err.message || "Chatbot đang tạm thời không phản hồi. Vui lòng đợi một chút rồi thử lại.");
      if (stream.text) {
        stream.replace(`${stream.text}\n\n_(Câu trả lời bị gián đoạn: ${message})_`);
        stream.finish();
      } else {
        stream.remove();
        appendMessage(messages, "bot", message);
      }
    } finally {
      input.disabled = false;
      attachButton.disabled = false;
      submitButton.disabled = false;
      input.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initChatbot);
