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

## 機能

- シークレットをマシン上に保存
- AIツールが実際の値ではなく名前でシークレットを参照できるようにする
- 必要に応じて`.env`ファイルに値を同期可能
- MCP、REST、OpenAI互換、Gemini互換クライアントをサポート

---

## v1.2.0 の新機能

- 初回セットアップの簡素化
- `config`と`rule`のインタラクティブメニュー
- 変数ごと・クライアントごとのAIルール
- サービス/起動設定の改善
- 全般的な整理、セキュリティ強化、テストカバレッジ

---

## クイックスタート

インストールと初期化：

```bash
npm install -g @fentz26/envcp
envcp init   # Basic / Advanced / Manual 設定を選択
```

シークレットの追加：

```bash
envcp add API_KEY --from-env API_KEY
# または: printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

MCPサーバーの起動：

```bash
envcp serve
```

---

## ドキュメント

| ガイド | 説明 |
|--------|------|
| [ドキュメントサイト](https://envcp.org/docs) | メインドキュメント |
| [セットアップガイド](SETUP.ja.md) | インストール、設定、統合 |
| [セキュリティガイド](../../docs/SECURITY_GUIDE.md) | 安全な設定とインシデント対応 |
| [検証](VERIFICATION.ja.md) | SLSA 3 出典検証 |
| [セキュリティポリシー](../../SECURITY.md) | 脆弱性報告 |

---

## ライセンス

SAL v1.0 — [LICENSE](../../LICENSE) ファイルを参照。

## サポート

- メール: contact@envcp.org
- GitHub Issues: https://github.com/fentz26/EnvCP/issues
- ドキュメント: https://envcp.org/docs
