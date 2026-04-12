# Xác minh phiên bản — EnvCP

<p align="center">
<sup>
<a href="../../VERIFICATION.md">English</a> |
<a href="VERIFICATION.fr.md">Français</a> |
<a href="VERIFICATION.es.md">Español</a> |
<a href="VERIFICATION.ko.md">한국어</a> |
<a href="VERIFICATION.zh.md">中文</a> |
<a href="VERIFICATION.ja.md">日本語</a>
</sup>
</p>

← [README](README.vi.md) · [Hướng dẫn cài đặt](SETUP.vi.md) · [Chính sách bảo mật](../../SECURITY.md)

---

Mỗi phiên bản EnvCP đi kèm với **chứng thực nguồn gốc SLSA Level 3 đã ký**. Điều này có nghĩa là:

- Được xây dựng từ nguồn chính thức trên GitHub Actions, không phải máy của nhà phát triển
- Tất cả các phụ thuộc CI được ghim vào SHA digest bất biến
- Artifact không bị sửa đổi sau khi xây dựng
- Chữ ký nguồn gốc được hỗ trợ bởi **Sigstore** — có thể xác minh độc lập

---

## Phương pháp xác minh

### Tùy chọn 1 — npm audit signatures (đơn giản nhất)

```bash
# Trong dự án có cài @fentz26/envcp:
npm install @fentz26/envcp
npm audit signatures
```

Kết quả mong đợi:
```
audited 1 package in 1s
1 package has a verified registry signature
```

> Có từ **v1.2.0** trở đi.

---

### Tùy chọn 2 — GitHub CLI

Yêu cầu: [GitHub CLI](https://cli.github.com/) (`gh`)

```bash
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

---

### Tùy chọn 3 — slsa-verifier (ngoại tuyến)

Yêu cầu: [slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

```bash
go install github.com/slsa-framework/slsa-verifier/v2/cli/slsa-verifier@latest

gh release download v<version> --repo fentz26/EnvCP \
  --pattern '*.tgz' \
  --pattern '*.intoto.jsonl'

slsa-verifier verify-artifact fentz26-envcp-<version>.tgz \
  --provenance-path fentz26-envcp-<version>.tgz.intoto.jsonl \
  --source-uri github.com/fentz26/EnvCP
```

---

## Khắc phục sự cố

**`npm audit signatures` — "không tìm thấy phụ thuộc để kiểm tra"**
Đảm bảo chạy trong thư mục dự án có `@fentz26/envcp` trong `node_modules`.

**`gh attestation verify` — "không tìm thấy chứng thực"**
Phiên bản được phát hành trước v1.2.0. Sử dụng tùy chọn 3 với bundle `.intoto.jsonl`.

**`slsa-verifier` — "hash artifact không khớp"**
File có thể bị hỏng trong quá trình truyền. Tải xuống lại.
