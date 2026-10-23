# 变更记录

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)：页型与配置的增删属于次版本，
缺陷修复与文案属于修订版本。

---

## 0.5.5

### 修复（**沙箱下产物写不出来，每一轮都是 os error 5**）

现场报错，6 次尝试、换过 5 个输出位置（含桌面与系统临时目录）全部相同：

```
error: failed to write PDF file (拒绝访问。 (os error 5))
```

**中间文件正常生成、只有最后的 PDF 被拒** —— 这条线索指向根因：中间文件是**插件自己
（宿主进程）**写的，PDF 是 **Typst 子进程**写的。同目录、两种权限。

测出来的机制（读 DSH 的 `@deepseek-ai/dsh-sandbox-windows-acl` 源码 + 现场 ACL）：

- Windows 沙箱让子进程运行在 **`WRITE_RESTRICTED` 受限 token** 下，其写能力来自工作区上
  一条**能力 SID 授权**（`S-1-4-*`）；
- 该工作区上这条授权**一条都没有**（`icacls` 实测 0 次；对照另一个曾被沙箱工作过的工作目录，
  那里有 1 条）；
- **系统临时目录也没有**，所以连 `%TEMP%` 都写不了；
- 宿主进程用主人自己的 token，所以同一目录照常能写。

结论：这不是我们算错路径，是**宿主没给这个目录铺授权**。本插件既无法验证、也无法补建它。

### 改法

**不再要求子进程写产物，改为宿主写盘**（Typst 支持用 `-` 把输出送到 stdout）：

| | 改法 | 实测代价 |
|---|---|---|
| PDF（`buildDeckPdf` / `compileDocumentPdf`） | 一律 `-` 走 stdout，由宿主 `writeFileSync` | **零**：292 ms vs 写文件 306 ms，**字节一致** |
| 页面 PNG（`renderDeckPages`） | 仍优先单次调用出全部页；**仅在检测到写被拒时**回退逐页 stdout | 快路径 8 页 312 ms；回退逐页 2459 ms（7.9×），只在坏环境下付 |

被拒的识别用**错误码**而非文案（`os error 5` / `Permission denied`），因为括号里的原因是
系统语言本地化的 —— 这台机器上就是中文。

`compileDocumentPdf` 顺手简化：原来靠「写 `.partial.pdf` 再改名」保证的全有或全无，
现在天然成立（失败就没有字节，目标文件不被触碰）。

### 新增测试 `test/write-path-test.mjs`（28 个套件）

沙箱拒绝写入这个环境在 CI 里造不出来，所以把这条路径做成**可断言的事实**而不是注释：

- 断言构建结果里的 argv **末位是 `-`、且不含任何 `.pdf` 输出路径** —— 子进程从不被要求写；
- 断言宿主捕获的 PDF 就是编译器自己的输出（长度一致、差异仅限于时间戳字符串）；
- 用 `stdoutOnly` 测试开关强制走回退，**逐页比对两条路径的 PNG 是否逐字节相同**
  （预览与被交付的页面不一致，比没有预览更糟）；
- 断言 `os error 5` / `Permission denied` 被识别，而普通编译错误**不**触发回退。

写这套测试时本鲸自己踩了一次：先用「两份 PDF 逐字节相等」断言，结果**只有落在同一秒才过** ——
Typst 会写创建时间戳。改成与 `determinism-test` 一致的「差异仅限于时间戳」判据。

### 文档

- README 中英双语新增「产物由谁写盘」，写明机制、代价与实测数字；
- 包内 README 的「与宿主的硬契约」由三条变**四条**，第四条就是「不要让 Typst 子进程写产物」。

---

## 0.5.4

### 修复（**CI 从加入起就一直红**）

Windows 通过，Ubuntu 与 macOS 在测试步骤失败。`npm test` 用 `&&` 串联套件，日志只说明
"链条失败"，而 job 日志需要认证才能下载 —— 所以**第一个修的是 CI 本身**。

三处断言是在 Windows 上写完就当成通用规则：

