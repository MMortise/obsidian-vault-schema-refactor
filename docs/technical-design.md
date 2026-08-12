# Obsidian Vault Schema Refactor 技术设计

## 1. 设计目标

技术实现必须满足四个核心性质：

1. **确定性**：同一 Vault 快照和同一请求产生同一 Change Plan。
2. **保守性**：不能证明是引用时不自动修改。
3. **原子感知**：Obsidian Vault API 不提供跨文件事务，插件必须自行实现快照、逐文件校验和补偿回滚。
4. **可演进**：引用扫描、计划生成和文件写入解耦，后续可增加 formula、路径和 Dataview adapter。

## 2. 技术栈

- TypeScript，启用严格类型检查。
- Obsidian Plugin API，最低版本在实现前根据 Bases 公开 API稳定版本确定。
- CodeMirror 6：仅用于 Diff/只读代码展示或插件自己的编辑器，不注入官方 Base UI。
- YAML parser：优先使用 Obsidian 提供的 `parseYaml` 读取；写回需选择支持稳定序列化和明确 quoting 的库或受控 serializer。
- 测试：Vitest；Obsidian 集成层使用 mock/fixture，关键工作流增加真实 Obsidian E2E。

核心功能禁止依赖：

- 未公开 `controller.getEditorLanguageSupport()` 等内部 API。
- Base 界面的 CSS selector 或 DOM 注入。
- 不使用 Electron/Node-only 文件 API；核心逻辑统一使用 Vault/Adapter API。MVP 的 Mobile 只读流程复用同一核心，写入能力保持 feature flag 关闭。
- 云服务或远程模型。

## 3. 架构

```text
UI
  -> RefactorApplicationService
      -> VaultInventory
      -> ReferenceIndexer
          -> MarkdownFrontmatterAdapter
          -> BasesConfigAdapter
      -> PlanBuilder
      -> PlanValidator
      -> TransactionExecutor
          -> SnapshotStore
          -> VaultWriter
          -> PostWriteVerifier
          -> RollbackCoordinator
      -> HistoryStore

DoctorApplicationService
  -> VaultInventory + ReferenceIndexer
  -> RuleEngine
  -> ReportExporter
```

扫描和计划层为纯逻辑，不能直接写 Vault。只有 `TransactionExecutor` 可以写源文件。

## 4. 目录建议

```text
src/
  main.ts
  app/
    refactor-service.ts
    doctor-service.ts
  domain/
    property-name.ts
    reference.ts
    finding.ts
    change-plan.ts
    transaction.ts
    conflict.ts
  inventory/
    vault-inventory.ts
    metadata-index.ts
  adapters/
    markdown-frontmatter-adapter.ts
    bases-config-adapter.ts
    expression-reference-adapter.ts
  planning/
    plan-builder.ts
    plan-validator.ts
    diff-builder.ts
  transaction/
    executor.ts
    snapshot-store.ts
    rollback.ts
    verifier.ts
    history-store.ts
  doctor/
    rule-engine.ts
    rules/
  ui/
    refactor-view.ts
    doctor-view.ts
    review/
    settings-tab.ts
  report/
    markdown-report.ts
    json-report.ts
```

## 5. 领域模型

### 5.1 PropertyId

```ts
interface PropertyName {
  raw: string;
  normalizedForComparison: string;
}
```

`raw` 用于真实写入；`normalizedForComparison` 只用于识别大小写漂移和冲突，不能直接写回。

### 5.2 SourceSnapshot

```ts
interface SourceSnapshot {
  path: string;
  kind: "markdown" | "base";
  bytes: Uint8Array;
  contentHash: string;
  mtime: number;
  size: number;
}
```

哈希使用浏览器和移动端均可用的 Web Crypto，例如 SHA-256。`mtime + size` 只能用于快速判断，应用前必须核对内容哈希。

### 5.3 Reference

