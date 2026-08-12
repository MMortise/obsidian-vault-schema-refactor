# 竞品核对与项目决策

## 1. 结论

**Vault Schema Refactor：Go。**

Go 的前提是产品严格定位为：

> 跨 Markdown Frontmatter 和 Obsidian `.base` 声明式引用的安全 schema 重构器。

不能把以下已有能力包装成新需求：

- 批量修改或重命名 Frontmatter 属性。
- 单条 Bases formula 编辑、自动补全或校验。
- 通用 YAML schema 校验。
- 普通文本查找替换。

当前明确缺口是把“属性数据迁移”和“所有 Bases 引用迁移”组成一次可预览、可回滚、可验证的操作，并提供 Vault 范围的只读引用健康检查。

数据与源码核对时间：2026-08-12。社区插件注册表当时包含 6,580 个插件。

## 2. 直接需求证据

### Forum 104914

来源：[Bases: Renaming (or deleting) a property in properties view should update all affected bases](https://forum.obsidian.md/t/104914)

主题：`Bases: Renaming (or deleting) a property in properties view should update all affected bases`

- 13 条回复。
- 32 个赞。
- 从 2025-08 持续至 2026-07。
- 明确描述属性改名后 Bases 继续引用旧字段、变为空列。

### Forum 115127

来源：[Property reference in formulas is not re-named](https://forum.obsidian.md/t/115127)

主题：`Property reference in formulas is not re-named`

- 明确指出属性改名后 formula 仍引用旧属性。
- 用户认为大量引用时是严重问题。

### Forum 110831

来源：[Changing folder name, does not updated Bases or workspaces](https://forum.obsidian.md/t/110831)

主题：`Changing folder name, does not updated Bases or workspaces`

- 文件夹改名后 Base 的 folder filter 保留旧路径。
- 证明问题不限于属性，也存在声明式引用生命周期缺失。

### Forum 108976

来源：[Dynamic Base Filters: Update Base Filter on Entity Rename](https://forum.obsidian.md/t/108976)

主题：`Dynamic Base Filters: Update Base Filter on Entity Rename`

- 笔记或文件夹重命名后 filter 未更新。
- 提案明确承认自动更新实现复杂。

这些证据支持“引用重构”需求；不支持把通用 AI、RAG 或自然语言生成作为核心产品。

## 3. 直接与相邻竞品

### 3.1 Bases Toolbox

仓库：[grub-basket/Bases-Toolbox](https://github.com/grub-basket/Bases-Toolbox)

已实现：

- 属性索引。
- 全 Vault 属性重命名和删除。
- 属性值查找替换与历史撤销。
- Base 结果批量编辑。
- formula column 编辑。
- filter quick toggle。
- Base CSV 导入导出、View 管理、条件格式等。

源码结论：

- `renamePropertyEverywhere` 遍历包含旧属性的 Markdown 文件，通过 Frontmatter API 移动 key。
- 没有同步重写所有 `.base` filters、formulas、order、sort、groupBy 的属性引用。
- formula 编辑会尝试复用打开 Base 的未公开 controller language extension；这不是可用于跨 Vault 重构的稳定公共能力。

判断：**最接近的相邻竞品，但没有覆盖核心跨引用事务。** 本项目应避免做成另一个“大而全 Bases 工具箱”。

### 3.2 Frontmatter Operator

仓库：[pssah4/frontmatter-operator](https://github.com/pssah4/frontmatter-operator)

已实现：

- 按筛选条件批量 set、rename、copy、merge、delete Frontmatter。
- 操作预览。
- snapshot undo。
- 交互表格和可供 Agent 调用的 API。

限制：属性 rename 的操作对象是 Frontmatter，不维护 `.base` 引用。

判断：**覆盖数据迁移，不覆盖引用迁移。** 其预览和快照设计是重要质量基线。

### 3.3 Bulk Properties

仓库：[gtritchie/bulk-properties](https://github.com/gtritchie/bulk-properties)

已实现：

- 通过选择属性批量编辑一组笔记。
- 更新、删除属性值及 list merge/replace/delete。
- 与 Bases 选择列配合。

限制：面向选择后的数据编辑，不做 schema rename 和引用索引。

判断：相邻但不直接竞争。

### 3.4 Forge

仓库：[joshua-walls/forge](https://github.com/joshua-walls/forge)

已实现：定义 Vault 应有的结构、检测 drift、规范化 metadata、执行可审计批量修改。

限制：定位是 schema enforcement，没有证据表明会重构全部 `.base` 引用。

判断：Doctor 的 schema drift 部分与其相邻；本项目必须把重点放在 `.base` 引用完整性和重构计划。

### 3.5 Fileclass

仓库：[mdelobelle/fileclass](https://github.com/mdelobelle/fileclass)

已实现：可复用笔记类型、属性 schema、引导输入和校验，作为 Metadata Menu 后继。

限制：提供 schema 和编辑体验，不承担已有引用的全 Vault 迁移。

判断：可作为未来 schema 来源，但不是 MVP 依赖或直接竞品。

### 3.6 Formula Forge

仓库：[unxok/obsidian-formula-forge](https://github.com/unxok/obsidian-formula-forge)

已实现：

- Bases formula 在笔记中渲染。
- 自己的 CodeMirror formula editor。
- 语法高亮和公式解析校验。
- global formulas 与 custom functions。

源码结论：其 `FormulaEditor` 已有 syntax highlighting 和 validation。因此“更好的公式编辑器”不是缺口。

限制：不建立 Vault 范围引用索引，也不在属性改名时迁移 `.base` 依赖。

判断：互补，不应重复实现其全局公式能力。

### 3.7 Mass Editor 与通用搜索替换

Mass Editor、Better Search and Replace 等提供条件查询、正则、Diff 或批量正文/Frontmatter 操作。

限制：通用文本替换不知道哪些字符串是 Bases 属性引用，不能安全区分 `note.status`、字符串 `"status"` 和无关正文。

判断：不能视作结构化重构的替代品，但它们设定了用户对预览、选择和备份的预期。

## 4. 能力矩阵

| 能力 | Bases Toolbox | Frontmatter Operator | Formula Forge | Forge/Fileclass | 本项目 |
|---|---:|---:|---:|---:|---:|
| 批量重命名 Frontmatter key | 是 | 是 | 否 | 部分 | 是 |
| 属性值批量编辑 | 是 | 是 | 否 | 部分 | 否（MVP） |
| 单 formula 编辑/校验 | 是/借用官方 | 否 | 是 | 否 | 否 |
| 扫描全部 `.base` 属性引用 | 未见 | 未见 | 否 | 未见 | 是 |
| 同步修改 filters/formulas/view 配置 | 未见完整实现 | 否 | 否 | 未见 | 是 |
| 写入前跨文件 Change Plan | 部分 | 是 | 否 | 部分 | 是 |
| 跨 Markdown + Base 事务回滚 | 未见 | 仅 Frontmatter 范围 | 否 | 未见 | 是 |
| 写后残留引用验证 | 未见 | 未见 | 否 | 部分 drift | 是 |
| Vault 范围 Bases Doctor | 部分工具 | 否 | 单公式 | schema drift | 是 |
| 零服务器 | 是 | 是 | 是 | 是 | 是 |

## 5. 产品差异

真正差异由以下完整闭环构成：

```text
Reference index
  -> Impact plan
  -> Structural diff
  -> Conflict decisions
  -> Snapshot
  -> Multi-file write
  -> Post-write verification
  -> Undo / crash recovery
```

任何单项都容易被已有插件覆盖；闭环才是产品。

## 6. 为什么 Bases Doctor 不单独做

Doctor 与 Refactor 共享：

- Vault inventory。
- `.base` parser 和兼容 fixtures。
- 属性/公式引用索引。
- Findings 和报告模型。
- 影响路径 UI。

拆成两个插件会重复扫描和配置，也让用户在“发现问题”和“修复问题”之间切换。Doctor 应作为同一插件的只读标签页，并且默认比 Refactor 更保守。

## 7. Hugging Face 方向判断

发现 Obsidian Bases query 数据集和小模型，但不能据此立项自然语言生成：

- 样本主要是生成数据。
- 输出不是当前标准 `.base` YAML，而是自定义 JSON 表示。
- 下载量和点赞量极低。
- 缺少语法通过率、执行准确率和 Vault schema 适配评测。

这些项目只说明 Bases 查询有学习成本。自然语言可以是未来输入适配器，但必须经过本项目的确定性索引、校验和 Diff，且不得直接写文件。

## 8. 竞争风险

- Bases Toolbox 更新速度快，未来可能补上 Base 引用迁移。
- Obsidian 核心可能原生实现属性/实体 rename cascade。
- Bases 仍在快速演进，序列化格式和 API 会变化。
- 需求集中在中高级 Bases 用户，市场规模可能有限。

应对：

- MVP 尽快验证“跨 `.base` 引用”而不是扩展周边工具。
- 核心建立在公开序列化类型和保守 adapter 上。
- 若 Obsidian 原生覆盖完整重构，项目应转为 Doctor/CI 审计或停止，不与官方重复。

## 9. Go / No-Go 门槛

继续开发必须满足：

- 20 个复杂 Vault 中至少 10 个存在用户认可的引用问题。
- Exact reference precision >= 99%。
- 属性重命名后支持范围内的 Exact 漏修率 <= 1%。
- 用户认为 Diff、冲突处理和回滚相较普通批量 rename 有明确价值。

以下任一情况成立则 No-Go：

- Obsidian 核心在发布前完整支持属性 rename cascade，覆盖 `.base` 全部引用。
- Bases Toolbox 等成熟插件实现同等完整闭环且质量可靠。
- 真实 Vault 中引用问题发生率低，用户不愿为安全预览增加操作步骤。
- 公开 API/格式无法支持可靠识别，Exact 范围小到没有实用价值。

## 10. 最终决策

当前执行：

- 开发 `Vault Schema Refactor` 窄 MVP。
- 将 `Bases Doctor` 合并为只读模式。
- 不开发自然语言 Base 生成器。
- 不扩展成通用 Properties 或 Bases 工具箱。
