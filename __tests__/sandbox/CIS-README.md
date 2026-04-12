# EnvCP Sandbox - CIS Docker Benchmark Hardening Guide

This document describes the security hardening applied to the EnvCP sandbox test runner, following CIS Docker Benchmark v1.6.0 recommendations.

## CIS Docker Benchmark Compliance

### Container Security (CIS 4.x)

| Control | CIS ID | Status | Implementation |
|---------|--------|--------|----------------|
| Use non-root user | 4.1 | ✅ | `USER envcp` (UID 1000) in Dockerfile |
| Remove setuid/setgid binaries | 4.6 | ✅ | `chmod a-s` in Dockerfile |
| Drop all capabilities | 4.3 | ✅ | `--cap-drop=ALL` in docker-compose/workflow |
| No privileged mode | 4.5 | ✅ | `privileged: false` |
| Resource limits | 4.7-4.10 | ✅ | Memory: 2GB, CPUs: 2.0, PIDs: 256 |
| Read-only filesystem | 4.12 | ⚠️ | Not enforced (Node.js needs /tmp) |
| Use tmpfs for sensitive data | 5.7 | ✅ | `/tmp/envcp-sandbox` mounted as tmpfs |

### Network Security (CIS 5.x)

| Control | CIS ID | Status | Implementation |
|---------|--------|--------|----------------|
| Network segmentation | 5.1 | ✅ | Separate sandbox-net network |
| Disable inter-container communication | 5.5 | ✅ | `ipc: none` |

### Security Options

```yaml
security_opt:
  - no-new-privileges:true  # Prevent privilege escalation
  - apparmor:docker-default # Use AppArmor profile
```

## Implementation Details

### 1. Non-Root User (CIS 4.1)

```dockerfile
RUN groupadd --gid 1000 envcp && \
    useradd --uid 1000 --gid envcp --shell /bin/bash --create-home envcp
USER envcp
```

**Why**: Running as non-root prevents container breakouts from gaining root on the host.

### 2. Capability Dropping (CIS 4.3)

```yaml
cap_drop:
  - ALL
```

**Why**: Removes all Linux capabilities, only keeping what's strictly needed.

### 3. Resource Limits (CIS 4.7-4.10)

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 2048M
```

**Why**: Prevents DoS via resource exhaustion.

### 4. tmpfs Mounts (CIS 5.7)

```yaml
tmpfs:
  - /tmp/envcp-sandbox:noexec,nosuid,nodev,size=100m,mode=700
```

**Why**: 
- `noexec`: Prevents binary execution
- `nosuid`: Ignores setuid/setgid bits
- `nodev`: No device files
- `size=100m`: Limits size to prevent disk exhaustion
- `mode=700`: Only owner can access

### 5. No New Privileges (CIS 4.4)

```yaml
security_opt:
  - no-new-privileges:true
```

**Why**: Prevents processes from gaining additional privileges via setuid binaries or capability-granting binaries.

## Verification

### Check Container Security

```bash
# Run container and inspect security
docker run --rm envcp-sandbox:latest cat /proc/1/status | grep -E "Uid|Gid|CapEff"

# Should show:
# Uid:    1000    1000    1000    1000
# Gid:    1000    1000    1000    1000
# CapEff: 0000000000000000 (no capabilities)
```

### Check for Setuid Binaries

```bash
docker run --rm envcp-sandbox:latest find / -perm /6000 -type f
# Should return nothing
```

### Check User

```bash
docker run --rm envcp-sandbox:latest whoami
# Should output: envcp
```

### Check Resource Limits

```bash
docker inspect envcp-sandbox | jq '.[0].HostConfig | {Memory: .Memory, CpuQuota: .CpuQuota, PidsLimit: .PidsLimit}'
```

## References

- [CIS Docker Benchmark v1.6.0](https://www.cisecurity.org/benchmark/docker)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [OWASP Docker Security](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

## Limitations

1. **Root filesystem**: Not fully read-only due to Node.js requirements
2. **Network**: Uses `host` network mode for API connectivity (could be more restrictive)
3. **Seccomp**: Using default Docker profile (could be custom)

## Future Improvements

- [ ] Custom Seccomp profile to limit syscalls
- [ ] Read-only rootfs with volumes for Node.js cache
- [ ] User namespace mapping for additional isolation
- [ ] Custom network with DNS restrictions
