# EnvCP

<p align="center">
  <a href="https://envcp.org/docs"><img src="../../assets/logo-ascii.png" alt="EnvCP" width="100%"></a>
</p>

<p align="center">
  <strong>为 AI 代理提供安全密钥管理 — 本地、加密、仅引用。</strong>
</p>

<p align="center">
  面向 AI 辅助编程的安全环境变量管理。<br>
  MCP 服务器，让 AI 通过名称引用您的密钥 — 而非实际值。
</p>

---

[English](../../README.md) | [Français](README.fr.md) | [Español](README.es.md) | [한국어](README.ko.md) | **中文** | [Tiếng Việt](README.vi.md) | [日本語](README.ja.md)

---

## 功能

- 将密钥存储在本地机器上
- 让 AI 工具通过名称而非实际值来引用密钥
- 可在需要时将值同步到 `.env` 文件
- 支持 MCP、REST、OpenAI 兼容和 Gemini 兼容客户端

---

## v1.2.0 新特性

- 更简便的首次运行设置
- `config` 和 `rule` 的交互式菜单
- 按变量和按客户端的 AI 规则
- 改进的服务/启动设置
- 全面的清理、安全加固和测试覆盖

---

## 快速开始

安装和初始化：

```bash
npm install -g @fentz26/envcp
envcp init   # 选择 Basic / Advanced / Manual 设置
```

添加密钥：

```bash
envcp add API_KEY --from-env API_KEY
# 或：printf '%s' "$API_KEY" | envcp add API_KEY --stdin
```

启动 MCP 服务器：

```bash
envcp serve
```

---

## 文档

| 指南 | 描述 |
|------|------|
| [文档网站](https://envcp.org/docs) | 主要文档 |
| [安装指南](SETUP.zh.md) | 安装、配置、集成 |
| [安全指南](../../docs/SECURITY_GUIDE.md) | 安全部署和事件响应 |
| [验证](VERIFICATION.zh.md) | SLSA 3 溯源验证 |
| [安全政策](../../SECURITY.md) | 漏洞报告 |

---

## 许可证

SAL v1.0 — 请参阅 [LICENSE](../../LICENSE) 文件。

## 支持

- 邮箱：contact@envcp.org
- GitHub Issues：https://github.com/fentz26/EnvCP/issues
- 文档：https://envcp.org/docs