- **硬编码的编译器路径**。`escape-vectors-test` 与 `font-stack-test` 把 Typst 路径写成
  `node_modules/@flukxr/typst-cli-win32-x64/vendor/typst.exe`，三个 runner 里只有一个存在。
  两者改为通过 `resolveBinary()` 解析 —— 和插件自己用的是同一个函数。
- **`.cmd` 假可执行文件**。`system-typst-test` 把假 `typst` 写成 Windows `.cmd` shim。
  Windows 靠 `PATHEXT` 能找到；POSIX 只执行名字恰好为 `typst` 且带可执行位的文件，
  于是假文件等于不存在，所有 fallback 断言失败。现在 POSIX 下写 `#!/bin/sh` 脚本并 `chmod 0755`。
- **Windows 形状的路径与 Windows 才有的字体**。`escape-vectors-test` 断言
  `C:\Windows\Temp`、UNC 共享会被拒绝 —— 在 Windows 成立（它们是逃逸），在 POSIX 不成立
  （它们只是 deck 目录里的普通文件名）。每条用例现在标注适用平台，其余记录。
  `font-stack-test` 断言三个字体栈渲染必然不同；**没有那些字族的机器上 Typst 会替换字体，
  两个栈可以合法地渲染成一样**，所以像素比对只在解析出的字族真的不同时才做。

只属于一台机器的测量值（密度阈值、像素差）改为**记录**而不是当作别的平台必须满足的规则。
`density-test` 改为比较"塞爆页 vs 正常页"这个真正要成立的性质，而不是拿本机字体标定出的数字。

### CI

- `ci.yml` 改成**每个套件一个步骤**，失败时发 `::error` 注解写明套件名与平台，并写进
  job summary。下一次失败可以直接从 checks API 读出是哪个套件，不用下载日志。

- **CI 脚本自身两个坑**，都是靠注解定位的：
  - `shell: bash` 在 GitHub 上默认带 `-e -o pipefail`，而 `detail=$(grep … | head …)`
    在 grep 无匹配时返回 1 → 整步中止 → **连注解都没发出去**。现在显式 `set +e` /
    `set +o pipefail`，并给管道加 `|| true`。
  - macOS 自带 bash 3.2，**没有 `mapfile`**，作业在一行套件都没跑时以 exit 127 结束。
    改为对字符串 `for` 循环。

- **Linux runner 没有中日韩字体**，让两个套件在 Ubuntu 上失败而 macOS/Windows 通过：
  `determinism-test` 看到"改了一页却没有变化"，`visual-title-test` 看到"有标题和无标题
  渲染相同"。原因是 Typst 自带字体（New Computer Modern、Libertinus）不含 CJK，
  中文渲染为空，两页自然一致。CI 现在在 Linux 装 `fonts-noto-cjk`，
  `CONTRIBUTING.md` 也写明测试需要一个 CJK 字体（本包不分发字体）。

### 清理

- 删掉 `test/` 下 11 个一次性调查脚本（从未进套件、多个硬编码了本机绝对路径、
  文档无引用）。现在 `test/` 里是套件 + 两个有文档引用的生成器（`readme-demo`、`perf-measure`）
  + 两个标定工具（`colour-calibrate`、`density-calibrate`）。

- `CONTRIBUTING.md` 加了这一轮换来的规则：**测试不得把某一个平台的行为当成通用断言**，
  并列出三种具体踩法。

---

## 0.5.3

### 修复（**升级 DSH 后演示模式完全不可用**）

- **persona 行的 `suffix` 引用了宿主不存在的 prompt 变量 `{{cwd}}`**，导致每一轮在装配
  system prompt 时抛错：

  ```
  unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
  registered variables: provider, model
  ```

  **DSH 0.2.1-rc.2 只注册了 `provider` 与 `model` 两个变量**（源码依据：
  `@deepseek-ai/dsh-agent-loop` 里只有 `variable("provider")` 与 `variable("model")`）。
  我们写的是 `Your working directory is {{cwd}}.`。

  症状具有欺骗性：**预设正常挂载、会话能建、卡片能选**，然后**每一轮都报"本轮运行失败"**。
  工作目录在新版里由 runtime context 提供（`CONTEXT_ORDERS.WORKING_DIRECTORY`），
  不是一个 prompt 变量，所以那句直接去掉，`prefix` 里的 `{{model}}` 保留（合法）。

