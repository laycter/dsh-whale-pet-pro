# 宠物仓库规范（注册表 + 多来源市场）

> dsh-whale-pet-pro 的桌宠市场由**注册表**（[whale-pet-assets](https://github.com/laycter/whale-pet-assets) 的
> `index.json`）统一管「来源列表」：注册表顶层 `sources` 数组列出所有宠物仓库的
> index.json URL。前端先拉注册表 → 并行拉所有来源 → 合并去重展示。
> **社区作者建自己的宠物仓库，把 URL 加进注册表 `sources`（PR 一行）即被聚合，
> 引擎代码一次不用改。**

## 一、市场如何工作

```
dsh-whale-pet-pro 前端
   │  ① 拉注册表 whale-pet-assets/index.json → 读 sources 列表
   ├→ ② 拉 whale-pet-assets 的 index.json ──┐
   ├→ ② 拉 成员A 的宠物仓库 index.json ──────┤ 合并去重（按 id）
   ├→ ② 拉 成员B 的宠物仓库 index.json ──────┘
   └→ 虚拟列表展示所有桌宠
```

- 注册表 `index.json` 结构：

```json
{
  "sources": [
    "https://raw.githubusercontent.com/laycter/whale-pet-assets/main/index.json",
    "https://raw.githubusercontent.com/<成员A>/<仓库>/main/index.json"
  ],
  "pets": [ { ... 注册表自带的宠物 ... } ]
}
```

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

`pet.json` 关键字段（完整见 dsh-whale-pet-pro 的
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

## 三、加入市场（两种方式）

### 方式 A（推荐）：独立宠物仓库 + 注册表一行 URL

1. 建自己的仓库（根目录带 `index.json` + `pets/` + `previews/`，见上文）。
2. 在 [whale-pet-assets](https://github.com/laycter/whale-pet-assets) 提 PR，
   把仓库的 index.json raw URL 加进 `index.json` 的 `sources` 数组（**一行**）：

```json
"sources": [
  "https://raw.githubusercontent.com/laycter/whale-pet-assets/main/index.json",
  "https://raw.githubusercontent.com/<你的账号>/<你的仓库>/main/index.json"
]
```

3. 维护者合并 → 市场前端下次打开自动聚合你的仓库（素材仍在你自己的仓库，
   你随时自己更新，无需再 PR）。

> 这种方式**不碰引擎代码**，素材自主管理，适合想长期维护自己桌宠的作者。

### 方式 B：直接提交到 whale-pet-assets

把 zip + 预览图 + `index.json` 的 `pets` 数组条目提交到
[whale-pet-assets](https://github.com/laycter/whale-pet-assets)，由仓库维护者合并。
素材集中托管，适合一次性投稿。

## 四、版权与许可（红线）

- **必须**在 `index.json` 里标注 `author` 与 `license`。
- 使用第三方素材（如 DeskPet 的 BoringPet）**必须**尊重原作者许可（GPL 素材
  有传播要求），并在 README / CREDITS 鸣谢原作者。
- 素材归原作者所有，聚合仓库只做分发；原作者要求删除时立即移除。
