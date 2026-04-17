---
name: Bug Report
about: Something isn't working as expected
title: "fix: "
labels: bug
assignees: fentz26
---

## Priority

<!-- Delete all that do not apply -->

- [ ] `priority:critical` — Security, data loss, production down
- [ ] `priority:high` — Major functionality broken
- [ ] `priority:medium` — Standard bug
- [ ] `priority:low` — Minor issue, workaround exists

## Description

A clear and concise description of the bug.

## Steps to Reproduce

1. Run `envcp ...`
2. See error

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include any error messages or stack traces.

```
paste error output here
```

## Environment

| Field | Value |
|-------|-------|
| EnvCP version | <!-- run `envcp --version` --> |
| Node.js version | <!-- run `node --version` --> |
| OS | <!-- e.g. Ubuntu 24.04, macOS 15, Windows 11 --> |
| Install method | <!-- npm global / npx / pip --> |
| Server mode | <!-- mcp / rest / openai / gemini / cli only --> |

## Configuration

<!-- Share your envcp.yaml (redact any sensitive values) -->

```yaml
# paste relevant envcp.yaml sections here
```

## Logs

<!-- Check .envcp/logs/ for relevant entries -->

```
paste relevant log lines here
```

## Additional Context

Any other context about the problem (screenshots, related issues, etc.).
