# Obsidian Bases 需求调研附件

> 本文保留早期机会筛选和外部证据。项目现已确认转向 `Obsidian Vault Schema Refactor`；正式产品规则以 [product-spec.md](./product-spec.md)、[technical-design.md](./technical-design.md) 和 [competitive-audit.md](./competitive-audit.md) 为准。

## 调研结论

Hugging Face 没有提供可以直接照搬的成熟插件需求，但相关模型和数据集把需求线索指向了 Obsidian Bases。结合官方社区插件、README、源码和论坛需求核对后，形成三个候选方向：

1. **Vault Schema Refactor：Go，优先级最高。**
2. **Bases Doctor：Conditional Go，建议作为 Vault Schema Refactor 的只读模式。**
3. **自然语言生成 Base：No-Go（独立产品）；可作为后续可选入口。**

最终产品采用 `Vault Schema Refactor + Bases Doctor`。两者共享 `.base` 解析、引用索引、诊断、Diff 和安全写入能力，作为同一插件的 Refactor 与 Doctor 两个模式实现。

## 产品约束

- 插件核心功能完全本地运行。
- 不需要开发者提供服务器、数据库、存储、账号或付费 API。
- 不依赖 AI 也能完成核心扫描和重构。
- 可选接入用户自己的 Ollama 或本地 Hugging Face 模型，但不得成为核心功能的必需条件。
- 所有批量修改必须先预览、再确认，并提供可恢复的快照或撤销记录。

## 候选一：Vault Schema Refactor

### 决策

**Go。当前三个方向中需求最强、竞争缺口最清晰。**

### 要解决的问题

Obsidian 可以批量重命名 Frontmatter 属性，但不会可靠更新引用该属性的 `.base` 文件。属性、公式、笔记或文件夹改名后，用户可能得到没有明显报错、却返回空结果或错误结果的 Base。

典型失效位置包括：

- Base 顶层 `filters`。
- 各 View 的 `filters`。
- `formulas` 和 `summaries` 中的属性引用。
- View 的 `order`、`sort` 和 `groupBy`。
- `note.<property>`、`formula.<name>` 等表达式引用。
- 指向已改名文件夹或笔记的过滤条件。

### 需求证据

- Obsidian Forum `104914`：重命名或删除属性后应更新所有受影响的 Bases；13 条回复、32 个赞，持续更新到 2026-07。
- Obsidian Forum `115127`：Base 公式中的属性引用不会随属性改名，用户称大量引用场景为 “a nightmare”。
- Obsidian Forum `110831`：文件夹改名后 Base 仍过滤旧路径。
- Obsidian Forum `108976`：笔记或文件夹改名后，动态 Base filter 不会更新。

### 竞品边界

已源码核对的相邻插件：

- **Bases Toolbox**：可以批量重命名 Frontmatter 属性，但 `renamePropertyEverywhere` 只遍历 Markdown Frontmatter，不会同步修改 `.base` 引用。
- **Frontmatter Operator**：支持属性重命名、预览和快照撤销，但操作对象仍是笔记 Frontmatter。
- **Bulk Properties**：批量修改选中笔记的属性值，不做引用级重构。
- **Forge / Fileclass**：提供属性 schema、校验或规范化，不负责跨 `.base` 依赖迁移。
- **Formula Forge**：提供公式渲染、语法高亮、校验、全局公式和自定义函数，不处理属性重命名后的跨文件引用迁移。

因此不能把“批量重命名属性”作为卖点。真正的差异是：**结构化识别所有依赖，并将属性数据和引用作为一次事务共同迁移。**

### MVP

首版只处理“属性重命名”，避免一开始扩展成通用文本重构器：

1. 用户选择旧属性名和新属性名。
2. 扫描包含该属性的 Markdown 文件及全部 `.base` 文件。
3. 使用 YAML parser 读取 `.base`，结构化定位 filters、formulas、summaries、order、sort 和 groupBy 中的引用。
4. 展示影响清单和逐文件 Diff，并区分高置信结构引用与无法确定的文本引用。
5. 用户确认后同时修改 Frontmatter 和 `.base` 文件。
6. 写入前保存快照；支持整次撤销。
7. 修改完成后重新扫描，报告仍然存在的旧引用。

### MVP 不做

- 不自动替换普通正文中碰巧同名的词。
- 不在首版修改任意 DataviewJS、Templater JavaScript 或第三方插件配置。
- 不在后台静默跟随每次属性改名；先采用显式命令，降低误改风险。
- 不依赖 LLM 判断引用。

### 后续范围

- 文件夹、笔记和公式名称重构。
- 模板目录中的属性引用。
- 对静态 Dataview DQL 提供可确认的引用迁移。
- 监听 Obsidian rename 事件，先提示影响，再由用户确认修复。

### API 与实现边界

- Obsidian 公开 API 已提供 `BasesConfigFile`、`BasesConfigFileFilter`、`BasesConfigFileView` 等序列化类型，可以安全描述 `.base` 文件结构。
- 插件可通过 Vault API 读取、解析和写回 `.base` 文件。
- 批量 Frontmatter 修改使用 `app.fileManager.processFrontMatter()`。
- 公开 API 没有通用的 Base 重构事务，需要插件自己生成计划、快照和回滚。
- 不应依赖官方 Base 弹窗 DOM 或未公开 controller 完成核心功能。

### 最小验证

制作 20 个包含 filters、formula、sort、group 和多 View 的测试 Base：

