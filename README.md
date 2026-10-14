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
| [`packages/dsh-presentation`](packages/dsh-presentation) | The plugin: a collaboration mode (`/deck`) plus five deck tools. |
| [`packages/dsh-presentation-preset`](packages/dsh-presentation-preset) | An Agent preset that puts a fifth card in **Settings → Agent preset** and in the new-session mode picker. |

These are two different DSH mechanisms, and the distinction matters:

- **Agent preset** — the plugin set an Agent runs on. This is what appears in the
  mode picker alongside standard / PTC / minimal / creative.
- **Collaboration mode** — a toggle inside a session, like `plan`. The plugin's
  `/deck` command is one.

Installing only the plugin gives you `/deck` in every preset. Installing the
preset as well adds the picker entry.

## Install

Two packages. Installing the preset also installs the plugin, because the preset declares it as a dependency:

| Package | What it gives you |
|---|---|
| `@hxql/dsh-presentation` | the plugin: the `/deck` mode and the five deck tools |
| `@hxql/dsh-presentation-preset` | the Agent preset: the card in **Settings → Agent preset** and the mode picker |

Install only the plugin and `/deck` works inside whatever preset you already
use. Add the preset to get the picker entry as well.

### From npm (recommended)

```bash
# the plugin, which is the part that does the work
dsh plugin --profile desktop add @hxql/dsh-presentation

# optional: the Agent preset, for the mode picker
dsh plugin --profile desktop add @hxql/dsh-presentation-preset
```

### From a clone

```bash
git clone https://github.com/hxql666/dsh-presentation
cd dsh-presentation
pnpm install          # links the workspace and fetches the Typst binary
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation"
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation-preset"
```

### Then restart the app

Installed plugins load at startup, and a replaced package needs a fresh module
generation before its new code is used.

### Why not a git URL

A plugin that ships a platform binary does not install reliably from a git URL,
and this was measured rather than assumed:

| Attempt | Result |
|---|---|
| `dsh plugin add <local clone>/packages/dsh-presentation` | works; the binary resolves |
| a packaged tarball of the plugin | works; `verified=true`, a deck builds |
| `npm install github:hxql666/dsh-presentation` | **fails** — npm clones the repository and runs its root `prepare` |
| `npm install <repo archive>.tar.gz` | installs, but **`optionalDependencies` are not fetched**, so there is no Typst binary and every build reports `binary-unavailable` |

If a build ever reports `binary-unavailable`, the platform package did not
install. Fix it either way:

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

### Page layouts

`cover` `section` `agenda` `bullets` `steps` `cards` `kpis` `timeline`
`compare` `quote` `table` `code` `image-text` `columns`

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

## 两个包，两套机制

| 路径 | 是什么 |
|---|---|
| `packages/dsh-presentation` | 插件本体：协作模式（`/deck`）+ 五个 deck 工具 |
| `packages/dsh-presentation-preset` | Agent 预设：让 **设置 → Agent 预设** 与新对话模式选择器里多一张卡片 |

- **Agent 预设** = Agent 手上的插件集合，就是模式选择器里和 标准/PTC/极简/创造 并列的那个
- **协作模式** = 会话内的开关，和 `/plan` 同类，本插件的 `/deck` 属于这一种

只装插件 → 任何预设下都能用 `/deck`；再装预设 → 模式列表里多一个入口。

## 安装

两个包。**装预设会连带装上插件** —— 预设把它声明为依赖：

| 包 | 作用 |
|---|---|
| `@hxql/dsh-presentation` | 插件本体：`/deck` 模式与五个 deck 工具 |
| `@hxql/dsh-presentation-preset` | Agent 预设：**设置 → Agent 预设** 与新对话模式选择器里的卡片 |

只装插件，`/deck` 在你现有预设下就能用；再装预设才多出模式选择器里的入口。

```bash
# 从 npm（推荐）
dsh plugin --profile desktop add @hxql/dsh-presentation
dsh plugin --profile desktop add @hxql/dsh-presentation-preset

# 或从一个克隆
git clone https://github.com/hxql666/dsh-presentation
cd dsh-presentation
pnpm install
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation"
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation-preset"
```

装完**必须重启应用**才会加载新的模块代。

**为什么不能直接用 git URL**：实测过 —— 带平台二进制的插件从 git URL 装不可靠。
`npm install github:...` 会因为 npm 克隆整仓并执行根的 `prepare` 而失败；
装仓库的 archive tarball 则**不会拉取 `optionalDependencies`**，于是没有 Typst 二进制，
每次构建都报 `binary-unavailable`。

若真的遇到 `binary-unavailable`，二选一：

```bash
# 在已安装的包目录里
npm install

# 或在插件配置里指向自备的 Typst 0.15.1+ 二进制
#   typstBinaryPath: /absolute/path/to/typst
```

后者也覆盖没有内置二进制的平台：32 位系统、`linux-armv7`、BSD。

## 使用

```
/deck                    进入演示文档模式
/deck handout            讲义形式
/deck theme:stargazer    指定主题
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
