# EnvCP

<p align="center">
  <a href="https://envcp.fentz.dev/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>Quản lý biến môi trường an toàn cho tác nhân AI</strong>
</p>

<p align="center">
  EnvCP cho phép bạn sử dụng tác nhân AI một cách an toàn mà không tiết lộ bí mật của mình.<br>
  Các khóa API và biến môi trường của bạn được mã hóa trên máy của bạn — AI chỉ tham chiếu chúng bằng tên.
</p>

---

## 🌍 Ngôn ngữ

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | **Tiếng Việt** | [日本語](README.ja.md)

---

## Cài đặt

### npm

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Yêu cầu Node.js 18+ được cài đặt.


```bash

### Sử dụng không cần cài đặt

```bash
npx @fentz26/envcp init
```

---

## Bắt đầu nhanh

```bash
# 1. Khởi tạo trong dự án của bạn
envcp init

# 2. Thêm bí mật của bạn
envcp add API_KEY --value "khóa-bí-mật-của-bạn"
envcp add DATABASE_URL --value "postgres://..."

# 3. Khởi động máy chủ (tự động phát hiện loại client)
envcp serve --mode auto --port 3456
```

---

## Lệnh CLI cơ bản

```bash
# Quản lý biến
envcp add <tên> [tùy chọn]     # Thêm một biến
envcp list [--show-values]     # Liệt kê biến
envcp get <tên>                # Lấy một biến
envcp remove <tên>             # Xóa một biến

# Quản lý phiên
envcp unlock                   # Mở khóa bằng mật khẩu
envcp lock                     # Khóa ngay lập tức
envcp status                   # Kiểm tra trạng thái phiên

# Đồng bộ và xuất
envcp sync                     # Đồng bộ đến file .env
envcp export [--format env|json|yaml]
```

---

## Tại sao chọn EnvCP?

- **Chỉ lưu trữ cục bộ** — Bí mật của bạn không bao giờ rời khỏi máy của bạn
- **Mã hóa khi nghỉ** — AES-256-GCM với dẫn xuất khóa Argon2id (64 MB bộ nhớ, 3 lần chạy)
- **Truy cập bằng tham chiếu** — AI tham chiếu biến bằng tên, không bao giờ thấy giá trị thực
- **Tiêm .env tự động** — Giá trị có thể được tự động tiêm vào các file .env của bạn
- **Kiểm soát truy cập AI** — Ngăn AI chủ động liệt kê hoặc kiểm tra bí mật của bạn
- **Khả năng tương thích phổ quát** — Hoạt động với mọi công cụ AI thông qua MCP, OpenAI, Gemini hoặc giao thức REST

---

## Tài liệu

- [Tài liệu đầy đủ](https://envcp.fentz.dev/docs)
- [Hướng dẫn bắt đầu nhanh](https://envcp.fentz.dev/docs/quick-start)
- [Tham khảo CLI](https://envcp.fentz.dev/docs/cli-reference)

---

## Giấy phép

[Source Available License v1.0](../../LICENSE)
