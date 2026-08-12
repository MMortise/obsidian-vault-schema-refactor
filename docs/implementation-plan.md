# 实施计划

## 1. 原则

- 先证明引用识别准确，再开放写入。
- 先完成单一属性重命名，再扩展其他重构类型。
- 每个阶段都可独立演示和验证。
- 写入路径在只读扫描、Plan 和故障测试完成前保持关闭。

## 2. 里程碑总览

| 阶段 | 目标 | 可交付结果 |
|---|---|---|
| M0 | 工程与契约基线 | 可加载空插件、fixture、CI、API 决策记录 |
| M1 | 只读 Inventory | 属性和 Base 文件索引 |
| M2 | Reference Index + Doctor | 可解释 findings，无写入 |
| M3 | Change Plan + Diff | 可生成真实 afterText，无写入 |
| M4 | Transaction + Rollback | 安全应用、验证、失败恢复 |
| M5 | 完整 UI + Undo | 用户可完成端到端流程 |
| M6 | 真实 Vault 验证 | Go/No-Go 数据和发布候选 |

## 3. M0：工程与契约基线

### 交付物

- Obsidian sample plugin 基础工程。
- TypeScript strict、ESLint、格式化和 Vitest。
- Desktop 开发 Vault 和最小 E2E 启动脚本。
- `.base` versioned fixture 目录。
- Markdown Frontmatter formatting fixture。
- 架构决策记录：YAML 写回策略、最低 Obsidian 版本、hash 算法。

### 任务

1. 初始化 `manifest.json`、构建脚本和 release 文件。
2. 建立 domain/adapters/planning/transaction/ui 模块边界。
3. 从目标 Obsidian 版本生成 `.base` 样本，覆盖 filters/formulas/views。
4. 比较 `processFrontMatter()` 与 CST YAML parser 的格式保真。
5. 选择 license 兼容、体积可接受的 diff/YAML 依赖。

### 完成门槛

- 插件可在测试 Vault 加载/卸载，无源文件修改。
- fixture 可在目标 Obsidian 打开。
- YAML 写回决策有自动化证据，不凭主观选择。

## 4. M1：只读 Inventory

### 交付物

- 文件发现和 SourceSnapshot。
- Markdown 顶层属性索引。
- Base parse 结果和未知 shape 报告。
- 扫描进度、取消和基础性能数据。

### 任务

1. 实现 VaultInventory。
2. 实现内容 hash 和缓存接口。
3. 实现 MarkdownFrontmatterAdapter 只读解析。
4. 实现 BasesConfigAdapter 只读解析。
5. 建立属性粗类型统计。
6. 添加 1k/10k 文件性能 fixture。

### 完成门槛

- 不读取/保存不需要的正文值。
- 解析失败能定位文件且不会中断整个扫描。
- 10k 文件基准达到或接近产品目标，并有 profile。

## 5. M2：Reference Index 与 Doctor

### 交付物

- `.base` 结构引用索引。
- 表达式 tokenizer/parser 的 Exact 最小集合。
- 七类 MVP Doctor rules。
- Findings 列表、详情和 Markdown/JSON 报告。

### 任务

1. 实现序列化 property ID 识别。
2. 实现表达式 string/token 边界处理。
3. 为特殊属性名建立 fixture。
4. 实现 MISSING_PROPERTY、MISSING_FORMULA、UNUSED_FORMULA。
5. 实现 CASE_DRIFT、TYPE_DRIFT、parse/shape rules。
6. 实现报告 schema 和脱敏。
7. 建立人工标注样本计算 precision/recall。

### 完成门槛

- Exact precision 在标注 fixture 上达到 100%。
- Probable 与 Text match 不进入自动修复。
- 报告不含绝对路径、正文或属性值。

## 6. M3：Change Plan 与 Diff

### 交付物

- RenamePropertyRequest 校验。
- Markdown 和 Base transform 纯函数。
- 四种 Markdown 目标属性冲突决策。
- 不可变 Change Plan、过期检测和 Diff。
- 完整 Review UI，但 Apply 按钮保持 feature flag 关闭。

### 任务

1. 实现属性名称校验和大小写迁移。
2. 生成 Frontmatter afterText。
3. 生成 Base afterText，保留未知字段。
4. 实现 Base properties map 冲突处理。
5. 实现 Plan invariants 和 afterText 重新解析。
6. 实现逐文件排除与残留影响计算。
7. 实现 line/word Diff。
8. 实现 Plan freshness 检查。

