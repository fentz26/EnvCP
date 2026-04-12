# リリース検証 — EnvCP

<p align="center">
<sup>
<a href="../../VERIFICATION.md">English</a> |
<a href="VERIFICATION.fr.md">Français</a> |
<a href="VERIFICATION.es.md">Español</a> |
<a href="VERIFICATION.ko.md">한국어</a> |
<a href="VERIFICATION.zh.md">中文</a> |
<a href="VERIFICATION.vi.md">Tiếng Việt</a>
</sup>
</p>

← [README](README.ja.md) · [セットアップガイド](SETUP.ja.md) · [セキュリティポリシー](../../SECURITY.md)

---

すべての EnvCP リリースには**署名済み SLSA Level 3 出典証明**が含まれています。これは以下を意味します：

- 開発者のマシンではなく、GitHub Actions の公式ソースからビルド
- すべての CI 依存関係は不変の SHA ダイジェストに固定
- ビルド後にアーティファクトが変更されていない
- 出典署名は **Sigstore** によって支持されている — 独立して検証可能

---

## 検証方法

### オプション 1 — npm audit signatures（最も簡単）

```bash
# @fentz26/envcp がインストールされたプロジェクトで：
npm install @fentz26/envcp
npm audit signatures
```

期待される出力：
```
audited 1 package in 1s
1 package has a verified registry signature
```

> **v1.2.0** 以降で利用可能。

---

### オプション 2 — GitHub CLI

必要：[GitHub CLI](https://cli.github.com/) (`gh`)

```bash
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

---

### オプション 3 — slsa-verifier（オフライン）

必要：[slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

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

## トラブルシューティング

**`npm audit signatures` — "監査する依存関係が見つかりません"**
`node_modules` に `@fentz26/envcp` がある プロジェクトディレクトリで実行してください。

**`gh attestation verify` — "証明が見つかりません"**
v1.2.0 以前に公開されたリリースです。`.intoto.jsonl` バンドルでオプション 3 を使用してください。

**`slsa-verifier` — "アーティファクトハッシュが一致しません"**
転送中にファイルが破損した可能性があります。再ダウンロードしてください。
