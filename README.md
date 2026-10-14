# @hxql/dsh-presentation

[![CI](https://github.com/hxql666/dsh-presentation/actions/workflows/ci.yml/badge.svg)](https://github.com/hxql666/dsh-presentation/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@hxql/dsh-presentation?label=npm)](https://www.npmjs.com/package/@hxql/dsh-presentation)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**演示文档模式**：
演示文稿以**结构化页面数据**书写，用 [Typst](https://typst.app) + [Touying](https://github.com/touying-typ/touying)
编译成 PDF，并把页面**渲染回图片，让 agent 亲眼看自己的产出**之后再交付。

[English](README_EN.md) · [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [变更记录](CHANGELOG.md)

---

## 为什么存在

把排版语言直接交给语言模型，每次产出都不一样：字号、边距、栏比在多次生成之间漂移，
第 3 页和第 7 页对留白的处理互相矛盾，而模型**看不见**这一切。十次生成得到十种视觉风格。

本插件把版式从模型手里拿走：

- 模型只发射**结构化页面数据** —— 一个页型 id 加槽位内容，**从不写 Typst**
- **16 种版式原语**掌握全部排版决策
- 编译后页面渲染成 PNG，模型读回来。重叠、裁切、几乎空掉的页面、一行放不下的句子 ——
  全都在别人看到之前就可见、可修

### 成品长什么样

![插件渲染的一页要点页](docs/example-page.png)

同一页换一套主题 —— 主题与页型是**互相独立的选择**：

![同一页换成 dewdrop 主题](docs/example-page-dewdrop.png)

上面是插件自己的输出，不是效果图。它由 `node test/readme-demo.mjs` 用**下面那份 spec**
生成，所以图和文字不会脱节。

### 可复现性到什么程度

实测结论，不是断言 —— `test/determinism-test.mjs`：

| 层次 | 结果 |
|---|---|
| 生成的 Typst 源码 | 同一 spec 逐字节相同 |
| 渲染出的页面 PNG | 同一 spec **逐像素相同** |
| PDF 文件本身 | **不是**逐字节相同 —— 内含 `/CreationDate` 与 `/ModDate`，两次构建相差约 88 字节，除此以外完全一致 |
| 改一页之后 | **页数不变**时，其余每一页逐像素相同 |
| 增删一页之后 | **每一页**都变 —— 页脚有页码计数（`2 / 4` → `2 / 5`） |

所以承诺是**窄而可核对**的：**同一插件版本、同一 Typst 与 Touying 版本、同一字体、同一平台、
页数不变**。改动其中任何一项，页面都可能不同。"无条件可复现"是假话，上表就是用来替代它的。

### 最小可用 deck

这份 deck **刻意用中文写**：上面两张截图就是它的输出，spec 与图必须一致。
`deck_status` 列出的 9 种语言里任何一种都可以。

```jsonc
{
  "title": "从单体到三个服务",
  "subtitle": "一次拆分复盘",
  "author": "示例作者",
  "locale": "zh",          // zh zh-tw en ja ko de fr es ru
  "theme": "metropolis",   // 7 套主题任选；见 deck_status
  "slides": [
    { "layout": "cover" },
    { "layout": "section", "title": "为什么要拆" },
    {
      "layout": "bullets",
      "title": "三个信号",
      "lead": "我们不是在追时髦，是被三件事逼的",
      "items": [
        { "text": "发布互相阻塞", "detail": "一个改动的发布要等另外两个" },
        { "text": "故障域重合", "detail": "一处内存泄漏拖垮整站" },
        { "text": "团队边界模糊", "detail": "没人说得清哪块代码归谁" }
      ],
      "takeaway": "拆分的动机是组织问题，不是技术问题"
    }
  ]
}
```

把这份 spec 交给 `deck_build`。**`deck_status` 才是页型、主题、场景的权威列表**；
下面的表格只是方便查阅，不是事实来源。

## 目录

| 路径 | 是什么 |
|---|---|
| [`packages/dsh-presentation`](packages/dsh-presentation) | 唯一的包。它提供协作模式（`/deck`）与五个 deck 工具，其 bundle patch 声明了 Agent 预设 —— 也就是 **设置 → Agent 预设** 与新会话模式选择器里的那张卡片。 |
| [`CHANGELOG.md`](CHANGELOG.md) | 每个版本改了什么、为什么。每条都写明证据，**包括试过并被否定的做法**。 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 怎么构建、测试、新增页型；什么不会被接受，以及为什么。 |
| [`SECURITY.md`](SECURITY.md) | 威胁模型 —— **模型的输出是不可信输入** —— 什么算漏洞，以及插件已经防住了什么。 |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | 所有被重新分发或安装时获取的第三方件的许可与义务。 |
| [`docs/`](docs/) | 本文中的图片，由 `node test/readme-demo.mjs` 按下面的 spec 生成。 |

这两样东西来自**同一个包**：预设由插件自己的 bundle patch 声明，所以**选那张卡片就是挂载这些
deck 工具**。没有第二个包要装，插件列表里也没有第二条。

**副作用说清楚**：选那张卡片挂载的是**整个插件**；只要插件在 `dsh.profile.bundles` 里，
它的 `/deck` 命令与五个工具就始终可用，与选不选卡片无关。预设让"新会话默认带这套工具"变成一个
可选项，**它不是沙箱**。

## 前置条件

| | |
|---|---|
| **DSH** | 任何具备本包所 patch 的插件机制与 Agent 预设机制的版本。bundle patch 针对 `@deepseek-ai/dsh-agent-preset` 与 `@deepseek-ai/dsh-app-boot`；entry group 结构不同的 DSH 不会应用它。**只对当前工作区里的 DSH 验证过，不声明任何支持版本范围。** |
| **Node** | `>=18`，来自 `package.json` 的 `engines`。 |
| **操作系统** | Windows、Linux、macOS。Typst 编译器以六个平台专属可选依赖发布（`win32-x64/arm64`、`linux-x64/arm64`、`darwin-x64/arm64`）。**开发与验证至今只在 Windows 上做过** —— 另外五个平台已声明、可解析，但本项目**未实测**。 |
| **Typst** | 0.15.1，来自可选依赖，或你自己指定的系统二进制。Touying 0.8.0 要求 0.15.x，大版本不同编译不过。 |
| **Touying** | 0.8.0，**随包 vendored**。构建时不下载任何东西。 |
| **字体** | **不捆绑。** 三个字体栈要求 Typst 机器上已有这些字族：New Computer Modern、Libertinus Serif、Noto Sans/Serif SC、Microsoft YaHei、SimSun。开发机上这些都有；**缺失时 Typst 会静默替换**，所以 deck 可能用与栈要求不同的字面渲染。 |
| **Profile** | 本文一律用 `desktop`，因为那是开发时用的 profile。插件与 profile 无关 —— 换成你自己的名字即可。 |
| **离线** | 可用。编译器与 Touying 都是本地的，构建期间不抓取任何东西。 |

## 安装

```bash
dsh plugin --profile desktop add @hxql/dsh-presentation
```

然后**重启应用**。已安装的插件在启动时加载，而被替换过的包需要新一代模块才会用上新代码。

重启后你从这一个包得到两样东西：

- **设置 → Agent 预设** 与新会话模式选择器里的「**演示模式**」卡片，以及
- 随该预设挂载的 `/deck` 命令与五个 deck 工具。

从克隆安装则指向目录：

```bash
# Linux / macOS
git clone https://github.com/hxql666/dsh-presentation
cd dsh-presentation
npm install          # 拉取本平台的 Typst 二进制
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation"
```

```powershell
# Windows PowerShell —— `$PWD` 的插值方式不同
git clone https://github.com/hxql666/dsh-presentation; cd dsh-presentation
npm install
dsh plugin --profile desktop add "$((Get-Location).Path)\packages\dsh-presentation"
```

绝对路径两种都行：`dsh plugin --profile desktop add /abs/path/to/packages/dsh-presentation`。

### 更新、pin 与卸载

```bash
dsh plugin --profile desktop update @hxql/dsh-presentation
dsh plugin --profile desktop add @hxql/dsh-presentation@0.4.2   # 固定版本
dsh plugin --profile desktop remove @hxql/dsh-presentation
```

每一步之后都要重启。卸载**不会动你的 deck 目录** —— spec、生成的源码与 PDF 都留在原处。

### 把页面图放到你指定的位置

`deck_check` 默认把 PNG 写到 deck 目录下的 `preview/`。传 `outDir` 可以送到别处 ——
归档目录、报告的资源目录：

```jsonc
{ "outDir": "01-talk/pages", "pages": [1, 2, 3] }
```

相对路径相对 deck 目录解析，且必须留在其中。这条限制是刻意的：`outDir` 由模型给出，
属于不可信输入，而 **Typst 的 `--root` 限制的是文档能读什么，不是编译器往哪写** ——
已实测：用编译根之外的输出路径渲染，文件确实写到了外面。因此工具层的包含检查是
deck spec 与任意写之间的**最后一道硬拒绝防线**，它是拒绝而不是警告。

是"最后一道"而非"唯一一道"：这道检查的**第一遍单独并不足够**，下一段记录了原因。
两层，而第二层存在，是因为实测证明第一层可以被绕过。

**这道检查跑两遍**，第二遍是被一次实测逃逸逼出来的。第一遍比较路径字符串，能挡住所有文本形式
—— `..`、`..\`、嵌套穿越、POSIX 与盘符绝对路径、UNC 共享、以及有根无盘符的路径。它**挡不住
deck 目录内部的符号链接或 junction**：名字通过了，文件系统把写送到了别处。**实测结果**：
经这样的链接写入返回 exit 0、文件落在目录树外面；而经它读取会被拒绝。所以第二遍把两个路径都
realpath 后比较真实路径，并向上找到最近的存在祖先，使**尚不存在的目录仍然可用**。
14 种文本向量与链接情形全部断言在 `test/escape-vectors-test.mjs`。

### 渲染会清理什么

渲染会删掉**它自己上一次渲染写出的**页面图，所以一个目录不会混着两次构建的页。
**删什么来自 manifest**（`page.manifest.json`，写在图片旁边），**不是名字模式**。
最初的实现匹配 `page*.png`，比意图更宽 —— 你自己的 `page-numbers.png` 就会中招，
而**不是本插件写的文件就不该由它删**。从未被渲染过的目录没有 manifest，因此里面一个文件都不会动。
断言在 `test/stale-preview-test.mjs`。

### 为什么不能用 git URL

一个携带平台二进制的插件，从 git URL 装并不可靠。实测而非假设：

| 尝试 | 结果 |
|---|---|
| `dsh plugin add <本地克隆>/packages/dsh-presentation` | 可用，二进制能解析 |
| 打包后的 tarball | 可用，`verified=true`，deck 能构建 |
| `npm install github:hxql666/dsh-presentation` | **失败** —— npm 克隆仓库并运行根目录的 `prepare` |
| `npm install <仓库归档>.tar.gz` | 装上了，但**不会抓取 `optionalDependencies`**，于是没有 Typst 二进制，每次构建都报 `binary-unavailable` |

如果构建报 `binary-unavailable`，说明平台包没装上。两种办法修：

```bash
# 在已安装的包目录里
npm install

# 或者让插件指向你已有的 Typst 0.15.1+ 二进制
#   插件配置：typstBinaryPath: /absolute/path/to/typst
```

第二种办法也覆盖没有内置二进制的平台：32 位系统、`linux-armv7`、BSD。

## 使用

```
/deck                    进入演示文档模式
/deck handout            讲义形态（每个逻辑页只出一帧）
/deck theme:stargazer    选主题
/deck scene:academic     设定常驻场景
/deck scene off          清除场景
/deck off                退出
```

然后描述你要的 deck。预期流程是：`deck_status` 拿到可用页型、主题、场景 → 规划页序 →
`deck_build` → `deck_check` 并**真的读那些渲染图** → 修 → 交付。

### 工具

五个工具，**只在模式开启时可用**。模式关闭时每一个都会带解释地拒绝，且**没有一个会写到
deck 目录之外**。

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `deck_status` | — | 模式状态、16 种页型及其键、主题、场景、引擎版本、Typst 二进制哈希是否已校验 | 只读。**先调它** —— 它才是权威列表，本文不是。 |
| `deck_build` | `spec`（必需）、`scene`、`outFile`、`handout` | `ok`、`pdf`、`specFile`、`pages`、`bytes`、`diagnostics`、`warnings`、`overflow` | 幂等：同一 spec 产出同一文档。写出 `build/body.typ`、`build/deck.typ`、`build/layout.typ`、`build/deck-spec.json`。必需槽位为空时**拒绝构建**，那种情况下不编译任何东西。 |
| `deck_check` | `pages`、`ppi`、`outDir` | `ok`、`images`、`outDir`、`density`、`tooDense`、`diagnostics` | 渲染 PNG 供模型读回。`outDir` 必须解析到 deck 目录内，越界是**拒绝而非警告**。只删除它自己上一次渲染记录在 manifest 里的页。 |
| `deck_export` | `what`（`vector` \| `handout` \| `notes`）、`spec`（`handout` 需要） | `ok`、`file`、`bytes`、`pages`、`diagnostics` | `vector` 与 `notes` 编译**已存在的构建产物**，所以不会与审阅过的 deck 产生偏差；`handout` 从其 `spec` 重建。 |
| `deck_scaffold` | `spec`（必需） | `ok`、`specFile`、`typFile` | 只写出生成的 Typst，不编译。用于查看源码。 |

五个工具的错误语义一致：`ok: false` 一定带上 `message`（输入哪里不对）、`stderr`
（编译器说了什么）或 `diagnostics` 三者之一。**没有任何静默失败**，也没有工具会因为用户层面的
错误而抛异常 —— 抛异常意味着调用方式错了，不是 deck 错了。

### 页型（16 种）

`cover` `section` `agenda` `bullets` `steps` `cards` `kpis` `timeline`
`compare` `quote` `table` `code` `image` `image-text` `columns` `sources`

### 每种页面的键（16 种）

写错键名**不会报错** —— 页面照画边框、内容留空。所以 `deck_build` 现在会校验：
缺必需内容**直接拒绝构建**；写了本页不读的键会作为 warning 返回，构建照常完成。

| layout | 键 |
|---|---|
| `cover` | 读 deck 级字段：`title` `subtitle` `author` `institution` `date` |
| `section` | `title` 或 `kicker`（必需其一） |
| `agenda` | `title`, `items[{ text }]` 或字符串数组 |
| `bullets` | `title`, `lead?`, `items[{ text, detail? }]`, `takeaway?` |
| `steps` | 同 `bullets`，渲染为编号步骤 |
| `cards` | `title`, `lead?`, `cards[{ title, eyebrow?, body[], footer? }]`, `perRow?`, `takeaway?` |
| `kpis` | `title`, `lead?`, `items[{ value, label, note? }]`, `takeaway?` |
| `timeline` | `title`, `lead?`, `items[{ when, what? }]`, `takeaway?` |
| `compare` | `title`, `left`, `right`（各为 `{ title?, items[] }`）, `leftTitle?`, `rightTitle?` |
| `quote` | `quote`（必需）, `author?` |
| `table` | `title`, `lead?`, `headers[]`, `rows[][]`, `takeaway?` |
| `code` | `title`, `lead?`, `source`（必需）, `language?`, `takeaway?` |
| `image` | `title`, `image`（必需）, `caption?`, `credit?`, `takeaway?` |
| `image-text` | `title`, `body[]` 或 `image?`, `caption?` |
| `columns` | `title`, `lead?`, `columns[{ title?, items[] }]`, `ratios?` |
| `sources` | `title`, `lead?`, `items[]`（编号参考列表）, `takeaway?` |

每种页型都接受 `notes`，导出为 pdfpc 演讲者备注。

**行内强调**：`**粗体**` 与 `*斜体*` 渲染为真正的粗体与斜体；其余特殊字符一律转义，
写进 deck 的文本无法变成 Typst 语法。`timeline` 的 `label`/`detail` 作为旧拼写仍被接受。

**图片必须放在 deck 目录里**：`image` 与 `image-text` 的 `image` 是相对 deck 目录的路径，
且不能越出该目录 —— Typst 以 deck 目录为 `--root` 编译，越界路径会被拒绝
（`would escape the project root`）。这条限制同时是一道安全边界：一份 deck 无法被用来
读取机器上的其它文件。把图片拷进 deck 目录后按文件名引用即可：

```jsonc
{ "layout": "image", "title": "现场照片", "image": "photo.png",
  "caption": "照片说明", "credit": "来源：某某" }
```

### 场景

场景是某类已知演讲的起点 —— 主题、画幅比例、字体栈、惯用页序，以及幻灯片该用的语域。
它**只填充 spec 没写的东西**，所以显式选择永远优先。

`tech-talk` · `academic` · `teaching` · `product` · `review` · `pitch`

### 主题

七套全部来自 Touying：`metropolis`（默认）`simple` `university` `dewdrop` `stargazer`
`aqua` `default`。

## 发布

发布在 CI 里做，不在笔记本上做。

npm 发布需要交互式两步验证。替代方案要么是每次发布都掏验证器，要么是带 2FA 绕过的
细粒度访问令牌 —— 而 npm 已宣布这类绕过令牌将失去直接发布能力（目标 2027 年 1 月），
指向 trusted publishing。

所以 `.github/workflows/publish.yml` 通过 OIDC 发布：注册表会验证该工作流**确实**在这个
仓库里跑过。不存令牌、没有东西会过期、也不需要从 app 里读码。它先跑整套测试，再打包并检查
tarball 内容，发现不该有的东西就拒绝发布。

从 **Actions → Publish to npm → Run workflow** 运行，勾上 `dry-run` 可只构建校验、不发布。

一次性准备：**包必须先存在**，才能为它注册 trusted publisher，所以首次发布得交互式做一次。
之后在 npmjs.com 上注册 publisher —— 用户 `hxql666`、仓库 `dsh-presentation`、工作流 `publish.yml`。

## 测试

```bash
npm test
```

它先跑类型检查，然后是 schema 门禁、装配测试、能力扫描、语言与系统 Typst 检查、场景测试、
讲义检查，最后是编码审计。先 `npm install`，让本平台的 Typst 二进制就位。

类型检查是 `tsc --checkJs` 扫源码与 JSDoc。**没有构建步骤**：插件直接发布它运行的 JavaScript，
所以 `index.js` 在 tarball 里和栈追踪里都保持可读。这个检查买到的是**契约不能悄悄漂移** ——
给函数加了参数却没写进文档，或读了一个已不存在的属性，在这里就失败，而不是在激活时。

`types/dsh.d.ts` 描述本插件用到的宿主部分。DSH **不附带类型声明** —— 已安装的应用里
`.d.ts` 文件数为零 —— 所以那份文件是照插件自己的调用点手写的。它挡不住对宿主的错误假设，
**那是测试的活**。

测试套件覆盖的是**真正咬过这个项目的失败模式**：

- **一个畸形的工具 schema 会杀掉整个会话**，不是杀掉一个工具 —— provider 会校验整个目录并
  拒绝每一个请求。`test/schema-gate.mjs` 在安装前编译并断言每个工具的 schema。
- **跳过校验的桩件恰好会掩盖这个 bug。** `lib/host.js` 复刻了宿主的「编译 + 校验」管线，
  所以一个会在激活时失败的定义，在测试里就失败。
- **编码损坏在你解析它之前是隐形的。** manifest 里一个多余的 BOM 或乱码就是真实缺陷，
  编码审计同时扫这两样。

### 为什么不做渲染缓存

一个合理的问题是：`deck_check` 为什么不只重渲染改动过的页？**实测** —— `test/perf-measure.mjs`：

| deck 规模 | 构建 | 渲染全部 | 重新渲染全部 | 只渲染 1 页 |
|---|---|---|---|---|
| 5 页 | 590 ms | 605 ms | 468 ms | 561 ms |
| 15 页 | 761 ms | 508 ms | 510 ms | 457 ms |
| 40 页 | 763 ms | 802 ms | 734 ms | 779 ms |

**关键一行是最后两列：只渲染 1 页和渲染全部几乎一样慢。** 耗时来自 Typst 的进程启动与
文档编译，光栅化只占小头。所以"只重渲染改动页"的缓存省不下多少。

而它要付出的代价是**必须能正确判断"源码没变"** —— 判断错了正是 0.2.1 修掉的那个缺陷：
`deck_check` 把旧图留在原处并当成结果报告，于是模型审阅了**当前 deck 里不存在的页**。
用几百毫秒换一个正确性风险，不划算。测量数据放在这里，下一个人不必重跑这个实验。

## 许可

本仓库为 MIT —— 见 [LICENSE](LICENSE)。

被重新分发的第三方代码与那个经过校验的编译器依赖，连同它们的许可与义务，列在
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。



