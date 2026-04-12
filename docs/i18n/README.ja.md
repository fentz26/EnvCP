# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>AIエージェントのための安全なシークレット — ローカル、暗号化、参照専用。</strong>
</p>

<p align="center">
  AIアシストコーディングのための安全な環境変数管理。<br>
  AIが秘密を名前で参照できるMCPサーバー — 値を見ることなく。
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | **日本語**

---

## なぜ EnvCP なのか？

- **ローカル専用ストレージ** — シークレットがマシンの外に出ることはありません
- **保存時に暗号化** — Argon2id鍵導出によるAES-256-GCM
- **参照ベースのアクセス** — AIは実際の値を見ることなく、名前で変数を参照します
- **自動 .env インジェクション** — .envファイルに値を自動注入できます
- **AIアクセス制御** — AIがシークレットをリストアップしたり確認するのを防止
- **ユニバーサル互換性** — MCP、OpenAI、Gemini、またはREST

---

## クイックスタート

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "your-secret-key"
envcp serve --mode auto --port 3456
```

---

## ドキュメント

| ガイド | 説明 |
|--------|------|
| [セットアップガイド](SETUP.ja.md) | インストール、CLI、統合、設定 |
| [検証](VERIFICATION.ja.md) | SLSA 3 出典検証 |
| [セキュリティポリシー](../../SECURITY.md) | 脆弱性報告、暗号化の詳細 |

---

## セキュリティとサプライチェーン

- **SLSA Level 3** — サプライチェーンの整合性のためのビルド出典（[検証 →](VERIFICATION.ja.md)）
- **保存時に暗号化** — Argon2idによるAES-256-GCM
- **ローカル専用** — シークレットがマシンの外に出ることはありません
- **CI SHA固定** — すべてのGitHub Actionsが不変のコミットSHAに固定

---

## ライセンス

SAL v1.0 — [LICENSE](../../LICENSE) ファイルを参照。

## サポート

- メール: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- ドキュメント: https://envcp.org/docs