### 为什么以前的检查没抓到

这个缺陷**任何 schema 校验都发现不了**：`suffix` 是合法的字符串，config 键也对。
错的是**模板内容**，而模板只在宿主装配 prompt 时才求值。

本版本新增 `test/prompt-variables-test.mjs`：扫描 bundle patch 里每一个 `{{...}}`，
断言其名字在宿主注册表内（`provider`、`model`），并检查 `{{` 都有闭合。
宿主注册表在构建时读不到（在应用内部），所以清单写死在测试里 —— **这是刻意的**：
宿主变量集变了，测试就该失败，那时才该决定 patch 是否跟进。

已用仍在使用的旧 bundle 反向验证过这个测试确实会失败（v18 被判 `cwd` 非法）。

### 排查过程中排除的方向（记录以免重走）

- 插件代码本身：5 个工具注册、deck 能构建、Typst 0.15.1 哈希校验通过 —— 正常
- 预设条目：`include:preset-presentation` `fiberPhase: active` —— 正常挂载
- patch 语法：`insert` / `group: true` / `isolate` 对照本版本技能文档 —— 未变
- 每个 row 的 config 键：与新版插件 schema 全部匹配（含 `plan-mode` 仍必填 `section`）
- `apply` 用到的宿主 API：`systemPrompt.section` / `getSectionOrder('PLAN_POLICY')`（仍=500）/
  `commands.register` / `agent/pre-step` —— 全在
- 是否有别的 bundle 覆盖本预设 —— 没有

也记录一处 CLI 误导：本机全局 `dsh` 是 **0.1.0-rc.7**，而桌面应用是 **0.2.1-rc.2**，
所以 `dsh --dump-config` 报"无法解析 `@deepseek-ai/dsh-experimental-auto-review`"是
**版本不匹配**，不是应用的病因。

---

## 0.5.2

### 修复

- **README 里一处错误的 DSH 兼容性声明**。原文写"bundle patch 针对
  `@deepseek-ai/dsh-agent-preset` 与 `@deepseek-ai/dsh-app-boot`"。实测：
  `dsh-app-boot` 在 `cordis.patch.yml` 里出现 **0 次**，`dsh-agent-preset` 出现 **2 次**。

  **`dsh-app-boot` 是 DSH 真实存在的包**（在 `app.asar` 里出现 87 次），所以这个说法
  *看着很合理* —— 这正是它长期没被发现的原因：从来没有任何东西验证过它。
  现在改为"**只针对一个包**：`@deepseek-ai/dsh-agent-preset`"，并解释为什么
  （它是 entry group，所以 bundle patch 能向它插入一行）。

- **仓库根的 `npm test` 只跑 9 个套件**，而包内跑 26 个。从仓库根测试会**静默跳过**
  0.5.0 之后新增的全部套件（`escape-vectors`、`determinism`、`readme-parity`…）。
  根脚本现在委托给包，两条入口一致。

- 仓库根 `package.json` 的描述仍在说 "and its Agent preset" —— 预设从 0.2.0 起就在
  插件自己的 patch 里，不再是一个独立包。

### 元数据

- **npm keywords 与仓库的 7 个 GitHub topic 对齐**（`deepseek-harness`、`dsh-plugin`、
  `dsh`、`cordis`、`typst`、`touying`、`pdf-generation`）。此前 keywords 缺
  `deepseek-harness` 与 `cordis`，而这两个正是生态里更常用的写法；`pdf` 太泛，去掉。
  额外只保留一个 `typst-package` —— Typst 用户在 npm 上会搜它，而本包 vendored 并
  再分发了两个 Typst 包。

- **新增 `test/topics-metadata-test.mjs`**：断言每个 topic 在 keywords 里都有对应、
  多余的词有理由、以及每个 topic 都能在代码里找到依据。GitHub topic 无法在构建时读取，
  所以清单在测试里重复一遍 —— **那正是用意**：期望值变化时测试会失败，而那正是该决定
  元数据是否跟进的时刻。

