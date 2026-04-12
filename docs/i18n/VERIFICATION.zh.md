# 版本验证 — EnvCP

<p align="center">
<sup>
<a href="../../VERIFICATION.md">English</a> |
<a href="VERIFICATION.fr.md">Français</a> |
<a href="VERIFICATION.es.md">Español</a> |
<a href="VERIFICATION.ko.md">한국어</a> |
<a href="VERIFICATION.vi.md">Tiếng Việt</a> |
<a href="VERIFICATION.ja.md">日本語</a>
</sup>
</p>

← [README](README.zh.md) · [安装指南](SETUP.zh.md) · [安全政策](../../SECURITY.md)

---

每个 EnvCP 版本都附带**签名的 SLSA Level 3 溯源证明**。这意味着：

- 从 GitHub Actions 的官方源构建，而非开发者机器
- 所有 CI 依赖项都固定到不可变的 SHA 摘要
- 构建后未修改构件
- 溯源签名由 **Sigstore** 支持 — 可独立验证

---

## 验证方法

### 选项 1 — npm audit signatures（最简单）

```bash
# 在安装了 @fentz26/envcp 的项目中：
npm install @fentz26/envcp
npm audit signatures
```

预期输出：
```
audited 1 package in 1s
1 package has a verified registry signature
```

> 从 **v1.2.0** 起可用。

---

### 选项 2 — GitHub CLI

需要：[GitHub CLI](https://cli.github.com/) (`gh`)

```bash
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

---

### 选项 3 — slsa-verifier（离线）

需要：[slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

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

## 故障排除

**`npm audit signatures` — "未找到要审计的依赖项"**
确保在 `node_modules` 中有 `@fentz26/envcp` 的项目目录中运行。

**`gh attestation verify` — "未找到证明"**
该版本在 v1.2.0 之前发布。请使用选项 3，带上 `.intoto.jsonl` 捆绑包。

**`slsa-verifier` — "构件哈希不匹配"**
文件可能在传输过程中损坏。请重新下载。
