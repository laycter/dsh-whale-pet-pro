# dsh-whale-pet-pro · 项目架构（v0.1 待鸭鸭审阅）

> 目标：Windows 丝滑桌面宠物引擎（24fps + 完整行为 AI）+ DSH 深度集成，开源分享。
> 基础：Fork dsh-desktop-pet（MIT）——保留其 Win32 窗口/拖拽/DSH 事件映射，重写动画与行为层。

## 一、目标与边界

### 做
1. **24fps 丝滑动画引擎**：帧预缓存 + 流式解码（仿 DeskPet 的序列帧动画引擎）
2. **完整行为 AI**：心情/清洁度 + 自主走动 + 打哈欠 + 待机变体 + 音乐联动
3. **PET.md 素材格式**：每动作一个 PNG 序列帧目录（支持多帧高帧率），兼容 Codex pet 精灵图
4. **DSH 集成**：事件映射（对话状态→宠物状态）+ 设置卡片
5. **开源发布**：GitHub + npm 双发

### 不做
- ❌ macOS/Linux 原生窗口（保留 dsh-desktop-pet 的后端接口，不重写）
- ❌ AI 生成功能（素材由用户/社区提供）

## 二、模块划分（低耦合高内聚）

```
dsh-whale-pet-pro/
├── src/
│   ├── renderer/            ← 渲染层（重写）
│   │   ├── AnimationController.ts ← 帧调度（Codex 切片 + dir 帧表双模式）
│   │   ├── FrameDecoder.ts  ← 切片/缩放/任意尺寸适配（纯函数）
│   │   ├── PetWindow.ts     ← 窗口编排（语义状态→动作映射、idle 变体）
│   │   ├── codex-pet/       ← Codex 精灵图契约 + 加载器（兼容旧素材）
│   │   ├── petdir/          ← PET.md 目录格式加载器（帧数不限，M2 核心）
│   │   └── backend/         ← 复用 Win32/X11 窗口后端（fork 保留）
│   ├── behavior/            ← 行为 AI 层（M3 新增）
│   │   ├── MoodSystem       ← 心情/清洁度状态机（随时间衰减/抚摸恢复）
│   │   ├── BehaviorAI       ← 自主走动/打哈欠/待机变体调度
│   │   └── MusicListener    ← 音乐播放联动（Windows 媒体事件）
│   ├── integration/         ← DSH 集成层（复用+扩展）
│   │   └── HarnessBridge    ← 事件映射（保留 dsh-desktop-pet 的完整映射）
│   └── core/                ← 状态机（复用+扩展 SemanticState）
├── assets/pets/<name>/      ← 素材（两种格式并存）
│   ├── whale-ui-pet/        ← 23 动作 × 41-62 帧（220×220，来自 dsh-client-ui-pet）
│   │   ├── idle/ 1.png 2.png... ← 每动作一个目录，多帧（dir 格式）
│   │   └── pet.json         ← 清单（id/displayName/fps/actions 覆盖）
│   └── fat-fish-maid/       ← Codex spritesheet 格式（fps:24）
└── docs/                    ← 素材规范 + 开发文档
```

**dir 素材格式（dsh-whale-pet-pro 扩展，PET.md 风格）**：

```jsonc
// pet.json
{
  "id": "whale-ui-pet",
  "format": "dir",                    // 省略则按有无 spritesheetPath 推断
  "fps": 24,                          // 全局帧率（dir 格式缺省 24）
  "actions": { "idle": { "fps": 20 } } // 按动作覆盖
}
```

- 布局：`<petDir>/<action>/1.png 2.png 3.png …`，文件名数字序即播放序，帧数不限
- 加载：`PetDirLoader` 每动作一次并发解码（libvips 线程池，1007 帧 ≈1.5s）
- 播放：`AnimationController` 双模式——命中帧表走帧表（fps 均分），未命中回退 Codex 切片
- 动作映射：`PetWindow.DEFAULT_ACTION_MAP`（Codex 姿势→目录动作，如 running→swim「干活=游泳」、jumping→surprise、failed→cry）
- 自由动作：`PetWindow.playAction(name)` 播放任意目录动作（M3 行为 AI 入口）

**层间契约**：
- 渲染层只管「给定状态→播放帧」；行为层只管「决定状态」；集成层只管「DSH 事件→语义状态」
- 行为 AI 通过 `BehaviorEvent`（mood/自主决策）与渲染层解耦

## 三、动画引擎设计（24fps 的关键）

| 要点 | 设计 |
|---|---|
| 帧率 | 默认 24fps（帧时长 ~42ms），pet.json 可覆盖每动作 fps |
| 预缓存 | 启动时预加载当前动作的全部帧到内存；切换动作时流式补齐（仿 DeskPet） |
| 帧数 | 不设 8 帧上限——PET.md 目录格式支持任意帧数 |
| 兼容 | 检测到 spritesheet.webp（Codex 格式）时走旧契约路径 |

## 四、行为 AI 设计（仿 DeskPet + 鸭鸭钦定扩展）

| 系统 | 行为 |
|---|---|
| 心情 | 0-100，随时间缓慢衰减；抚摸/双击回窝恢复；心情低→sleep 频繁、心情高→happy 频繁 |
| 清洁度 | 随时间变脏，需「洗澡」动作 |
| 自主走动 | 心情/活动频率配置（Chill/Normal/Hyper）驱动随机 walk |
| 待机变体 | idle_0/idle_1/... 随机切换，避免单调 |
| 音乐联动 | 检测系统媒体播放 → music 动作（跳舞）；**可自行开关**（`musicEnabled` 配置项，设置卡片一键切换） |

### 对话互动模块（鸭鸭钦点：行为 AI 接入小女仆）

