# 설치 가이드 — EnvCP

<p align="center">
<sup>
<a href="../../SETUP.md">English</a> |
<a href="SETUP.fr.md">Français</a> |
<a href="SETUP.es.md">Español</a> |
<a href="SETUP.zh.md">中文</a> |
<a href="SETUP.vi.md">Tiếng Việt</a> |
<a href="SETUP.ja.md">日本語</a>
</sup>
</p>

← [README](README.ko.md) · [검증](VERIFICATION.ko.md) · [보안 정책](../../SECURITY.md)

---

## 목차

- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [CLI 참조](#cli-참조)
- [서버 모드](#서버-모드)
- [통합 가이드](#통합-가이드)
- [AI 접근 제어](#ai-접근-제어)
- [설정 참조](#설정-참조)
- [모범 사례](#모범-사례)

---

## 설치

### npm (권장)

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Node.js 18+ 필요.

### 설치 없이 사용

```bash
npx @fentz26/envcp init
```

---

## 빠른 시작

```bash
# 1. 프로젝트에서 초기화
envcp init

# 2. 시크릿 추가
envcp add API_KEY --value "your-secret-key"
envcp add DATABASE_URL --value "postgres://..."

# 3. 서버 시작
envcp serve --mode auto --port 3456
```

---

## CLI 참조

### 변수 관리

```bash
envcp add <이름> [옵션]      # 변수 추가
envcp list [--show-values]   # 변수 목록
envcp get <이름>             # 변수 가져오기
envcp remove <이름>          # 변수 삭제
```

### 볼트 관리

```bash
envcp vault --global init|add|list|get|delete
envcp vault --project init|add|list|get|delete
envcp vault --name <이름> init|add|list|get|delete
envcp vault-switch <이름>
envcp vault-list
```

### 세션 관리

```bash
envcp unlock   # 비밀번호로 잠금 해제
envcp lock     # 즉시 잠금
envcp status   # 세션 상태 확인
```

### 동기화 및 내보내기

```bash
envcp sync
envcp export [--format env|json|yaml]
```

### 서버

```bash
envcp serve [옵션]
  --mode, -m      mcp, rest, openai, gemini, all, auto
  --port          HTTP 포트 (기본값: 3456)
  --host          HTTP 호스트 (기본값: 127.0.0.1)
  --api-key, -k   인증용 API 키
  --password, -p  암호화 비밀번호
```

---

## 서버 모드

| 모드 | 설명 | 사용 사례 |
|------|------|-----------|
| `auto` | 클라이언트 자동 감지 | 범용 (권장) |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | REST API (HTTP) | 모든 HTTP 클라이언트 |
| `openai` | OpenAI 형식 | ChatGPT, GPT-4 API |
| `gemini` | Google 형식 | Gemini, Google AI |
| `all` | 모든 HTTP 프로토콜 | 다중 클라이언트 |

---

## 통합 가이드

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

### REST API (범용)

```bash
envcp serve --mode rest --port 3456 --api-key your-secret-key
```

```bash
curl -H "X-API-Key: your-secret-key" http://localhost:3456/api/variables
```

---

## AI 접근 제어

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

## 설정 참조

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

## 모범 사례

1. `.envcp/`를 절대 커밋하지 마세요 — `.gitignore`에 추가
2. HTTP 모드에는 API 키 사용
3. `allow_ai_active_check` 비활성화
4. 민감한 변수에 블랙리스트 패턴 사용
5. `.envcp/logs/`에서 정기적으로 접근 로그 확인
