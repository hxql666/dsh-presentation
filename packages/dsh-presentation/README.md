# @hxql/dsh-presentation

演示文档模式（Presentation-Document Mode）—— 一个 DSH 协作模式插件：以结构化数据驱动
Typst + Touying 生成 PDF 演示文稿，并带**视觉自审闭环**。

## 它解决什么

让模型自由写 Typst，产出一定不可复现：字号、边距、栏比每次都不一样，10 次生成 10 种风格，
而且模型看不见自己的产物。

这个插件的做法是把**版式从模型手里拿走**：

- 模型只产**结构化页面数据**（页型 + 槽位内容），从不写 Typst 标记
- 十四种版式原语拥有全部排版约束（字号阶梯、栅格、安全边距、溢出行为）
- 编译后可把页面渲染成 PNG，**模型亲眼看自己的产出**再决定改什么

## 形态

与 `plan` 同构的协作模式：

| 组成 | 说明 |
|---|---|
| 模式状态 | 从会话日志里 `/deck` 的 `command/run` + `command/done` 折叠推导，**不新增事件类型**；恢复与 fork 因此免费获得 |
| 提示词段落 | `presentation:policy`，仅在模式激活时注入（顺序 500） |
| 人类命令 | `/deck`、`/deck off`、`/deck handout`、`/deck theme:<name>`、`/deck scene:<name>`（`scene off` 清除） |
| 工具 | 常驻注册，靠模式门控（进入/离开不改变请求工具目录，前缀缓存不受影响）|

## 与宿主的四条硬契约（踩过的坑，勿回退）

1. **工具 schema 必须编译成原始 JSON Schema。** 注册表把 `parameters` 原样投影进模型请求，
   不做编译；作者 DSL（`{ spec: { type: 'object', required: true } }`）直接上线会让请求里出现
   `type: null`，供应商拒绝整个请求，**该会话此后每一轮都失败**。
   `lib/host.js` 的 `defineTool` 复刻了宿主的编译与校验（作者 DSL → 原始 schema、子集断言、
   参数与返回值校验），`output.schema` 同样是作者 DSL 单节点（对象节点必须显式声明
   `additionalProperties`）。
2. **工具的返回值必须是无损 JSON。** 宿主先做快照再按 `output.schema` 校验：带 `undefined`
   成员的返回值会被整条拒绝（不是"忽略该字段"）。因此每个 `execute` 的返回值都过
   `jsonSafe()`。
3. **不要 append 新的事件类型。** 读取器只接受带 `ignorable: true` 的未知事件，而实时
   `Session.append()` 无法设置该标记 —— 写了 `presentation/mode` 这类自有事件，会话之后
   将拒绝重新打开。模式状态因此改为从 `/deck` 的命令记录推导。
4. **不要让 Typst 子进程写产物。** 沙箱下子进程运行在**受限 token** 里，其写能力来自工作区上
   一条**能力 SID 授权**（`S-1-4-*`）；授权缺失时子进程**哪儿都写不了**（含系统临时目录），
   而宿主进程照常能写，于是每一轮都得到
   `error: failed to write PDF file (拒绝访问。 (os error 5))`。
   所以 PDF 一律用 `-` 走 stdout、由宿主写盘（实测零代价：292 ms vs 306 ms，字节一致）；
   PNG 仍优先单次调用，被拒才回退逐页 stdout。
   `test/write-path-test.mjs` 断言子进程 argv 里从不出现输出路径 —— 这条契约不靠注释守。

## 工具

| 工具 | 作用 |
|---|---|
| `deck_status` | 模式状态 + 可用页型/主题/字体栈 + 引擎版本与完整性 |
| `deck_build` | 结构化 spec → PDF；返回页数、字节数与结构化诊断 |
| `deck_check` | PDF/源 → 逐页 PNG，供模型目视自审 |
| `deck_export` | `handout`（一页一屏的讲义）/ `notes`（`.pdfpc` 讲者备注）|
| `deck_scaffold` | 只落盘不编译，用于查看生成的 Typst 源码 |

