# 测试计划

## 1. 质量目标

本插件会批量修改用户知识库，质量标准高于普通展示型插件。测试优先级：

1. 不误改。
2. 不留下半迁移状态。
3. 不覆盖并发新内容。
4. 不丢失未知 `.base` 配置和 YAML 信息。
5. 所有修改可解释、可验证、可恢复。

## 2. 测试层级

### 2.1 单元测试

覆盖纯函数：

- 属性名校验和规范化比较。
- YAML key rename 与冲突策略。
- Property ID 分类。
- 表达式 tokenizer/parser。
- Change Plan invariants。
- Finding fingerprint。
- Diff 摘要。
- Doctor rules。

### 2.2 契约测试

验证插件对 Obsidian 文件格式和 API 的假设：

- `processFrontMatter()` 对不同 YAML 风格的实际输出。
- `.base` 公开类型与真实序列化样本一致性。
- Vault modify/read/rename 事件顺序。
- Desktop 与 Mobile Adapter 行为差异。
- Obsidian 版本升级后的 fixture 往返。

### 2.3 集成测试

使用内存 Vault/mock Adapter：

- Inventory -> Index -> Plan 全链路。
- Plan -> Snapshot -> Write -> Verify。
- 写入失败 -> Rollback。
- History -> Restore Plan -> Undo。
- Doctor -> Markdown/JSON report。

### 2.4 E2E

在真实 Obsidian 测试 Vault 中：

- 加载插件并执行完整 UI 流程。
- 打开受影响的 Bases，确认可渲染。
- 验证 Properties View 中旧属性消失、新属性存在。
- 重启 Obsidian 后历史和快照仍可用。
- 在执行阶段模拟 reload/crash 后恢复。

### 2.5 手工探索

- 大型 Vault 的响应性。
- 移动端后台/前台切换。
- Sync/Git 外部修改竞争。
- 极长路径、CJK、RTL 和特殊字符属性名。

## 3. 属性名测试矩阵

| 类别 | 示例 | 预期 |
|---|---|---|
| ASCII | `status` | 支持 |
| 连字符 | `project-status` | 按 Bases 合法语法 fixture 处理 |
| 空格 | `project status` | 支持 YAML；表达式仅在可证明语法下自动改 |
| CJK | `项目状态` | 支持 |
| 大小写 | `Status -> status` | 有效迁移 |
| 点号 | `project.status` | 作为完整属性名，不误判层级 |
| 数字开头 | `2026-status` | YAML 支持；表达式访问按 fixture |
| 前后空格 | ` status ` | 新名称拒绝 |
| 换行/控制字符 | 非法输入 | 拒绝 |
| YAML 特殊字面量 | `true`, `null`, `yes` | 必须正确 quote，不改变成非字符串 key |

## 4. Markdown Frontmatter fixture

覆盖：

- 无 Frontmatter。
- 空 Frontmatter。
- CRLF/LF、BOM。
- 注释、blank lines、key 顺序。
- quoted/unquoted key。
- scalar、null、boolean、number、list、nested object、multiline string。
- anchors/aliases 和自定义 tag：若 parser 不安全支持则 blocker。
- duplicate key。
- 旧属性不存在。
- 目标属性不存在。
- 新旧属性同时存在且值相同/不同。
- 仅大小写不同键同时存在。
- 10 MB Markdown 文件，只修改开头 Frontmatter。

断言：

- 正文 byte-identical。
- 无关 Frontmatter 语义不变。
- 若设计要求格式保真，注释、顺序和 quoting 保持。
- afterText 与 Review Diff 完全一致。

## 5. Base fixture

### 5.1 结构

- 空 Base。
- 顶层 filters。
- 多 View filters。
- 嵌套 `and/or/not`。
- formulas、summaries。
- properties display config。
- order、sort、groupBy。
- 多个自定义 View 及未知字段。
- 未知顶层字段。
- 格式错误和类型错误。

### 5.2 引用形式

