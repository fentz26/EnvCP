# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>Gestión segura de variables de entorno para agentes de IA</strong>
</p>

<p align="center">
  EnvCP te permite usar agentes de IA de forma segura sin exponer tus secretos.<br>
  Tus claves API y variables de entorno permanecen cifradas en tu máquina — la IA solo las referencia por nombre.
</p>

---

[English](../../README.md) | [Français](README.fr.md) | **Español** | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## ¿Por qué EnvCP?

- **Almacenamiento local únicamente** — Tus secretos nunca salen de tu máquina
- **Cifrado en reposo** — AES-256-GCM con derivación de clave Argon2id
- **Acceso por referencia** — La IA referencia variables por nombre, sin ver los valores reales
- **Inyección automática .env** — Los valores se pueden inyectar en tus archivos .env
- **Control de acceso IA** — Bloquea que la IA liste o verifique tus secretos
- **Compatibilidad universal** — MCP, OpenAI, Gemini o REST

---

## Inicio rápido

```bash
npm install -g @fentz26/envcp
envcp init
envcp add API_KEY --value "tu-clave-secreta"
envcp serve --mode auto --port 3456
```

---

## Documentación

| Guía | Descripción |
|------|-------------|
| [Guía de configuración](SETUP.es.md) | Instalación, CLI, integraciones, configuración |
| [Verificación](VERIFICATION.es.md) | Verificación de procedencia SLSA 3 |
| [Política de seguridad](../../SECURITY.md) | Reporte de vulnerabilidades, cifrado |

---

## Seguridad y cadena de suministro

- **SLSA Level 3** — Procedencia de build para integridad de la cadena de suministro ([verificar →](VERIFICATION.es.md))
- **Cifrado en reposo** — AES-256-GCM con Argon2id
- **Local únicamente** — Tus secretos nunca salen de tu máquina
- **CI SHA-fijado** — Todas las GitHub Actions fijadas a commits inmutables

---

## Licencia

SAL v1.0 — Ver archivo [LICENSE](../../LICENSE).

## Soporte

- Email: contact@envcp.org
- Issues GitHub: https://github.com/fentz26/EnvCP/issues
- Documentación: https://envcp.org/docs