## 页型（14）

`cover` `section` `agenda` `bullets` `steps` `cards` `kpis` `timeline`
`compare` `quote` `table` `code` `image-text` `columns`

## 场景预设（6）

场景是"这一类演讲"的起点：一套主题、画幅、字体栈、惯用页序与行文基调。它让
"做一场学术报告"每次都得到同样的结构与视觉register，而不是模型随机选。

| 场景 | 面向 | 主题 / 画幅 / 字体 |
|---|---|---|
| `tech-talk` | 工程师讲系统、变更、复盘 | metropolis / 16-9 / sans |
| `academic` | 研究报告、seminar、答辩 | university / 4-3 / serif |
| `teaching` | 教学讲解 | simple / 16-9 / sans |
| `product` | 产品与商业汇报 | dewdrop / 16-9 / sans |
| `review` | 进度、阻塞、下一步 | aqua / 16-9 / sans |
| `pitch` | 舞台演讲 | stargazer / 16-9 / sans |

场景只是**起点**：spec 里显式写了的字段优先，场景只补空缺；页序给的是页型而非固定内容，
所以每页说什么仍由模型决定。`deck_build` 传 `scene`，`deck_status` 列出全部场景细节。

## 主题（7，来自 Touying）

`metropolis`（默认，技术分享）`simple`（教学）`university`（学术）
`dewdrop`（产品）`stargazer`（舞台/演示）`aqua`（数据）`default`

## 技术约束（实测结论，不要试图绕过）

- **Typst 锁定 0.15.1**，来自 `@flukxr/typst-cli-*`。官方 `typst` npm 包停在 0.10.0，
  **永远不要用它**：Touying 0.8.0 要求 typst ≥ 0.15.0。
- 二进制使用前做 **SHA-256 校验**（与包内 `typst.binarySha256` 比对，该值与官方 release
  声明一致）；不匹配则拒绝执行。
- **Touying 0.8.0 与 uniwarn 0.1.1 随插件内置**（`vendor/preview/`），通过
  `--package-path` 指向，因此离线可用，且绝不触碰用户的 `%LOCALAPPDATA%\typst`。
- 每次编译 `--root` 限定在会话工作区内的 deck 目录。
- 中文默认字体栈：`New Computer Modern` → `Noto Sans SC` → `Microsoft YaHei` → `SimSun`
  （均随系统，不内置再分发）。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `section` | 必填 | 模式激活时注入的引导文本 |
| `theme` | `metropolis` | 默认主题 |
| `aspectRatio` | `16-9` | 默认画幅 |
| `fontStack` | `sans` | 默认字体栈 |
| `locale` | `zh` | 语言事实（断行、连字符、标点整形），不是显示偏好。英文文稿应设为 `en` |
| `workdir` | `''` | deck 目录（相对会话工作区）；空表示 `deck` |
| `typstBinaryPath` | `''` | 显式 Typst 可执行文件；空则用内置且校验 |
| `typstPath` | `auto` | 用哪个 Typst：`auto` 优先内置、缺失时用 PATH；`system` 优先 PATH（零下载）；`bundled` 只用内置 |
| `timeoutMs` | `180000` | 单次编译期限 |
| `maxOutputBytes` | `67108864` | PDF 体积上限 |
| `maxPages` | `200` | 页数上限 |
| `checkPpi` | `110` | 自审渲染分辨率 |

## 目录结构