### 本鲸的两次判断失误（记录在案）

- 曾把这个项目判定为"不符合 `touying` 协议"。**错的。** 依据是搜索结果第一页的 12 条，
  而总数是 26 条；全查后发现其中 6 个不是主题/模板，包括一个几乎同类的仓库
  `statzhero/typst-touying-skill`（★1，给 LLM 用的 Touying 演示技能）。
  本插件的 7 套主题**全部 import 自 Touying 的内置主题**，整个演示层由 Touying 实现，
  符合度没有问题。
- 用来验证 topic 的检查脚本硬编码了 `dsh-app-boot` 这个字符串，于是误报
  `deepseek-harness` 不受支持。判据已改为"patch 里命名的所有包是否都是 `@deepseek-ai/*`"。

---

## 0.5.1

### 变更

- **README 拆成两份**：`README.md` 为**简体中文且是默认**（npm 与仓库首页显示的就是它），
  `README_EN.md` 为英文。此前是一份双语文件 —— 英文正文后面接一段中文**摘要**
  （105 非空行 vs 317 行），中文读者只拿到简介、一张键表和少量内容，而且两半可以悄悄漂移。

  现在的两份是**同一份文档**：22 个标题、10 个代码块、7 张表、5 张图、以及文中引用的每一个
  度量值两边都有。示例 deck 的 spec 在两边都保持中文 —— 那两张截图就是它的输出，
  英文版里明确写了这一点，所以读者知道那里的中文是**示例**而不是漏译。

- **新增 `test/readme-parity-test.mjs`**：比对两份文档的标题层级与顺序、表格行数、代码块、
  链接、图片顺序，以及文中引用的每个数字（`590 ms`、`88 bytes`、`14 种`…）。
  代码块在剥离注释后比对 —— 注释是散文会被翻译，代码不会。给一边加段落而另一边不加，
  这个测试就会失败。

### 修复

- **英文 README 里一处过度声明**。它仍把 `outDir` 包含检查称为
  "the only thing standing between a deck spec and an arbitrary write" ——
  这与**下一段自相矛盾**（那里记录了第一遍检查会被符号链接绕过），而 0.5.0 已经决定
  这个说法太强。改为 "the last hard refusal"，并让两份文档都补上那句说明：
  **两层防线，第二层存在正是因为实测证明第一层不足**。

  这处是靠**把本会话的翻译与另一份独立翻译对比**发现的：两份译法恰好在这一点上不一致，
  而错的是英文原文。

### 其它

- `package.json` 的两份 README 都随包发布；`CONTRIBUTING.md` 说明有两份文档、
  给一份加段落必须同时给另一份加。
- 删掉了指向 0.2.0 已合并掉那个包的悬空 `node_modules` junction —— 它会让 Windows 上
  任何递归读取目录树的命令报错。

---

## 0.5.0

### 安全（本次唯一的真漏洞）

- **deck 目录内的符号链接可以绕过 `outDir` 的包含检查**。原检查只比较路径字符串：
  `linked` 这个名字在 deck 目录内，所以通过；而写入落到了链接指向的地方。
  **实测而非推理** —— exit 0、文件落在目录树外面、零诊断。读取方向被 Typst 的 `--root` 挡住，
  写入方向没有，所以工具层必须是那道边界。

  现在检查跑两遍：字符串一遍，再把两个路径都 realpath 后比较真实路径一遍；
  目标目录尚不存在时会向上找到最近的存在祖先再拼接，所以**合法的"新建目录"仍然可用**。
  `test/escape-vectors-test.mjs` 断言 14 种文本向量、链接情形，以及"新目录仍被允许"。

- **清理用的是名字模式，比意图更宽**。原来匹配 `page*.png`，于是用户自己放在输出目录里的
  `page-numbers.png` 会被删掉 —— 那个文件不是本插件写的。现在按**上次渲染的 manifest** 删除；
  从未渲染过的目录没有 manifest，因此里面一个文件都不会动。

