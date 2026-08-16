# M3 行为 AI · 最小活起来（设计 v1 · 待鸭鸭审阅）

> 目标：让桌宠在**空闲时**自己「活」起来——打哈欠、换姿势、小范围溜达，
> 并由「心情值」驱动这些行为的频率。DSH 一有活（干活/成功/出错）立刻让位。
> 本阶段只做「最小闭环」，音乐联动/爬墙/对话情感/双向互动后续再议。

## 一、目标与边界

### 做（4 个行为）
1. **心情数值**：0-100，随时间缓慢衰减；DSH 活动（干活/成功）回升、出错小降
2. **打哈欠**（yawn）：定时随机触发，心情低更频繁
3. **待机换肤**：idle_0~3 变体定时轮换（现在随机、改定时）
4. **自主走动**（walk）：小范围 ±150px 来回溜达，心情高更频繁

### 不做（本次明确排除）
- ❌ 音乐联动（Windows 媒体检测无统一 API）
- ❌ 爬墙/倒挂/使坏（DeskPet 素材缺失）
- ❌ 对话情感词→动作（DialogueBridge）
- ❌ 双向互动（戳宠物→对话回应 / poke 事件）
- ❌ 抚摸恢复心情（无 poke 交互，本次用 DSH 活动事件替代）

## 二、模块设计（新增 `src/behavior/`）

```
src/behavior/
├── MoodSystem.ts     ← 心情状态机（0-100，衰减 + 事件回升，纯逻辑可测）
├── BehaviorAI.ts     ← 自主行为调度器（打哈欠/换肤/走动，纯逻辑可测）
└── BehaviorTypes.ts  ← 共享类型 + BehaviorExecutor 接口
```

### MoodSystem（心情，纯状态机）
- 字段：`mood`（0-100，初始 60）
- 方法：
  - `tick()` —— 每 60 秒 -1（慢速衰减，不会很快掉光）
  - `onActivity(kind)` —— `working` +5、`success` +8、`error` -5（上限 100 下限 0）
  - `moodLevel()` —— 档位：`happy`(≥65) / `neutral` / `bored`(≤35)
- 注入 `clock`，可测

### BehaviorAI（调度器，只在 idle 时接管）
- 依赖：`MoodSystem` + `BehaviorExecutor`（接口，解耦渲染层）
- 输入：`onSemanticState(state)` —— `idle` 开始调度；非 idle 暂停并让位（清定时器）
- 内部：按「心情档位 + 活泼度常量」决定下一个自主行为（见规则表）
- 注入 `clock` + `random`，可测

### BehaviorExecutor（PetWindow 实现）
```ts
interface BehaviorExecutor {
  playAction(action: string): void                      // 播一次性动作（yawn/happy）
  nextIdleVariant(): void                               // 切到下一个 idle 变体
  walk(direction: 'left' | 'right', steps: number): void // 走动（动画 + 移动窗口）
  isIdle(): boolean                                     // 当前语义是否空闲
}
```

## 三、行为规则表（安静乖巧档，参数均为可调常量）

| 行为 | 基础频率 | 心情高(happy) | 心情低(bored) | 说明 |
|---|---|---|---|---|
| 待机换肤 | 每 ~20 秒 | 同左 | 同左 | idle_0→1→2→3 顺序轮换 |
| 打哈欠 yawn | 每 60~120 秒随机 | 120~180 秒（很少） | 30~60 秒（频繁） | `playAction('yawn')` |
| 开心 happy | 几乎不 | 偶尔主动蹦跳 | 不 | `playAction('happy')` |
| 自主走动 walk | 每 120~180 秒随机 | 60~120 秒（更频繁） | 很少/不走 | 走 3~8 步，见下 |

### 自主走动细节
- 一次走动 = 朝随机方向走 **3~8 步**，每步 `move(±30px)`，每步间隔 ~150ms
- 锚点 = 召唤时的窗口位置；走动范围约束在锚点 **±150px** 内，越界则反向走回
- 向左走需**水平镜像**（boring-pet 的 walk 只画一个方向）——新增 `FrameDecoder.flipHorizontal()`
- 走动是「瞬时的短途溜达」（几秒走完回 idle），不做长时间漫游，避免复杂中断逻辑

## 四、关键机制

### 1. 行为 AI 与语义状态机的协调（谁说了算）
```
DSH 事件 → PetStateMachine（语义状态）→ index.ts
   ├→ window.setState(state)          ← 语义动作（干活/成功/出错…）
   └→ behaviorAI.onSemanticState(state) ← 行为 AI 只在 idle 接管
```
- 行为 AI 只在 `idle` 调度；DSH 一有活（WORKING/SUCCESS/ERROR…）立刻清定时器让位
- 打哈欠/换肤/走动是「自主 transient」，**不改变语义状态**（语义仍 idle）

### 2. 心情闭环（有陪伴感，无需抚摸交互）
- 没活动 → 心情缓慢衰减（无聊）
- 干活/成功 → 心情回升（**主人工作 = 宠物陪伴**）
- 心情反作用于行为频率（见规则表）

### 3. 走动被中断（DSH 优先）
- 走动期间若 `setState` 进来（DSH 有活），立即停步进定时器、清镜像、恢复语义动作
- 与现有 `introPlaying`（出场）排队机制并存，互不冲突

## 五、分步实现（每步验证再下一步）

| 步 | 内容 | 验证 |
|---|---|---|
| 1 | `FrameDecoder.flipHorizontal()` | 单测：像素翻转正确 |
| 2 | `MoodSystem` | 单测：衰减/回升/档位（fake clock） |
| 3 | `BehaviorAI` + `BehaviorExecutor` 接口 | 单测：调度决策（fake clock + 固定 random） |
| 4 | `PetWindow` 实现 `nextIdleVariant` / `walk` / 镜像接入 | typecheck + 现有测试不破 |
| 5 | `index.ts` 组装（创建 MoodSystem + BehaviorAI，转发语义状态） | typecheck + build |
| 6 | 实机验收 | 见验收清单 |

## 六、验收标准（实机）

1. 召唤 → 出场掉落 → 落地转 idle，约 20 秒后 idle 变体自动切换
2. 空闲时约 1-2 分钟出现一次打哈欠；长时间空闲后打哈欠变频繁
3. 空闲时宠物偶尔小范围溜达（真的在屏幕上移动，向左走是镜像）
4. 主人干活/任务成功时，宠物心情回升、走动变多
5. DSH 有活（干活/成功/出错）时，自主行为立即让位、不抢戏
6. 全程不崩、不卡、不影响 GUI 和对话

## 七、决策记录

- 活泼度：**安静乖巧**（鸭鸭拍板）——走动 2-3 分钟、打哈欠 1-2 分钟、换肤 20 秒
- 心情：**驱动行为频率**（鸭鸭拍板）——低→打哈欠/发呆多，高→开心/溜达多
- 走动范围：**小范围 ±150px**（鸭鸭拍板）——不碰屏幕边缘，实现简单
- 频率参数先硬编码为常量（安静乖巧档），跑起来看效果再决定是否暴露为设置项