```ts
type Confidence = "exact" | "probable" | "text";

interface PropertyReference {
  id: string;
  filePath: string;
  fileKind: "markdown" | "base";
  semanticKind:
    | "frontmatter-key"
    | "base-filter"
    | "base-formula"
    | "base-summary"
    | "base-property-config"
    | "view-order"
    | "view-sort"
    | "view-group";
  structuralPath: Array<string | number>;
  syntaxForm: "note-prefixed" | "bare-identifier" | "serialized-property-id";
  propertyName: string;
  confidence: Confidence;
  range?: { from: number; to: number };
  evidence: string;
}
```

`structuralPath` 是主要定位方式；`range` 只用于 Diff 和表达式内替换，不能在文件内容变化后继续复用。

### 5.4 Finding

```ts
interface Finding {
  id: string;
  ruleId: string;
  severity: "blocker" | "error" | "warning" | "info";
  filePath: string;
  structuralPath?: Array<string | number>;
  confidence: Confidence;
  message: string;
  evidence?: string;
  fingerprint: string;
  suggestedAction?: "create-refactor" | "open-file" | "manual-review";
}
```

Finding fingerprint 由规则、相对路径、结构路径和规范化证据计算，不包含完整属性值。

### 5.5 ChangePlan

```ts
interface ChangePlan {
  schemaVersion: 1;
  planId: string;
  createdAt: string;
  request: RenamePropertyRequest;
  sourceSnapshots: Record<string, Pick<SourceSnapshot, "contentHash" | "mtime" | "size">>;
  fileChanges: FileChange[];
  unresolvedFindings: Finding[];
  exclusions: PlanExclusion[];
  status: "draft" | "ready" | "stale" | "applied" | "cancelled";
}
```

Change Plan 创建后不可就地修改。用户更改冲突策略或排除项时，生成新 revision 和新 `planId`，避免 UI 状态与执行数据漂移。

### 5.6 FileChange

```ts
interface FileChange {
  path: string;
  beforeHash: string;
  beforeText: string;
  afterText: string;
  afterHash: string;
  operations: ChangeOperation[];
  validation: ValidationResult;
}
```

内存可只为实际变化文件保存 `beforeText/afterText`。大文件需设置合理上限；超限时将计划标记为人工处理，不执行部分字符串替换。

## 6. Vault Inventory

### 6.1 文件发现

使用 `app.vault.getFiles()` 获取 `.md` 与 `.base` 文件：

- Markdown：优先使用 `MetadataCache` 判断是否存在 Frontmatter；实际计划必须读取原文件确认。
- Base：全部读取并解析。
- 不遍历 Vault 外路径。
- `.obsidian` 默认不在 `getFiles()` 结果中；即使可见也不扫描其他插件设置。

### 6.2 增量缓存

缓存键：`path + contentHash + adapterVersion`。

缓存内容：

- Markdown 顶层属性名与粗略类型。
- Base 解析状态、formula 定义和属性引用。
- 不缓存 Frontmatter 属性值，除非生成当前计划所必需；计划结束后释放。

监听：

- Vault `create`、`modify`、`delete`、`rename` 使对应缓存失效。
- MetadataCache `changed` 只作为提示，不能替代内容哈希。

MVP 可先实现全量扫描，接口保持可缓存；性能不达标时再启用持久缓存。

## 7. Markdown Frontmatter Adapter

### 7.1 读取

- 只处理文档开头合法 YAML Frontmatter。
- 只重命名顶层键；嵌套 object 中的同名键不属于同一个 Obsidian property。
- 保留正文原始字节不变。
- 记录源文件行尾风格和 BOM。

### 7.2 写入策略

`processFrontMatter()` 对简单属性安全，但可能重新格式化 Frontmatter。产品要求提供清晰 Diff，因此实现阶段需通过契约测试选择：

方案 A：`app.fileManager.processFrontMatter()`

- 优点：官方推荐，Obsidian 语义兼容。
- 缺点：可能改变 YAML formatting，难以做到最小 Diff。

