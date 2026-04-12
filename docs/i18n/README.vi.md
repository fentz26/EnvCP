# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>Quản lý biến môi trường an toàn cho AI agent</strong>
</p>

<p align="center">
  EnvCP cho phép bạn sử dụng AI agent an toàn mà không lộ bí mật.<br>
  Khóa API và biến môi trường của bạn được mã hóa trên máy — AI chỉ tham chiếu chúng theo tên.
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | **Tiếng Việt** | [日本語](README.ja.md)

---

## Thế tại sao bạn nên tin dùng EnvCP?

- **Chỉ lưu trữ cục bộ** — Bí mật của bạn không bao giờ rời khỏi máy nên ghệ bạn sẽ không biết
- **Mã hóa khi lưu trữ** — AES-256-GCM với Argon2id key derivation
- **Truy cập dựa trên tham chiếu** — AI tham chiếu biến theo tên biến, không bao giờ thấy giá trị thực
- **Tự động inject .env** — Giá trị có thể được inject vào file .env, vjip chưa
- **Kiểm soát truy cập AI** — Ngăn AI chủ động liệt kê hoặc kiểm tra bí mật
- **Tương thích toàn cầu** — MCP, OpenAI, Gemini hoặc REST

---

## Bắt đầu nhanh

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "your-secret-key"
envcp serve --mode auto --port 3456
```

---

## Tài liệu

| Hướng dẫn | Mô tả |
|-----------|-------|
| [Hướng dẫn cài đặt](SETUP.vi.md) | Cài đặt, CLI, tích hợp, cấu hình |
| [Xác minh](VERIFICATION.vi.md) | Xác minh nguồn gốc SLSA 3 |
| [Chính sách bảo mật](../../SECURITY.md) | Báo cáo lỗ hổng, chi tiết mã hóa |

---

## Bảo mật và chuỗi cung ứng

- **SLSA Level 3** — Xuất xứ build cho toàn vẹn chuỗi cung ứng ([xác minh →](VERIFICATION.vi.md))
- **Mã hóa khi lưu trữ** — AES-256-GCM với Argon2id
- **Chỉ cục bộ** — Bí mật không bao giờ rời khỏi máy
- **CI SHA-pinned** — Tất cả GitHub Actions được ghim vào commit SHA bất biến

---

## Giấy phép

SAL v1.0 — Xem file [LICENSE](../../LICENSE).

## Hỗ trợ

- Email: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- Tài liệu: https://envcp.org/docs
