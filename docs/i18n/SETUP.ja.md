# セットアップガイド — EnvCP

<p align="center">
<sup>
<a href="../../SETUP.md">English</a> |
<a href="SETUP.fr.md">Français</a> |
<a href="SETUP.es.md">Español</a> |
<a href="SETUP.ko.md">한국어</a> |
<a href="SETUP.zh.md">中文</a> |
<a href="SETUP.vi.md">Tiếng Việt</a>
</sup>
</p>

← [README](README.ja.md) · [検証](VERIFICATION.ja.md) · [セキュリティポリシー](../../SECURITY.md)

---

## 目次

- [インストール](#インストール)
- [クイックスタート](#クイックスタート)
- [CLIリファレンス](#cliリファレンス)
- [サーバーモード](#サーバーモード)
- [統合ガイド](#統合ガイド)
- [AIアクセス制御](#aiアクセス制御)
- [設定リファレンス](#設定リファレンス)
- [ベストプラクティス](#ベストプラクティス)

---

## インストール

### npm（推奨）

```bash
npm install -g @fentz26/envcp
```

### pip（Python）

```bash
pip install envcp
```

> Node.js 18+ が必要です。

### インストールなしで使用

```bash
npx @fentz26/envcp init
```

---

## クイックスタート

```bash
# 1. プロジェクトで初期化
envcp init

# 2. シークレットを追加
envcp add API_KEY --value "your-secret-key"
envcp add DATABASE_URL --value "postgres://..."

# 3. サーバーを起動
envcp serve --mode auto --port 3456
```

---

## CLIリファレンス

### 変数管理

```bash
envcp add <名前> [オプション]  # 変数を追加
envcp list [--show-values]    # 変数一覧
envcp get <名前>              # 変数を取得
envcp remove <名前>           # 変数を削除
```

### ボールト管理

```bash
envcp vault --global init|add|list|get|delete
envcp vault --project init|add|list|get|delete
envcp vault --name <名前> init|add|list|get|delete
envcp vault-switch <名前>
envcp vault-list
```

### セッション管理

```bash
envcp unlock   # パスワードでロック解除
envcp lock     # 即座にロック
envcp status   # セッション状態を確認
```

### 同期とエクスポート

```bash
envcp sync
envcp export [--format env|json|yaml]
```

### サーバー

```bash
envcp serve [オプション]
  --mode, -m      mcp, rest, openai, gemini, all, auto
  --port          HTTPポート（デフォルト: 3456）
  --host          HTTPホスト（デフォルト: 127.0.0.1）
  --api-key, -k   認証用APIキー
  --password, -p  暗号化パスワード
```

---

## サーバーモード

| モード | 説明 | ユースケース |
|--------|------|------------|
| `auto` | クライアント自動検出 | 汎用（推奨） |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | あらゆるHTTPクライアント |
| `openai` | OpenAI形式 | ChatGPT, GPT-4 API |
| `gemini` | Google形式 | Gemini, Google AI |
| `all` | 全HTTPプロトコル | 複数クライアント |

---

## 統合ガイド

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

### REST API（汎用）

```bash
envcp serve --mode rest --port 3456 --api-key your-secret-key
```

```bash
curl -H "X-API-Key: your-secret-key" http://localhost:3456/api/variables
```

---

## AIアクセス制御

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

## 設定リファレンス

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

## ベストプラクティス

1. `.envcp/` を絶対にコミットしない — `.gitignore` に追加
2. HTTPモードにはAPIキーを使用
3. `allow_ai_active_check` を無効化
4. 機密変数にはブラックリストパターンを使用
5. `.envcp/logs/` のアクセスログを定期的に確認
