# EnvCP

<p align="center">
  <a href="https://envcp.fentz.dev/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>Gestión segura de variables de entorno para agentes de IA</strong>
</p>

<p align="center">
  EnvCP te permite usar agentes de IA de forma segura sin exponer tus secretos.<br>
  Tus claves API y variables de entorno permanecen cifradas en tu máquina — la IA solo las referencia por su nombre.
</p>

---

## 🌍 Idiomas

[English](../../README.md) | [Français](README.fr.md) | **Español** | [한국어](README.ko.md) | [中文](README.zh.md) | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## Instalación

### npm

```bash
npm install -g @fentz26/envcp
```

### pip (Python)

```bash
pip install envcp
```

> Requiere Node.js 18+ instalado.


```bash

### Usar sin instalación

```bash
npx @fentz26/envcp init
```

---

## Inicio rápido

```bash
# 1. Inicializar en tu proyecto
envcp init

# 2. Agregar tus secretos
envcp add API_KEY --value "tu-clave-secreta"
envcp add DATABASE_URL --value "postgres://..."

# 3. Iniciar el servidor (detección automática del cliente)
envcp serve --mode auto --port 3456
```

---

## Comandos CLI básicos

```bash
# Gestión de variables
envcp add <nombre> [opciones]  # Agregar una variable
envcp list [--show-values]     # Listar variables
envcp get <nombre>             # Obtener una variable
envcp remove <nombre>          # Eliminar una variable

# Gestión de sesiones
envcp unlock                   # Desbloquear con contraseña
envcp lock                     # Bloquear inmediatamente
envcp status                   # Verificar estado de la sesión

# Sincronización y exportación
envcp sync                     # Sincronizar a archivo .env
envcp export [--format env|json|yaml]
```

---

## ¿Por qué EnvCP?

- **Solo almacenamiento local** — Tus secretos nunca salen de tu máquina
- **Cifrado en reposo** — AES-256-GCM con derivación de clave Argon2id (64 MB memoria, 3 pasadas)
- **Acceso por referencia** — La IA referencia variables por nombre, nunca ve los valores reales
- **Inyección automática .env** — Los valores pueden inyectarse automáticamente en tus archivos .env
- **Control de acceso IA** — Evitar que la IA liste o verifique proactivamente tus secretos
- **Compatibilidad universal** — Funciona con cualquier herramienta de IA vía MCP, OpenAI, Gemini o protocolos REST

---

## Documentación

- [Documentación completa](https://envcp.fentz.dev/docs)
- [Guía de inicio rápido](https://envcp.fentz.dev/docs/quick-start)
- [Referencia CLI](https://envcp.fentz.dev/docs/cli-reference)

---

## Licencia

[Source Available License v1.0](../../LICENSE)
