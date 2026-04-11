# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>面向 AI 代理的安全环境变量管理</strong>
</p>

<p align="center">
  EnvCP 让您安全地使用 AI 代理而不暴露您的秘密。<br>
  您的 API 密钥和环境变量在您的机器上保持加密 — AI 仅通过名称引用它们。
</p>

---

## 🌍 语言

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | **中文** | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## 安装

### npm

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> 需要安装 Node.js 18+。


```bash

### 无需安装使用

```bash
npx @fentz26/envcp init
```

---

## 快速开始

```bash
# 1. 在您的项目中初始化
envcp init

# 2. 添加您的秘密
envcp add API_KEY --value "您的密钥"
envcp add DATABASE_URL --value "postgres://..."

# 3. 启动服务器（自动检测客户端类型）
envcp serve --mode auto --port 3456
```

---

## 基本 CLI 命令

```bash
# 变量管理
envcp add <名称> [选项]        # 添加变量
envcp list [--show-values]     # 列出变量
envcp get <名称>               # 获取变量
envcp remove <名称>            # 删除变量

# 会话管理
envcp unlock                   # 用密码解锁
envcp lock                     # 立即锁定
envcp status                   # 检查会话状态

# 同步和导出
envcp sync                     # 同步到 .env 文件
envcp export [--format env|json|yaml]
```

---

## 为什么选择 EnvCP？

- **仅本地存储** — 您的秘密永远不会离开您的机器
- **静态加密** — 使用 Argon2id 密钥派生的 AES-256-GCM（64 MB 内存，3 次传递）
- **基于引用的访问** — AI 通过名称引用变量，从未看到实际值
- **自动 .env 注入** — 值可以自动注入到您的 .env 文件中
- **AI 访问控制** — 阻止 AI 主动列出或检查您的秘密
- **通用兼容性** — 通过 MCP、OpenAI、Gemini 或 REST 协议与任何 AI 工具配合使用

---

## 文档

- [完整文档](https://envcp.org/docs)
- [快速入门指南](https://envcp.org/docs/quick-start)
- [CLI 参考](https://envcp.org/docs/cli-reference)

---

## 许可证

[Source Available License v1.0](../../LICENSE)
