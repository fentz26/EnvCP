# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%" /></a>
</p>

<p align="center">
  <strong>Bí mật an toàn cho AI agent — cục bộ, mã hóa, chỉ tham chiếu.</strong>
</p>

<p align="center">
  Quản lý biến môi trường an toàn cho lập trình hỗ trợ AI.<br />
  MCP server giúp AI tham chiếu bí mật của bạn theo tên — không bao giờ theo giá trị.
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | **Tiếng Việt** | [日本語](README.ja.md)

---

## Tính năng

- Lưu trữ bí mật trên máy của bạn
- Cho phép các công cụ AI tham chiếu bí mật theo tên thay vì giá trị thực
- Có thể đồng bộ giá trị vào file `.env` khi cần
- Hỗ trợ MCP, REST, tương thích OpenAI và tương thích Gemini

---

## Điểm mới trong v1.2.0

- Thiết lập lần đầu đơn giản hơn
- Menu tương tác cho `config` và `rule`
- Quy tắc AI theo biến và theo client
- Cài đặt dịch vụ/khởi động cải tiến
- Dọn dẹp tổng thể, tăng cường bảo mật và độ phủ test

---

## Bắt đầu nhanh

Cài đặt và khởi tạo:

```bash
npm install -g @fentz26/envcp
envcp init   # chọn thiết lập Basic / Advanced / Manual
```

Thêm bí mật:

```bash
envcp add API_KEY --from-env API_KEY
# hoặc: printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

Khởi động MCP server:

```bash
envcp serve
```

---

## Tài liệu

| Hướng dẫn | Mô tả |
|-----------|-------|
| [Trang tài liệu](https://envcp.org/docs) | Tài liệu chính |
| [Hướng dẫn cài đặt](SETUP.vi.md) | Cài đặt, cấu hình, tích hợp |
| [Hướng dẫn bảo mật](../../docs/SECURITY_GUIDE.md) | Triển khai an toàn và xử lý sự cố |
| [Xác minh](VERIFICATION.vi.md) | Xác minh nguồn gốc SLSA 3 |
| [Chính sách bảo mật](../../SECURITY.md) | Báo cáo lỗ hổng |

---

## Giấy phép

SAL v1.0 — Xem file [LICENSE](../../LICENSE).

## Hỗ trợ

- Email: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Tài liệu: https://envcp.org/docs
