# Guía de configuración — EnvCP

<p align="center">
<sup>
<a href="../../SETUP.md">English</a> |
<a href="SETUP.fr.md">Français</a> |
<a href="SETUP.ko.md">한국어</a> |
<a href="SETUP.zh.md">中文</a> |
<a href="SETUP.vi.md">Tiếng Việt</a> |
<a href="SETUP.ja.md">日本語</a>
</sup>
</p>

← [README](README.es.md) · [Verificación](VERIFICATION.es.md) · [Política de seguridad](../../SECURITY.md)

---

## Tabla de contenidos

- [Instalación](#instalación)
- [Inicio rápido](#inicio-rápido)
- [Referencia CLI](#referencia-cli)
- [Modos de servidor](#modos-de-servidor)
- [Guías de integración](#guías-de-integración)
- [Control de acceso IA](#control-de-acceso-ia)
- [Referencia de configuración](#referencia-de-configuración)
- [Mejores prácticas](#mejores-prácticas)

---

## Instalación

### npm (recomendado)

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Requiere Node.js 18+.

### Sin instalación

```bash
npx @fentz26/envcp init
```

---

## Inicio rápido

```bash
# 1. Inicializar en tu proyecto
envcp init

# 2. Agregar tus secretos
envcp add API_KEY --value "tu-clave-secreta"
envcp add DATABASE_URL --value "postgres://..."

# 3. Iniciar el servidor
envcp serve --mode auto --port 3456
```

---

## Referencia CLI

### Gestión de variables

```bash
envcp add <nombre> [opciones]  # Agregar variable
envcp list [--show-values]     # Listar variables
envcp get <nombre>             # Obtener variable
envcp remove <nombre>          # Eliminar variable
```

### Gestión de bóvedas

```bash
envcp vault --global init|add|list|get|delete
envcp vault --project init|add|list|get|delete
envcp vault --name <nombre> init|add|list|get|delete
envcp vault-switch <nombre>
envcp vault-list
```

### Gestión de sesión

```bash
envcp unlock   # Desbloquear con contraseña
envcp lock     # Bloquear inmediatamente
envcp status   # Verificar estado de sesión
```

### Sincronización y exportación

```bash
envcp sync
envcp export [--format env|json|yaml]
```

### Servidor

```bash
envcp serve [opciones]
  --mode, -m      mcp, rest, openai, gemini, all, auto
  --port          Puerto HTTP (defecto: 3456)
  --host          Host HTTP (defecto: 127.0.0.1)
  --api-key, -k   Clave API para autenticación
  --password, -p  Contraseña de cifrado
```

---

## Modos de servidor

| Modo | Descripción | Caso de uso |
|------|-------------|-------------|
| `auto` | Detección automática del cliente | Universal (recomendado) |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | API REST (HTTP) | Cualquier cliente HTTP |
| `openai` | Formato OpenAI | ChatGPT, GPT-4 API |
| `gemini` | Formato Google | Gemini, Google AI |
| `all` | Todos los protocolos HTTP | Múltiples clientes |

---

## Guías de integración

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

### API REST (Universal)

```bash
envcp serve --mode rest --port 3456 --api-key tu-clave-secreta
```

```bash
curl -H "X-API-Key: tu-clave-secreta" http://localhost:3456/api/variables
```

---

## Control de acceso IA

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

## Referencia de configuración

```yaml
version: "1.0"
project: mi-proyecto

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

## Mejores prácticas

1. Nunca confirmar `.envcp/` — Agregar a `.gitignore`
2. Usar claves API para modos HTTP
3. Deshabilitar `allow_ai_active_check`
4. Usar patrones de lista negra para variables sensibles
5. Revisar registros de acceso regularmente en `.envcp/logs/`
