# 릴리스 검증 — EnvCP

<p align="center">
<sup>
<a href="../../VERIFICATION.md">English</a> |
<a href="VERIFICATION.fr.md">Français</a> |
<a href="VERIFICATION.es.md">Español</a> |
<a href="VERIFICATION.zh.md">中文</a> |
<a href="VERIFICATION.vi.md">Tiếng Việt</a> |
<a href="VERIFICATION.ja.md">日本語</a>
</sup>
</p>

← [README](README.ko.md) · [설치 가이드](SETUP.ko.md) · [보안 정책](../../SECURITY.md)

---

모든 EnvCP 릴리스에는 **서명된 SLSA Level 3 출처 증명**이 포함됩니다. 이는 다음을 의미합니다:

- 개발자 머신이 아닌 GitHub Actions의 공식 소스에서 빌드됨
- 모든 CI 종속성이 불변 SHA 다이제스트에 고정됨
- 빌드 후 아티팩트가 수정되지 않음
- 출처 서명은 **Sigstore**로 뒷받침됨 — 독립적으로 검증 가능

---

## 검증 방법

### 옵션 1 — npm audit signatures (가장 간단)

```bash
# @fentz26/envcp가 설치된 프로젝트에서:
npm install @fentz26/envcp
npm audit signatures
```

예상 출력:
```
audited 1 package in 1s
1 package has a verified registry signature
```

> **v1.2.0**부터 사용 가능합니다.

---

### 옵션 2 — GitHub CLI

필요: [GitHub CLI](https://cli.github.com/) (`gh`)

```bash
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

---

### 옵션 3 — slsa-verifier (오프라인)

필요: [slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

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

## 문제 해결

**`npm audit signatures` — "감사할 종속성을 찾을 수 없음"**
`node_modules`에 `@fentz26/envcp`가 있는 프로젝트 디렉토리에서 실행하세요.

**`gh attestation verify` — "증명을 찾을 수 없음"**
v1.2.0 이전에 게시된 릴리스입니다. `.intoto.jsonl` 번들로 옵션 3을 사용하세요.

**`slsa-verifier` — "아티팩트 해시가 일치하지 않음"**
파일이 전송 중에 손상되었을 수 있습니다. 다시 다운로드하세요.