```
index.js              模式装配：段落、命令、pre-step 提交、工具注册
lib/host.js           defineTool（含作者 DSL → 原始 schema 编译与校验）/ createUserMessage / 配置校验
lib/mode.js           模式状态：从 `/deck` 命令记录增量推导，narration
lib/render.js         spec -> Typst 源码（唯一的排版生成点）
lib/build.js          构建目录编排、编译、PNG 渲染、pdfpc 导出
lib/engine.js         二进制解析与校验、包路径、诊断解析、页数统计
lib/tools.js          五个模型可见工具
templates/deck.typ    主题装配与页型分发
templates/layout.typ  十四种版式原语
vendor/preview/       内置 Touying 0.8.0 + uniwarn 0.1.1
```

## 为什么没有导入 `@deepseek-ai/*`

从工作区路径（`link:`）装进 profile 的插件，其模块从该路径加载，而宿主自己的模块图
（`dsh-tools`、`schemastery`、`dsh-llm`）在那里不可解析 —— 随发行版解析的包（如
`dshmarket`）才可用。因此本插件需要的这几个辅助函数在 `lib/host.js` 里本地实现，
注册表一律从 `ctx` 获取。`lib/host.js` 只依赖 Node 内置模块。

本地实现不等于可以少做一步：`defineTool` 必须连同 schema 编译一起复刻（见上文硬契约 1），
否则插件在 `node` 里自测全绿、上线后让每个请求被供应商拒绝。`_recon_tools/schema-parity-test.mjs`
就是为此存在的 —— 它把本插件的声明交给宿主真正的 `@deepseek-ai/dsh-tools` 编译，逐字节比对。

## 开发与验证

```bash
# 插件内安装平台二进制（约 50 MB，只装匹配平台）
npm install

# 测试套件（在仓库根目录跑全部）
npm test

# 或单独跑
node packages/dsh-presentation/test/schema-gate.mjs      # 工具 schema 门禁（最重要）
node packages/dsh-presentation/test/assemble-test.mjs    # 模拟 ctx 的装配与模式推导
node packages/dsh-presentation/test/final-sweep.mjs      # 14 种页型端到端
node packages/dsh-presentation/test/handout-test.mjs     # handout 选项确实抵达模板
node packages/dsh-presentation/test/scene-test.mjs       # 场景注册表
node packages/dsh-presentation/test/encoding-audit.mjs   # 编码/BOM/乱码自检
```

测试输出写到 `DSH_PRESENTATION_SCRATCH`（默认包的 `.test-output/`），不会写到检出目录之外。

安装到 profile 后**必须重启应用**才会加载新的 JS 模块代：已安装包的 ESM 模块按 URL 缓存，
`set_plugin` 禁用再启用拿到的仍是旧模块。改插件源码后用
`node scripts/package-plugin.mjs <新包名>` 打包成新身份，再 `install_bundle`。

## Typst: bundled, or the one you already have

```
50.1 MB   bundled platform binary (one per platform, fetched at install time)
```

That download is the largest cost this plugin imposes, so it is avoidable in two
ways.

### Use a Typst you already have

If `typst --version` reports **0.15.0 or newer** on your `PATH`, the plugin can
use it and download nothing:

```yaml
typstPath: system      # prefer PATH; fall back to the bundled binary
```

Three values are accepted:

| `typstPath` | Behaviour |
|---|---|
| `auto` (default) | Prefer the bundled binary; if it is missing, use one from `PATH` |
| `system` | Prefer `PATH`, so nothing is downloaded; fall back to bundled |
| `bundled` | Use only the bundled binary |

An explicitly older Typst is **refused, not tried**: Touying 0.8.0 needs Typst
0.15.0+, and a 0.14 binary would fail deep inside the template with a message
that says nothing about the real cause. The version is read from the binary
(`typst --version`) rather than assumed.

Anything found on `PATH` reports `verified: false` — the SHA-256 check exists to
prove the *bundled* binary is the one its package describes, and cannot attest to
a binary you installed yourself.

### Skip the download entirely

The platform packages are `optionalDependencies`, so a package manager that is
told to skip optional dependencies installs no binary at all:

```bash
npm install --omit=optional     # then set typstPath: system
```

