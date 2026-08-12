# Obsidian Vault Schema Refactor

[English](./README.md) | 简体中文

安全地重命名 Obsidian Vault 中的属性，并同步更新 Bases 引用。

## 为什么要做这个项目

Obsidian 属性以 Frontmatter 键的形式存储在 Markdown 文件中，Bases 还会在过滤器、公式、汇总、排序、分组和列配置中引用这些属性。

重命名属性通常需要手动修改大量文件。遗漏任何一处引用，都可能导致 Base 数据不完整，甚至在没有明显报错的情况下产生错误结果。直接进行全文替换也不安全，因为相同文本可能出现在笔记正文、其他命名空间、字符串字面量或插件无法理解的配置结构中。

Schema Refactor 提供一个覆盖整个 Vault、写入前可完整审查、不会猜测替换的统一流程。

## 能解决什么问题

- 重命名所有 Markdown 文件中的顶层 Frontmatter 属性。
- 更新 Obsidian Bases 已支持结构中的确定属性引用。
- 写入前展示每个受影响文件、结构位置和 Diff。
- 只报告不确定引用供人工检查，不自动修改。
- 通过逐文件决策或排除文件明确处理新旧属性冲突。
- 创建本地快照，验证每次写入，并在失败时回滚。
- 创建安全的 Undo 计划，不覆盖原事务后被再次编辑的文件。
- 提供只读 Doctor，检查缺失属性或公式、未使用公式、大小写漂移、类型漂移和未知 Base 结构。

所有功能都在本地运行，不需要账号、服务器、遥测、API Key 或 AI 服务。

## 安装

目前需要从源码构建插件：

```bash
npm install
npm run build
npm run install:dev -- /absolute/path/to/test-vault
```

也可以将 `main.js`、`manifest.json` 和 `styles.css` 放入：

```text
<vault>/.obsidian/plugins/schema-refactor/
```

然后在 Obsidian 的第三方插件设置中启用 **Schema Refactor**。最低支持 Obsidian 1.9.0。

## 如何使用

1. 首次使用前先备份或同步 Vault。
2. 从左侧 ribbon 或命令面板打开 **Schema Refactor**。
3. 运行 **Doctor**，在不修改文件的前提下检查 Vault。
4. 在 **Refactor** 中输入当前属性名和新属性名，然后扫描整个 Vault。
5. 逐个检查文件和 Diff，解决冲突或排除不应修改的文件。
6. 核对冲突策略、排除文件和保留的旧引用数，然后应用已审查的计划。
7. 插件创建快照、写入、验证或回滚期间保持 Obsidian 打开。
8. 需要撤销时，从 **History** 创建并审查 Undo 计划。

Desktop 支持完整的写入、回滚和 Undo 流程。Mobile 当前只支持 Doctor、扫描和 Review。

快照和事务 journal 存放在 `.obsidian/plugins/schema-refactor/snapshots/`。如果事务显示 `ROLLBACK_INCOMPLETE`，请停止外部同步，并在继续操作前检查列出的文件。
