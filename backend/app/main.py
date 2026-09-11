"""Backend FastAPI cho chatbot định hướng nghề nghiệp dùng Gemini."""

import base64
import binascii
import json
import logging
import os
import queue
import re
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_DEEP_MODEL = os.getenv("GEMINI_DEEP_MODEL", "gemini-3.1-pro-preview")


def env_models(name: str, default: str) -> list[str]:
    return [model.strip() for model in os.getenv(name, default).split(",") if model.strip()]


def env_flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in {"0", "false", "off", "no"}


GEMINI_FALLBACK_MODELS = env_models(
    "GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.1-flash-lite"
)
GEMINI_ENABLE_SEARCH = env_flag("GEMINI_ENABLE_SEARCH")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Bạn là trợ lý AI hỗ trợ định hướng nghề nghiệp cho học sinh THPT tại Việt Nam,
đặc biệt là học sinh lớp 12 chuẩn bị chọn tổ hợp môn, ngành học hoặc trường đại học.

Nguyên tắc trả lời:
- Luôn trả lời hoàn toàn bằng tiếng Việt, ngắn gọn, dễ hiểu và thân thiện. Không dùng tiêu đề hoặc
  nhãn tiếng Anh như "Why", "Specific majors"; nếu cần thuật ngữ tiếng Anh, phải giải thích bằng tiếng Việt.
- Chỉ tư vấn về tổ hợp môn, ngành học, nghề nghiệp, phương pháp học tập và tự đánh giá năng lực.
- Khi không chắc về điểm chuẩn, chỉ tiêu hoặc đề án tuyển sinh, yêu cầu học sinh kiểm tra nguồn chính thức.
- Không đưa ra kết luận tuyệt đối; trình bày dưới dạng gợi ý và khuyến khích tham khảo giáo viên, phụ huynh.
- Với vấn đề tâm lý nghiêm trọng, khuyên học sinh tìm người lớn tin cậy hoặc chuyên viên phù hợp.

Khi có mục "HỒ SƠ HỌC SINH" do website tự động gửi kèm:
- Coi đây là dữ liệu thật của chính học sinh đang trò chuyện và ưu tiên dùng nó để cá nhân hóa câu trả lời.
- Gắn mỗi gợi ý với dữ liệu cụ thể trong hồ sơ (môn học, điểm số, kết quả trắc nghiệm, mục tiêu).
- Nếu hồ sơ còn thiếu phần nào, nói rõ phần đó chưa có và mời học sinh bổ sung tại trang "Hồ sơ của tôi".
- Không nhắc lại toàn bộ hồ sơ ở đầu câu trả lời; chỉ tóm tắt ngắn phần thực sự dùng để suy luận.

Khi học sinh gửi tệp hoặc hình ảnh kết quả trắc nghiệm:
- Đọc toàn bộ các trang trước khi kết luận và chỉ sử dụng dữ liệu nhìn thấy rõ trong tệp.
- Không tự đoán nội dung bị mờ, thiếu, vô nghĩa hoặc chưa cập nhật. Phải nói rõ phần nào chưa đủ tin cậy.
- Phân biệt rõ: dữ liệu quan sát được, nhận định tham khảo và thông tin còn thiếu.
- Nếu tệp là PDF "Hồ sơ của tôi" được xuất từ website, phải kết hợp cả thông tin chữ (môn học yêu thích,
  năng khiếu, sở trường, hoạt động, mục tiêu) và các biểu đồ trắc nghiệm. Không được chỉ dựa vào một
  trường thông tin hoặc một điểm nổi bật duy nhất.
- Khi học sinh yêu cầu Top N, phải trả đúng N gợi ý. Riêng yêu cầu Top 10 từ hồ sơ, trình bày theo
  thứ tự: (1) "Tóm tắt hồ sơ đã đọc"; (2) "Top 10 nhóm nghề/nghề nên tiếp tục tra cứu" được đánh số
  từ 1 đến 10; (3) "Bước tiếp theo". Mỗi gợi ý phải có tên nghề hoặc nhóm nghề, mức độ phù hợp tham khảo,
  lý do gắn với dữ liệu cụ thể trong hồ sơ và từ khóa tiếng Việt + tiếng Anh để tra cứu trên O*NET.
