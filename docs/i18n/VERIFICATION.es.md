# Verificación de versiones — EnvCP

<p align="center">
<sup>
<a href="../../VERIFICATION.md">English</a> |
<a href="VERIFICATION.fr.md">Français</a> |
<a href="VERIFICATION.ko.md">한국어</a> |
<a href="VERIFICATION.zh.md">中文</a> |
<a href="VERIFICATION.vi.md">Tiếng Việt</a> |
<a href="VERIFICATION.ja.md">日本語</a>
</sup>
</p>

← [README](README.es.md) · [Guía de configuración](SETUP.es.md) · [Política de seguridad](../../SECURITY.md)

---

Cada versión de EnvCP incluye una **attestación de procedencia SLSA Nivel 3 firmada**. Esto significa:

- Construido desde la fuente oficial en GitHub Actions
- Todas las dependencias CI están fijadas a digests SHA inmutables
- El artefacto no fue modificado después de la construcción
- La firma de procedencia está respaldada por **Sigstore** — verificable independientemente

---

## Métodos de verificación

### Opción 1 — npm audit signatures (más simple)

```bash
# En un proyecto con @fentz26/envcp instalado:
npm install @fentz26/envcp
npm audit signatures
```

Resultado esperado:
```
audited 1 package in 1s
1 package has a verified registry signature
```

> Disponible desde **v1.2.0**.

---

### Opción 2 — GitHub CLI

Requiere: [GitHub CLI](https://cli.github.com/) (`gh`)

```bash
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

---

### Opción 3 — slsa-verifier (sin conexión)

Requiere: [slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

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

## Solución de problemas

**`npm audit signatures` — "no se encontraron dependencias para auditar"**
Asegúrese de ejecutarlo en un directorio de proyecto con `@fentz26/envcp` en `node_modules`.

**`gh attestation verify` — "no se encontraron attestaciones"**
La versión fue publicada antes de v1.2.0. Use la opción 3 con el bundle `.intoto.jsonl`.

**`slsa-verifier` — "el hash del artefacto no coincide"**
El archivo puede haberse corrompido durante la descarga. Vuelva a descargarlo.
