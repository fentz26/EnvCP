# Release Verification — EnvCP

<p align="center">
<sup>
<a href="docs/i18n/VERIFICATION.fr.md">Français</a> |
<a href="docs/i18n/VERIFICATION.es.md">Español</a> |
<a href="docs/i18n/VERIFICATION.ko.md">한국어</a> |
<a href="docs/i18n/VERIFICATION.zh.md">中文</a> |
<a href="docs/i18n/VERIFICATION.vi.md">Tiếng Việt</a> |
<a href="docs/i18n/VERIFICATION.ja.md">日本語</a>
</sup>
</p>

← [README](README.md) · [Setup Guide](SETUP.md) · [Security Policy](SECURITY.md)

---

Every EnvCP release ships with a **signed SLSA Level 3 provenance attestation**. This means:

- Built from the official source on GitHub Actions, not a developer machine
- All build dependencies (CI actions) were pinned to immutable SHA digests
- The artifact was not modified after the build
- The provenance signature is backed by **Sigstore** — independently verifiable

---

## Verification Methods

### Option 1 — npm audit signatures (simplest)

No extra tooling required.

```bash
# In a project with @fentz26/envcp installed:
npm install @fentz26/envcp
npm audit signatures
```

Expected output:
```
audited 1 package in 1s
1 package has a verified registry signature
```

> **Note**: Available from **v1.2.0** onward — first release published with `--provenance`.

---

### Option 2 — GitHub CLI attestation verify

Requires: [GitHub CLI](https://cli.github.com/) (`gh`)

```bash
# Download the release tarball
gh release download v<version> --repo fentz26/EnvCP --pattern '*.tgz'

# Verify against GitHub's Sigstore-backed attestation store
gh attestation verify fentz26-envcp-<version>.tgz \
  --repo fentz26/EnvCP
```

Expected output:
```
Loaded digest sha256:... for file://fentz26-envcp-<version>.tgz
Loaded 1 attestation from GitHub API
✓ Verification succeeded!

The following policy criteria were met:
- SLSA Build Level: 3
- Source repository: https://github.com/fentz26/EnvCP
- Source ref: refs/tags/v<version>
- Runner environment: github-hosted
```

---

### Option 3 — slsa-verifier (offline, full inspection)

Requires: [slsa-verifier](https://github.com/slsa-framework/slsa-verifier/releases)

```bash
# Install slsa-verifier
go install github.com/slsa-framework/slsa-verifier/v2/cli/slsa-verifier@latest
# or download a binary from: https://github.com/slsa-framework/slsa-verifier/releases

# Download tarball + provenance bundle from the GitHub release
gh release download v<version> --repo fentz26/EnvCP \
  --pattern '*.tgz' \
  --pattern '*.intoto.jsonl'

# Verify
slsa-verifier verify-artifact fentz26-envcp-<version>.tgz \
  --provenance-path fentz26-envcp-<version>.tgz.intoto.jsonl \
  --source-uri github.com/fentz26/EnvCP
```

Expected output:
```
Verified signature against tlog entry index ... at URL: https://rekor.sigstore.dev/...
Verified build using builder "https://github.com/slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@..."
PASSED: SLSA verification passed
```

This method works fully offline once you have the tarball and provenance bundle downloaded.

---

## What the Provenance Covers

| Property | Value |
|---|---|
| Builder | `slsa-framework/slsa-github-generator` (SHA-pinned) |
| Build trigger | GitHub release event |
| Source repo | `https://github.com/fentz26/EnvCP` |
| Source ref | `refs/tags/v<version>` |
| Artifact | `fentz26-envcp-<version>.tgz` (sha256 hash recorded) |
| Transparency log | Sigstore Rekor — publicly auditable |

---

## CI Pipeline Integrity

The build pipeline itself is protected:

- `actions/checkout` — SHA-pinned (`de0fac2e...`)
- `actions/setup-node` — SHA-pinned (`53b83947...`)
- `slsa-framework/slsa-github-generator` — SHA-pinned (`5a775b36...`)
- All Docker and deploy actions in `publish.yml` — SHA-pinned
- `npm audit --audit-level=high` runs on every push across Node 18, 20, and 22
- Dependabot monitors npm and GitHub Actions dependencies weekly

---

## Verifying Docker Images

Docker images are published to:
- `docker.io/fentz26/envcp:<version>`
- `ghcr.io/fentz26/envcp:<version>`

```bash
# Verify GitHub Container Registry image
gh attestation verify oci://ghcr.io/fentz26/envcp:<version> \
  --repo fentz26/EnvCP
```

---

## Troubleshooting

**`npm audit signatures` — "found no dependencies to audit"**
Make sure you run it inside a project directory with `@fentz26/envcp` in `node_modules`, not globally.

**`gh attestation verify` — "no attestations found"**
The release was published before v1.2.0. Use Option 3 (slsa-verifier) with the `.intoto.jsonl` bundle from the GitHub release assets instead.

**`slsa-verifier` — "FAILED: artifact hash does not match"**
The file may have been corrupted in transit. Re-download and verify the sha256 manually:
```bash
sha256sum fentz26-envcp-<version>.tgz
# Compare against the hash recorded in the .intoto.jsonl file
```
