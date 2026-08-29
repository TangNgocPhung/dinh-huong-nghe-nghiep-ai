/*
 * Giao diện chatbot. Gửi câu hỏi tới backend FastAPI (/api/chat).
 * Nếu backend chưa chạy (ví dụ khi giáo viên/học sinh mới mở phần
 * frontend tĩnh), hiển thị thông báo hướng dẫn thay vì lỗi khó hiểu.
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
const PROFILE_ANALYSIS_PROMPT = "Dựa trên Hồ sơ của tôi trong tệp đính kèm (học sinh cần đính kèm file), hãy đề xuất và xếp hạng 10 ngành học/nghề nghiệp phù hợp, nêu rõ cơ sở đề xuất.";

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
  if (text) {
    const messageText = document.createElement("div");
    messageText.className = "chat-message-text";
    if (role === "bot") renderMarkdown(messageText, text);
    else messageText.textContent = text;
    bubble.appendChild(messageText);
  }
  msg.appendChild(bubble);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
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

async function sendChatMessage(message, history, attachment) {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, attachment }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.detail || `Máy chủ trả về lỗi ${res.status}.`);
  return payload;
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
  const history = [];
  let selectedFile = null;

  function autoResizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

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

  appendMessage(
    messages,
    "bot",
    "Xin chào! Mình là trợ lý định hướng nghề nghiệp. Bạn có thể hỏi mình về tổ hợp môn, ngành học, hoặc cách chọn nghề phù hợp với bản thân."
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
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

    const typingEl = document.createElement("div");
    typingEl.className = "chat-msg chat-msg-bot";
    const typingBubble = document.createElement("div");
    typingBubble.className = "chat-bubble chat-typing";
    typingBubble.textContent = "Đang trả lời...";
    typingEl.appendChild(typingBubble);
    messages.appendChild(typingEl);
    messages.scrollTop = messages.scrollHeight;

    try {
      const attachment = file ? await fileToAttachment(file) : null;
      clearSelectedFile();
      const { reply } = await sendChatMessage(displayText, history, attachment);
      typingEl.remove();
      appendMessage(messages, "bot", reply);
      if (attachment) {
        history.forEach((item) => {
          if (item.role === "user") delete item.attachment;
        });
      }
      history.push(
        { role: "user", content: displayText, attachment },
        { role: "assistant", content: reply }
      );
      while (history.length > 20) history.shift();
    } catch (err) {
      typingEl.remove();
      appendMessage(
        messages,
        "bot",
        err.message || "Chatbot đang tạm thời không phản hồi. Vui lòng đợi một chút rồi thử lại."
      );
    } finally {
      input.disabled = false;
      attachButton.disabled = false;
      submitButton.disabled = false;
      input.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initChatbot);
