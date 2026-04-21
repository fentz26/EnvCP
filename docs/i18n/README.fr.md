# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%" /></a>
</p>

<p align="center">
  <strong>Secrets sécurisés pour les agents IA — local, chiffré, par référence uniquement.</strong>
</p>

<p align="center">
  Gestion sécurisée des variables d'environnement pour le développement assisté par IA.<br />
  Serveur MCP qui permet à l'IA de référencer vos secrets par nom — jamais par valeur.
</p>

---

[English](../../README.md) | **Français** | [Español](README.es.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## Ce que ça fait

- Stocke les secrets sur votre machine
- Permet aux outils IA de référencer les secrets par nom plutôt que par valeur
- Peut synchroniser les valeurs dans des fichiers `.env` si besoin
- Fonctionne avec MCP, REST, OpenAI-compatible et Gemini-compatible

---

## Nouveautés en v1.2.0

- Configuration initiale simplifiée
- Menus interactifs `config` et `rule`
- Règles IA par variable et par client
- Meilleure configuration du service/démarrage
- Nettoyage général, renforcement de sécurité et couverture de tests

---

## Démarrage rapide

Installer et initialiser :

```bash
npm install -g @fentz26/envcp
envcp init   # choisir la configuration Basic / Advanced / Manual
```

Ajouter des secrets :

```bash
envcp add API_KEY --from-env API_KEY
# ou : printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

Démarrer le serveur MCP :

```bash
envcp serve
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Site de documentation](https://envcp.org/docs) | Documentation principale |
| [Guide d'installation](SETUP.fr.md) | Installation, configuration, intégrations |
| [Guide de sécurité](../../docs/SECURITY_GUIDE.md) | Configuration sécurisée et réponse aux incidents |
| [Vérification](VERIFICATION.fr.md) | Vérification de la provenance SLSA 3 |
| [Politique de sécurité](../../SECURITY.md) | Signalement de vulnérabilités |

---

## Licence

SAL v1.0 — Voir le fichier [LICENSE](../../LICENSE).

## Support

- Email : contact@envcp.org
- Issues GitHub : https://github.com/fentz26/EnvCP/issues
- Documentation : https://envcp.org/docs