That is also the answer for platforms with no bundled binary — 32-bit systems,
`linux-armv7`, BSD: install Typst 0.15.1+ yourself and put it on `PATH`.

### Why there is no smaller binary

Measured, not assumed. The obvious alternative is WebAssembly:

| Option | Size | Verdict |
|---|---|---|
| bundled native binary | **50.1 MB** | what ships today |
| `typst.ts` 0.7.0 (WASM) | 27.7 MB package, but 78 MB with its dependencies | embeds Typst **0.13.1** — below the 0.15.0 floor |
| `typst.ts` 0.8.0-rc3 | 83.9 MB with dependencies | still a release candidate; larger than native |
| `@blocknote/xl-typst-compiler` | 25.5 MB | **GPL-3.0 or proprietary** — unusable here |

The WASM builds are not platform-trimmed, so they cost more than the one native
binary a platform actually needs, and the stable one is two minor Typst versions
behind what the vendored Touying requires. A smaller download is only possible
with a different compiler, which would mean sacrificing the layout primitives and
CJK typesetting this plugin is built on.

## 平台与语言

## Typst：内置的，或你已经装好的

内置的平台二进制是 **50.1 MB**（按平台各一个，安装时拉取）—— 这是本插件给用户
带来的最大成本，但有两条路可以避开。

**用你已经装好的 Typst**：若 `typst --version` 显示 **0.15.0 或更高**，配置

```yaml
typstPath: system      # 优先用 PATH 里的，不下载；找不到再回退到内置
```

| `typstPath` | 行为 |
|---|---|
| `auto`（默认） | 优先内置；内置缺失时用 PATH 里的 |
| `system` | 优先 PATH，零下载；回退内置 |
| `bundled` | 只用内置 |

**版本太旧的会被拒绝，而不是硬试** —— Touying 0.8.0 要求 Typst 0.15.0+，
0.14 的二进制会在模板深处报一个跟真实原因无关的错。版本由二进制自己
（`typst --version`）报出，不靠猜。

PATH 里找到的二进制标记为 `verified: false`：那个 SHA-256 校验证明的是**内置**
二进制与其包描述一致，无法为你自己装的二进制背书。

**完全跳过下载**：平台包是 `optionalDependencies`，让包管理器跳过可选依赖就不会装：

```bash
npm install --omit=optional     # 然后设 typstPath: system
```

这也解决了没有内置二进制的平台 —— 32 位系统、`linux-armv7`、BSD：
自己装 Typst 0.15.1+ 放进 PATH 即可。

**为什么没有更小的二进制**（实测，非推测）：

| 方案 | 体积 | 结论 |
|---|---|---|
| 内置原生二进制 | **50.1 MB** | 当前方案 |
| `typst.ts` 0.7.0（WASM） | 含依赖 78 MB | 内嵌 Typst **0.13.1**，低于 0.15.0 下限 |
| `typst.ts` 0.8.0-rc3 | 含依赖 83.9 MB | 仍是 RC，且比原生更大 |
| `@blocknote/xl-typst-compiler` | 25.5 MB | **GPL-3.0 或专有** —— 不可用 |

WASM 构建没有按平台裁剪，所以比"每个平台实际只需的那一个原生二进制"更贵；
而稳定版还落后内置 Touying 所要求的 Typst 两个 minor 版本。要更小的下载，
只能换掉编译器 —— 那等于放弃本插件的版式原语与中文排版能力。

**平台覆盖**：内置 Typst 二进制只覆盖 6 个目标 —— `win32-x64` `win32-arm64`
`linux-x64` `linux-arm64` `darwin-x64` `darwin-arm64`。
32 位系统、`linux-armv7`、FreeBSD 等**没有**内置二进制：请自备 Typst 0.15.1+ 并在配置里设置
`typstBinaryPath`（绝对路径）。缺失时报错会直接指名这个键。