方案 B：支持 CST 的 YAML parser 定点重命名键

- 优点：保留注释、quote、key 顺序和格式。
- 缺点：增加依赖和边缘语法风险。

MVP 决策原则：先制作契约样本。若 `processFrontMatter()` 会对未相关字段产生大量格式 churn，则采用 CST parser；否则使用官方 API。无论选择哪种方式，Plan 中的 `afterText` 必须是执行前已经展示给用户的真实目标文本，执行阶段不能再次用不同 serializer 生成。

### 7.3 冲突操作

纯函数：

```ts
renameFrontmatterKey(
  document: ParsedFrontmatter,
  oldName: string,
  newName: string,
  decision: ConflictDecision
): TransformResult
```

规则：

- 目标不存在：移动值并删除旧键。
- Keep target：删除旧键。
- Keep source：目标设为源值并删除旧键。
- Merge lists：目标与源都必须是数组，否则返回 blocker。
- 排除：不产生 FileChange，并产生残留警告。

## 8. Bases Config Adapter

### 8.1 解析

`.base` 是 YAML 序列化的 `BasesConfigFile`。Adapter 必须：

- 解析为受控 AST/CST，而不是 `JSON.stringify` 往返。
- 验证顶层已知字段类型。
- 保留未知顶层字段、未知 View 字段和 key 顺序。
- 对无法解析文件生成 `UNPARSEABLE_BASE` Error；仅当创建重构计划且原文可能包含旧属性时，将该文件提升为当前计划的 Blocker。
- 对已知字段出现未知 shape 生成 `UNKNOWN_BASE_SHAPE`，不自动修改该节点。

### 8.2 已知结构路径

依据公开 API 处理：

- `filters`
- `properties`
- `formulas`
- `summaries`
- `views[*].filters`
- `views[*].order`
- `views[*].sort`（若当前序列化版本存在）
- `views[*].groupBy`
- 公开类型新增且经 fixture 验证的属性引用字段

公开 API 类型和实际序列化可能随 Obsidian 版本演进。Adapter 以 versioned fixture 建立兼容矩阵，不根据字段名猜测并写入未知结构。

### 8.3 Property ID

Bases 可使用 `note.<name>`、`file.<name>`、`formula.<name>` 等 property ID。

属性重命名只修改：

- `note.<old>` -> `note.<new>`。
- 经 expression adapter 确认为 note property 的裸标识符。

绝不修改：

- `file.<old>`。
- `formula.<old>`，除非未来执行 formula rename。
- 字符串值中的 `<old>`。

属性名包含空格、连字符或特殊字符时，表达式的合法访问形式以 Obsidian 当前语法 fixture 为准，不自行发明 escaping。

### 8.4 properties 配置

若 `properties` map 的 key 是 `note.<old>`，重命名为 `note.<new>`。若目标 key 已存在，视为 Base 配置冲突：

- 默认 blocker。
- MVP 仅允许 Keep target 或 Keep source，不合并任意配置 object。

## 9. 表达式引用识别

### 9.1 为什么需要独立 Adapter

filters、formulas 和 summaries 的叶子可能是表达式字符串。简单正则替换会误改：

- 字符串字面量：`label == "status"`。
- 方法或局部变量名称。
- `file.status` 或 `formula.status`。
- 更长标识符的一部分。

因此必须将结构定位与表达式 token 化分开。

### 9.2 MVP 策略

优先级：

1. 使用 Obsidian 公开 parser（若发布目标版本正式提供）。
2. 使用与当前 Bases 表达式语法兼容、带 fixture 的 tokenizer/parser。
3. 无法完整解析时，只识别语法边界明确的 `note.<old>`，其余降级为 Probable。

禁止用无边界的 `string.replaceAll(oldName, newName)`。

### 9.3 Token 规则

