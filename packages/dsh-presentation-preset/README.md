# @hxql666/dsh-presentation-preset

为 DeepSeek Harness 增加第五个 **Agent 预设**：`演示模式`。装好后出现在
**设置 → Agent 预设** 与**新对话的模式选择器**里，和 标准模式 / PTC 模式 / 极简模式 / 创造模式 并列。

## 这两套机制别混

| 机制 | 实例 | 出现在 |
|---|---|---|
| **Agent 预设** | standard / ptc / minimal / cordis | 设置页的预设卡片、新对话模式下拉 |
| **协作模式** | `plan` | 对话里的 `/plan`（模式开关，不是预设） |

本仓库是**预设**；真正的排版能力在 `@hxql666/dsh-presentation`（协作模式插件）里。
换句话说：

- 只装 `@hxql666/dsh-presentation` → 在任何预设下都能用 `/deck`，但模式列表里看不到新选项。
- 再装本 bundle → 模式列表里多一个「演示模式」，进去就是面向演示文稿的能力集。

两者互不依赖对方的顺序，但**预设里的 `presentation` 行指向 `@hxql666/dsh-presentation`**，
所以那个包必须同时作为 profile 依赖存在（`install_bundle` 已保证）。

## 预设内容

在 standard 的基础上改三处：

1. **加入 `@hxql666/dsh-presentation`** —— 这是 deck 工具存在的原因。
2. **去掉 shell 行**（`tool-bash` / `tool-pwsh`）。做演示文稿需要的是工作区，不是终端：
   插件自己解析并运行 Typst 编译器，留一个 shell 只会扩大演示会话需要推理的表面
   （也扩大请求前缀）。
3. **去掉 delegation 组**（subagent / workflow / ralph）—— 同理，deck 在这里写。

其余与 standard 一致：文件读写、搜索、skills、goal、todo、web 研究、`present`、压缩。

插件行的 `config` 里 **`section` 是必填**（插件的硬契约）：它只在演示模式激活时进入请求，
所以放在这里不额外占 token。persona 只留一句身份。

## 安装

```bash
# 本 bundle 依赖 dsh-presentation-v5，pnpm 会一起装
dsh plugin --profile desktop add <preset-package>
```

或用 `plugin_manager` 的 `install_bundle`，target 指向本目录。

装完**刷新页面**（客户端名册是拉取的，不会自己重推）。

## 校验

```bash
node packages/dsh-presentation-preset/test/preset-validate.cjs
```

它检查三件会让预设"变成 broken"而不是"部分可用"的事：

1. **预设行字段**：`id` / `order` / `name` 是否就位。
2. **每个具名插件行能否解析** —— 三个来源依次尝试：profile 的 `node_modules`、
   dsh 安装目录、以及 `app.asar` 的清单（Node 穿不透 asar，但插件加载器可以，
   所以这里查解包出的 asar 头）。判定表里 `dsh-tool-present`、`dsh-plugin-manager/tools`
   正是只能从 asar 满足的两行。
3. **必填的插件 config 是否漏** —— 这一项是踩过的坑：`@hxql666/dsh-presentation` 的
   `section` 曾漏写，那会让**整个预设**挂载失败，而不是只坏一个工具。

另外可用权威来源核对合成结果：

```bash
dsh --profile desktop --dump-config | Select-String 'preset-presentation' -Context 0,12
```

应能看到 `id: presentation`、`name: 演示模式`，以及预设块内联的 presentation 行（含 `section`）。

## 已知限制

- **预设是用户级、按会话生效**：切换预设 = 换一套活动插件面。已有会话保留它启动时的预设，
  所以改完要**新建对话**才生效。
- **用户一旦在 Web 编辑器里保存过这个预设，`config.plugins` 会被整值覆盖**，不会自动合并
  本文件的后续更新。这是注册表的既定语义，不是 bug。
- **预设不是安全沙箱**：YAML 与插件都能执行 Host 代码。
- 改本 bundle 后若宿主仍是旧行为：patch 是 YAML，通常禁用再启用即可重新挂载；
  若改的是**插件包的 JS**，则必须换包身份（ESM 按 URL 缓存）。
