# EnvCP

<p align="center">
  <a href="https://envcp.fentz.dev/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>AI 에이전트를 위한 안전한 환경 변수 관리</strong>
</p>

<p align="center">
  EnvCP를 사용하면 비밀을 노출하지 않고 안전하게 AI 에이전트를 사용할 수 있습니다.<br>
  API 키와 환경 변수는 기기에서 암호화되어 저장됩니다 — AI는 이름으로만 참조합니다.
</p>

---

## 🌍 언어

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | **한국어** | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## 설치

### npm

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Node.js 18+ 이상이 필요합니다.

### curl

```bash
curl -fsSL https://envcp.fentz.dev/install.sh | bash
```

### 설치 없이 사용

```bash
npx @fentz26/envcp init
```

---

## 빠른 시작

```bash
# 1. 프로젝트에서 초기화
envcp init

# 2. 비밀 추가
envcp add API_KEY --value "당신의-비밀-키"
envcp add DATABASE_URL --value "postgres://..."

# 3. 서버 시작 (클라이언트 자동 감지)
envcp serve --mode auto --port 3456
```

---

## 기본 CLI 명령어

```bash
# 변수 관리
envcp add <이름> [옵션]        # 변수 추가
envcp list [--show-values]     # 변수 목록
envcp get <이름>               # 변수 가져오기
envcp remove <이름>            # 변수 제거

# 세션 관리
envcp unlock                   # 비밀번호로 잠금 해제
envcp lock                     # 즉시 잠금
envcp status                   # 세션 상태 확인

# 동기화 및 내보내기
envcp sync                     # .env 파일로 동기화
envcp export [--format env|json|yaml]
```

---

## 왜 EnvCP인가?

- **로컬 전용 저장소** — 비밀이 기기를 벗어나지 않음
- **저장 시 암호화** — Argon2id 키 파생이 포함된 AES-256-GCM (64 MB 메모리, 3회 통과)
- **참조 기반 액세스** — AI는 이름으로 변수를 참조하고 실제 값을 보지 못함
- **자동 .env 주입** — 값이 .env 파일에 자동으로 주입될 수 있음
- **AI 액세스 제어** — AI가 비밀을 사전에 나열하거나 확인하지 못하도록 차단
- **범용 호환성** — MCP, OpenAI, Gemini 또는 REST 프로토콜을 통해 모든 AI 도구와 작동

---

## 문서

- [전체 문서](https://envcp.fentz.dev/docs)
- [빠른 시작 가이드](https://envcp.fentz.dev/docs/quick-start)
- [CLI 참조](https://envcp.fentz.dev/docs/cli-reference)

---

## 라이선스

[Source Available License v1.0](../../LICENSE)
