# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%" /></a>
</p>

<p align="center">
  <strong>AI 에이전트를 위한 안전한 시크릿 — 로컬, 암호화, 참조 전용.</strong>
</p>

<p align="center">
  AI 보조 코딩을 위한 안전한 환경 변수 관리.<br />
  AI가 시크릿을 값이 아닌 이름으로 참조하게 하는 MCP 서버.
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | **한국어** | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## 기능

- 시크릿을 머신에 저장
- AI 도구가 실제 값 대신 이름으로 시크릿을 참조하도록 허용
- 필요 시 `.env` 파일에 값 동기화 가능
- MCP, REST, OpenAI 호환, Gemini 호환 클라이언트 지원

---

## v1.2.0 새로운 기능

- 간소화된 첫 실행 설정
- `config` 및 `rule`을 위한 대화형 메뉴
- 변수별 및 클라이언트별 AI 규칙
- 개선된 서비스/시작 설정
- 전반적인 정리, 보안 강화 및 테스트 커버리지

---

## 빠른 시작

설치 및 초기화:

```bash
npm install -g @fentz26/envcp
envcp init   # Basic / Advanced / Manual 설정 선택
```

시크릿 추가:

```bash
envcp add API_KEY --from-env API_KEY
# 또는: printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

MCP 서버 시작:

```bash
envcp serve
```

---

## 문서

| 가이드 | 설명 |
|--------|------|
| [문서 사이트](https://envcp.org/docs) | 메인 문서 |
| [설치 가이드](SETUP.ko.md) | 설치, 설정, 통합 |
| [보안 가이드](../../docs/SECURITY_GUIDE.md) | 안전한 설정 및 인시던트 대응 |
| [검증](VERIFICATION.ko.md) | SLSA 3 출처 검증 |
| [보안 정책](../../SECURITY.md) | 취약점 신고 |

---

## 라이선스

SAL v1.0 — [LICENSE](../../LICENSE) 파일 참조.

## 지원

- 이메일: contact@envcp.org
- GitHub 이슈: https://github.com/fentz26/EnvCP/issues
- 문서: https://envcp.org/docs
