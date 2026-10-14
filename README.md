# @hxql/dsh-presentation

A presentation-document mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
decks are authored as **structured page data**, compiled to PDF with
[Typst](https://typst.app) + [Touying](https://github.com/touying-typ/touying),
and **rendered back to images so the agent can look at its own output** before
delivering.

[中文说明见下](#中文说明)

---

## Why this exists

Handing a layout language to a language model produces a deck that is different
every time: type scale, margins, and column ratios drift between runs, page 3 and
page 7 disagree about whitespace, and the model cannot see any of it. Ten
generations give ten visual styles.

This plugin takes the layout away from the model:

- The model emits **structured page data** — a layout id plus slot content. It
  never writes Typst.
- Fifteen layout primitives own every typesetting decision, so a deck rebuilt
  after an edit keeps its untouched pages identical.
- After compiling, pages render to PNG and the model reads them back. Overlap,
  clipping, a frame that is nearly empty, a line that does not fit — all visible,
  and fixable, before anyone sees the deck.

## Contents

| Path | What it is |
|---|---|
| [`packages/dsh-presentation`](packages/dsh-presentation) | One package. It ships the collaboration mode (`/deck`) and five deck tools, and its bundle patch declares the Agent preset that puts a card in **Settings → Agent preset** and in the new-session mode picker. |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release, and why. Every entry names the evidence behind the change. |

These are two different DSH mechanisms, and the distinction matters:

- **Agent preset** — the plugin set an Agent runs on. This is what appears in the
  mode picker alongside standard / PTC / minimal / creative.
- **Collaboration mode** — a toggle inside a session, like `plan`. The plugin's
  `/deck` command is one.

Both arrive from the one package: the preset is declared by the plugin's own
bundle patch, so selecting the card is what mounts the deck tools. There is no
second package to install and no second entry in the plugin list.

## Install

```bash
dsh plugin --profile desktop add @hxql/dsh-presentation
```

Then **restart the app**. Installed plugins load at startup, and a replaced
package needs a fresh module generation before its new code is used.

After the restart you get two things from that one package:

- a **演示模式** card in **Settings → Agent preset** and in the new-session mode
  picker, and
- the `/deck` command and five deck tools, which mount with that preset.

From a clone, point at the directory instead:

```bash
git clone https://github.com/hxql666/dsh-presentation
cd dsh-presentation
npm install          # fetches the Typst binary for this platform
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation"
```

### Putting the page images where you want them

`deck_check` writes its PNGs to `preview/` under the deck directory by default.
Pass `outDir` to send them somewhere else — an archive folder, a report's asset
directory:

```jsonc
{ "outDir": "01-talk/pages", "pages": [1, 2, 3] }
```

A relative path resolves against the deck directory, and the directory must stay
inside it. That restriction is deliberate: `outDir` is model-supplied, and
**Typst's `--root` confines what a document may read, not where the compiler
writes**. Verified by rendering with a pattern outside the compile root: the files
are written outside it. The containment check in the tool layer is therefore the
only thing standing between a deck spec and an arbitrary write, so it is a refusal
rather than a warning.

Rendering also clears the PNGs already matching the output pattern, so a directory
never mixes pages from two builds.

### Why not a git URL

A plugin that ships a platform binary does not install reliably from a git URL,
measured rather than assumed:

| Attempt | Result |
|---|---|
| `dsh plugin add <local clone>/packages/dsh-presentation` | works; the binary resolves |
| a packaged tarball | works; `verified=true`, a deck builds |
| `npm install github:hxql666/dsh-presentation` | **fails** — npm clones the repository and runs its root `prepare` |
| `npm install <repo archive>.tar.gz` | installs, but **`optionalDependencies` are not fetched**, so there is no Typst binary and every build reports `binary-unavailable` |

If a build reports `binary-unavailable`, the platform package did not install.
Fix it either way:

```bash
# inside the installed package directory
npm install

# or point the plugin at a Typst 0.15.1+ binary you already have
#   plugin config:  typstBinaryPath: /absolute/path/to/typst
```

The second option also covers platforms with no bundled binary: 32-bit systems,
`linux-armv7`, and BSD.

## Use

```
/deck                    enter presentation-document mode
/deck handout            handout form (one frame per logical slide)
/deck theme:stargazer    pick a theme
/deck scene:academic     set a standing scene default
/deck scene off          clear it
/deck off                leave
```

Then describe the deck. The intended flow is: `deck_status` for the available
layouts, themes and scenes → plan the page sequence → `deck_build` → `deck_check`
and actually read the rendered images → fix → deliver.

### Tools

| Tool | Purpose |
|---|---|
| `deck_status` | Mode state, page layouts and their slots, themes, scenes, engine version. |
| `deck_build` | Structured spec → PDF. Returns page count and structured diagnostics. |
| `deck_check` | Renders pages to PNG so the model can inspect the layout. |
| `deck_export` | `handout` print form / `notes` `.pdfpc` speaker-note sidecar. |
| `deck_scaffold` | Writes the generated Typst source without compiling. |

### Page layouts (16)

`cover` `section` `agenda` `bullets` `steps` `cards` `kpis` `timeline`
`compare` `quote` `table` `code` `image` `image-text` `columns` `sources`

### 每种页面的键（16 种）

写错键名**不会报错** —— 页面会照画边框、内容留空。所以 `deck_build` 现在会校验：
缺必需内容会**直接拒绝构建**；写了本页不读的键会作为 warning 返回，构建照常完成。

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

每页都可写 `notes`（导出为 pdfpc 演讲者备注）。

**行内强调**：`**粗体**` 与 `*斜体*` 渲染为真正的粗体与斜体；其余特殊字符一律转义，
写进 deck 的文本无法变成 Typst 语法。`timeline` 的 `label`/`detail` 作为旧拼写仍被接受。

**图片必须放在 deck 目录里**：`image` 与 `image-text` 的 `image` 是相对 deck 目录的路径，且不能越出该目录 —— Typst 以 deck 目录为 `--root` 编译，越界路径会被拒绝（`would escape the project root`）。这条限制同时是一道安全边界：一份 deck 无法被用来读取机器上的其它文件。把图片拷进 deck 目录后按文件名引用即可：

```jsonc
{ "layout": "image", "title": "现场照片", "image": "photo.png",
  "caption": "照片说明", "credit": "来源：某某" }
```

### Scenes

A scene is a starting point for a known kind of talk — theme, frame ratio, font
stack, a usual page order, and the register the slides should read in. It only
fills in what the spec leaves unset, so an explicit choice always wins.

`tech-talk` · `academic` · `teaching` · `product` · `review` · `pitch`

### Themes

All seven come from Touying: `metropolis` (default) `simple` `university`
`dewdrop` `stargazer` `aqua` `default`.

## Releasing

Publishing happens in CI, not from a laptop.

npm requires an interactive two-factor challenge to publish. The alternatives
are an authenticator app on every release or a granular access token with 2FA
bypass — and npm has announced that those bypass tokens lose direct publish,
targeted January 2027, in favour of trusted publishing.

So `.github/workflows/publish.yml` publishes both packages over OIDC: the
registry verifies that the workflow really ran in this repository. No token is
stored, nothing expires, and no code has to be read out of an app. It runs the
whole suite first, then packs both packages and refuses to publish if a tarball
contains anything it should not.

Run it from **Actions → Publish to npm → Run workflow**, with `dry-run` ticked
to build and verify without publishing.

One-time setup: each package must exist before a trusted publisher can be
registered for it, so a first release has to be done interactively. After that,
register the publisher on npmjs.com for both packages — user `hxql666`,
repository `dsh-presentation`, workflow `publish.yml`.

## Tests

```bash
npm test
```

Runs a type check, then the schema gate, the assembly test, the capability
sweep, the locale and system-Typst checks, the scene tests, the handout check,
and the encoding audit. Install dependencies first (`npm install`) so a platform
Typst binary is present.

The type check is `tsc --checkJs` over the source and its JSDoc. There is no
build step: the plugin ships the JavaScript it runs, so `index.js` stays
readable in the tarball and in a stack trace. What the check buys is that a
contract cannot silently drift from the code — a parameter added to a function
but not to its documentation, or a property read that no longer exists, fails
here rather than at activation.

`types/dsh.d.ts` describes the parts of the host this plugin uses. DSH ships no
type declarations — the installed application contains zero `.d.ts` files — so
that file is written by hand from the plugin's own call sites. It cannot catch
a wrong assumption about the host; the tests are what do that.

The suite covers the failure modes that actually bit this project:

- **A malformed tool schema kills the whole session**, not one tool — the
  provider validates the catalog and rejects every request. `test/schema-gate.mjs`
  compiles and asserts every tool's schemas before installation.
- **A stub that skips validation hides exactly that bug.** `lib/host.js` reproduces
  the host's compile-and-validate pipeline so a definition that would fail at
  activation fails in the test instead.
- **Encoding damage is invisible until it breaks parsing.** A stray BOM or
  mojibake in a manifest is a real defect; the encoding audit sweeps for both.

### 关于渲染缓存：实测后决定不做

有人会问为什么 `deck_check` 每次都重新渲染所有页面。本鲸测过（`test/perf-measure.mjs`）：

| deck 规模 | 构建 | 渲染全部 | 重新渲染全部 | 只渲染 1 页 |
|---|---|---|---|---|
| 5 页 | 590 ms | 605 ms | 468 ms | 561 ms |
| 15 页 | 761 ms | 508 ms | 510 ms | 457 ms |
| 40 页 | 763 ms | 802 ms | 734 ms | 779 ms |

**关键一行是最后两列：只渲染 1 页和渲染全部几乎一样慢。** 耗时由 Typst 的进程启动与文档编译主导，光栅化只占小头，所以"只重渲染改动页"的缓存省不下多少。

而缓存要付出的代价是：它必须正确判断"源码没变"，而 0.2.1 修掉的正是这个 ——
`deck_check` 留下旧图并当成结果，模型据此审阅了**当前 deck 里不存在的页**。
用一点点速度换回一个假阴性风险，不划算。

## Requirements

- DeepSeek Harness (the plugin targets the `@deepseek-ai/cordis` 4.x plugin API)
- Node.js 18+
- A platform Typst binary, installed as an optional dependency at install time

## License

MIT for this repository — see [LICENSE](LICENSE).

Redistributed third-party code and the verified compiler dependency are listed
with their licenses and obligations in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

# 中文说明

[English](#hxqldsh-presentation) | 中文

## 这是什么

DeepSeek Harness（DSH）的**演示文档模式**：演示文稿以**结构化页面数据**书写，用
Typst + Touying 编译成 PDF，并把页面**渲染回图片让 agent 亲眼看自己的产出**后再交付。

## 为什么这样做

把排版语言直接交给模型，产出一定不可复现：字号、边距、栏比每次都不一样，第 3 页和第 7 页
的留白规则互相矛盾，而且模型看不见自己的产物。十次生成会得到十种风格。

本插件把版式从模型手里拿走：

- 模型只产**结构化页面数据**（页型 + 槽位内容），从不写 Typst
- 十五种版式原语掌握全部排版决策，所以改一页重建后，没动过的页保持像素一致
- 编译后渲染成 PNG 让模型回读：重叠、裁切、空得发慌的页面、装不下的句子 —— 都在别人看到之前发现并修掉

## 一个包，两样东西

**一个包就够了。** 它同时提供：

| 你会看到 | 是什么 |
|---|---|
| 插件列表里的 **1 项** | 插件本体（`/deck` 模式 + 五个 deck 工具） |
| 模式选择器里的 **1 张卡片**「演示模式」 | Agent 预设 —— 由插件自己的 bundle patch 声明 |

- **Agent 预设** = Agent 手上的插件集合，就是模式选择器里和 标准/PTC/极简/创造 并列的那个
- **协作模式** = 会话内的开关，和 `/plan` 同类，本插件的 `/deck` 属于这一种

预设声明就在插件的 `cordis.patch.yml` 里，所以**选那张卡片就是挂载这个插件**。
没有第二个包要装，也没有第二条插件条目。

## 安装

```bash
dsh plugin --profile desktop add @hxql/dsh-presentation
```

装完**必须重启应用**才会加载新的模块代。

重启后你会从这一个包得到两样东西：**设置 → Agent 预设** 与新对话模式选择器里的
「演示模式」卡片，以及随之挂载的 `/deck` 命令与五个 deck 工具。

从克隆安装：

```bash
git clone https://github.com/hxql666/dsh-presentation
cd dsh-presentation
npm install
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation"
```

### 把页面图放到你指定的位置

`deck_check` 默认把 PNG 写到 deck 目录下的 `preview/`。传 `outDir` 可以改到别处 —— 归档目录、报告的资源目录：

```jsonc
{ "outDir": "01-talk/pages", "pages": [1, 2, 3] }
```

相对路径相对 deck 目录解析，且**必须留在 deck 目录内**。这条限制是刻意的：`outDir` 来自模型输出，而 **Typst 的 `--root` 只限制文档能读什么，不限制编译器往哪写** —— 实测过，用 root 之外的输出路径，文件确实写到了外面。所以工具层这道包含检查是 deck spec 与任意写之间的**唯一防线**，它是硬拒绝而不是警告。

渲染还会清掉与输出模式匹配的旧 PNG，所以一个目录里不会混着两次构建的页。

## 使用

```
/deck                    进入演示文档模式
/deck handout            讲义形式
/deck theme:stargazer    指定主题
/deck scene:academic     设置常驻场景
/deck scene off          清除
/deck off                退出
```

然后直接说需求。预期流程：`deck_status` 查页型/主题/场景 → 排页序 → `deck_build` →
`deck_check` 渲染并**实际读图检视** → 修 → 交付。

## 测试

```bash
npm test
```

覆盖了这个项目真实踩过的坑：**一个坏的工具 schema 会让整个会话失效**（不是只坏一个工具）、
**跳过校验的测试桩正好会掩盖它**、**编码损坏不到解析失败就看不见**。

## 许可

本仓库 MIT，见 [LICENSE](LICENSE)。内置的第三方代码与编译器依赖的许可与义务见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