### 修复

- **发布工作流还在发布一个已经不存在的包**。它 pack 并 publish
  `@hxql/dsh-presentation-preset`，而该包在 0.2.0 已合并进本包。任何人触发发布都会在第二步失败。
  现在一包、一 pack、一 publish，并加了"包内不得含构建产物"的检查。
- **许可证全文没有随包发布**。tarball 里有 vendored 依赖的 MIT 全文，但没有本项目自己的
  `LICENSE`，也没有 `THIRD-PARTY-NOTICES.md` —— 从 npm 安装的人只能看到一个属于 Touying 的
  MIT 文件，**看不到编译器依赖是 Apache-2.0、字体不重新分发、以及 deck 期望哪些字族**。
  两份文件现在都随包发布，并有测试比对副本与原文件防止漂移。

### 文档与项目规范

以下都来自一份针对 README 的外部评审，其中**两条不成立、未采纳**（README 写的是 16 种页型
而非 15 种；`THIRD-PARTY-NOTICES.md` 本就已涵盖 Apache-2.0 编译器、字体许可与哈希校验）。

- **前置条件与兼容矩阵**，明确写出"已验证"与"未验证"：本插件**只在 Windows 上开发与验证**，
  另外 5 个平台的二进制已声明但本项目未实测。
- **更新 / pin / 卸载**，以及跨平台的 clone 安装 —— `"$PWD/..."` 不可移植，Windows 写法单独给出。
- **术语表**：Agent 预设 / 协作模式 / 插件是三个不同机制。并写明选那张卡片的副作用 ——
  它挂载的是整个插件，工具在列表里就一直可用，**预设不是沙箱**。
- **五个工具的参数、返回与错误语义**，此前只提了三个名字。
- **最小 deck spec 与两张渲染图**，由 `test/readme-demo.mjs` 用 README 里那份 spec 生成，
  所以图和文字不会脱节。
- **"可复现性到什么程度"实测表**，替换掉无限定的"像素一致"断言。实测：源码与页面图可复现；
  PDF 因 `/CreationDate`、`/ModDate` 相差约 88 字节 —— 所以"它们不同"这个断言是**依赖时钟的**，
  已改成时钟影响不到的断言。改一页时其余页像素一致**仅在页数不变时**成立；
  追加一页会让所有页都变，因为页脚有页码计数。
- **措辞收紧**："产出一定不可复现" → "不加版式约束时通常不可复现"；
  "唯一防线" → "当前实现中最后一道硬拒绝防线"，并列出两道。
- **CI（三平台）** 跑测试套件，另有打包检查作业。新增 `CONTRIBUTING.md`、`SECURITY.md`、
  `CODE_OF_CONDUCT.md`，其中 SECURITY 是威胁模型的首次书面化。

---

## 0.4.3

### 验证

- **字体栈确认生效**。此前的检查只证明了 `fontStack` 的值抵达生成源码，而"值到了源码"
  不等于"页面看起来不同" —— 测试 agent 报告"看不出场景差异"这条一直没结论。
  现在从**渲染结果**下了结论：三个字体栈产出不同的字节数、不同的墨迹占比、不同的字体列表，
  各自在生成源码里署名，未指定时解析为模板默认值，且三个栈声明的所有字族**都真实已安装**。
  模板一行没改 —— 这条从来不是坏的，只是**没被证明**。

### 记录

- **不做渲染缓存，这是决定而不是遗漏**。审阅会重渲染所有页，直觉上应该只渲染改动页。
  实测后否定了：`test/perf-measure.mjs` 显示**只渲染 1 页和渲染全部几乎一样慢** ——
  耗时由 Typst 的进程启动与文档编译主导，光栅化只占小头。

  | deck | 构建 | 渲染全部 | 重新渲染全部 | 只渲染 1 页 |
  |---|---|---|---|---|
  | 5 页 | 590 ms | 605 ms | 468 ms | 561 ms |
  | 15 页 | 761 ms | 508 ms | 510 ms | 457 ms |
  | 40 页 | 763 ms | 802 ms | 734 ms | 779 ms |

  缓存要正确判断"源码没变"，而 0.2.1 修掉的正是这个判断失误 ——
  旧图被当成当前结果，模型审阅了不存在的页。**用一点速度换回一个假阴性风险，不划算。**
  测量数据写进 README，下一个人不必重做这个实验。