```
DSH 对话流（assistant 消息）
   ↓ DialogueBridge（情感/关键词规则匹配）
   ↓ BehaviorEvent（happy/hurt/excited/care...）
行为 AI → 触发宠物动作（开心蹦跳/委屈/比心/紧张…）
   ↓ 双向通道（可选）
宠物交互事件（被抚摸/被点击/被夸奖）
   → 反馈给 DSH 会话（女仆可在对话里感知：「鸭鸭刚摸我了～」）
```

- **内容级映射**：女仆输出文本的情感词（开心/失败/惊讶/安慰…）→ 宠物即时反应，比「任务状态」更细腻
- **双向互动**：鸭鸭戳宠物 → 宠物做动作 + 女仆在对话里回应（桌宠成为对话的「第三人」）
- **实现**：扩展 HarnessBridge 的 assistant 事件通道 + 行为层的 DialogueListener；规则引擎（词表匹配）先行，后续可换轻量情感分类

## 五、安全红线（鸭鸭钦点，发布必须执行）

1. **`.gitignore` 白名单制**：默认排除一切可能含密钥的文件（.env、config.yaml、settings、*.key、*.pem、credentials 等）
2. **发布前密钥扫描**：`grep` 扫描全部待提交文件，匹配 `sk-` / `Bearer ` / `api[_-]?key` / `token` 等模式，命中即拦截
3. **双发流程**：先扫描 → 再 git push → 再 npm publish；npm 包用 `files` 白名单（只发 lib/docs/README，不发任何用户配置）
4. **测试目录隔离**：本地测试配置（含密钥）一律放仓库外或 .gitignore 内

## 五·五、按需召唤（鸭鸭钦点，2026-08-16）

**桌宠绝不自动启动**——开机不启动、不加载素材、不检查；点击 UI 右上角 🐳 按钮才召唤。

| 层 | 机制 |
|---|---|
| 默认配置 | `cordis.patch.yml` `enabled: false`（包内 patch 同）；apply 不再提前 return——settings 命名空间始终注册 |
| 启动重置 | `installPetSettings` 检测 user 层残留 `enabled: true`（上次会话开启过）→ 立即重置回 composition 默认——**跨会话绝不自动启动** |
| 按需加载 | `reconcile` 的 `!enabled` 分支：销毁窗口、置空 loadedPetKey；素材解码（sharp，1007 帧）和窗口创建只在 enabled=true 时发生 |
| 设置入口 | 通用设置列表（`settings.general.item`）的「桌宠」行：🫧 召唤/收起开关 + 宠物下拉（直写 `toggleEnabled`/`setPet`，不走卡片 staged 表单）——**入口收进设置列表，无悬浮按钮**（鸭鸭钦点，2026-08-16） |
| 完整卡片 | 插件配置 tab（`settings.plugin.item`）保留完整卡片：大小/自动隐藏/保存流程 |
| 表单隔离 | 行/按钮走 `toggleEnabled()`/`setPet()` 直写 `scope.set`，绝不连带提交卡片未保存的修改 |
| 崩溃隔离 | client `apply()` 整体 try/catch；行渲染失败由 slots 系统 `reportEntryError`（abdicate）兜底——**任何失败最多让入口缺席，绝不影响 GUI**（历史教训：client factory 抛错 = 整个 GUI 打不开） |

安全性分层（「我不能再看不到你了」的工程化）：
1. **GUI 活着** > 按钮存在 > 宠物出现：三层各自独立失败隔离
2. 出问题最多退回「没有按钮/没有宠物」，GUI 和对话永远可用

## 六、里程碑

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| M1 | 项目骨架 + 安全基线（.gitignore/扫描脚本）+ fork 代码就位 | ✅ 能构建运行 |
| M2 | 24fps 动画引擎 + PET.md 素材加载器 + Codex 兼容 | 🔄 step-1 fps 覆盖 ✅ / step-2 dir 加载器 ✅ / 待 DSH 实机换肤验证 |
| M3 | 完整行为 AI（心情/走动/打哈欠/音乐联动） | 桌宠「活」起来 |
| M4 | 文档 + 示例皮肤 + GitHub/npm 双发（含安全扫描） | 可被 dsh plugin add 安装 |

**M2 进度**：
- ✅ step-1：`pet.json` fps 全局 + actions 逐动作覆盖；`durationsFor()` 三优先级（actions > 全局 > Codex 契约）
- ✅ step-2：dir 格式加载器 `PetDirLoader`（帧数不限、批量并发解码、fps 继承）+ AnimationController 双模式 + PetWindow 动作映射/自由动作/任意帧尺寸适配 + `whale-ui-pet` 素材接入（23 动作 1007 帧）
- ✅ step-3：按需召唤（见五·五）——按钮触发、跨会话不自动启动、三层崩溃隔离
- ✅ 测试：`tests/petdir.spec.ts` 9 项（真实素材 + fake clock），全绿
- ✅ 双端修复：CLIENT_ID='whale-pet-pro'（client 注册，当时包名）+ cordis.patch.yml name='whale-pet-pro'（host 解析，当时包名）+ 残留旧 junction 隔离（注：2026-08-16 后包名统一为 dsh-whale-pet-pro）
- ⏳ step-4：DSH 实机验证（重启后点 🐳 按钮召唤 whale-ui-pet）

## 七、风险与对策

- 音乐联动在 Windows 的媒体检测没有统一 API → 用「检测混音器/已知播放器进程」的降级方案，不支持就优雅禁用
- 24fps 高帧率的内存占用 → 帧预缓存 LRU 上限，超了流式加载
- fork 与上游的协议兼容 → 保留 Codex 契约路径，旧素材不失效