- 验证能找到所有真实引用。
- 验证不会改动字符串字面量和同名无关字段。
- 验证修改后 Base 仍能由 Obsidian 正常打开。
- 验证撤销可完整恢复 Markdown 与 `.base` 文件。

## 候选二：Bases Doctor

### 决策

**Conditional Go。适合作为 Vault Schema Refactor 的只读入口，不建议单独立项。**

### 要解决的问题

用户很难知道一个 Base 是“当前没有匹配结果”，还是已经因为属性、公式、笔记或文件夹改名而失效。官方界面主要显示运行结果，没有提供整个 Vault 的引用完整性报告。

### 核心检查

- filter 引用了不存在的属性、文件夹或笔记。
- formula / summary 引用了不存在的属性或公式。
- order、sort、groupBy 引用了已删除字段。
- formula 已定义但从未使用，或被使用但没有定义。
- 属性名称存在大小写漂移。
- 同一属性在不同笔记中出现明显类型冲突。
- Base 中残留旧属性名，但 Vault 已存在疑似替代字段。
- 每项问题展示 Base、View、表达式位置和依赖路径。

### 竞品边界

- Formula Forge 已覆盖单条公式的语法高亮和解析校验。
- Obsidian 官方公式编辑器已有函数和属性自动补全。
- Bases Toolbox 可编辑公式列、切换 filters、显示属性索引，也会复用官方未公开的 formula editor language support。
- 尚未发现成熟插件提供跨 Vault 的 `.base` 依赖索引、失效引用审计和结构化修复计划。

所以 Bases Doctor 不能定位为“更好的公式编辑器”，而应定位为：**整个 Vault 的 Base 依赖健康检查。**

### MVP

1. 只读扫描全部 `.base` 文件。
2. 建立 Vault 属性、文件、文件夹和 Base formula 索引。
3. 输出按严重程度分组的 findings。
4. 每项 finding 提供证据位置、原因和建议动作。
5. 对确定性问题提供“交给 Schema Refactor 修复”，但默认不自动写入。
6. 可导出 Markdown/JSON 报告，方便用户提交 Git 或在自己的 CI 中比较。

### API 限制

Obsidian 公开 API 暴露了 `.base` 的序列化类型和自定义 Bases View，但没有公开“执行任意临时 Base 查询”或通用公式 parser API。因此 MVP 应做结构和引用诊断；不要承诺在独立面板完整模拟官方 Bases 运行结果。

### Go / No-Go 验证

对至少 20 个真实 Vault 扫描：

- 至少一半 Vault 能发现用户认可的真实失效引用。
- 高严重度 finding 的 precision 达到 90% 以上。
- 用户愿意在属性整理、插件升级或提交 Git 前重复运行。

若问题主要都是无害的历史字段或低价值告警，则不应将其做成独立产品，只保留为 Schema Refactor 的扫描步骤。

## 候选三：自然语言生成 Base

### 决策

**No-Go（独立插件）。可在前两个方向成立后，作为可选输入方式。**

### Hugging Face 线索

发现以下相关项目：

- `ssdavid/obsidian-bases-query-v1`：1,000 条生成样本。
- `ssdavid/obsidian-bases-query-v2-compact`。
- `ssdavid/obsidian-bases-slm`：基于 Qwen3-0.6B 微调。
- `ssdavid/obsidian-bases-slm-compact`：基于 SmolLM2-135M 微调。

它们反映出有人尝试把“自然语言问题”转换成 Bases 查询，但不能作为成熟市场需求或可直接集成的基础设施：

- 数据和模型下载量约为 0 至 11，需求信号很弱。
- v1 数据由 Claude 生成，不是真实用户查询日志。
- 输出是自定义 JSON/压缩 JSON 中间格式，不是当前标准 `.base` YAML。
- 模型卡缺少针对 Bases 的准确率、语法通过率和执行结果评测。
- 模型卡仍保留无关的通用问答示例，项目完成度不足。

### 为什么不单独开发

- 模型需要理解每个 Vault 的真实字段、类型、文件夹和公式，通用训练数据不能可靠解决。
- 错误查询可能正常运行但返回错误集合，比明确报错更危险。
- 用户可以通过现有通用 AI、Ollama 或 Agent 插件生成文本，单纯增加一个生成入口差异不足。
- 浏览器内直接运行 0.6B 模型会增加包体、内存、移动端兼容和推理性能成本。

### 可接受的后续形态

当 Schema Refactor 和 Bases Doctor 已能建立可靠字段索引及校验后，可以加入可选的“描述想要的结果”入口：

1. 用户输入“显示最近 30 天内未完成的项目”。
2. 插件先把当前 Vault 的字段、类型和候选值提供给用户自己的 Ollama 或本地模型。
3. 模型只生成候选 filter/formula，不直接写文件。
4. Bases Doctor 做确定性引用和结构校验。
5. 展示生成内容和 Diff，用户确认后写入。

没有 Ollama 或模型时，核心插件仍应完整可用。

## 推荐产品组合

建议将本目录转向一个插件，暂定名：

### Obsidian Schema Refactor

它包含两个主模式：

- **Audit / Doctor**：只读发现失效引用和 schema drift。
- **Refactor**：生成跨 Markdown 和 `.base` 的修改计划，预览 Diff，确认后事务式写入并可撤销。

自然语言生成只作为未来可选适配器，不进入 MVP，也不影响插件的零服务器和零额外成本属性。

## 与原项目的关系

原 Portable Merge Compiler 已被竞品源码核对判定为 No-Go，并已移除。当前目录是独立的 Vault Schema Refactor 项目，不继承原导出编译器的产品范围。
