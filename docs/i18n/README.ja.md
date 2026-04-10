# EnvCP

<p align="center">
  <a href="https://envcp.fentz.dev/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>AIエージェント向けの安全な環境変数管理</strong>
</p>

<p align="center">
  EnvCPを使用すると、秘密を公開せずにAIエージェントを安全に使用できます。<br>
  APIキーと環境変数はお使いのマシンで暗号化されたままです — AIは名前でのみ参照します。
</p>

---

## 🌍 言語

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | **日本語**

---

## インストール

### npm

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Node.js 18+のインストールが必要です。

### curl

```bash
curl -fsSL https://envcp.fentz.dev/install.sh | bash
```

### インストールせずに使用

```bash
npx @fentz26/envcp init
```

---

## クイックスタート

```bash
# 1. プロジェクトで初期化
envcp init

# 2. 秘密を追加
envcp add API_KEY --value "あなたの秘密鍵"
envcp add DATABASE_URL --value "postgres://..."

# 3. サーバーを起動（クライアントタイプを自動検出）
envcp serve --mode auto --port 3456
```

---

## 基本的なCLIコマンド

```bash
# 変数管理
envcp add <名前> [オプション]       # 変数を追加
envcp list [--show-values]           # 変数を一覧表示
envcp get <名前>                     # 変数を取得
envcp remove <名前>                  # 変数を削除

# セッション管理
envcp unlock                         # パスワードでロック解除
envcp lock                           # 即座にロック
envcp status                         # セッションステータスを確認

# 同期とエクスポート
envcp sync                           # .envファイルに同期
envcp export [--format env|json|yaml]
```

---

## なぜEnvCPなのか？

- **ローカルのみのストレージ** — 秘密はマシンから出ることはありません
- **保存時暗号化** — Argon2id鍵導出付きAES-256-GCM（64 MBメモリ、3パス）
- **参照ベースのアクセス** — AIは名前で変数を参照し、実際の値を見ることはありません
- **自動.env注入** — 値は.envファイルに自動的に注入できます
- **AIアクセス制御** — AIが秘密を積極的にリストまたはチェックすることを防止
- **ユニバーサル互換性** — MCP、OpenAI、Gemini、またはRESTプロトコルを介して任意のAIツールで動作

---

## ドキュメント

- [完全なドキュメント](https://envcp.fentz.dev/docs)
- [クイックスタートガイド](https://envcp.fentz.dev/docs/quick-start)
- [CLIリファレンス](https://envcp.fentz.dev/docs/cli-reference)

---

## ライセンス

[Source Available License v1.0](../../LICENSE)
