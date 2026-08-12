# Obsidian Vault Schema Refactor

[English](./README.md) | 简体中文

本地、安全地重构 Obsidian Vault 的属性 schema，并同步修复引用这些属性的 Bases 配置。

## 开发状态

`0.1.0` MVP 已实现工程、Inventory、Reference Index、Doctor、Change Plan、Diff、Desktop 事务写入/回滚/恢复、历史与安全 Undo。公开发布仍需完成真实 Obsidian E2E 和实施计划 M6 的 20 个授权 Vault 验证；详见 [验证报告](./docs/validation-report.md)。

开发命令：

```bash
npm install
npm run check
npm run build
npm run install:dev -- /absolute/path/to/test-vault
```

构建产物为 `main.js`，与 `manifest.json`、`styles.css` 一起放入 Vault 的 `.obsidian/plugins/schema-refactor/`。最低目标版本为 Obsidian 1.9.0。

## 使用

1. 从左侧 ribbon 或命令面板打开 `Schema Refactor`。
2. 在 `Doctor` 运行只读检查，查看失效属性/公式引用、大小写漂移、类型漂移和无法解析的 Base。
3. 在 `Refactor` 输入旧属性和新属性，扫描整个 Vault。
4. 逐文件检查结构路径和 Diff；解决冲突或排除文件。
5. Desktop 上确认后应用。插件会先创建全量快照，再逐文件写入、读回和验证。
6. 从 History 创建 Undo Plan。Undo 也必须经过 Review 和 Confirm；事务后被编辑的文件会标为 diverged，不会被覆盖。

Mobile 首发只提供 Doctor、Scan 和 Review，不提供 Apply、Rollback 或 Undo 写入入口。

## 恢复与隐私

快照和 journal 存放在 `.obsidian/plugins/schema-refactor/snapshots/`，默认保留最近 20 个可清理事务。`ROLLBACK_INCOMPLETE` 快照不会自动删除。遇到该状态时先停止外部同步，保留快照，并对照 History 中列出的文件人工核查。

插件核心不联网、不包含遥测 SDK，不记录或导出 Frontmatter 值及正文。Doctor 报告只包含 Vault 相对路径、规则、结构位置和必要的属性标识符。

## 当前决策

**Go，先实现窄 MVP。**

首版只解决一个完整问题：

> 将一个 Frontmatter 属性从旧名称重命名为新名称，同时更新全部 Markdown Frontmatter 和 `.base` 中可确定识别的引用；写入前展示完整计划和 Diff，写入失败时回滚，并支持事后撤销。

`Bases Doctor` 是同一插件的只读审计模式，不是第二个插件。自然语言生成 Base 不进入 MVP。

首发支持边界：Desktop 提供完整扫描、预览、写入、回滚和撤销；Mobile 提供 Doctor、扫描和预览，属性写入默认关闭，只有移动端事务与崩溃恢复测试全部通过后才开放。

## 产品约束

- 完全本地运行，不需要服务器、数据库、账号、API Key 或付费服务。
- 核心功能不依赖 AI、Ollama 或 Hugging Face 模型。
- 不静默修改 Vault；任何重构都必须经过扫描、计划、预览和确认。
- 只自动修改高置信、结构化引用；不确定引用只报告，不猜测替换。
- 每次写入都有快照、校验、回滚和可审计记录。
- 插件本身即可完成核心功能；除 Obsidian 外不要求用户安装 Git、Ollama、Docker 或任何外部服务。

## 文档导航

- [产品规格](./docs/product-spec.md)：为什么做、为谁做、做什么、完整交互与产品规则。
- [技术设计](./docs/technical-design.md)：如何扫描、识别引用、生成计划、事务写入和撤销。
- [竞品审计](./docs/competitive-audit.md)：直接竞品、相邻能力和产品差异。
- [实施计划](./docs/implementation-plan.md)：开发阶段、交付物、依赖关系和完成定义。
- [测试计划](./docs/test-plan.md)：测试矩阵、故障注入、性能基线和发布门槛。
- [需求调研附件](./docs/bases-opportunity-research.md)：论坛、Hugging Face 和早期方向筛选记录。

## MVP 成功定义

只有同时满足以下条件，MVP 才算完成：

1. 能准确扫描 Vault 中的属性定义和 `.base` 引用。
2. 能安全处理属性不存在、目标属性已存在、文件并发变化和部分写入失败。
3. 用户确认前不会修改任何源文件。
4. 用户能逐文件查看修改内容并排除文件。
5. 写入后重新扫描，不再存在本次应修复的旧引用。
6. 整次撤销能恢复修改前字节内容；若文件后来被编辑，则停止覆盖并提示冲突。
7. 不依赖未公开 Obsidian API 完成核心流程。
