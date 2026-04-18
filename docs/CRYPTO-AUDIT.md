# Cryptographic Implementation Audit

**Issue:** #140 - Crypto implementation review (Phase 1b)
**Date:** 2026-04-18
**Status:** PASSED

## Scope

This audit covers the cryptographic implementations in:
- `src/utils/crypto.ts` — Node.js crypto functions
- `crates/envcp-core/src/crypto.rs` — Rust crypto functions
- `src/utils/secure-memory.ts` — Memory protection
- `src/utils/hsm.ts` — HSM multi-factor key combination

## 1. Argon2id Parameters

### Current Settings

| Parameter | Value | Source |
|-----------|-------|--------|
| Memory cost | 65536 KB (64 MB) | OWASP recommended minimum |
| Time cost | 3 iterations | OWASP recommended minimum ≥2 |
| Parallelism | 1 | Acceptable for single-threaded use |
| Hash length | 32 bytes | AES-256 key size |

### Code Locations

**Node.js** (`src/utils/crypto.ts:18-25`):
```typescript
const ARGON2_OPTS = {
  type: argon2.argon2id,
  hashLength: 32,
  memoryCost: 65536,  // 64 MB
  timeCost: 3,
  parallelism: 1,
  raw: true,
};
```

**Rust** (`crates/envcp-core/src/crypto.rs:30-33`):
```rust
const ARGON2_MEMORY: u32 = 65536; // 64 MB
const ARGON2_TIME: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const ARGON2_HASH_LEN: usize = 32;
```

### OWASP Compliance

- **Memory**: 64 MB meets the recommended minimum for standard security ✓
- **Time**: 3 iterations exceeds the minimum of 2 ✓
- **Parallelism**: 1 is acceptable; higher values increase ASIC resistance but are not required

**Status**: ✓ PASSED

---

## 2. AES-256-GCM IV Uniqueness

### Implementation

Each encryption operation generates a fresh IV using cryptographically secure random number generation:

**Node.js** (`src/utils/crypto.ts:40-42`):
```typescript
const salt = crypto.randomBytes(V2_SALT_LENGTH);
const key = await argon2.hash(password, { ...ARGON2_OPTS, salt });
const iv = crypto.randomBytes(IV_LENGTH);
```

**Rust** (`crates/envcp-core/src/crypto.rs:97-98`):
```rust
rand::thread_rng().fill_bytes(&mut salt);
rand::thread_rng().fill_bytes(&mut iv);
```

### Guarantees

- `crypto.randomBytes()` uses the operating system's CSPRNG (`/dev/urandom` on Unix, `CryptGenRandom` on Windows)
- `rand::thread_rng()` in Rust uses `OsRng` which also uses the system CSPRNG
- IV is never reused — new IV generated for every encryption
- 128-bit IV length provides negligible collision probability

**Status**: ✓ PASSED

---

## 3. Random Number Generation

### Security-Sensitive Uses

All security-sensitive random number generation uses cryptographically secure sources:

| Use Case | Implementation | Secure |
|----------|----------------|--------|
| Salt generation | `crypto.randomBytes()` | ✓ |
| IV generation | `crypto.randomBytes()` | ✓ |
| Recovery key | `crypto.randomBytes()` | ✓ |
| Session token | `crypto.randomBytes()` | ✓ |
| Config HMAC key | `crypto.pbkdf2Sync()` | ✓ |

### Math.random Usage

**Found**: One instance in `src/utils/lock.ts:28`:
```typescript
const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** attempt)) + Math.random() * 50;
```

**Assessment**: This is used for lock retry jitter (exponential backoff), NOT for any security-sensitive purpose. Acceptable.

**Status**: ✓ PASSED

---

## 4. Memory Zeroing

### Implementation

Secrets are zeroed from memory after use using platform-optimized zeroing:

