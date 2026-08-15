# dsh-ui-hud 🧠

**DSH（DeepSeek Harness）状态 HUD + 会话记忆中心** —— 填补生态空白的两件套：底部状态栏 HUD（VSCode 式，生态里没人做）+ 记忆可视化面板（记忆插件很多，但可视化面板是空白）。

> 灵感来源：[Datawhale hello-agents 第8章《记忆与检索》](https://datawhalechina.github.io/hello-agents/#/./chapter8/%E7%AC%AC%E5%85%AB%E7%AB%A0%20%E8%AE%B0%E5%BF%86%E4%B8%8E%E6%A3%80%E7%B4%A2) —— 把"工作/情景/语义/感知"四种记忆类型做成了可视化面板。

## 功能

### 1️⃣ 状态栏 HUD（底部悬浮条，可自动隐藏）

```
[● 思考中 12s] [DeepSeek-V4-Flash] [⚡ 12.4k] [上下文 ▓▓▓░░ 62%] [⚙ 2 任务] [🎯 目标] [📖 记忆] [12:34]
```

- **状态 pill**：空闲 / 思考中（带实时计时）/ 完成 / 错误 / 待命
- **当前模型**（从 assistant 节点 provenance 读取）
- **token 用量**（tokenUsage 投影）+ **上下文压力条**（contextPressure，>85% 变红）
- **后台任务数**（jobsBySession）+ **goal 阶段**（goal 投影）
- **点击展开详情**：sessionStats（回合/步骤/LLM 耗时/工具耗时/首 token 延迟）
- **自动隐藏**：鼠标移开淡出、悬停恢复（可关）

### 2️⃣ 记忆中心 · Memory Hub（右侧抽屉，`Ctrl+Shift+M`）

| 页签 | 对应 hello-agents 记忆类型 | 内容 |
|---|---|---|
| **情景** | Episodic | 会话时间线：用户/助手/工具调用/压缩/上下文注入/错误，可 **★ 固定** 重要条目 |
| **工作** | Working | 当前回合流式输出 + 你固定的消息（localStorage 持久化） |
| **语义** | Semantic | 上下文注入卡片（context 节点 + provenance 来源标签） |
| **感知** | Sensory | 会话中的图片附件墙 |
| 检索框 | — | 对当前会话做关键词过滤 |
| 统计行 | — | 回合 / 步骤 / token / 上下文占用 |

### 3️⃣ 快捷键

- `Ctrl+Shift+H` — 显示/隐藏 HUD
- `Ctrl+Shift+M` — 打开/关闭记忆抽屉

### 4️⃣ 设置分节

**设置 → 状态 HUD · Memory**：HUD 开关、自动隐藏、记忆抽屉开关。

## 安装

```bash
# 本地源码安装（改源码后重启 dsh web 生效）
dsh plugin --profile web add <本仓库路径>

# 或手动：把包放进 ~/.dsh/profiles/node_modules/，在 cordis.patch.yml 加一行
# - insert: [{ id: ui-hud, name: dsh-ui-hud }]
```

安装后**重启 `dsh web`** 生效。卸载：

```bash
dsh plugin --profile web remove dsh-ui-hud
```

## 生态定位（调研结论）

来自 DSH 生态调研（awesome-dsh-plugin 等聚合列表）：
- ✅ **底部状态栏 HUD：生态空白**（已有的 dsh-hud 是悬浮侧栏式，非 VSCode 式底部状态栏）
- ✅ **记忆可视化面板：生态空白**（记忆插件 10+ 全是存储/检索，无时间线/图谱面板）
- 命令面板（dsh-spotlight）、token 仪表（context-vista 等）已饱和，本插件不重复造

## 兼容性

- 纯原生 DSH 插件（`dsh.bundle` + `dsh.client` 双面插件）
- HUD/抽屉为插件私有 fixed 元素（类前缀 `dshhud-`，z-index 8000 级，低于应用弹层）
- 数据全部来自**官方会话快照与投影服务**：`ctx.sessions`（快照订阅 + list）、`projections.faceOf('tokenUsage'/'contextPressure'/'sessionStats'/'goal')`
- 与 dsh-mood-wallpaper（壁纸）、dream-skin、壁纸轮换等插件共存
- 配置存 localStorage

## 冒烟测试记录

- HUD 栏渲染（空闲/思考中(计时)/时钟）✅
- 记忆抽屉：4 页签 + 统计行 + 检索框 + 空会话提示 ✅
- 设置分节（3 开关）✅
- **E2E（mock LLM）**：发消息 → HUD 显示「思考中 1s」→ 完成后回到「空闲」✅

## 结构

```
dsh-ui-hud/
├── package.json     # dsh.bundle + dsh.client 声明
├── cordis.patch.yml # bundle 组合补丁（插入 ui-hud 入口）
└── lib/
    ├── index.js     # host 半边（空激活载体）
    └── client.js    # 浏览器半边：HUD + 记忆抽屉 + 快捷键 + 设置页
```

## License

MIT