---

## 0.4.2

### 修复

- **过密告警误报图片页**。一张全幅图片页被判为 56.6% 墨迹、超过 19% 阈值 ——
  测量没错，**告警错了**：图片本来就该占满版面，它的墨迹是图片本身。
  这个指标检测的是**文字塞不下**，图片页没有这个问题。

  判定方式试了两次，**第一次被实测否定**：
  - ❌ **颜色数分不开** —— 纯色图片只用 **90** 种颜色，而一页中文用了 **125** 种：
    反锯齿的字形本身就是很多颜色，纯色图反而只有一种。直觉是反的。
  - ✅ **色调分布分得开** —— 文字页几乎全是背景加少量深色字形，中间调极少；
    图片页则铺满整个色调范围。实测：文字页中间调占 **2.1%–8.0%**，图片页 **53.8%** 以上，
    中间有 **45.8 个百分点**的空隙，阈值取 25%。

  豁免依据是**页面图像本身**而不是 deck spec 的 layout 列表 —— 后者会被下一次构建覆写，
  于是"先建 10 页、再建 2 页、再回来审阅"就会查错 spec。页面不会对自己过时。

  `deck_check` 的每页密度现在带 `picture` 标记，豁免原因可见而不是隐含。

- 这个缺陷是**在已安装副本上跑完整流程**才发现的：此前所有验证读的都是源码树，
  而这个缺陷只有在"真建一个图片页 → 审阅 → 测量"连起来跑时才出现。

---

## 0.4.1

### 新增

- `deck_export` 支持 `vector`：把已构建的文档再编译一份矢量 PDF（`deck.vector.pdf`），
  用于打印或导入 Keynote / Acrobat / Illustrator。
  它编译的是**已生成的文档**而不是重新从 spec 推导，所以不会和审阅过的 deck 产生偏差；
  输出经临时文件改名落盘，失败不会留下半截 PDF。

### 修复

- `deck_check` 的溢出告警现在有了实际依据（见 0.3.2），文档补充说明其阈值来源。

---

## 0.4.0

### 新增

- 页型 **`image`**：全幅图片页 —— 标题、图片、图注、来源署名。
  此前只有 `image-text`（图文并排），做整页配图只能用空栏凑。
- 页型 **`sources`**：编号参考列表。演示文档定位下，学术与评审场景需要可引用的来源页。

页型总数 14 → 16。

### 修复

- 页型参数命名不能叫 `image` —— 那会遮蔽 Typst 内置的 `image()` 函数，
  使模板内部的调用变成"把字符串当函数调用"。

### 安全

- 测试断言了图片路径**不能越出 deck 目录**（Typst 的 `--root` 会拒绝，报
  `would escape the project root`）。这同时是安全边界：一份 deck 无法被用来读取机器上其它文件。

---

## 0.3.2

### 新增

- **过密/溢出检测**。此前插件完全没有溢出检测，也无法使用 Touying 的：
  版式由 grid/stack 组合而成，Touying 对这类组合测出的内容高度是 0pt，
  所以内容明显溢出页面底部的页它也不会报。实测：一页 14 条长要点，
  最后一行压在页脚页码上，构建与工具全程零告警。

  `deck_check` 现在测量每页的墨迹占比并点名过密的页：

  ```
  WARNING: 1 page(s) are packed close to the edge, which usually means its
  content has run past the bottom of the slide:
  - page-2.png (23.2% of the page is ink)
  Look at those pages first. Trim the items, shorten the text, or split the page
  across two frames.
  ```

  测量实现是 `lib/png.js`，用 Node 内置 zlib 解码 Typst 的 PNG 输出 —— **零依赖**。
  阈值由实测标定：版面舒适的页在 0.04–0.15，内容溢出的页在 0.24 左右，
  因此取 0.19，两侧都留有余量。页面四周内缩测量，主题的页眉条、进度条与页码不计入。

