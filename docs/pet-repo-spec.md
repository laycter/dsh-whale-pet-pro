# 宠物仓库规范（多来源市场）

> whale-pet-pro 的桌宠市场是**多来源聚合**的：任何 GitHub 仓库，只要根目录带
> 一份 `index.json` 桌宠清单，就算一个「宠物仓库」。前端配置来源列表，拉取
> 并合并所有仓库的桌宠——**社区去中心化，人人可建仓库，不依赖中心审批**。

## 一、市场如何工作

```
whale-pet-pro 前端
   │  PET_MARKET_SOURCES（来源列表，见 src/client/pet-market.ts）
   ├→ 拉取 whale-pet-assets 的 index.json ──┐
   ├→ 拉取 成员A 的宠物仓库 index.json ──────┤ 合并去重（按 id）
   ├→ 拉取 成员B 的宠物仓库 index.json ──────┘
   └→ 虚拟列表展示所有桌宠
```

- 每个来源 = 一个仓库根目录的 `index.json`（raw URL）。
- 单个来源拉取失败**不影响其它来源**（跳过失败源）。
- 合并按 `id` 去重，先到先得。

## 二、怎么建一个宠物仓库

### 1. 仓库结构

```
你的仓库/
├── index.json           ← 桌宠清单（必须）
├── pets/<pet-id>.zip    ← 桌宠包（一个 zip 一个桌宠）
└── previews/<pet-id>.gif ← 预览图 / 演示 GIF（可选但推荐）
```

### 2. `index.json` 格式

```json
{
  "pets": [
    {
      "id": "my-pet",
      "name": "我的桌宠",
      "description": "一句话描述这个桌宠",
      "preview": "https://raw.githubusercontent.com/<你的账号>/<仓库>/main/previews/my-pet.gif",
      "download": "https://media.githubusercontent.com/media/<你的账号>/<仓库>/main/pets/my-pet.zip",
      "author": "你的名字",
      "license": "MIT"
    }
  ]
}
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | 桌宠 id = 解压后放进 `assets/pets/<id>/` 的目录名 |
| `name` | 是 | 市场列表显示的名称 |
| `description` | 是 | 一句话描述 |
| `preview` | 推荐 | 预览图 URL（raw 直链；GIF 会自动播动画） |
| `download` | 是 | zip 下载直链 |
| `author` | 推荐 | 作者名（用于鸣谢） |
| `license` | 是 | 许可（MIT / GPL-3.0 / CC-BY…） |

> ⚠️ **大文件注意**：GitHub 单文件超 100MB 需要 Git LFS；LFS 文件的 raw URL
> 返回的是 134 字节 pointer，**下载必须用 media URL**：
> `https://media.githubusercontent.com/media/<账号>/<仓库>/main/pets/<id>.zip`

### 3. 桌宠包格式（zip）

zip 内直接是 `pet.json` + 动作目录，**不要**外层再套 `<pet-id>/`：

```
<pet-id>.zip
├── pet.json             ← 配置：id / semantic 映射 / actions（fps/variants/loops）/ audio
├── ACTIONS.md           ← 动作清单（给 DSH/agent 读，可选）
├── idle_0/ 1.png 2.png ...
├── walk_0/ walk_1/ ...
├── happy_0/ happy_1/ ...
├── drag/ fall/ sleep/ ...
└── 各动作目录内的 sound.m4a（可选）
```

`pet.json` 关键字段（完整见 whale-pet-pro 的
[`docs/MAPPING-ARCHITECTURE.md`](./MAPPING-ARCHITECTURE.md)）：

```jsonc
{
  "id": "my-pet",
  "format": "dir",
  "fps": 24,
  "scale": 0.35,
  "semantic": {
    "idle": "idle", "working": "walk", "success": "happy",
    "error": "hurt", "sleeping": "sleep", "hover": "happy",
    "drag": "drag", "fall": "fall", "starting": "fall"
  },
  "actions": { "idle": { "variants": 4 }, "happy": { "loops": 1 } },
  "audio": { "working": "walk_0/sound.m4a", "drag": "drag/sound.m4a" }
}
```

## 三、加入市场（二选一）

1. **把自己的仓库加进 whale-pet-pro 的来源列表**：在
   [whale-pet-pro](https://github.com/laycter/whale-pet-pro) 提 PR，把仓库的
   index.json raw URL 加进 `src/client/pet-market.ts` 的 `PET_MARKET_SOURCES`。
2. **提 PR 到 whale-pet-assets**：把 zip + 预览图 + index.json 条目提交到
   [whale-pet-assets](https://github.com/laycter/whale-pet-assets)，由仓库维护者合并。

## 四、版权与许可（红线）

- **必须**在 `index.json` 里标注 `author` 与 `license`。
- 使用第三方素材（如 DeskPet 的 BoringPet）**必须**尊重原作者许可（GPL 素材
  有传播要求），并在 README / CREDITS 鸣谢原作者。
- 素材归原作者所有，聚合仓库只做分发；原作者要求删除时立即移除。