### 完成门槛

- 同一输入重复生成 byte-identical afterText 和稳定操作序列。
- Review 展示的 afterText 与未来执行器写入内容完全一致。
- 所有支持 fixture 在计划后可解析，未知字段不丢失。

## 7. M4：Transaction、验证与回滚

### 交付物

- SnapshotStore 和 manifest。
- Transaction journal 和状态机。
- VaultWriter、PostWriteVerifier、RollbackCoordinator。
- 故障注入 harness。
- 崩溃恢复入口。

### 任务

1. 实现单事务互斥锁。
2. 实现全量快照和 hash 校验。
3. 实现稳定顺序写入和逐文件读回。
4. 实现 post-write 五级验证。
5. 在每个写入点注入失败测试回滚。
6. 模拟文件在计划后/写入中被外部修改。
7. 模拟插件卸载/进程中断后的 journal 恢复。
8. 实现 Rollback incomplete 持续告警。

### 完成门槛

- 任意第 N 个文件写入失败时，前 N-1 个文件恢复 beforeHash。
- 外部变化文件从不被自动覆盖。
- journal 每个非终态均有确定恢复策略。

## 8. M5：完整产品流程与 Undo

### 交付物

- Refactor Configure/Scan/Review/Confirm/Apply/Verify 全流程。
- History 列表、事务详情和安全 Undo。
- 设置页、移动端布局和可访问性。
- 用户文档和风险说明。

### 任务

1. 完成双标签主视图。
2. 增加文件筛选、结构路径和打开源文件操作。
3. 完成确认与 blocker 规则。
4. 完成结果状态和错误恢复 UI。
5. 实现 Restore Plan，不直接旁路恢复。
6. 实现快照保留与安全清理。
7. 完成键盘导航和窄屏布局。

### 完成门槛

- 新用户能在测试 Vault 独立完成重构和撤销。
- 所有危险操作有明确确认且不可设置为永久跳过。
- 移动端可完成 Doctor、扫描和 Review；首发写入入口保持关闭。Mobile 写入作为 M6 后独立发布决策，不阻塞 Desktop MVP。

## 9. M6：真实 Vault 验证和发布候选

### 样本

- 至少 20 个经用户授权的真实或脱敏 Vault。
- 至少覆盖 5 种主要用途：任务、项目、阅读、CRM、研究/写作。
- 覆盖小型、中型、10k+ 笔记 Vault。
- 覆盖 Git、Sync、iCloud/文件同步等常见存储方式，但不主动操作远端。

### 验证

1. 人工确认 Doctor findings 真伪。
2. 在副本 Vault 执行重构并打开全部受影响 Base。
3. 比较普通属性 rename 工具与本项目发现的额外引用。
4. 记录误报、漏报、格式 churn 和耗时。
5. 进行可用性访谈，验证 Review 是否可理解。

### 发布门槛

- 达到 product-spec 的成功指标。
- 无 P0/P1 已知缺陷。
- Rollback incomplete 仅能由无法控制的外部并发模拟触发，且 UI 可恢复。
- README、隐私说明、兼容版本和已知限制完整。
- Desktop 完整流程达到发布门槛；Mobile 只读能力通过兼容测试，写入 feature flag 保持关闭。

### M6 输出

- `validation-report.md`：样本构成、问题发生率、precision、漏修率和性能结果。
- `compatibility-matrix.md`：Obsidian 版本、操作系统、同步目录及读写能力。
- `known-limitations.md`：所有 Probable/Text match、未知 Base shape 和移动端限制。
- Go/No-Go 决策记录：逐条对应产品规格第 20、21 节，不以主观判断替代数据。

## 10. 首版后候选顺序

仅在 M6 Go 后考虑：

1. 属性删除/合并。
2. formula rename。
3. folder/note path 的 `.base` 补充重构。
4. 模板静态引用 adapter。
5. Dataview DQL adapter。
6. 可选 Ollama/HF 自然语言计划入口。

每个新 adapter 都必须复用 Confidence、Plan、Transaction 和 Test 门槛，不允许直接文本替换写入。

## 11. 暂停条件

开发过程中出现以下情况应暂停而不是继续扩范围：

- 无法为常见 Base 表达式建立高 precision Exact 识别。
- YAML 往返无法避免大规模无关格式变化。
- Obsidian 核心即将发布完整原生 rename cascade。
- 真实 Vault 验证显示问题发生率或用户价值不足。
