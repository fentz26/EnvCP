# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%" /></a>
</p>

<p align="center">
  <strong>Secretos seguros para agentes de IA — local, cifrado, solo por referencia.</strong>
</p>

<p align="center">
  Gestión segura de variables de entorno para el desarrollo asistido por IA.<br />
  Servidor MCP que permite a la IA referenciar tus secretos por nombre — nunca por valor.
</p>

---

[English](../../README.md) | [Français](README.fr.md) | **Español** | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## Qué hace

- Almacena secretos en tu máquina
- Permite que las herramientas de IA referencien secretos por nombre en lugar de valor
- Puede sincronizar valores en archivos `.env` cuando lo necesites
- Funciona con MCP, REST, compatible con OpenAI y compatible con Gemini

---

## Novedades en v1.2.0

- Configuración inicial más sencilla
- Menús interactivos para `config` y `rule`
- Reglas de IA por variable y por cliente
- Mejor configuración del servicio/inicio
- Limpieza general, refuerzo de seguridad y cobertura de tests

---

## Inicio rápido

Instalar e inicializar:

```bash
npm install -g @fentz26/envcp
envcp init   # elegir configuración Basic / Advanced / Manual
```

Agregar secretos:

```bash
envcp add API_KEY --from-env API_KEY
# o: printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

Iniciar el servidor MCP:

```bash
envcp serve
```

---

## Documentación

| Guía | Descripción |
|------|-------------|
| [Sitio de documentación](https://envcp.org/docs) | Documentación principal |
| [Guía de configuración](SETUP.es.md) | Instalación, configuración, integraciones |
| [Guía de seguridad](../../docs/SECURITY_GUIDE.md) | Configuración segura y respuesta a incidentes |
| [Verificación](VERIFICATION.es.md) | Verificación de procedencia SLSA 3 |
| [Política de seguridad](../../SECURITY.md) | Reporte de vulnerabilidades |

---

## Licencia

SAL v1.0 — Ver archivo [LICENSE](../../LICENSE).

## Soporte

- Email: contact@envcp.org
- Issues GitHub: https://github.com/fentz26/EnvCP/issues
- Documentación: https://envcp.org/docs