- 跳过单引号、双引号字符串及其 escape。
- 跳过正则字面量（若语法支持）。
- 识别 identifier、dot access、bracket access、function call 和 operator。
- `note.<old>` 是 Exact。
- 裸 `<old>` 只有在 parser 能解析为当前 row 的 note property 时才是 Exact，否则 Probable。
- `note["<old>"]` 是否支持及如何重写由兼容 fixture 决定。

### 9.4 替换

表达式解析产生 token range，从后向前应用替换。应用前重新核对 token 内容和 AST 节点类型；任何不一致使计划 stale。

## 10. Plan Builder

步骤：

1. 校验 RenamePropertyRequest。
2. 冻结 Inventory revision。
3. 收集旧属性定义和引用。
4. 为每个 Markdown 计算冲突和候选 afterText。
5. 为每个 Base 计算结构化修改和候选 afterText。
6. 重新解析所有 afterText。
7. 运行不变量检查。
8. 生成 Diff、摘要、findings 和不可变 Change Plan。

不变量：

- 每个 FileChange 的 beforeHash 与 SourceSnapshot 一致。
- afterText 与 beforeText 不同时才产生 FileChange。
- afterText 可被对应 Adapter 解析。
- Exact 旧引用数量的减少等于计划操作数量，扣除显式排除。
- 不存在未决 blocker 时 Plan 才能进入 `ready`。

## 11. Diff

- 使用成熟 diff 库生成 line diff；Review 可进一步显示 word diff。
- Diff 完全由 `beforeText` 与 `afterText` 计算，不读取实时文件。
- YAML 大范围格式变化需标记 `FORMAT_CHURN` warning。
- 默认折叠未变化区，始终显示文件相对路径和修改原因。
- 二进制文件不在本产品范围。

## 12. Plan 过期检测

以下任一条件使 Plan stale：

- 目标文件内容哈希变化。
- 文件被删除或路径变化。
- 新增了包含旧属性定义或 Exact 引用的文件。
- 插件的 adapter/parser 版本变化。

应用前至少：

- 重新哈希所有 FileChange 文件。
- 检查 Vault inventory revision。
- 若 revision 变化，增量扫描变化文件，判断是否影响计划。

受影响时要求重新生成计划，不能只弹警告后继续。

## 13. Transaction Executor

### 13.1 状态机

```text
PREPARING
  -> SNAPSHOTTING
  -> WRITING
  -> VERIFYING
  -> COMPLETED

Any failure after SNAPSHOTTING
  -> ROLLING_BACK
  -> ROLLED_BACK | ROLLBACK_INCOMPLETE
```

### 13.2 写入顺序

1. 获取插件级互斥锁，禁止同时执行两个事务。
2. 再次验证 Plan freshness。
3. 为所有 FileChange 写快照和 manifest。
4. 验证快照可读且哈希正确。
5. 按稳定路径顺序写文件。
6. 每次写入后读取并核对 afterHash。
7. 全部写完后运行 PostWriteVerifier。
8. 保存历史并释放锁。

稳定顺序仅用于可重现日志，不代表真正原子性。

### 13.3 Vault 写入

- 使用 `app.vault.modify(file, afterText)`。
- 写之前确认 `TFile` 仍对应计划路径。
- 保留原 BOM 和行尾。
- 不使用直接系统路径，以保持移动端兼容。

### 13.4 外部并发编辑

写入前和每次写入前都核对当前 hash。发现变化：

- 尚未写任何文件：终止，Plan stale。
- 已写部分文件：进入回滚。

插件自己的 `modify` 事件通过 transaction ID/预期 hash 识别，避免误判为外部修改。

## 14. Snapshot Store

建议位置：

```text
.obsidian/plugins/<plugin-id>/snapshots/<transaction-id>/
  manifest.json
  files/<encoded-relative-path>
```

