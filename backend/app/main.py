"""Backend FastAPI cho chatbot định hướng nghề nghiệp dùng Gemini."""

import base64
import binascii
import logging
import os
import re
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
- Luôn trả lời hoàn toàn bằng tiếng Việt, ngắn gọn, dễ hiểu và thân thiện. Không dùng tiêu đề hoặc
  nhãn tiếng Anh như "Why", "Specific majors"; nếu cần thuật ngữ tiếng Anh, phải giải thích bằng tiếng Việt.
- Chỉ tư vấn về tổ hợp môn, ngành học, nghề nghiệp, phương pháp học tập và tự đánh giá năng lực.
- Khi không chắc về điểm chuẩn, chỉ tiêu hoặc đề án tuyển sinh, yêu cầu học sinh kiểm tra nguồn chính thức.
- Không đưa ra kết luận tuyệt đối; trình bày dưới dạng gợi ý và khuyến khích tham khảo giáo viên, phụ huynh.
- Với vấn đề tâm lý nghiêm trọng, khuyên học sinh tìm người lớn tin cậy hoặc chuyên viên phù hợp.

Khi học sinh gửi tệp hoặc hình ảnh kết quả trắc nghiệm:
- Đọc toàn bộ các trang trước khi kết luận và chỉ sử dụng dữ liệu nhìn thấy rõ trong tệp.
- Không tự đoán nội dung bị mờ, thiếu, vô nghĩa hoặc chưa cập nhật. Phải nói rõ phần nào chưa đủ tin cậy.
- Phân biệt rõ: dữ liệu quan sát được, nhận định tham khảo và thông tin còn thiếu.
- Nếu tệp là PDF "Hồ sơ của tôi" được xuất từ website, phải kết hợp cả thông tin chữ (môn học yêu thích,
  năng khiếu, sở trường, hoạt động, mục tiêu) và các biểu đồ trắc nghiệm. Không được chỉ dựa vào một
  trường thông tin hoặc một điểm nổi bật duy nhất.
- Khi học sinh yêu cầu Top N, phải trả đúng N gợi ý. Riêng yêu cầu Top 10 từ PDF hồ sơ, trình bày theo
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
- Hoàn thành trọn vẹn câu trả lời; không kết thúc giữa câu hoặc giữa một mục."""

MAX_OUTPUT_TOKENS = max(8192, int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "8192")))
GEMINI_THINKING_BUDGET = int(os.getenv("GEMINI_THINKING_BUDGET", "512"))
TOP_TEN_REQUEST_PATTERN = re.compile(r"\btop\s*10\b|\b10\s+(?:nhóm\s+)?nghề\b", re.IGNORECASE)
NUMBERED_ITEM_PATTERN = re.compile(r"(?m)^\s*(?:#{1,6}\s*)?(10|[1-9])[.)]\s+")

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
                    max_output_tokens=MAX_OUTPUT_TOKENS,
                    thinking_config=types.ThinkingConfig(
                        thinking_budget=GEMINI_THINKING_BUDGET,
                        include_thoughts=False,
                    ),
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
    retry_response = generate_chat_response(retry_contents)
    retry_text = retry_response.text or ""
    return retry_text if len(numbered_items(retry_text)) > len(found_items) else response_text


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "llm_configured": client is not None,
        "provider": "gemini",
        "overload_fallback": bool(GEMINI_FALLBACK_MODELS),
    }


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

    reply = response.text or "Xin lỗi, Gemini không trả về nội dung."
    if req.attachment and TOP_TEN_REQUEST_PATTERN.search(req.message):
        try:
            reply = retry_incomplete_top_ten(contents, reply)
        except errors.APIError:
            logger.exception("Gemini could not retry an incomplete Top 10 response")
        except Exception:
            logger.exception("Unexpected failure while retrying an incomplete Top 10 response")

    return ChatResponse(reply=reply)


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
