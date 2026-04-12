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

[English](../../README.md) | **Français** | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## Pourquoi EnvCP ?

- **Stockage local uniquement** — Vos secrets ne quittent jamais votre machine
- **Chiffré au repos** — AES-256-GCM avec dérivation de clé Argon2id
- **Accès par référence** — L'IA référence les variables par leur nom, sans jamais voir les valeurs
- **Injection automatique .env** — Les valeurs peuvent être injectées dans vos fichiers .env
- **Contrôle d'accès IA** — Empêchez l'IA de lister ou vérifier vos secrets
- **Compatibilité universelle** — MCP, OpenAI, Gemini ou REST

---

## Démarrage rapide

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "votre-clé-secrète"
envcp serve --mode auto --port 3456
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Guide d'installation](SETUP.fr.md) | Installation, CLI, intégrations, configuration |
| [Vérification](VERIFICATION.fr.md) | Vérification de la provenance SLSA 3 |
| [Politique de sécurité](../../SECURITY.md) | Signalement de vulnérabilités, chiffrement |

---

## Sécurité et chaîne d'approvisionnement

- **SLSA Level 3** — Provenance de build pour l'intégrité de la chaîne d'approvisionnement ([vérifier →](VERIFICATION.fr.md))
- **Chiffré au repos** — AES-256-GCM avec Argon2id
- **Local uniquement** — Vos secrets ne quittent jamais votre machine
- **CI SHA-épinglé** — Toutes les actions GitHub épinglées à des commits immuables

---

## Licence

SAL v1.0 — Voir le fichier [LICENSE](../../LICENSE).

## Support

- Email : contact@envcp.org
- Issues GitHub : https://github.com/fentz26/EnvCP/issues
- Documentation : https://envcp.org/docs
