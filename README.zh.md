# dsh-whale-pet-pro 🐳

> Windows 丝滑桌面宠物引擎（24fps 动画 + 行为 AI），DeepSeek Harness（DSH）插件。
> 基于 [dsh-desktop-pet](https://github.com/)（MIT）二次开发。

**本仓库只含引擎（MIT），不含任何宠物素材。** 素材从独立的
[whale-pet-assets](https://github.com/laycter/whale-pet-assets) 仓库按需下载
（见下文「获取宠物素材」）。

---

## 目录

- [快速开始](#快速开始)
- [特性](#特性)
- [目录结构](#目录结构)
- [运作流程](#运作流程)
- [配置](#配置)
- [获取宠物素材](#获取宠物素材)
- [示例宠物 BoringPet 行为详解](#示例宠物-boringpet-行为详解)
- [鸣谢](#鸣谢)
- [许可](#许可)

---

## 快速开始

1. **安装插件**（安装方式取决于你的 DSH）：
   ```bash
   # 方式 A：DSH 插件安装（如支持）
   dsh plugin add dsh-whale-pet-pro
   # 方式 B：npm
   npm install dsh-whale-pet-pro
   ```

2. **下载宠物素材**（必须，否则召唤后没有画面）：
   从 [whale-pet-assets](https://github.com/laycter/whale-pet-assets) 下载
   `boring-pet.zip`，解压到本插件的 `assets/pets/boring-pet/`。
   （详见[获取宠物素材](#获取宠物素材)）

3. **召唤**：打开 DSH 设置 → 桌宠 → 打开「召唤」开关。

> ⚠️ **重要**：桌宠**默认不自动启动**（`enabled: false`），点召唤按钮才出现。

---

## 特性

- **24fps 丝滑动画**：帧预缓存 + 流式解码，支持任意帧数的序列帧素材
- **语义映射外部化**：`pet.json` 声明「语义状态 → 目录动作」，换宠物零代码
- **多变体 + 循环控制**：`idle_0/1/2/3` 自动合并，`loops` 控制一次性/循环
- **音效**：UWP MediaPlayer 播 m4a，按语义触发，右键「Toggle sound」静音
- **行为 AI**：心情数值 + 待机换肤 + 打哈欠 + 自主走动（小范围溜达）
- **按需召唤 + 崩溃隔离**：开机不启动、素材按需加载、任何失败不影响 GUI
- **桌宠市场**：内置「获取更多桌宠」入口，浏览/预览/下载社区宠物

---

## 目录结构

```text
dsh-whale-pet-pro/
├── src/
│   ├── renderer/            # 渲染层
│   │   ├── AnimationController.ts  # 帧调度（24fps，双模式）
│   │   ├── PetWindow.ts            # 窗口编排（语义→动作映射、出场、拖拽、走动）
│   │   ├── FrameDecoder.ts         # 切片/缩放/镜像/颜色转换（纯函数）
│   │   ├── petdir/PetDirLoader.ts  # dir 格式素材加载器（<动作>_<变体>/）
│   │   ├── codex-pet/              # Codex 精灵图契约 + 加载器（兼容旧素材）
│   │   ├── backend/                # Win32/X11 透明窗口后端
│   │   └── audio/AudioPlayer.ts    # UWP MediaPlayer 音效
│   ├── behavior/            # 行为 AI（M3）
│   │   ├── MoodSystem.ts           # 心情状态机（0-100）
│   │   ├── BehaviorAI.ts           # 自主行为调度器（换肤/打哈欠/走动）
│   │   └── BehaviorTypes.ts        # 接口契约
│   ├── integration/         # DSH 集成
│   │   └── HarnessBridge.ts        # DSH 事件 → 归一化事件
│   ├── core/                # 状态机
│   │   ├── PetStateMachine.ts      # 语义状态机（10 状态 + 优先级）
│   │   └── types.ts                # 类型词汇（SemanticState 等）
│   ├── client/              # 浏览器端
│   │   ├── PetMarketplace.tsx      # 桌宠市场 UI
│   │   └── ...                     # 设置栏目、控制器、市场数据
│   └── index.ts             # 插件入口（组装所有层）
├── assets/pets/             # 宠物素材目录（不随包分发，用户自下载）
│   └── <pet-id>/            # 一个宠物 = 一个目录（见素材格式）
├── docs/                    # 架构/素材规格/添加宠物文档
├── tests/                   # 单元测试（vitest）
├── cordis.patch.yml         # 默认配置补丁（bundle layer）
├── LICENSE                  # MIT
└── CREDITS.md               # 鸣谢 + 素材许可说明
```

---

## 运作流程

```
DSH 事件（对话 / 任务状态 / 工具调用）
        │
        ▼
  HarnessBridge         归一化成事件（taskId + 状态）
        │
        ▼
  PetStateMachine       语义状态机：10 个语义状态，优先级合并 + 去重 + 过期
        │                IDLE/THINKING/WORKING/CODING/RUNNING_COMMAND/
        │                WAITING_FOR_USER/SUCCESS/ERROR/SLEEPING/STARTING
        │
        ├───────────────────────────────┐
        ▼                               ▼
  PetWindow.setState()          BehaviorAI.onSemanticState()
  （语义动作）                    （只在 IDLE 时接管自主行为）
   idle/walk/happy/hurt/          ├→ 待机换肤（idle 变体轮换）
   sleep/drag/fall                 ├→ 打哈欠（yawn）
        │                          └→ 自主走动（walk + 移动窗口）
        │                               │
        │                               ▼
        │                        MoodSystem（心情 0-100）
        │                        活动事件增减（干活+5/成功+8/出错-5）
        ▼
  AnimationController    帧调度（24fps，帧表/精灵图双模式）
        │
        ▼
  WindowBackend          Win32 透明置顶窗口上屏
```

**音效链路**：`PetWindow.playAudioForTrigger` → `AudioPlayer` → UWP MediaPlayer
（spawn 无窗口 PowerShell 播 m4a）。

---

## 配置

### 1. 默认配置补丁（`cordis.patch.yml`）

插件包自带的 bundle 配置，`enabled` 默认 `false`（按需召唤）：

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关；`true` 才加载素材并创建窗口 |
| `alwaysOnTop` | `true` | 置顶显示 |
| `petScale` | `1` | 缩放倍率（0.5~4，步进 0.25） |
| `petId` | `text` | 默认宠物（无素材时用内置 text 占位） |
| `hideWhenIdle` | `false` | 空闲（入睡）时自动隐藏 |
| `animationEnabled` | `true` | 开启动画（关闭则显示静态帧） |
| `idleFrequencySec` | `20` | （已被行为 AI 接管，暂不生效） |
| `clickThrough` | `false` | 鼠标穿透（Windows） |
| `startSleeping` | `false` | 启动即睡眠态 |
| `animationSpeed` | `1` | 全局动画速度倍率 |

### 2. 用户可改设置（settings 命名空间 `desktop-pet`）

设置页可实时改：`enabled`（召唤/收起）、`petId`（选宠物）、`petScale`（大小）、
`hideWhenIdle`（自动隐藏）。

### 3. ⚠️ DSH 白名单补丁（重要）

DSH 的 API 网关默认**不向浏览器暴露新注册的 settings 命名空间**，需要在其
`packages/host/apiproxy/src/api-proxy.ts` 的 `WEB_SETTINGS_NAMESPACES` 数组中
加入 `'desktop-pet'`，设置页才会显示桌宠栏目。

> **DSH 升级/重装后需要重新打这个补丁。** 未来若 settings 服务支持插件自声明
> 暴露，可去掉此补丁。

---

## 获取宠物素材

**引擎包不含素材**，你需要先下载一个宠物才能召唤。

### 方式 A（推荐）：桌宠市场（注册表 + 多来源聚合）

打开 **设置 → 桌宠 →「+ 更多宠物获取」**，市场由注册表
（[whale-pet-assets](https://github.com/laycter/whale-pet-assets) 的 `index.json`）
统一管来源列表，前端自动聚合所有来源的宠物：

1. 列表里挑一个宠物 → 详情 → 下载 zip
2. 解压到本插件的 `assets/pets/<宠物 id>/`
3. 重启 DSH → 设置 → 桌宠 → 选择该宠物 → 召唤

当前来源：
- [whale-pet-assets](https://github.com/laycter/whale-pet-assets)（含 BoringPet）

> **社区成员想发布自己的桌宠？** 建一个「宠物仓库」（根目录带 `index.json`
> 桌宠清单），把仓库 URL 加进注册表 `index.json` 的 `sources` 数组（PR 一行），
> 市场自动聚合——**引擎代码不用改**。
> 完整规范见 [`docs/pet-repo-spec.md`](docs/pet-repo-spec.md)。

### 方式 B：从 DeskPet 提取 BoringPet

1. 下载 [DeskPet](https://github.com/2048Nemo/DeskPet) 仓库
2. 取出 `deskpet/BoringPet/` 目录（含各动作帧目录 + `config.json`）
3. 整理成素材包格式（见下）：加一份 `pet.json` 声明语义映射/动作/音效
4. 放进 `assets/pets/boring-pet/`

### 素材包格式（dir 格式）

```text
assets/pets/<pet-id>/
├── pet.json            # 清单：id/displayName/fps/scale/semantic/actions/audio
├── ACTIONS.md          # 动作清单（给人/agent 看的触发说明，可选）
├── idle_0/ 1.png 2.png ...   # 变体目录（<动作>_<变体>）
├── idle_1/ ...
├── walk_0/ walk_1/ ...
├── happy_0/ happy_1/ ...
├── hurt_0/ hurt_1/ ...
├── sleep/ yawn/ drag/ fall/ home/ eat/   # 无变体动作目录
└── （各动作目录内可放 sound.m4a 音效）
```

`pet.json` 关键字段：

```jsonc
{
  "id": "boring-pet",
  "format": "dir",
  "fps": 24,
  "scale": 0.35,
  // 语义映射：内部触发状态 → 本宠目录动作
  "semantic": { "idle": "idle", "working": "walk", "success": "happy",
                "error": "hurt", "sleeping": "sleep", "hover": "happy",
                "drag": "drag", "fall": "fall", "starting": "fall" },
  // 动作定义：fps 覆盖 + 变体数 + 循环次数
  "actions": { "idle": { "variants": 4 }, "happy": { "variants": 2, "loops": 1 } },
  // 音效：内部触发状态 → 音频相对路径
  "audio": { "working": "walk_0/sound.m4a", "drag": "drag/sound.m4a" }
}
```

完整规格见 [`docs/pet-asset-spec.md`](docs/pet-asset-spec.md) 与
[`docs/adding-a-pet.zh.md`](docs/adding-a-pet.zh.md)。

---

## 示例宠物 BoringPet 行为详解

BoringPet 是 DeskPet 作者 @2048Nemo 的素材（GPL-3.0，见[鸣谢](#鸣谢)），
作为本项目的**示例宠物**，其 `pet.json` 完整演示了语义映射/音效/动作配置。

### 语义映射（semantic）

| 内部触发状态 | 含义 | 目录动作 |
|---|---|---|
| `idle` | 待机 | `idle`（4 变体） |
| `working` | 干活/思考/写码/跑命令 | `walk`（走路，2 变体） |
| `success` | 成功 | `happy`（开心，2 变体） |
| `error` | 出错 | `hurt`（受惊，2 变体） |
| `sleeping` | 睡觉 | `sleep`（一次性，停最后一帧） |
| `hover` | 鼠标悬停 | `happy`（开心反应，无声音） |
| `drag` | 拖拽 | `drag` |
| `fall` | 掉落/关闭 | `fall`（一次性） |
| `starting` | 出场登场 | `fall`（掉落登场，播完转 idle） |

### 动作清单（16 动作 / 1778 帧 / 24fps）

| 动作 | 变体 | 循环 | 说明 |
|---|---|---|---|
| `idle` | 4 | 循环 | 待机，行为 AI 每 ~20 秒轮换变体 |
| `walk` | 2 | 循环 | 走路（向左自动镜像） |
| `happy` | 2 | 一次 | 成功 / 悬停反应 |
| `hurt` | 2 | 一次 | 出错 |
| `sleep` | 1 | 一次 | 睡觉（停最后一帧） |
| `yawn` | 1 | 一次 | 打哈欠（行为 AI 触发） |
| `drag` | 1 | 循环 | 拖拽期间 |
| `fall` | 1 | 一次 | 出场掉落 / 关闭 |
| `home` | 1 | 循环 | 回窝（可选） |
| `eat` | 1 | 一次 | 吃饭（10fps） |

### 音效（14 个 m4a）

| 触发 | 文件 | 是否播放 |
|---|---|---|
| 待机 `idle` | `idle_0/sound.m4a` | ❌ 静音（待机素材自带背景音） |
| 干活 `working` | `walk_0/sound.m4a` | ✅ 一次性 |
| 成功 `success` | `happy_0/sound.m4a` | ✅ 一次性 |
| 出错 `error` | `hurt_0/sound.m4a` | ✅ 一次性 |
| 睡觉 `sleeping` | `sleep/sound.m4a` | ✅ 一次性 |
| 拖拽 `drag` | `drag/sound.m4a` | ✅ 一次性 |
| 掉落 `fall` | `fall/sound.m4a` | ✅ 一次性 |
| 悬停 `hover` | — | ❌ 无（忠实 DeskPet 原作） |

> 音效策略对齐 DeskPet 原作：`idle`/`home` 静音，其余一次性播放（不循环），
> 切换动作先停旧声音。右键菜单「Toggle sound」可整体静音。

### 行为 AI 规则（M3「最小活起来」）

| 行为 | 频率 | 说明 |
|---|---|---|
| 待机换肤 | 每 ~20 秒 | idle_0→1→2→3 顺序轮换 |
| 打哈欠 | 60~120 秒随机 | 心情低更频繁（30~60 秒） |
| 自主走动 | 120~180 秒随机 | 小范围 ±150px 溜达，向左镜像 |
| 开心蹦跳 | 心情高时 | 心情 ≥65 偶尔主动蹦跳 |

**心情闭环**：没活动慢慢掉（60 秒 -1）；干活 +5、成功 +8、出错 -5。
心情高 → 溜达/蹦跳多；心情低 → 打哈欠多、几乎不溜达。**主人工作 = 宠物陪伴**。
无活动 5 分钟 → 入睡（SLEEPING）。

---

## 鸣谢

- **[@2048Nemo](https://github.com/2048Nemo)**：BoringPet 素材作者（16 动作
  1778 帧 + 14 音效），[DeskPet](https://github.com/2048Nemo/DeskPet) 项目作者。
  其素材的动作语义与音效策略直接启发了本项目的语义映射设计。详见
  [CREDITS.md](CREDITS.md)。
- **[@xiaoshihou514](https://github.com/xiaoshihou514)**：本项目 fork [dsh-desktop-pet](https://github.com/xiaoshihou514/dsh-desktop-pet)基础（MIT），保留了其
  Win32 窗口后端与 DSH 事件映射。
  感谢两位原作者的付出。

## 许可

- **引擎（本仓库）**：**MIT**，见 [LICENSE](LICENSE)。
- **BoringPet 素材**：**GPL-3.0**（作者 @2048Nemo），**不随本包分发**，从
  [whale-pet-assets](https://github.com/laycter/whale-pet-assets) 单独获取。
