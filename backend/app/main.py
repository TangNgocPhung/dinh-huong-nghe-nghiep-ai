"""Backend FastAPI cho chatbot định hướng nghề nghiệp dùng Gemini."""

import base64
import binascii
import logging
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
GEMINI_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv(
        "GEMINI_FALLBACK_MODELS",
        "gemini-3.5-flash-lite,gemini-2.5-flash-lite",
    ).split(",")
    if model.strip()
]
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Bạn là trợ lý AI hỗ trợ định hướng nghề nghiệp cho học sinh THPT tại Việt Nam,
đặc biệt là học sinh lớp 12 chuẩn bị chọn tổ hợp môn, ngành học hoặc trường đại học.

Nguyên tắc trả lời:
- Trả lời ngắn gọn, dễ hiểu, bằng tiếng Việt và thân thiện.
- Chỉ tư vấn về tổ hợp môn, ngành học, nghề nghiệp, phương pháp học tập và tự đánh giá năng lực.
- Khi không chắc về điểm chuẩn, chỉ tiêu hoặc đề án tuyển sinh, yêu cầu học sinh kiểm tra nguồn chính thức.
- Không đưa ra kết luận tuyệt đối; trình bày dưới dạng gợi ý và khuyến khích tham khảo giáo viên, phụ huynh.
- Với vấn đề tâm lý nghiêm trọng, khuyên học sinh tìm người lớn tin cậy hoặc chuyên viên phù hợp."""

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


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    attachment: ChatAttachment | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    attachment: ChatAttachment | None = None


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


def content_parts(text: str, attachment: ChatAttachment | None) -> list[types.Part]:
    parts: list[types.Part] = []
    if attachment:
        parts.append(attachment_part(attachment))
        parts.append(types.Part.from_text(text=f"Tên tệp đính kèm: {Path(attachment.name).name}"))
    parts.append(types.Part.from_text(text=text))
    return parts


def generate_chat_response(contents: list[types.Content]):
    """Dùng model chính và tự chuyển sang model dự phòng khi Gemini quá tải."""
    model_candidates = list(dict.fromkeys([GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]))
    last_error: errors.APIError | None = None

    for model in model_candidates:
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    max_output_tokens=1024,
                ),
            )
        except errors.APIError as exc:
            last_error = exc
            if exc.code not in {429, 500, 502, 503, 504}:
                raise
            logger.warning("Gemini model %s temporarily unavailable: %s", model, exc.code)

    if last_error:
        raise last_error
    raise RuntimeError("Không có mô hình Gemini khả dụng.")


@app.get("/api/health")
def health():
    return {"ok": True, "llm_configured": client is not None, "provider": "gemini"}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if client is None:
        raise HTTPException(status_code=503, detail="Server chưa cấu hình GEMINI_API_KEY trong backend/.env.")

    attachment_count = int(req.attachment is not None) + sum(
        message.attachment is not None for message in req.history
    )
    if attachment_count > 1:
        raise HTTPException(status_code=400, detail="Mỗi cuộc trao đổi chỉ hỗ trợ một tệp tại một thời điểm.")

    contents = []
    for message in req.history:
        role = "model" if message.role == "assistant" else "user"
        contents.append(types.Content(role=role, parts=content_parts(message.content, message.attachment)))
    contents.append(types.Content(role="user", parts=content_parts(req.message, req.attachment)))

    try:
        response = generate_chat_response(contents)
    except errors.APIError as exc:
        logger.exception("Gemini API request failed after fallback attempts")
        if exc.code in {429, 500, 502, 503, 504}:
            raise HTTPException(
                status_code=503,
                detail="Hệ thống AI đang có nhiều người sử dụng. Vui lòng chờ khoảng 30 giây rồi gửi lại.",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail="AI chưa thể xử lý yêu cầu này. Vui lòng thử câu hỏi ngắn hơn hoặc chọn tệp khác.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected Gemini request failure")
        raise HTTPException(
            status_code=502,
            detail="Chatbot đang tạm thời không phản hồi. Vui lòng thử lại sau ít phút.",
        ) from exc

    return ChatResponse(reply=response.text or "Xin lỗi, Gemini không trả về nội dung.")


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
