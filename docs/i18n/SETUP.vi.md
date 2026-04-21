# Hướng dẫn cài đặt — EnvCP

<p align="center">
<sup>
<a href="../../SETUP.md">English</a> |
<a href="SETUP.fr.md">Français</a> |
<a href="SETUP.es.md">Español</a> |
<a href="SETUP.ko.md">한국어</a> |
<a href="SETUP.zh.md">中文</a> |
<a href="SETUP.ja.md">日本語</a>
</sup>
</p>

← [README](README.vi.md) · [Xác minh](VERIFICATION.vi.md) · [Chính sách bảo mật](../../SECURITY.md)

---

## Mục lục

- [Cài đặt](#cài-đặt)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Tham chiếu CLI](#tham-chiếu-cli)
- [Chế độ máy chủ](#chế-độ-máy-chủ)
- [Hướng dẫn tích hợp](#hướng-dẫn-tích-hợp)
- [Kiểm soát truy cập AI](#kiểm-soát-truy-cập-ai)
- [Tham chiếu cấu hình](#tham-chiếu-cấu-hình)
- [Thực hành tốt nhất](#thực-hành-tốt-nhất)

---

## Cài đặt

### npm (khuyến nghị)

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Yêu cầu Node.js 18+.

### Sử dụng không cần cài đặt

```bash
npx @fentz26/envcp init
```

---

## Bắt đầu nhanh

```bash
# 1. Khởi tạo trong dự án
envcp init

# 2. Thêm bí mật
envcp add API_KEY --value "your-secret-key"
envcp add DATABASE_URL --value "postgres://..."

# 3. Khởi động máy chủ
envcp serve --mode auto --port 3456
```

---

## Tham chiếu CLI

### Quản lý biến

```bash
envcp add <tên> [tùy chọn]   # Thêm biến
envcp list [--show-values]    # Liệt kê biến
envcp get <tên>               # Lấy biến
envcp remove <tên>            # Xóa biến
```

### Quản lý kho

```bash
envcp vault --global init|add|list|get|delete
envcp vault --project init|add|list|get|delete
envcp vault --name <tên> init|add|list|get|delete
envcp vault use <tên>
envcp vault contexts
```

### Quản lý phiên

```bash
envcp unlock   # Mở khóa bằng mật khẩu
envcp lock     # Khóa ngay lập tức
envcp status   # Kiểm tra trạng thái phiên
```

### Đồng bộ và xuất

```bash
envcp sync
envcp export [--format env|json|yaml]
```

### Máy chủ

```bash
envcp serve [tùy chọn]
  --mode, -m      mcp, rest, openai, gemini, all, auto
  --port          Cổng HTTP (mặc định: 3456)
  --host          Host HTTP (mặc định: 127.0.0.1)
  --api-key, -k   Khóa API để xác thực
  --global        Dùng vault toàn cục trong thư mục home
```

---

## Chế độ máy chủ

| Chế độ | Mô tả | Trường hợp sử dụng |
|--------|-------|-------------------|
| `auto` | Tự động phát hiện client | Phổ quát (khuyến nghị) |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | Mọi HTTP client |
| `openai` | Định dạng OpenAI | ChatGPT, GPT-4 API |
| `gemini` | Định dạng Google | Gemini, Google AI |
| `all` | Tất cả giao thức HTTP | Nhiều client |

---

## Hướng dẫn tích hợp

### Claude Desktop / Cursor / Cline (MCP)

```json
{
  "mcpServers": {
    "envcp": {
      "command": "npx",
      "args": ["-y", "@fentz26/envcp", "serve", "--mode", "mcp"]
    }
  }
}
```

### REST API (Phổ quát)

```bash
envcp serve --mode rest --port 3456 --api-key your-secret-key
```

```bash
curl -H "X-API-Key: your-secret-key" http://localhost:3456/api/variables
```

---

## Kiểm soát truy cập AI

```yaml
access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_active_check: false
  require_confirmation: true
  blacklist_patterns:
    - "*_SECRET"
    - "*_PRIVATE"
    - "ADMIN_*"
```

---

## Tham chiếu cấu hình

```yaml
version: "1.0"
project: my-project

session:
  enabled: true
  timeout_minutes: 30
  max_extensions: 5

access:
  allow_ai_read: true
  allow_ai_write: false
  allow_ai_active_check: false
  require_confirmation: true

sync:
  enabled: true
  target: .env
  exclude:
    - "*_PRIVATE"
    - "*_SECRET"
```

---

## Thực hành tốt nhất

1. Không bao giờ commit `.envcp/` — Thêm vào `.gitignore`
2. Sử dụng khóa API cho chế độ HTTP
3. Tắt `allow_ai_active_check`
4. Sử dụng các mẫu danh sách đen cho biến nhạy cảm
5. Kiểm tra nhật ký truy cập thường xuyên tại `.envcp/logs/`
