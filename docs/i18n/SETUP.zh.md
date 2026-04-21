# 安装指南 — EnvCP

<p align="center">
<sup>
<a href="../../SETUP.md">English</a> |
<a href="SETUP.fr.md">Français</a> |
<a href="SETUP.es.md">Español</a> |
<a href="SETUP.ko.md">한국어</a> |
<a href="SETUP.vi.md">Tiếng Việt</a> |
<a href="SETUP.ja.md">日本語</a>
</sup>
</p>

← [README](README.zh.md) · [验证](VERIFICATION.zh.md) · [安全政策](../../SECURITY.md)

---

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [CLI 参考](#cli-参考)
- [服务器模式](#服务器模式)
- [集成指南](#集成指南)
- [AI 访问控制](#ai-访问控制)
- [配置参考](#配置参考)
- [最佳实践](#最佳实践)

---

## 安装

### npm（推荐）

```bash
npm install -g @fentz26/envcp
```

### pip（Python）

```bash
pip install envcp
```

> 需要 Node.js 18+。

### 无需安装

```bash
npx @fentz26/envcp init
```

---

## 快速开始

```bash
# 1. 在项目中初始化
envcp init

# 2. 添加密钥
envcp add API_KEY --value "your-secret-key"
envcp add DATABASE_URL --value "postgres://..."

# 3. 启动服务器
envcp serve --mode auto --port 3456
```

---

## CLI 参考

### 变量管理

```bash
envcp add <名称> [选项]      # 添加变量
envcp list [--show-values]   # 列出变量
envcp get <名称>             # 获取变量
envcp remove <名称>          # 删除变量
```

### 保险库管理

```bash
envcp vault --global init|add|list|get|delete
envcp vault --project init|add|list|get|delete
envcp vault --name <名称> init|add|list|get|delete
envcp vault use <名称>
envcp vault contexts
```

### 会话管理

```bash
envcp unlock   # 用密码解锁
envcp lock     # 立即锁定
envcp status   # 检查会话状态
```

### 同步和导出

```bash
envcp sync
envcp export [--format env|json|yaml]
```

### 服务器

```bash
envcp serve [选项]
  --mode, -m      mcp, rest, openai, gemini, all, auto
  --port          HTTP 端口（默认：3456）
  --host          HTTP 主机（默认：127.0.0.1）
  --api-key, -k   认证 API 密钥
  --global        使用 home 目录中的全局 vault
```

---

## 服务器模式

| 模式 | 描述 | 使用场景 |
|------|------|----------|
| `auto` | 自动检测客户端 | 通用（推荐） |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | 任何 HTTP 客户端 |
| `openai` | OpenAI 格式 | ChatGPT, GPT-4 API |
| `gemini` | Google 格式 | Gemini, Google AI |
| `all` | 所有 HTTP 协议 | 多客户端 |

---

## 集成指南

### Claude Desktop / Cursor / Cline（MCP）

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

### REST API（通用）

```bash
envcp serve --mode rest --port 3456 --api-key your-secret-key
```

```bash
curl -H "X-API-Key: your-secret-key" http://localhost:3456/api/variables
```

---

## AI 访问控制

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

## 配置参考

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

## 最佳实践

1. 永远不要提交 `.envcp/` — 添加到 `.gitignore`
2. HTTP 模式使用 API 密钥
3. 禁用 `allow_ai_active_check`
4. 对敏感变量使用黑名单模式
5. 定期检查 `.envcp/logs/` 中的访问日志