Desktop MVP 使用 Adapter 在插件目录下保存快照和 manifest；若目标环境无法可靠访问该目录，则该环境不开放写入。`Plugin.saveData` 只保存小型设置和历史索引，不保存大体积文件快照。Mobile 写入必须先通过兼容矩阵验证，不在首发范围内。

Manifest 必须先写临时文件、校验后替换正式 manifest。每个快照记录：

- 原相对路径。
- beforeHash、afterHash。
- 原字节长度。
- 快照文件名。
- 写入和回滚状态。

编码路径不能直接拼接用户路径，使用哈希文件名并在 manifest 映射，防止 `../` 和非法字符问题。

## 15. 回滚

### 15.1 自动回滚

只回滚本事务已经写入的文件。恢复前：

- 当前 hash 必须等于事务预期 afterHash 或本次失败写入的已知 hash。
- 若发现外部变化，不覆盖，标记 Rollback incomplete。

按写入逆序恢复，并逐文件验证 beforeHash。

### 15.2 事后撤销

与自动回滚不同：

- 检查所有文件当前 hash 是否仍是 afterHash。
- 任何 divergent 文件默认跳过；用户可先打开 Diff。
- 非 divergent 文件组成新的 Restore Plan，仍经过 Review/Confirm。
- 撤销也使用 Transaction Executor，不走旁路写入。

## 16. Post-write Verifier

验证层级：

1. **字节验证**：实际 hash 等于 afterHash。
2. **解析验证**：Markdown Frontmatter 与 Base 仍可解析。
3. **计划验证**：每项 ChangeOperation 的后置条件成立。
4. **残留扫描**：重新查找旧定义和 Exact 引用。
5. **目标验证**：新定义和新引用数量符合计划。

公开 API 不提供任意 Base 查询执行器，因此不把“结果行完全相同”作为 MVP 自动验证。E2E fixture 可在真实 Obsidian 中确认 Base 能打开且无明显解析错误。

## 17. Doctor Rule Engine

Rule 接口：

```ts
interface DoctorRule {
  id: string;
  version: number;
  run(context: DoctorContext): Finding[] | Promise<Finding[]>;
}
```

规则：

- `MISSING_PROPERTY`：Exact note property 引用无任何实例。由于空 Vault schema 可能是有意设计，默认 severity 为 Warning；若同一 Base 还有同名近似属性，则提升提示但不自动认定替代关系。
- `MISSING_FORMULA`：View 引用不存在 formula，Error。
- `UNUSED_FORMULA`：Info。
- `CASE_DRIFT`：Warning。
- `TYPE_DRIFT`：Warning；类型只按 null/string/number/boolean/list/object 粗分。
- `UNPARSEABLE_BASE`：Error。
- `UNKNOWN_BASE_SHAPE`：Doctor 中为 Warning。创建属性重构计划时，若未知节点位于已知引用字段且原始节点可能包含旧属性，则提升为该计划的 Blocker；其他情况只报告。

规则不能仅因属性值为空就认定类型错误。

## 18. 报告格式

JSON schema 版本化：

```json
{
  "schemaVersion": 1,
  "pluginVersion": "0.1.0",
  "generatedAt": "2026-08-12T00:00:00Z",
  "summary": {},
  "findings": []
}
```

- 所有路径相对 Vault root。
- 不输出绝对路径、正文或属性值。
- evidence 只包含属性标识符和必要表达式片段。
- Markdown 报告从同一中间模型生成，避免两种报告结论不同。

## 19. UI 状态管理

- 应用服务持有 scan/plan/transaction 状态，View 只是投影。
- 长任务支持 `AbortSignal`；扫描可取消，写入只能在安全边界取消。
- Transaction 进行中时，插件 unload 应被视为故障：在每个阶段持久化 journal，下次加载检测未完成事务并进入恢复页面。
- 不把完整快照内容放进前端响应式 state。

## 20. 崩溃恢复

Transaction journal 每完成一个原子步骤就持久化：

