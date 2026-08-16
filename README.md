# Định Hướng Nghề Nghiệp AI

Website hỗ trợ học sinh THPT (đặc biệt lớp 12) tự nhận thức năng lực bản thân và định hướng
lựa chọn tổ hợp môn / nghề nghiệp, tích hợp AI. Đây là khung (scaffold) ban đầu cho đề tài
nghiên cứu khoa học học sinh — còn nhiều phần cần nhóm tiếp tục hoàn thiện, xem mục
[Việc cần làm tiếp](#việc-cần-làm-tiếp) ở cuối file.

## Kiến trúc & lựa chọn công nghệ

| Thành phần | Công nghệ | Vì sao chọn |
|---|---|---|
| Frontend | HTML/CSS/JavaScript thuần (không framework, không bước build) | Máy chưa cài Node.js; học sinh mở/sửa file trực tiếp, dễ hiểu, dễ deploy miễn phí (GitHub Pages, Netlify) |
| Dữ liệu bài test & ngành nghề | File JSON tĩnh (`frontend/data/`) | Không cần database cho MVP; dễ chỉnh sửa nội dung câu hỏi |
| Lưu kết quả trắc nghiệm | `localStorage` của trình duyệt | Đơn giản, không cần tài khoản/đăng nhập cho bản demo |
| Biểu đồ hồ sơ năng lực | Chart.js (qua CDN) | Nhẹ, không cần cài đặt |
| Backend chatbot | Python + FastAPI | Máy đã có sẵn Python; giữ API key an toàn ở phía server |
| Mô hình AI | Claude API (Anthropic), model mặc định `claude-sonnet-5` | Chất lượng trả lời tiếng Việt tốt, có thể đổi model trong `.env` |

**Vì sao tách backend riêng chỉ cho chatbot?** Toàn bộ trắc nghiệm, hồ sơ năng lực và tra cứu
ngành nghề chạy hoàn toàn phía trình duyệt (không cần server) — chỉ chatbot mới cần một server nhỏ,
vì phải gọi Claude API bằng API key bí mật (không được đặt key trong code frontend).

## Cấu trúc thư mục

```
DinhHuongNgheNghiep/
├── frontend/                  # Website tĩnh — chạy độc lập, không cần backend (trừ chatbot)
│   ├── index.html             # Trang chủ
│   ├── assessments.html       # Danh sách 5 bài trắc nghiệm
│   ├── quiz.html              # Trang làm bài (dùng chung cho cả 5 bài, đọc ?test=<id>)
│   ├── profile.html           # Hồ sơ năng lực tổng hợp + gợi ý ngành nghề
│   ├── careers.html           # Tra cứu cơ sở dữ liệu ngành nghề
│   ├── chatbot.html           # Giao diện hỏi đáp AI
│   ├── css/style.css          # Toàn bộ giao diện
│   ├── js/
│   │   ├── quiz-engine.js     # Render câu hỏi, chấm điểm, lưu kết quả (dùng chung 5 bài test)
│   │   ├── profile.js         # Tổng hợp hồ sơ, vẽ radar chart, đối chiếu ngành nghề
│   │   └── chatbot.js         # Gọi backend /api/chat
│   └── data/
│       ├── holland.json  mi.json  mbti.json  disc.json  motivators.json
│       └── careers.json       # Cơ sở dữ liệu ngành nghề - tổ hợp môn (dữ liệu minh họa)
├── backend/                   # Chỉ phục vụ chatbot
│   ├── app/main.py            # FastAPI, endpoint POST /api/chat
│   ├── requirements.txt
│   └── .env.example           # Sao chép thành .env và điền ANTHROPIC_API_KEY
└── README.md
```

## Cách chạy thử

### 1. Chạy frontend (bắt buộc, để xem trắc nghiệm/hồ sơ/tra cứu)

Trình duyệt chặn `fetch()` đọc file JSON khi mở trực tiếp bằng `file://`, nên cần một máy chủ
tĩnh đơn giản. Mở PowerShell tại thư mục `frontend/` rồi chạy:

```bash
python -m http.server 5500
```

Sau đó mở trình duyệt tại `http://localhost:5500`.

### 2. Chạy backend (chỉ cần khi muốn thử chatbot)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Mở file `.env` vừa tạo, điền `ANTHROPIC_API_KEY` (lấy tại https://console.anthropic.com/settings/keys).
Sau đó chạy server:

```bash
uvicorn app.main:app --reload --port 8000
```

Chatbot trên frontend (`chatbot.html`) sẽ tự động gọi tới `http://localhost:8000`. Nếu chưa chạy
backend, các trang khác (trắc nghiệm, hồ sơ, tra cứu) vẫn hoạt động bình thường — chỉ riêng
chatbot sẽ báo "chưa kết nối được với máy chủ".

## Giới hạn cần lưu ý khi viết báo cáo NCKH

- **DISC** trong bản demo dùng thang Likert tự đánh giá đơn giản hóa, khác với bản gốc
  "forced-choice ipsative" — cần nêu rõ giới hạn này khi trình bày phương pháp.
- **Cơ sở dữ liệu ngành nghề** (`careers.json`) là dữ liệu minh họa do nhóm tự biên soạn, tổ hợp
  môn/điểm chuẩn thay đổi theo năm — cần đối chiếu với đề án tuyển sinh chính thức trước khi công bố.
- **Thuật toán gợi ý nghề nghiệp** hiện là luật đối chiếu đơn giản (overlap giữa mã Holland/MI nổi
  bật và dữ liệu ngành nghề), phù hợp làm điểm mới có thể giải thích được (explainable) cho đề tài,
  nhưng chưa phải mô hình học máy — nên trình bày đúng bản chất trong báo cáo.
- Trắc nghiệm không thay thế tư vấn tâm lý/hướng nghiệp chuyên nghiệp.

## Việc cần làm tiếp

- [ ] Thiết kế thực nghiệm đo hiệu quả: cho một nhóm học sinh làm lại trắc nghiệm tự nhận thức
      sau vài tuần dùng hệ thống (pre-test/post-test) để có số liệu cho phần kết quả nghiên cứu.
- [ ] Bổ sung cơ chế đồng ý của phụ huynh trước khi thu thập dữ liệu học sinh phục vụ nghiên cứu.
- [ ] Mở rộng ngân hàng câu hỏi (hiện đang rút gọn để làm MVP) nếu muốn tăng độ tin cậy trắc nghiệm.
- [ ] Cân nhắc thêm trang giáo viên/nhà trường xem thống kê tổng hợp toàn khối.
- [ ] Khi cần lưu dữ liệu nhiều học sinh tập trung (thay vì chỉ `localStorage` từng máy), bổ sung
      database (ví dụ SQLite) và các endpoint lưu/truy xuất kết quả ở backend.