---

## 0.3.1

### 修复

- **时间线页只画出三条横线**。渲染器发射 `label`/`detail`，而文档写的是 `when`/`what`，
  于是模型按自然读法写 `{when, what}`，布局读不到内容 —— 线照画、文字全空、**零报错**。
  现在 `when`/`what` 是正式键名，`label`/`detail` 作为旧拼写仍被接受。

### 新增

- **spec 内容校验**。上面那个缺陷的本质不是键名，而是"错的键会产出一个渲染成功、
  报告成功、内容为空的页"。`deck_build` 现在会：
  - 页面的必需内容为空 → **构建前直接拒绝**，点名是哪一页、缺什么；
  - 写了本页不读的键 → 作为 warning 返回，构建照常完成。

  这个区分是刻意的：缺内容产不出可用 deck，属于致命；多余键通常只是笔误，报出来即可。
  `layout` 与 `notes` 每页都读，`cover` 读的是 deck 级字段 —— 键表如实记录，因此不会误报。

- README 补上**全部 16 种页型及其键**的对照表。此前 `items[]` 就是时间线条目的全部说明，
  正是这种含糊导致了上面的缺陷。

---

## 0.3.0

### 修复

- **`**粗体**` 印成字面星号**。转换层从来没错 —— 问题在于 **Typst 的字符串按字面渲染**：
  `text("a *b* c")` 就打印星号，标记只在**内容块**里解析。
  行内文本现在发射为内容块，两种强调变成显式的 `#strong[…]` / `#emph[…]` 调用
  （`#` 是必需的：内容块里的 `strong[…]` 就是字面文本）。

  所有特殊字符（含 `*` `_`）一律转义，因此写进 deck 的文本**无法注入 Typst 语法**。

- 代码块的 `source` / `language` 与 `image` 路径**保持字符串**：
  它们分别要送给 `raw(…, lang: …)` 和图片路径。`final-sweep` 立刻抓到了这个回归
  （`error: expected string or none, found content`）。

---

## 0.2.2

### 新增

- `deck_check` 支持 **`outDir`**：把页面图写到你指定的目录（归档、报告资源目录）。
  模型没有复制文件的能力，所以"写对地方"只能由渲染本身完成。

### 安全

- `outDir` 来自模型输出，属于不可信输入，因此**强制留在 deck 目录内**。
  这条限制是唯一防线：实测确认 **Typst 的 `--root` 只限制读取，不限制写入** ——
  用 root 之外的输出路径渲染，文件确实写到了外面。

---

## 0.2.1

### 修复

- **每个 deck 的页数都被多报一倍**。`countPdfPages` 用"下一个字符不是 `s`"来排除 `/Pages`，
  但 Typst 每页还会生成 `/Type /PageLabel`（阅读器页码），它的下一个字符是 `L`，
  于是每页被数了两次：7 页的 deck 报 14 页。

  Typst 渲染 PNG 一直是正确的，所以症状是"报告的数字和图片对不上"，
  而**模型的自审步骤正好在比较这两个永远对不上的数字**。

- **`deck_check` 留下旧图并当作本次结果**。渲染前不清空目录，然后把目录里所有 PNG
  都报成结果 —— deck 从 16 帧改到 7 帧后，目录里还留着第 8–16 页的图，
  视觉自审会去检视**当前 deck 里不存在的页**。
  现在渲染前清掉同模式的旧文件，返回列表只含本次真正画出的页。

---

## 0.2.0

### 变更

- **两个包合并为一个**。此前 `@hxql/dsh-presentation` 与 `@hxql/dsh-presentation-preset`
  是两个插件、两项安装、插件列表里两行。现在预设声明就在插件自己的 bundle patch 里：
  一次安装、一个插件列表条目、模式选择器里一张卡片。

---

## 0.1.0

首个版本。Typst + Touying 的演示文档模式：结构化页面数据、14 种页型、7 套主题、
渲染 PNG 回读的视觉自审、handout 与 pdfpc 演讲者备注导出。
