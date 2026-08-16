# 动作映射外部化架构（M3 前置 · 鸭鸭已拍板）

> 目标：把「动作映射」从代码硬编码改成**数据 + 提示词文件**，换宠物 = 换一份素材包（含声明），
> 按键端（设置栏触发器）零改动。别人做的宠物素材「一次配置」即可接入动作与基础音效。

## 零、整体架构（2026-08-16 深夜，鸭鸭拍板）

```
┌─ whale-pet-pro（引擎 + 接口，MIT 开源）─────────────┐
│  触发器层  src/client/                             │
│    设置栏目 · 召唤开关 · 宠物选择 · 「获取更多桌宠」入口 │
│    （只发指令：enabled / petId）                    │
├───────────────────────────────────────────────────┤
│  接口层  src/index.ts + renderer/                  │
│    读 pet.json 契约 → 加载 → 状态机 → 播放 → 音效   │
│    （不关心具体素材）                               │
├───────────────────────────────────────────────────┤
│  数据层（本地）  assets/pets/<id>/                   │
│    已下载的桌宠包（pet.json + ACTIONS.md + 帧 + 音效）│
└───────────────────────────────────────────────────┘
        ▲ GitHub zip 下载（前端入口 + 文档指引 deepseek）
┌─ whale-pet-assets（桌宠包独立仓库，GPL 素材注意许可）─┐
│  boring-pet/  whale-ui-pet/  ...                    │
│  每个目录 = 一个桌宠包（pet.json + ACTIONS.md + 帧 + 音效）│
│  + index.json 清单 + README（下载到哪、怎么调用）      │
└───────────────────────────────────────────────────┘
```

**决策记录**（鸭鸭钦点）：
- 分发方式 = **GitHub zip 下载** + 前端「获取更多桌宠」入口 + 文档指引 deepseek 下载到 `assets/pets/` 并调用
- **桌宠包独立仓库**（whale-pet-assets），与引擎仓库分离（接口 + 内容解耦）
- 音效手动关闭（右键 Toggle sound）保留


## 一、目标与边界

### 做
1. **语义映射外部化**：`pet.json` 声明「语义动作 → 本宠目录动作」，代码不再写死映射
2. **变体目录支持**：`<action>_<variant>/`（如 `idle_0/1/2/3`）自动合并为动作 + 变体列表，播放时随机/轮换变体
3. **ACTIONS.md 提示词文件**：每个宠物目录一份动作清单（agent/DSH/人可读），读了就知道怎么触发
4. **基础音效播放**：MediaPlayer 播 m4a（Windows 原生；苹果用户参照架构改）
5. **换宠物零代码**：素材包（pet.json + ACTIONS.md + 帧目录 + 音效）放进 `assets/pets/<id>/` → 设置栏选 → 自动接入

### 不做
- ❌ deepseek 对话接入 / 语音接入（后续阶段）
- ❌ 强制统一语义词汇（基础语义参照 DeskPet，各宠可扩展；文档指导 deepseek 生成新素材）

## 二、基础语义词汇表（参照 DeskPet 作者结构）

| 语义动作 | 含义 | DeskPet 目录 | 说明 |
|---|---|---|---|
| `idle` | 待机 | `idle_0~3` | 多变体随机切换，不单调 |
| `walk` | 走路/行动 | `walk_0~1` | 干活时用 |
| `happy` | 开心/成功 | `happy_0~1` | 成功反馈 |
| `hurt` | 受惊/出错 | `hurt_0~1` | 错误反馈 |
| `sleep` | 睡觉 | `sleep` | loops:1（播完停最后一帧） |
| `yawn` | 打哈欠 | `yawn` | 闲时随机 |
| `drag` | 拖拽 | `drag` | 鼠标拖拽期间 |
| `fall` | 掉落/关闭 | `fall` | 收起时 |
| `home` | 回窝 | `home` | 可选，缺省用 sleep 末帧 |
| `eat` | 吃饭 | `eat` | loops:1 |

> 语义 → 内部触发状态：`idle`(待机) / `working`(干活) / `success`(成功) / `error`(出错) /
> `sleeping`(睡觉) / `hover`(悬停) / `drag`(拖拽) / `fall`(关闭) —— 每个宠物在 `semantic` 里
> 声明这些内部状态映射到哪个目录动作。

## 三、素材包结构（一个宠物 = 一个目录）

```
assets/pets/<pet-id>/
├── pet.json            ← 机器配置：id/displayName/fps/scale/semantic/actions/audio
├── ACTIONS.md          ← ★提示词文件：动作清单 + 触发方式 + 生成新素材指引
├── idle_0/ 1.png 2.png ...   ← 变体目录（<action>_<variant>）
├── idle_1/ ...               ← 同一动作多个变体，自动合并
├── walk_0/ walk_1/ ...
├── happy_0/ happy_1/ ...
├── hurt_0/ hurt_1/ ...
├── sleep/ yawn/ drag/ fall/ home/ eat/   ← 无变体动作目录
└── sound/ *.m4a         ← 基础音效（可选，按动作命名）
```

## 四、pet.json 扩展（新增字段）