```ts
interface TransactionJournal {
  transactionId: string;
  state: TransactionState;
  snapshotted: string[];
  written: string[];
  verified: string[];
  rollbackRestored: string[];
}
```

插件启动时检测非终态 journal：

- 只完成快照、未写文件：标记 cancelled，可清理。
- 写了部分文件：进入恢复向导，默认尝试安全回滚。
- 写完但未完成全局验证：先核对 hash，再继续验证或回滚。
- 状态无法判断：不自动写文件，展示快照与人工恢复步骤。

## 21. 兼容策略

发布矩阵：

| 平台 | Doctor/Scan | Review/Diff | Apply/Rollback/Undo |
|---|---:|---:|---:|
| macOS/Windows/Linux Desktop | 支持 | 支持 | 支持 |
| iOS/Android Mobile | 支持 | 支持 | 首发关闭 |

最低 Obsidian 版本在 M0 通过公开 API 类型与 `.base` fixture 确定，并写入 `manifest.json`、README 和发布说明。未完成该决策前不得发布构建。

维护 fixture：

```text
fixtures/bases/<obsidian-version>/
```

覆盖：

- 单 View、多 View。
- 嵌套 and/or/not filters。
- note/file/formula property IDs。
- formulas、summaries、order、sort、groupBy。
- 属性名含空格、连字符、CJK、点号和大小写变化。
- 社区自定义 Bases View 的未知字段。

每次提升最低 Obsidian 版本或适配新序列化字段时更新 fixture 和 adapter version。

## 22. 性能方案

- MetadataCache 只用于候选缩小，最终判断读取原文。
- 扫描分批 yield 回事件循环，避免冻结 UI。
- 限制并发读取；桌面默认 8，移动端默认 2，具体通过基准调整。
- 只对含 Frontmatter 的 Markdown 运行 YAML adapter。
- 只为有变化的文件保存 before/after text。
- Diff 懒加载，用户展开文件时生成 word diff。
- 哈希使用 Web Crypto 批量异步计算。

## 23. 安全审查点

- 所有写入路径必须来自当前 Vault 的 `TFile`，禁止信任报告或历史中的任意字符串直接写入。
- Snapshot 文件名使用 hash 映射，避免路径穿越。
- YAML 解析禁止构造任意对象原型；拒绝危险 key 或使用安全 schema。
- 不执行 YAML tag、自定义函数或表达式。
- 日志不含属性值。
- 清理快照先读取并验证 manifest 中的 transaction ID 和根目录。

## 24. 可观测性

仅本地日志，按设置启用 debug：

- 阶段、耗时、文件计数、规则计数。
- 错误类型、相对路径和 adapter version。
- 不记录正文、Frontmatter 值或完整表达式。

默认关闭 debug；没有遥测上传。

## 25. 技术风险与缓解

### Base 表达式缺少公开 parser

- 缓解：Exact 只覆盖明确形式；其他降级报告。
- 不使用内部 API 作为核心依赖。

### YAML 格式 churn

- 缓解：契约测试选择写入策略；Plan 展示真实 afterText；FORMAT_CHURN 警告。

### 跨文件非原子

- 缓解：全量快照、逐写验证、补偿回滚、持久 journal 和崩溃恢复。

### 外部同步/编辑竞争

- 缓解：内容哈希 freshness、写前检查和 divergent 保护。

### Obsidian 版本演进

- 缓解：versioned fixtures、unknown shape 保守退出、明确最低版本。

## 26. 完成定义

技术实现只有在以下条件全部满足时完成：

- 核心写入不调用未公开 API。
- 所有自动修改均来自 Exact reference 或 Frontmatter 顶层 key。
- Plan 可重现且应用前可检测过期。
- 故障注入证明任意写入点失败都能回滚或明确进入 Rollback incomplete。
- 崩溃 journal 可在重启后恢复。
- 所有支持的 Base fixture 往返后语义和未知字段保持。
- 测试计划中的发布门槛全部通过。