- `note.status`。
- `file.status`：不得修改。
- `formula.status`：不得修改。
- 裸 `status`。
- `status` 出现在字符串字面量。
- `statusText`：不得部分修改。
- 注释中的 status：不得修改。
- 函数参数、method 名和局部名字碰撞。
- 属性名含空格、连字符、点和 CJK。
- 同一表达式多次引用。

### 5.3 断言

- Exact 引用全部被识别且只改正确 token。
- Probable 不自动修改。
- 未知字段和值保持。
- 解析后的语义与除重命名外的配置一致。
- 所有 fixture 在目标 Obsidian 可打开。

## 6. 冲突测试

| Source | Target | 策略 | 预期 |
|---|---|---|---|
| 存在 | 不存在 | 任意 | 正常 rename |
| scalar A | scalar B | Keep target | B，删除 source |
| scalar A | scalar B | Keep source | A，删除 source |
| list A | list B | Merge lists | B 顺序 + A 新项 |
| scalar | list | Merge lists | blocker |
| object | object | Merge lists | blocker |
| null | scalar | 各策略 | 按显式选择，不猜测 |
| Base config A | Base config B | 未选择 | blocker |

还需测试逐文件决策、全局策略后局部覆盖以及排除文件造成的残留警告。

## 7. Plan 测试

- 同一输入产生确定性操作顺序和 afterHash。
- 空计划禁止应用。
- 有 blocker 禁止 ready。
- 排除文件后计数和残留正确。
- Plan 创建后修改目标文件，应用被拒绝。
- Plan 创建后新增含旧属性文件，应用被拒绝或要求重扫。
- Adapter version 变化使持久 Plan 失效。
- Diff 只来自 Plan 内容，不受实时文件变化影响。

## 8. 事务故障注入

对 N 个文件的事务，在以下每一点注入失败：

- Snapshot manifest 创建前。
- 第 K 个快照写入中。
- 快照校验失败。
- 第 K 个源文件写入前。
- 第 K 个源文件写入后读回 hash 不符。
- 全部写完后的解析验证。
- 残留扫描。
- History 保存。

预期：

- 写入开始前失败：源文件零变化。
- 写入后失败：全部已写文件恢复 beforeHash。
- 回滚自身失败：进入 ROLLBACK_INCOMPLETE，快照不清理，列出未恢复文件。

## 9. 并发测试

- 用户在 Review 时修改计划内文件。
- 外部同步在 Apply 前修改文件。
- 外部同步在第 K 个写入后修改已写文件。
- 文件被删除、重命名或移出 Vault。
- 两个窗口同时发起重构。
- Doctor scan 与 Refactor scan 同时运行。
- 插件自己的 modify event 不应使当前事务误判 stale。

核心断言：任何无法证明安全的状态都停止，不覆盖外部新内容。

## 10. 崩溃恢复测试

在状态机每个非终态模拟插件 unload/应用退出：

- PREPARING。
- SNAPSHOTTING。
- WRITING，0/部分/全部文件已写。
- VERIFYING。
- ROLLING_BACK。

重启后：

- 正确读取 journal。
- 不静默继续未知写入。
- 能安全完成验证或回滚。
- 恢复结果持久化，重复重启幂等。

## 11. Undo 测试

- 未发生后续编辑：完整恢复。
- 一个文件 diverged：默认跳过该文件，其余可恢复。
- 文件删除：报告 missing，不重建除非未来明确支持。
- 文件被重命名：不按内容猜测新路径。
- 连续两个事务按逆序撤销。
- 已清理快照的事务不可撤销，并明确显示原因。
- Rollback incomplete 的快照不会被自动清理。

## 12. Doctor 规则测试

每条规则包括：

- 至少 10 个 true positive fixture。
- 至少 10 个容易混淆的 true negative fixture。
- severity、structuralPath、fingerprint 稳定性断言。
- 同一 finding 重扫不重复。
- 文件修复后 finding 消失。