```jsonc
{
  "id": "boring-pet",
  "displayName": "Boring Pet",
  "format": "dir",
  "fps": 24,
  "scale": 0.35,
  // ★语义映射：内部触发状态 → 本宠目录动作（核心解耦点）
  "semantic": {
    "idle": "idle",
    "working": "walk",
    "success": "happy",
    "error": "hurt",
    "sleeping": "sleep",
    "hover": "happy",
    "drag": "drag",
    "fall": "fall"
  },
  // 动作定义：fps 覆盖 + 变体数 + 循环次数
  "actions": {
    "idle":  { "fps": 24, "variants": 4 },
    "walk":  { "fps": 24, "variants": 2 },
    "happy": { "fps": 24, "variants": 2 },
    "hurt":  { "fps": 24, "variants": 2 },
    "sleep": { "fps": 24, "loops": 1 },
    "yawn":  { "fps": 24 },
    "drag":  { "fps": 24 },
    "fall":  { "fps": 24 },
    "home":  { "fps": 24 },
    "eat":   { "fps": 10, "loops": 1 }
  },
  // ★音效：内部触发状态 → 音频文件（可选）
  "audio": {
    "idle": "sound/idle.m4a",
    "happy": "sound/happy.m4a",
    "hurt": "sound/hurt.m4a"
  }
}
```

## 五、ACTIONS.md（提示词文件模板）

```markdown
# <宠物名> 动作清单

本文件是给 DSH/agent 的动作触发说明。切换本宠物后，按键端按此清单匹配触发。

## 动作一览

| 内部触发 | 动作 | 变体 | 循环 | 说明 |
|---|---|---|---|---|
| idle（待机） | idle | 4 | 循环 | 随机切换变体 |
| working（干活） | walk | 2 | 循环 | |
| success（成功） | happy | 2 | 循环 | |
| error（出错） | hurt | 2 | 循环 | |
| sleeping（睡觉） | sleep | 1 | 一次 | 停在最后一帧 |
| hover（悬停） | happy | 2 | 循环 | |
| drag（拖拽） | drag | 1 | 循环 | |
| fall（关闭） | fall | 1 | 一次 | |

## 音效

| 触发 | 文件 |
|---|---|
| 待机 | sound/idle.m4a |
| 开心 | sound/happy.m4a |
| 受惊 | sound/hurt.m4a |

## 新增动作指引（给 deepseek 生成素材用）

要为本宠物补充动作（如 dance/music），请生成 `<动作名>_0/ 1.png 2.png...` 序列帧：
- PNG 透明背景，同一动作所有帧尺寸一致（推荐 256~512px）
- 文件名数字排序（1.png, 2.png... 10.png）
- 走路只需画一个方向，向左自动镜像
```

## 六、代码改造清单（M2~M5）

| 模块 | 改动 |
|---|---|
| `PetContract.ts` | PetManifest 加 `semantic`/`actions[].variants`/`actions[].loops`/`audio` |
| `PetDirLoader.ts` | 变体目录合并：`<action>_<variant>/` → action + variants[]；音频文件登记 |
| `PetWindow.ts` | `DEFAULT_ACTION_MAP` 改为「manifest.semantic 优先 + 代码兜底」；变体随机/轮换切换 |
| `AnimationController.ts` | 支持变体切换（setVariant / 随机） |
| 音效播放 | 新增 `AudioPlayer`（Windows MediaPlayer 播放 m4a，按语义触发） |
| `pets.ts` | 扫描时读取 ACTIONS.md 存在性（可选：登记到 catalog 提示） |

## 七、换宠物流程（用户视角）

1. 拿到别人做的宠物素材包（一个目录：pet.json + ACTIONS.md + 帧 + 音效）
2. 放进 `assets/pets/<id>/`
3. 设置栏 → 桌宠 → 选这个宠物 → 召唤
4. 后端读 pet.json 的 semantic 映射 → 自动播放对应动作 + 音效 ✅ **零代码**

## 八、里程碑

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| M1 | 架构确认（本文档） | 鸭鸭点头 |
| M2 | PetContract/PetDirLoader 扩展（变体 + semantic + audio 声明） | 单测通过 |
| M3 | PetWindow 语义映射外部化 + 变体切换 | 换 pet.json 不改代码即可映射 |
| M4 | MediaPlayer 音效播放 | 动作触发时播 m4a |
| M5 | BoringPet 素材接入（生成 pet.json + ACTIONS.md）+ 实机验证 | 设置栏选 BoringPet 可玩 |

## 九、决策记录（鸭鸭钦点）

- **基础打包宠物 = DeskPet 作者的 BoringPet**（1778 帧 + 14 m4a；PET.md 目录格式，fps 24）
- 语义词汇：不强制统一，基础语义参照 DeskPet 结构；ACTIONS.md 含「新增动作指引」供 deepseek 生成新素材
- 音效：MediaPlayer 播放（Windows；苹果用户参照架构改）
- 提示词文件：宠物目录内 `ACTIONS.md`
- **⚠️ 许可**：DeskPet 是 **GPL-3.0**。本地使用 OK；**公开发布（M4）需处理许可**（素材单独仓库 / 问作者授权 / 默认宠物换自有素材）——M4 再定，不阻塞 M2~M5