- Với danh sách Top 10, viết cô đọng: mỗi nghề tối đa 3 dòng ngắn, không lặp lại phần giải thích chung,
  không dùng đoạn văn dài và phải ưu tiên hoàn thành đủ các mục từ 1 đến 10 trước phần kết luận.
- Nếu học sinh không yêu cầu số lượng cụ thể, hãy gợi ý 3 đến 5 nhóm nghề. Không khẳng định đây là
  lựa chọn duy nhất và không lặp lại cùng một nghề dưới các tên gần giống nhau.
- Nếu hồ sơ chưa đủ dữ liệu về môn học, năng khiếu, sở trường hoặc mục tiêu, hãy đặt thêm 2 đến 3 câu hỏi
  ngắn ở cuối câu trả lời để học sinh tự kiểm chứng mức độ phù hợp; vẫn hoàn thành danh sách đã được yêu cầu.
- Không nêu điểm số chính xác khi biểu đồ không thể đọc chắc chắn.
- Hoàn thành trọn vẹn câu trả lời; không kết thúc giữa câu hoặc giữa một mục.

Khi dùng công cụ tìm kiếm để lấy thông tin tuyển sinh, học phí hoặc thị trường lao động:
- Ưu tiên nguồn chính thức (website trường, Bộ GD&ĐT) và nêu rõ năm của số liệu.
- Nói rõ đây là số liệu tham khảo và học sinh cần kiểm tra lại đề án tuyển sinh mới nhất."""

MAX_OUTPUT_TOKENS = max(8192, int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "8192")))
GEMINI_THINKING_BUDGET = int(os.getenv("GEMINI_THINKING_BUDGET", "2048"))
GEMINI_DEEP_THINKING_BUDGET = int(os.getenv("GEMINI_DEEP_THINKING_BUDGET", "8192"))
TOP_TEN_REQUEST_PATTERN = re.compile(r"\btop\s*10\b|\b10\s+(?:nhóm\s+)?nghề\b", re.IGNORECASE)
NUMBERED_ITEM_PATTERN = re.compile(r"(?m)^\s*(?:#{1,6}\s*)?(10|[1-9])[.)]\s+")
DEEP_REQUEST_PATTERN = re.compile(
    r"\btop\s*\d+\b|phân tích|đánh giá|so sánh|lộ trình|xếp hạng|hồ sơ của (?:tôi|em|mình)|tư vấn sâu",
    re.IGNORECASE,
)
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
COOLDOWN_SECONDS = int(os.getenv("GEMINI_COOLDOWN_SECONDS", "300"))
REQUEST_TIMEOUT_MS = int(os.getenv("GEMINI_TIMEOUT_MS", "180000"))
STREAM_STALL_SECONDS = int(os.getenv("GEMINI_STREAM_STALL_SECONDS", "25"))
SEARCH_COOLDOWN_KEY = "google_search"
cooldowns: dict[str, float] = {}


class StreamStalled(RuntimeError):
    """Gemini mở luồng nhưng ngừng gửi chữ; coi như model đang quá tải."""

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENT_BASE64_LENGTH = 14_000_000
ATTACHMENT_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


class ChatAttachment(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    mime_type: str = Field(default="application/octet-stream", max_length=150)
    data: str = Field(min_length=1, max_length=MAX_ATTACHMENT_BASE64_LENGTH)


class SubjectScore(BaseModel):
    subject: str = Field(default="", max_length=80)
    score: str = Field(default="", max_length=12)


class QuizSummary(BaseModel):
    test: str = Field(default="", max_length=80)
    code: str = Field(default="", max_length=40)
    highlights: list[str] = Field(default_factory=list, max_length=16)
    completed_at: str = Field(default="", max_length=40)


class StudentProfile(BaseModel):
    """Hồ sơ học sinh do frontend tự lấy từ localStorage và gửi kèm mỗi câu hỏi."""

    subjects: list[SubjectScore] = Field(default_factory=list, max_length=20)
    talents: str = Field(default="", max_length=500)
    strengths: str = Field(default="", max_length=500)
    interests: str = Field(default="", max_length=500)
    career_goal: str = Field(default="", max_length=500)
    quizzes: list[QuizSummary] = Field(default_factory=list, max_length=8)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    attachment: ChatAttachment | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    attachment: ChatAttachment | None = None
    profile: StudentProfile | None = None


class ChatResponse(BaseModel):
    reply: str


app = FastAPI(title="Chatbot Định Hướng Nghề Nghiệp")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def attachment_part(attachment: ChatAttachment) -> types.Part:
    """Kiểm tra và chuyển tệp đính kèm thành dữ liệu an toàn cho Gemini."""
    safe_name = Path(attachment.name).name
    extension = Path(safe_name).suffix.lower()
    mime_type = ATTACHMENT_MIME_TYPES.get(extension)
    if not mime_type:
        raise HTTPException(
            status_code=415,
            detail="Định dạng tệp chưa được hỗ trợ. Hãy dùng ảnh, PDF, Word, Excel hoặc PowerPoint.",
        )
    try:
        file_bytes = base64.b64decode(attachment.data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Dữ liệu tệp không hợp lệ.") from exc
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Tệp đính kèm đang trống.")
    if len(file_bytes) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Tệp vượt quá giới hạn 10 MB.")
    return types.Part.from_bytes(data=file_bytes, mime_type=mime_type)


def profile_summary(profile: StudentProfile | None) -> str:
    """Chuyển hồ sơ đã lưu trên trình duyệt thành đoạn mô tả cho model."""
    if profile is None:
        return ""

    lines: list[str] = []
    subjects = [
        f"{item.subject.strip()}{f' ({item.score.strip()} điểm)' if item.score.strip() else ''}"
        for item in profile.subjects
        if item.subject.strip()
    ]
    if subjects:
        lines.append(f"- Môn học yêu thích và điểm số: {', '.join(subjects)}")
    for label, value in (
        ("Năng khiếu", profile.talents),
        ("Sở trường", profile.strengths),
        ("Sở thích và hoạt động", profile.interests),
        ("Mục tiêu hoặc nghề đang quan tâm", profile.career_goal),
    ):
        if value.strip():
            lines.append(f"- {label}: {value.strip()}")

    for quiz in profile.quizzes:
        if not quiz.test.strip():
            continue
        details = ", ".join(item.strip() for item in quiz.highlights if item.strip())
        if quiz.code.strip():
            details = f"mã {quiz.code.strip()}" + (f" ({details})" if details else "")
        lines.append(f"- Kết quả {quiz.test.strip()}: {details or 'chưa có chi tiết'}")

    if not lines:
        return ""
    return (
        "HỒ SƠ HỌC SINH (website tự động gửi kèm từ trang Hồ sơ của tôi và các bài trắc nghiệm "
        "đã làm trên thiết bị này):\n" + "\n".join(lines)
    )


def content_parts(text: str, attachment: ChatAttachment | None) -> list[types.Part]:
    parts: list[types.Part] = []
    if attachment:
        parts.append(attachment_part(attachment))
        parts.append(types.Part.from_text(text=f"Tên tệp đính kèm: {Path(attachment.name).name}"))
        parts.append(
            types.Part.from_text(
                text=(
                    "Hãy đọc toàn bộ tệp trước khi trả lời. Chỉ dựa vào thông tin nhìn thấy rõ; "
                    "nếu dữ liệu thiếu, mờ, vô nghĩa hoặc chưa cập nhật, hãy nói thẳng và không suy diễn."
                )
            )
        )
        if Path(attachment.name).suffix.lower() == ".pdf":
            parts.append(
                types.Part.from_text(
                    text=(
                        "Nếu đây là PDF Hồ sơ của tôi được xuất từ website, hãy đọc cả phần thông tin cá nhân "
                        "và toàn bộ biểu đồ. Khi người dùng yêu cầu Top 10, phải đưa đủ đúng 10 nhóm nghề/nghề "
                        "để tiếp tục tra cứu, kèm bằng chứng từ hồ sơ và từ khóa O*NET cho từng mục."
                    )
                )
            )
    parts.append(types.Part.from_text(text=text))
    return parts


def build_contents(req: ChatRequest) -> list[types.Content]:
    contents: list[types.Content] = []
    for message in req.history:
        role = "model" if message.role == "assistant" else "user"
        contents.append(types.Content(role=role, parts=content_parts(message.content, message.attachment)))

    parts = content_parts(req.message, req.attachment)
    summary = profile_summary(req.profile)
    if summary:
        parts.insert(0, types.Part.from_text(text=summary))
    contents.append(types.Content(role="user", parts=parts))
    return contents


def needs_deep_model(req: ChatRequest) -> bool:
    """Câu hỏi phân tích sâu mới dùng model đắt tiền; hỏi đáp thường vẫn dùng bản flash."""
    return bool(req.attachment) or bool(DEEP_REQUEST_PATTERN.search(req.message))


def model_candidates(deep: bool) -> list[str]:
    preferred = [GEMINI_DEEP_MODEL, GEMINI_MODEL] if deep else [GEMINI_MODEL]
    return list(dict.fromkeys([*preferred, *GEMINI_FALLBACK_MODELS]))


def is_available(key: str) -> bool:
    return cooldowns.get(key, 0.0) <= time.monotonic()


def start_cooldown(key: str) -> None:
    """Tạm bỏ qua model hoặc công cụ vừa báo hết quota để câu hỏi sau không phải chờ nó lỗi lại."""
    cooldowns[key] = time.monotonic() + COOLDOWN_SECONDS


def request_config(deep: bool, with_search: bool) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        thinking_config=types.ThinkingConfig(
            thinking_budget=GEMINI_DEEP_THINKING_BUDGET if deep else GEMINI_THINKING_BUDGET,
            include_thoughts=False,
        ),
        tools=[types.Tool(google_search=types.GoogleSearch())] if with_search else None,
        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
    )


def request_attempts(deep: bool) -> list[tuple[str, types.GenerateContentConfig]]:
    """Danh sách lượt thử: mỗi model thử kèm tìm kiếm trước, rồi bỏ tìm kiếm nếu gói cước không cho dùng."""
    candidates = model_candidates(deep)
    models = [model for model in candidates if is_available(model)] or candidates
    search = GEMINI_ENABLE_SEARCH and is_available(SEARCH_COOLDOWN_KEY)

    attempts: list[tuple[str, types.GenerateContentConfig]] = []
    for model in models:
        if search:
            attempts.append((model, request_config(deep, with_search=True)))
        attempts.append((model, request_config(deep, with_search=False)))
    return attempts


def note_failure(model: str, config: types.GenerateContentConfig, exc: errors.APIError) -> bool:
    """Ghi nhận lỗi và cho biết có nên thử tiếp lượt sau hay không."""
    if config.tools is not None:
        start_cooldown(SEARCH_COOLDOWN_KEY)
        logger.warning("Tạm tắt tìm kiếm Google cho Gemini: %s", exc.code)
        return True
    if exc.code in RETRYABLE_STATUS:
        start_cooldown(model)
        logger.warning("Gemini model %s tạm thời không dùng được: %s", model, exc.code)
        return True
    return False


def generate_chat_response(contents: list[types.Content], deep: bool = False):
    """Dùng model chính và tự chuyển sang model dự phòng khi Gemini quá tải."""
    last_error: errors.APIError | None = None

    for model, config in request_attempts(deep):
        try:
            return client.models.generate_content(model=model, contents=contents, config=config)
        except errors.APIError as exc:
            last_error = exc
            if not note_failure(model, config, exc):
                raise

    if last_error:
        raise last_error
    raise RuntimeError("Không có mô hình Gemini khả dụng.")


def chunk_text(chunk) -> str:
    """Lấy phần chữ của một mảnh stream; mảnh chỉ chứa dữ liệu trích dẫn sẽ bị bỏ qua."""
    try:
        return chunk.text or ""
    except (AttributeError, ValueError):
        return ""


def guard_stalls(chunks, stall_seconds: int) -> Iterator:
    """Đọc luồng trong luồng phụ để phát hiện lúc Gemini im lặng quá lâu."""
    inbox: queue.Queue = queue.Queue()

    def pump():
        try:
            for chunk in chunks:
                inbox.put(("chunk", chunk))
        except Exception as exc:  # lỗi được ném lại ở luồng chính để xử lý chung một chỗ
            inbox.put(("error", exc))
        finally:
            inbox.put(("end", None))

    threading.Thread(target=pump, daemon=True).start()
    while True:
        try:
            kind, payload = inbox.get(timeout=stall_seconds)
        except queue.Empty as exc:
            raise StreamStalled() from exc
        if kind == "error":
            raise payload
        if kind == "end":
            return
        yield payload


def stream_chat_response(contents: list[types.Content], deep: bool = False) -> Iterator[str]:
    """Phát từng đoạn trả lời; chỉ đổi model khi chưa gửi chữ nào cho người dùng."""
    last_error: Exception | None = None

    for model, config in request_attempts(deep):
        emitted = False
        try:
            chunks = client.models.generate_content_stream(
                model=model, contents=contents, config=config
            )
            for chunk in guard_stalls(chunks, STREAM_STALL_SECONDS):
                text = chunk_text(chunk)
                if not text:
                    continue
                emitted = True
                yield text
            return
        except StreamStalled as exc:
            last_error = exc
            start_cooldown(model)
            logger.warning("Gemini model %s ngừng gửi chữ giữa chừng", model)
            if emitted:
                raise
        except errors.APIError as exc:
            last_error = exc
            can_retry = note_failure(model, config, exc)
            if emitted or not can_retry:
                raise

    if last_error:
        raise last_error
    raise RuntimeError("Không có mô hình Gemini khả dụng.")


def numbered_items(text: str) -> set[int]:
    """Lấy các số thứ tự nghề đã xuất hiện trong câu trả lời."""
    return {int(number) for number in NUMBERED_ITEM_PATTERN.findall(text)}


def retry_incomplete_top_ten(contents: list[types.Content], response_text: str) -> str:
    """Yêu cầu viết lại ngắn gọn nếu Gemini chưa trả đủ danh sách 1–10."""
    found_items = numbered_items(response_text)
    if all(number in found_items for number in range(1, 11)):
        return response_text

    logger.warning("Top 10 response incomplete; found numbered items: %s", sorted(found_items))
    retry_instruction = types.Part.from_text(
        text=(
            "Câu trả lời vừa tạo chưa có đủ các mục đánh số từ 1 đến 10. Hãy viết lại TOÀN BỘ câu trả lời "
            "theo dạng cô đọng và phải có đúng 10 mục. Mỗi mục chỉ gồm: tên nghề/nhóm nghề; mức độ phù hợp; "
            "một lý do ngắn dựa trên hồ sơ; từ khóa O*NET tiếng Anh. Không viết phần mở đầu dài, không lặp ý "
            "và không dừng trước mục số 10."
        )
    )
    retry_contents = list(contents)
    last_content = retry_contents[-1]
    retry_contents[-1] = types.Content(
        role=last_content.role,
        parts=[*(last_content.parts or []), retry_instruction],
    )
    retry_response = generate_chat_response(retry_contents, deep=True)
    retry_text = retry_response.text or ""
    return retry_text if len(numbered_items(retry_text)) > len(found_items) else response_text


def wants_complete_top_ten(req: ChatRequest) -> bool:
    return bool(TOP_TEN_REQUEST_PATTERN.search(req.message)) and (
        req.attachment is not None or req.profile is not None
    )


def overload_message(exc: errors.APIError) -> tuple[int, str]:
    if exc.code in RETRYABLE_STATUS:
        return 503, "Hệ thống AI đang có nhiều người sử dụng. Vui lòng chờ khoảng 30 giây rồi gửi lại."
    return 502, "AI chưa thể xử lý yêu cầu này. Vui lòng thử câu hỏi ngắn hơn hoặc chọn tệp khác."


def ensure_ready(req: ChatRequest) -> None:
    if client is None:
        raise HTTPException(status_code=503, detail="Server chưa cấu hình GEMINI_API_KEY trong backend/.env.")

    attachment_count = int(req.attachment is not None) + sum(
        message.attachment is not None for message in req.history
    )
    if attachment_count > 1:
        raise HTTPException(status_code=400, detail="Mỗi cuộc trao đổi chỉ hỗ trợ một tệp tại một thời điểm.")


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "llm_configured": client is not None,
        "provider": "gemini",
        "model": GEMINI_MODEL,
        "deep_model": GEMINI_DEEP_MODEL,
        "overload_fallback": bool(GEMINI_FALLBACK_MODELS),
        "search_grounding": GEMINI_ENABLE_SEARCH and is_available(SEARCH_COOLDOWN_KEY),
        "streaming": True,
        "profile_context": True,
        "response_policy": "top10-complete-v2",
        "max_output_tokens": MAX_OUTPUT_TOKENS,
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    ensure_ready(req)
    contents = build_contents(req)
    deep = needs_deep_model(req)

    try:
        response = generate_chat_response(contents, deep=deep)
    except errors.APIError as exc:
        logger.exception("Gemini API request failed after fallback attempts")
        status_code, detail = overload_message(exc)
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except Exception as exc:
        logger.exception("Unexpected Gemini request failure")
        raise HTTPException(
            status_code=502,
            detail="Chatbot đang tạm thời không phản hồi. Vui lòng thử lại sau ít phút.",
        ) from exc

    reply = response.text or "Xin lỗi, Gemini không trả về nội dung."
    if wants_complete_top_ten(req):
        try:
            reply = retry_incomplete_top_ten(contents, reply)
        except Exception:
            logger.exception("Không thể viết lại câu trả lời Top 10 chưa đủ mục")

    return ChatResponse(reply=reply)


def sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def rewrite_after_broken_stream(contents: list[types.Content], deep: bool) -> str:
    """Viết lại trọn câu trả lời khi luồng chữ bị ngắt giữa chừng, để học sinh không đọc dở dang."""
    try:
        return generate_chat_response(contents, deep=deep).text or ""
    except Exception:
        logger.exception("Không thể viết lại câu trả lời sau khi luồng bị ngắt")
        return ""


@app.post("/api/chat/stream")
def chat_stream(req: ChatRequest):
    """Trả lời theo kiểu gõ dần để học sinh thấy chữ ngay thay vì chờ hết câu."""
    ensure_ready(req)
    contents = build_contents(req)
    deep = needs_deep_model(req)

    def events() -> Iterator[str]:
        collected: list[str] = []
        try:
            for piece in stream_chat_response(contents, deep=deep):
                collected.append(piece)
                yield sse_event({"delta": piece})
        except (errors.APIError, StreamStalled) as exc:
            logger.warning("Luồng trả lời bị ngắt: %s", exc)
            detail = (
                overload_message(exc)[1]
                if isinstance(exc, errors.APIError)
                else "Hệ thống AI đang có nhiều người sử dụng. Vui lòng chờ khoảng 30 giây rồi gửi lại."
            )
            # Model vừa hỏng đã bị đánh dấu tạm nghỉ, nên lượt viết lại này sẽ dùng model khác.
            rewritten = rewrite_after_broken_stream(contents, deep) if collected else ""
            yield sse_event({"replace": rewritten} if rewritten else {"error": detail})
            if not rewritten:
                return
            collected = [rewritten]
        except Exception:
            logger.exception("Unexpected Gemini streaming failure")
            yield sse_event({"error": "Chatbot đang tạm thời không phản hồi. Vui lòng thử lại sau ít phút."})
            return

        reply = "".join(collected)
        if reply and wants_complete_top_ten(req):
            try:
                completed = retry_incomplete_top_ten(contents, reply)
            except Exception:
                logger.exception("Không thể viết lại câu trả lời Top 10 chưa đủ mục")
            else:
                if completed != reply:
                    reply = completed
                    yield sse_event({"replace": completed})

        yield sse_event({"done": True, "empty": not reply})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
FRONTEND_ROOT = FRONTEND_DIR.resolve()


def frontend_response(path: Path) -> FileResponse:
    """Trả file frontend và tránh giữ cache 404 cũ sau mỗi lần deploy."""
    response = FileResponse(path)
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/", include_in_schema=False)
def frontend_index():
    return frontend_response(FRONTEND_ROOT / "index.html")


@app.get("/{file_path:path}", include_in_schema=False)
def frontend_file(file_path: str):
    target = (FRONTEND_ROOT / file_path).resolve()
    if FRONTEND_ROOT not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy trang.")
    return frontend_response(target)