特别注意：

- 没有属性实例可能是空模板设计，MISSING_PROPERTY 不能默认 blocker。
- `null` 不代表一种稳定属性类型。
- formula 定义可能由自定义 View 间接使用；未知字段存在时 UNUSED_FORMULA 应降级。

## 13. 报告测试

- JSON 符合 versioned schema。
- Markdown 与 JSON summary/finding 数量一致。
- 不包含 Vault 绝对路径。
- 不包含 Frontmatter 值和正文。
- 特殊字符正确 escape。
- 10k findings 时可导出且不会冻结 UI。

## 14. 性能测试

### 数据集

- S：500 MD / 10 Base。
- M：5,000 MD / 100 Base。
- L：10,000 MD / 200 Base / 50 MB Frontmatter。
- XL：50,000 MD / 1,000 Base，用于发现退化，不作为首发硬门槛。

### 指标

- 首次扫描 wall time。
- 重复增量扫描 wall time。
- Main thread 最长阻塞。
- 峰值内存。
- Plan build 和 Diff 首屏时间。
- Apply/Verify 每文件耗时。

### 门槛

L 数据集桌面参考环境：

- 首次扫描 P95 <= 20 秒，目标 <= 10 秒。
- 增量扫描 <= 2 秒。
- 单次主线程阻塞 <= 100 ms。
- 峰值额外内存 <= 200 MB。

移动端首发只验证 Doctor、扫描和 Review；Apply/Rollback/Undo 入口必须关闭。Mobile 写入性能与事务测试作为后续开放门槛单独记录。

## 15. UI 与可访问性测试

- 仅键盘完成 Configure -> Review -> Confirm。
- Screen reader 可读按钮名称、严重程度和 Diff 文件名。
- 200% 缩放不遮挡主操作。
- 320 px 宽度无横向溢出导致操作不可达。
- 长路径、长属性名和 CJK 正确换行。
- 深色/浅色主题均有足够对比度。
- 扫描取消、错误、无结果、stale、rollback incomplete 状态完整。

## 16. 兼容测试

- 最低支持 Obsidian 版本。
- 当前稳定版。
- 最新 insider 版用于提前发现问题，不作为发布依赖。
- macOS、Windows、Linux。
- iOS、Android 的 Doctor、扫描和 Review；确认不存在可绕过 feature flag 的写入入口。
- Vault 位于普通磁盘、iCloud/Dropbox/OneDrive 同步目录。

不自动触发 Git commit、Sync 或外部工具。

## 17. 安全测试

- 恶意 YAML key：`__proto__`、`constructor`、`prototype`。
- 路径穿越：`../`、绝对路径、Windows drive path。
- Snapshot manifest 篡改。
- 超大 YAML、深层嵌套、alias bomb。
- 不受信任自定义 YAML tag。
- 报告中的 HTML/Markdown 注入。
- 日志检查：不得出现属性值或正文。

## 18. 发布阻断等级

### P0

- 数据丢失。
- 自动覆盖 divergent 文件。
- 回滚报告成功但 hash 未恢复。
- 路径越界写入。

任何 P0 必须阻断发布。

### P1

- Exact 引用误改。
- 计划 Diff 与实际写入不同。
- 常见 `.base` 被破坏或未知字段丢失。
- crash recovery 无法进入明确状态。

任何 P1 必须阻断发布。

### P2

- Doctor 非关键误报。
- 大 Vault 性能未达目标但不冻结和不影响正确性。
- 非核心 UI 问题。

P2 可在有明确说明和计划时评估发布。

## 19. 发布检查表

- 所有自动化测试通过。
- 真实 Obsidian E2E 通过。
- 20 个 Vault 验证达到 Go 指标。
- 无 P0/P1。
- Snapshot、rollback 和 crash recovery 手工演练通过。
- 最低版本、已知限制、隐私说明和恢复说明已发布。
- 从干净安装、升级安装、禁用和卸载路径均验证。
