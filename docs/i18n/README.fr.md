# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>Gestion sécurisée des variables d'environnement pour les agents IA</strong>
</p>

<p align="center">
  EnvCP vous permet d'utiliser des agents IA en toute sécurité sans exposer vos secrets.<br>
  Vos clés API et variables d'environnement restent chiffrées sur votre machine — l'IA ne les référence que par leur nom.
</p>

---

## 🌍 Langues

[English](../../README.md) | **Français** | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## Installation

### npm

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Nécessite Node.js 18+ installé.


```bash

### Utiliser sans installation

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

# 3. Démarrer le serveur (détection automatique du client)
envcp serve --mode auto --port 3456
```

---

## Commandes CLI de base

```bash
# Gestion des variables
envcp add <nom> [options]     # Ajouter une variable
envcp list [--show-values]    # Lister les variables
envcp get <nom>               # Obtenir une variable
envcp remove <nom>            # Supprimer une variable

# Gestion des sessions
envcp unlock                  # Déverrouiller avec mot de passe
envcp lock                    # Verrouiller immédiatement
envcp status                  # Vérifier le statut de la session

# Synchronisation et export
envcp sync                    # Synchroniser vers fichier .env
envcp export [--format env|json|yaml]
```

---

## Pourquoi EnvCP ?

- **Stockage local uniquement** — Vos secrets ne quittent jamais votre machine
- **Chiffré au repos** — AES-256-GCM avec dérivation de clé Argon2id (64 MB mémoire, 3 passes)
- **Accès par référence** — L'IA référence les variables par nom, ne voit jamais les valeurs réelles
- **Injection automatique .env** — Les valeurs peuvent être automatiquement injectées dans vos fichiers .env
- **Contrôle d'accès IA** — Empêcher l'IA de lister ou vérifier proactivement vos secrets
- **Compatibilité universelle** — Fonctionne avec tout outil IA via MCP, OpenAI, Gemini ou protocoles REST

---

## Documentation

- [Documentation complète](https://envcp.org/docs)
- [Guide de démarrage rapide](https://envcp.org/docs/quick-start)
- [Référence CLI](https://envcp.org/docs/cli-reference)

---

## Licence

[Source Available License v1.0](../../LICENSE)
