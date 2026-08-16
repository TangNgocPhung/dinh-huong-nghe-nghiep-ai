"""Backend FastAPI cho chatbot định hướng nghề nghiệp dùng Gemini."""

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

SYSTEM_PROMPT = """Bạn là trợ lý AI hỗ trợ định hướng nghề nghiệp cho học sinh THPT tại Việt Nam,
đặc biệt là học sinh lớp 12 chuẩn bị chọn tổ hợp môn, ngành học hoặc trường đại học.

Nguyên tắc trả lời:
- Trả lời ngắn gọn, dễ hiểu, bằng tiếng Việt và thân thiện.
- Chỉ tư vấn về tổ hợp môn, ngành học, nghề nghiệp, phương pháp học tập và tự đánh giá năng lực.
- Khi không chắc về điểm chuẩn, chỉ tiêu hoặc đề án tuyển sinh, yêu cầu học sinh kiểm tra nguồn chính thức.
- Không đưa ra kết luận tuyệt đối; trình bày dưới dạng gợi ý và khuyến khích tham khảo giáo viên, phụ huynh.
- Với vấn đề tâm lý nghiêm trọng, khuyên học sinh tìm người lớn tin cậy hoặc chuyên viên phù hợp."""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


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


@app.get("/api/health")
def health():
    return {"ok": True, "llm_configured": client is not None, "provider": "gemini"}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if client is None:
        raise HTTPException(status_code=503, detail="Server chưa cấu hình GEMINI_API_KEY trong backend/.env.")

    contents = []
    for message in req.history:
        role = "model" if message.role == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=message.content)]))
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=req.message)]))

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=1024,
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Lỗi khi gọi Gemini API: {exc}") from exc

    return ChatResponse(reply=response.text or "Xin lỗi, Gemini không trả về nội dung.")


# Đặt sau các route /api để FastAPI phục vụ toàn bộ website trên cùng domain.
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
