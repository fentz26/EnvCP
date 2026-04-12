# Vérification des versions — EnvCP

<p align="center">
<sup>
<a href="../../VERIFICATION.md">English</a> |
<a href="VERIFICATION.es.md">Español</a> |
<a href="VERIFICATION.ko.md">한국어</a> |
<a href="VERIFICATION.zh.md">中文</a> |
<a href="VERIFICATION.vi.md">Tiếng Việt</a> |
<a href="VERIFICATION.ja.md">日本語</a>
</sup>
</p>

← [README](README.fr.md) · [Guide d'installation](SETUP.fr.md) · [Politique de sécurité](../../SECURITY.md)

---

Chaque version d'EnvCP est accompagnée d'une **attestation de provenance SLSA Level 3 signée**. Cela signifie :

- Construit depuis la source officielle sur GitHub Actions
- Toutes les dépendances CI sont épinglées à des digests SHA immuables
- L'artefact n'a pas été modifié après la construction
- La signature de provenance est soutenue par **Sigstore** — vérifiable indépendamment

---

## Méthodes de vérification

### Option 1 — npm audit signatures (le plus simple)

```bash
# Dans un projet avec @fentz26/envcp installé :
npm install @fentz26/envcp
npm audit signatures
```

Résultat attendu :
```
audited 1 package in 1s
1 package has a verified registry signature
```

> Disponible à partir de **v1.2.0**.

---

### Option 2 — GitHub CLI

Nécessite : [GitHub CLI](https://cli.github.com/) (`gh`)

```bash
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

---

### Option 3 — slsa-verifier (hors ligne)

Nécessite : [slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

```bash
go install github.com/slsa-framework/slsa-verifier/v2/cli/slsa-verifier@latest

gh release download v<version> --repo fentz26/EnvCP \
  --pattern '*.tgz' \
  --pattern '*.intoto.jsonl'

slsa-verifier verify-artifact fentz26-envcp-<version>.tgz \
  --provenance-path fentz26-envcp-<version>.tgz.intoto.jsonl \
  --source-uri github.com/fentz26/EnvCP
```

---

## Dépannage

**`npm audit signatures` — "aucune dépendance à auditer"**
Assurez-vous d'exécuter la commande dans un répertoire de projet avec `@fentz26/envcp` dans `node_modules`.

**`gh attestation verify` — "aucune attestation trouvée"**
La version a été publiée avant v1.2.0. Utilisez l'option 3 avec le bundle `.intoto.jsonl`.

**`slsa-verifier` — "le hash de l'artefact ne correspond pas"**
Le fichier peut avoir été corrompu lors du transfert. Retéléchargez-le.
