# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>面向 AI 代理的安全环境变量管理</strong>
</p>

<p align="center">
  EnvCP 让您安全地使用 AI 代理，而无需暴露您的密钥。<br>
  您的 API 密钥和环境变量以加密形式存储在本地 — AI 仅通过名称引用它们。
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | **中文** | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## 为什么选择 EnvCP？

- **仅本地存储** — 您的密钥永远不会离开您的机器
- **静态加密** — 使用 Argon2id 密钥派生的 AES-256-GCM
- **基于引用的访问** — AI 通过名称引用变量，从不看到实际值
- **自动 .env 注入** — 值可以自动注入到您的 .env 文件中
- **AI 访问控制** — 阻止 AI 主动列出或检查您的密钥
- **通用兼容性** — 支持 MCP、OpenAI、Gemini 或 REST

---

## 快速开始

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "your-secret-key"
envcp serve --mode auto --port 3456
```

---

## 文档

| 指南 | 描述 |
|------|------|
| [安装指南](SETUP.zh.md) | 安装、CLI、集成、配置 |
| [验证](VERIFICATION.zh.md) | SLSA 3 溯源验证 |
| [安全政策](../../SECURITY.md) | 漏洞报告、加密详情 |

---

## 安全与供应链

- **SLSA Level 3** — 供应链完整性的构建溯源（[验证 →](VERIFICATION.zh.md)）
- **静态加密** — 使用 Argon2id 的 AES-256-GCM
- **仅本地** — 您的密钥永远不会离开您的机器
- **CI SHA 固定** — 所有 GitHub Actions 固定到不可变的提交 SHA

---

## 许可证

SAL v1.0 — 请参阅 [LICENSE](../../LICENSE) 文件。

## 支持

- 邮箱：contact@envcp.org
- GitHub Issues：https://github.com/fentz26/EnvCP/issues
- 文档：https://envcp.org/docs
