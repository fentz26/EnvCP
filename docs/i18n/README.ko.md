# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>AI 에이전트를 위한 안전한 환경 변수 관리</strong>
</p>

<p align="center">
  EnvCP를 사용하면 시크릿을 노출하지 않고 AI 에이전트를 안전하게 사용할 수 있습니다.<br>
  API 키와 환경 변수는 암호화된 상태로 당신의 머신에 보관됩니다 — AI는 이름으로만 참조합니다.
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | **한국어** | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## 왜 EnvCP인가?

- **로컬 전용 스토리지** — 시크릿이 절대 머신을 벗어나지 않음
- **저장 시 암호화** — Argon2id 키 파생을 사용한 AES-256-GCM
- **참조 기반 접근** — AI는 실제 값을 보지 않고 이름으로만 변수를 참조
- **자동 .env 주입** — 값을 .env 파일에 자동으로 주입 가능
- **AI 접근 제어** — AI가 시크릿을 목록화하거나 확인하는 것을 차단
- **범용 호환성** — MCP, OpenAI, Gemini 또는 REST

---

## 빠른 시작

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "your-secret-key"
envcp serve --mode auto --port 3456
```

---

## 문서

| 가이드 | 설명 |
|--------|------|
| [설치 가이드](SETUP.ko.md) | 설치, CLI, 통합, 설정 |
| [검증](VERIFICATION.ko.md) | SLSA 3 출처 검증 |
| [보안 정책](../../SECURITY.md) | 취약점 신고, 암호화 |

---

## 보안 및 공급망

- **SLSA Level 3** — 공급망 무결성을 위한 빌드 출처 ([검증 →](VERIFICATION.ko.md))
- **저장 시 암호화** — Argon2id를 사용한 AES-256-GCM
- **로컬 전용** — 시크릿이 절대 머신을 벗어나지 않음
- **CI SHA 고정** — 모든 GitHub Actions가 불변 커밋 SHA에 고정

---

## 라이선스

SAL v1.0 — [LICENSE](../../LICENSE) 파일 참조.

## 지원

- 이메일: contact@envcp.org
- GitHub 이슈: https://github.com/fentz26/EnvCP/issues
- 문서: https://envcp.org/docs
