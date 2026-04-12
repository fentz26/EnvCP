# Guide d'installation — EnvCP

<p align="center">
<sup>
<a href="../../SETUP.md">English</a> |
<a href="SETUP.es.md">Español</a> |
<a href="SETUP.ko.md">한국어</a> |
<a href="SETUP.zh.md">中文</a> |
<a href="SETUP.vi.md">Tiếng Việt</a> |
<a href="SETUP.ja.md">日本語</a>
</sup>
</p>

← [README](README.fr.md) · [Vérification](VERIFICATION.fr.md) · [Politique de sécurité](../../SECURITY.md)

---

## Table des matières

- [Installation](#installation)
- [Démarrage rapide](#démarrage-rapide)
- [Référence CLI](#référence-cli)
- [Modes serveur](#modes-serveur)
- [Guides d'intégration](#guides-dintégration)
- [Gestion des coffres](#gestion-des-coffres)
- [Protection par mot de passe par variable](#protection-par-mot-de-passe-par-variable)
- [Contrôle d'accès IA](#contrôle-daccès-ia)
- [Référence de configuration](#référence-de-configuration)
- [Bonnes pratiques](#bonnes-pratiques)

---

## Installation

### npm (recommandé)

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Nécessite Node.js 18+.

### Sans installation

```bash
npx @fentz26/envcp init
```

---

## Démarrage rapide

```bash
# 1. Initialiser dans votre projet
envcp init

# 2. Ajouter vos secrets
envcp add API_KEY --value "votre-clé-secrète"
envcp add DATABASE_URL --value "postgres://..."

# 3. Démarrer le serveur
envcp serve --mode auto --port 3456
```

---

## Référence CLI

### Gestion des variables

```bash
envcp add <nom> [options]    # Ajouter une variable
envcp list [--show-values]   # Lister les variables
envcp get <nom>              # Obtenir une variable
envcp remove <nom>           # Supprimer une variable
```

### Gestion des coffres

```bash
envcp vault --global init|add|list|get|delete
envcp vault --project init|add|list|get|delete
envcp vault --name <nom> init|add|list|get|delete
envcp vault-switch <nom>
envcp vault-list
```

### Gestion de session

```bash
envcp unlock   # Déverrouiller avec mot de passe
envcp lock     # Verrouiller immédiatement
envcp status   # Vérifier l'état de la session
```

### Synchronisation et export

```bash
envcp sync
envcp export [--format env|json|yaml]
```

### Serveur

```bash
envcp serve [options]
  --mode, -m      mcp, rest, openai, gemini, all, auto
  --port          Port HTTP (défaut : 3456)
  --host          Hôte HTTP (défaut : 127.0.0.1)
  --api-key, -k   Clé API pour l'authentification
  --password, -p  Mot de passe de chiffrement
```

---

## Modes serveur

| Mode | Description | Cas d'utilisation |
|------|-------------|-------------------|
| `auto` | Détection automatique du client | Universel (recommandé) |
| `mcp` | Model Context Protocol (stdio) | Claude Desktop, Cursor, Cline |
| `rest` | API REST (HTTP) | Tout client HTTP |
| `openai` | Format OpenAI | ChatGPT, GPT-4 API |
| `gemini` | Format Google | Gemini, Google AI |
| `all` | Tous les protocoles HTTP | Clients multiples |

---

## Guides d'intégration

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

### API REST (Universel)

```bash
envcp serve --mode rest --port 3456 --api-key votre-clé-secrète
```

```bash
curl -H "X-API-Key: votre-clé-secrète" http://localhost:3456/api/variables
```

---

## Contrôle d'accès IA

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

## Référence de configuration

```yaml
version: "1.0"
project: mon-projet

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

## Bonnes pratiques

1. Ne jamais committer `.envcp/` — Ajouter au `.gitignore`
2. Utiliser des clés API pour les modes HTTP
3. Désactiver `allow_ai_active_check`
4. Utiliser des patterns de liste noire pour les variables sensibles
5. Vérifier régulièrement les journaux d'accès dans `.envcp/logs/`