**语言**：`locale` 不是显示偏好 —— Typst 由它决定断行、连字符与标点整形。
默认 `zh`（配合默认的 CJK 优先字体栈）。**英文或其它拉丁文稿应显式设 `locale: "en"`**，
否则会套用中文断行规则，表现为间距与引号整形异常。可选值：
{LOCALE_KEYS{'}'}。

**字体**：不内置任何字体，也不改写系统字体。缺失字体只会产生警告并回退（实测：不失败、照样出 PDF）。
默认字体栈为 CJK 优先，纯拉丁文稿用 Typst 自带字体即可编译。要跨机器完全一致，请显式指定
`fontStack` 并在每台机器上装好对应字体。

## 已知限制

- Typst 与 Touying 是**版本锁步**关系；升级任一方都必须重跑回归。
- 单元素集合必须带尾随逗号（`((x: 1),)`）：Typst 会把 `((x: 1))` 解包成字典而不是数组。
  渲染器已统一处理（`lib/render.js` 的 `arr()`）。
- 页型内的富文本仅支持 `**粗体**` 与 `*斜体*`，其余字符一律按字面渲染。
- `code` 页型使用 Typst 内置高亮；`raw(theme:)` 需要 `.tmTheme` 文件路径，无内置主题名。
- **溢出靠目视，不靠自动测量**。`breakable` 保持 Touying 默认的 `true`：装不下的内容
  会流到下一页，绝不裁切。曾实测 `breakable: false` + `detect-overflow` 的自动判据并**否决**：
  Touying 对用 `grid`/`stack` 组合出来的版式一律报 `content height: 0pt`，
  把这些**明显是满的**页判成"未测量"，因此不可信。溢出改由 `deck_check` 渲染页面后目视发现
  —— 这也是本插件视觉自审闭环存在的理由。
- 主题配置的传入方式有陷阱：`..config-common(...)` 装箱后经 `.with()` 传入会**静默失效**。
  正确做法是在 `render-deck` **函数体内**装载主题 show 规则（见 `templates/deck.typ`）。
  渲染器只向生成文件传标量。
- `handout` 选项已正确接到模板（`renderDeckSource({ handout: true })` 会发射 `handout: true`，
  修复前它根本没有抵达模板），但**内置版式不产生子页**（内容一次性显示），
  所以目前讲义版与放映版内容一致；将来若加入显式暂停，该选项立即生效。
- 模式状态由会话日志里的命令事件派生，**工具无法自行开启模式**。
  因此模式未激活时的拒绝信息写明了要请用户执行 `/deck`，以及该模式提供什么能力 ——
  这条信息是模型唯一能拿到的信号，所以它必须可操作，而不只是拒绝。
- 尚无客户端预览面板：自审走 `deck_check` 渲染的 PNG。
- 修改插件后需要**新的包身份**才能生效：ESM 模块按 URL 缓存，原地改已导入的路径不会被
  重新读取（这正是"禁用再启用仍是旧代码"的原因）。用
  `node _recon_tools/package-plugin.mjs <新包名>` 打包后 `install_bundle`。

## 一次真实的故障记录

会话曾完全不可用，报错：

```
Invalid schema for function 'deck_build':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

根因是 `deck_status` 的 `parameters: {}` 编译成了 `type: null`。三点教训：

1. **一个坏 schema 杀死整个会话**，不是杀死一个工具 —— provider 校验工具目录，
   任一不合法就拒绝请求。
2. **报错指向的函数名可能是无辜的**：坏的是 `deck_status`，报出来的是 `deck_build`。
   排查要覆盖全部工具，不能只看被点名的那一个。
3. **测试桩会掩盖真实校验**：早期装配测试自带的 `defineTool` 桩不做校验，
   所以本地全绿、上线即挂。现在 `lib/host.js` 复刻真实编译，并有与宿主逐字节比对的
   一致性测试（`schema-parity-test.mjs`），门禁才真正有效。