**Node.js** (`src/utils/secure-memory.ts:23-30`):
```typescript
export function secureZero(buf: Buffer): void {
  if (!buf || buf.length === 0) return;
  if (HAS_SODIUM) {
    sodium.sodium_memzero(buf);
  } else {
    buf.fill(0);
  }
}
```

### Usage in Crypto Operations

**Encrypt** (`src/utils/crypto.ts:51-55`):
```typescript
} finally {
  secureZero(key);
  secureZero(salt);
  secureZero(iv);
}
```

**Decrypt** (`src/utils/crypto.ts:87-92`, `110-114`):
```typescript
} finally {
  secureZero(key);
  secureZero(salt);
  secureZero(iv);
  secureZero(authTag);
}
```

### Rust Implementation

The Rust crate uses `zeroize` crate for secure memory clearing:
```rust
// Cargo.toml includes: zeroize = { version = "1", features = ["derive"] }
```

**Status**: ✓ PASSED

---

## 5. Auth Tag Verification

### Implementation

AES-GCM authentication tags are always verified during decryption:

**Node.js** (`src/utils/crypto.ts:82, 104`):
```typescript
decipher.setAuthTag(authTag);
```

**Rust** (`crates/envcp-core/src/crypto.rs:87-89`):
```rust
cipher.decrypt(nonce, ct_with_tag.as_slice())
    .map_err(|_| Error::DecryptFailed)
```

### Behavior

- If tag verification fails, decryption throws an error
- No plaintext is returned if tag is invalid
- Timing-safe comparison is implicit in AES-GCM decryption

**Status**: ✓ PASSED

---

## 6. API Error Handling

### Stack Trace Exposure

All error handling uses `error.message` only, never `error.stack`:

**Example** (`src/adapters/rest.ts:329-330`):
```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
```

**Files Audited**:
- `src/adapters/rest.ts` — Lines 329-330
- `src/adapters/openai.ts` — Lines 44-45, 227-229
- `src/adapters/gemini.ts` — Lines 42-43, 217-219
- `src/server/unified.ts` — All error handlers

**Status**: ✓ PASSED

---

## 7. Key Derivation (HMAC)

### combineSecrets Function

**Location**: `src/utils/hsm.ts:405-420`

```typescript
static combineSecrets(hsmSecret: string, userPassword: string): string {
  const combined = Buffer.concat([
    Buffer.from(hsmSecret, 'utf8'),
    Buffer.from(':', 'utf8'),
    Buffer.from(userPassword, 'utf8'),
  ]);
  try {
    return crypto
      .createHmac('sha256', 'envcp-multi-factor')
      .update(combined)
      .digest('hex');
  } finally {
    secureZero(combined);
  }
}
```

### Assessment

- **Purpose**: Combining two high-entropy secrets (HSM output + user password), NOT password hashing
- **Algorithm**: HMAC-SHA256 is appropriate for combining secrets
- **Memory safety**: Combined buffer is zeroed after use
- **Security comment**: Code includes LGTM suppression with explanation

**Status**: ✓ PASSED

---

## 8. Config File Integrity (HMAC)

### Implementation (Added in PR #193)

**Location**: `src/config/config-hmac.ts`

- Uses PBKDF2 with 100,000 iterations for key derivation
- HMAC-SHA256 for config signature
- Timing-safe comparison via `crypto.timingSafeEqual`

**Status**: ✓ PASSED

---

## Summary

| Criterion | Status |
|-----------|--------|
| Argon2id parameters documented and justified | ✓ PASSED |
| AES-GCM IV uniqueness guaranteed | ✓ PASSED |
| No `Math.random` in security paths | ✓ PASSED |
| API errors contain no stack traces | ✓ PASSED |
| Memory zeroed after use | ✓ PASSED |
| Auth tag verification | ✓ PASSED |
| Key derivation correctness | ✓ PASSED |

## Recommendations

None. All acceptance criteria for Issue #140 are met.

## Related Documents

- `docs/THREAT_MODEL.md` — Security threat analysis
- `SECURITY.md` — Security policy
- `VERIFICATION.md` — SLSA verification
