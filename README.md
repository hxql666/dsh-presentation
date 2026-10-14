# @hxql666/dsh-presentation

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

Two separate packages. Installing the preset alone is the usual choice: it
declares the plugin as a dependency, so the plugin comes with it.

```bash
# Plugin only — gives you /deck inside whatever preset you already use
dsh plugin --profile desktop add @hxql666/dsh-presentation

# Plugin + the picker entry (brings the plugin with it)
dsh plugin --profile desktop add @hxql666/dsh-presentation-preset
```

From a clone, point at the directories instead:

```bash
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation"
dsh plugin --profile desktop add "$PWD/packages/dsh-presentation-preset"
```

Then **restart the app**. Installed plugins load at startup, and a replaced
package needs a fresh module generation.

## Use

```
/deck                    enter presentation-document mode
/deck handout            handout form (one frame per logical slide)
/deck theme:stargazer    pick a theme
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

## Security and privacy

Worth stating plainly, because the plugin runs a native compiler and writes
files:

- **No credentials, ever.** The plugin has no network code, no account access,
  and no telemetry. It cannot reach a model provider or an API of any kind.
- **The compiler is verified before it runs.** The bundled Typst binary is
  SHA-256 checked against the digest its package publishes (itself derived from
  the official Typst release asset); a mismatch is a refusal, not a warning.
- **Compilation is confined.** Every build runs with `--root` set to its own
  build directory inside the session workspace, so a document cannot read or
  write outside it.
- **Your Typst store is left alone.** Packages resolve from the plugin's
  `vendor/` directory via `--package-path`. The global
  `%LOCALAPPDATA%\typst` store is never written.
- **Bounded resources.** Per-compilation timeout, output size cap, and page cap
  are all configurable and enforced.
- **What it does write:** a deck directory (`deck/` under the session workspace
  by default, configurable) containing the spec, the generated Typst source, the
  compiled PDF, and preview PNGs. Nothing else.
- **What it never touches:** `~/.dsh/.credentials.yaml`, session logs belonging
  to other sessions, and anything outside the session workspace.

No API key, account name, password, session transcript, or personal path is
present in this repository — the test suite scans for exactly that (see
`packages/dsh-presentation/test/encoding-audit.mjs` and the checks noted in each
package README).

## Tests

```bash
npm test
```

Runs the schema gate, the assembly test, the capability sweep, the scene tests,
the handout check, and the encoding audit. Install dependencies first
(`npm install`) so a platform Typst binary is present.

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

[English](#@hxql666/dsh-presentation) | 中文

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

```bash
dsh plugin --profile desktop add <包名>
```

装完**必须重启应用**：已安装插件在启动时加载，替换包需要新的模块代。

## 使用

```
/deck                    进入演示文档模式
/deck handout            讲义形式
/deck theme:stargazer    指定主题
/deck off                退出
```

然后直接说需求。预期流程：`deck_status` 查页型/主题/场景 → 排页序 → `deck_build` →
`deck_check` 渲染并**实际读图检视** → 修 → 交付。

## 安全与隐私

- **绝不接触凭据**：插件无任何网络代码、无账号访问、无遥测，无法访问任何模型服务或 API
- **编译器先校验再执行**：内置 Typst 二进制做 SHA-256 比对（与包内声明、官方 release 资产一致），不匹配即拒绝执行
- **编译被限定**：每次构建 `--root` 指向会话工作区内的独立构建目录，文档无法越界读写
- **不动你的 Typst 包库**：包从插件自带的 `vendor/` 经 `--package-path` 解析，绝不写全局 `%LOCALAPPDATA%\typst`
- **资源有界**：编译超时、输出体积上限、页数上限均可配置且强制生效
- **它只写**：deck 目录（默认会话工作区下的 `deck/`，可配置）里的 spec、生成的 Typst 源码、PDF、预览 PNG。仅此而已
- **它绝不碰**：`~/.dsh/.credentials.yaml`、其他会话的日志、会话工作区之外的任何东西

本仓库不含任何 API 密钥、账号名、密码、会话记录或个人路径。

## 测试

```bash
npm test
```

覆盖了这个项目真实踩过的坑：**一个坏的工具 schema 会让整个会话失效**（不是只坏一个工具）、
**跳过校验的测试桩正好会掩盖它**、**编码损坏不到解析失败就看不见**。

## 许可

本仓库 MIT，见 [LICENSE](LICENSE)。内置的第三方代码与编译器依赖的许可与义务见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
