/*
 * Giao diện chatbot. Gửi câu hỏi tới backend FastAPI (/api/chat).
 * Nếu backend chưa chạy (ví dụ khi giáo viên/học sinh mới mở phần
 * frontend tĩnh), hiển thị thông báo hướng dẫn thay vì lỗi khó hiểu.
 */

const IS_LOCAL_FRONTEND = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && window.location.port !== "8000";
const BACKEND_URL = window.DHNN_BACKEND_URL
  || (IS_LOCAL_FRONTEND ? "http://localhost:8000" : window.location.origin);

function appendMessage(container, role, text) {
  const msg = document.createElement("div");
  msg.className = `chat-msg chat-msg-${role}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text;
  msg.appendChild(bubble);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage(message, history) {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error(`Backend lỗi: ${res.status}`);
  return res.json();
}

function initChatbot() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const messages = document.getElementById("chat-messages");
  const history = [];

  appendMessage(
    messages,
    "bot",
    "Xin chào! Mình là trợ lý định hướng nghề nghiệp. Bạn có thể hỏi mình về tổ hợp môn, ngành học, hoặc cách chọn nghề phù hợp với bản thân."
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    appendMessage(messages, "user", text);
    input.value = "";
    input.disabled = true;

    const typingEl = document.createElement("div");
    typingEl.className = "chat-msg chat-msg-bot";
    const typingBubble = document.createElement("div");
    typingBubble.className = "chat-bubble chat-typing";
    typingBubble.textContent = "Đang trả lời...";
    typingEl.appendChild(typingBubble);
    messages.appendChild(typingEl);
    messages.scrollTop = messages.scrollHeight;

    try {
      const { reply } = await sendChatMessage(text, history);
      typingEl.remove();
      appendMessage(messages, "bot", reply);
      history.push({ role: "user", content: text }, { role: "assistant", content: reply });
    } catch (err) {
      typingEl.remove();
      appendMessage(
        messages,
        "bot",
        "Chatbot đang tạm thời không phản hồi. Vui lòng đợi một chút rồi thử lại."
      );
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initChatbot);
