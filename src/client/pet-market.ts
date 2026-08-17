/**
 * 桌宠市场数据模型 + 拉取（注册表 + 多来源聚合）。
 *
 * 市场由一个**注册表仓库**（whale-pet-assets）统一管「来源列表」：
 * - 注册表 `index.json` 顶层有 `sources` 数组（所有宠物仓库的 index.json URL，
 *   含注册表自己）+ `pets`（注册表自带的宠物）。
 * - 前端先拉注册表 → 读 `sources` → 并行拉所有来源的清单 → 合并去重。
 *
 * 社区作者想分享素材：建自己的宠物仓库（根目录带 index.json），把 URL 加进
 * 注册表的 `sources`（提 PR 一行即可）——**引擎代码一次不用改**。
 * 规范见 docs/pet-repo-spec.md。
 */

import { BORING_IDLE_GIF } from './boring-idle-gif'

export interface PetMarketItem {
  /** 目录名 / 桌宠 id（解压后放进 assets/pets/<id>/）。 */
  id: string
  name: string
  description: string
  /** 预览图 URL（仓库内 preview.gif/preview.png，GIF 自动演示动画）。 */
  preview?: string
  /** 下载链接（zip 直链或 GitHub 页面）。 */
  download: string
  author?: string
  license?: string
}

export interface PetMarketIndex {
  pets: PetMarketItem[]
}

/** 注册表仓库的 index.json：顶层 `sources`（来源 URL 列表）+ `pets`。 */
export interface PetMarketRegistry extends PetMarketIndex {
  sources?: string[]
}

/**
 * 市场注册表：唯一需要引擎记住的 URL。社区作者把新宠物仓库的 index.json URL
 * 加进这个注册表的 `sources` 数组（PR 一行），前端自动聚合（不再改引擎）。
 */
export const PET_MARKET_REGISTRY_URL = 'https://raw.githubusercontent.com/laycter/whale-pet-assets/main/index.json'

/**
 * 拉取市场清单：先读注册表拿 `sources`，再并行拉所有来源合并去重。
 * 注册表拉不到时回退到单来源（注册表自己）；完全不可用时返回 mock（UI 开发）。
 *
 * 更新机制（鸭鸭钦点）：社区桌宠源源不断，index.json 会持续更新——每次
 * 打开市场都强制拉最新（`cache: 'no-store'` + 时间戳绕过 GitHub raw 的
 * 5 分钟缓存）。清单全量拉取（元数据小），客户端分页 + 虚拟列表展示。
 */
export async function fetchPetMarket(): Promise<PetMarketIndex> {
  // 1) 拉注册表 → 读 sources 列表。
  let sources: string[] = []
  if (PET_MARKET_REGISTRY_URL.length > 0) {
    try {
      const url = `${PET_MARKET_REGISTRY_URL}?t=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const registry = (await res.json()) as PetMarketRegistry
        if (Array.isArray(registry.sources) && registry.sources.length > 0) {
          sources = registry.sources.filter((s): s is string => typeof s === 'string' && s.length > 0)
        }
      }
    } catch {
      // 注册表拉取失败：走下面的兜底。
    }
  }
  // 注册表没有 sources 时，兜底只拉注册表自己。
  if (sources.length === 0 && PET_MARKET_REGISTRY_URL.length > 0) {
    sources = [PET_MARKET_REGISTRY_URL]
  }
  if (sources.length === 0) return { pets: MOCK_PETS }

  // 2) 并行拉所有来源的清单。
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const url = `${source}?t=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`pet market fetch failed: ${res.status} (${source})`)
      return (await res.json()) as PetMarketIndex
    }),
  )

  // 3) 合并去重（按 id，先到先得；单个来源失败不影响其它来源）。
  const pets: PetMarketItem[] = []
  const seen = new Set<string>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const pet of result.value.pets) {
      if (pet && typeof pet.id === 'string' && !seen.has(pet.id)) {
        seen.add(pet.id)
        pets.push(pet)
      }
    }
  }
  return { pets }
}

// --- mock 数据（UI 开发用，仓库建好后删除或替换） ---

const mk = (id: string, name: string, description: string, author = '社区', license = 'MIT', preview?: string): PetMarketItem => ({
  id,
  name,
  description,
  preview,
  download: `https://github.com/whale-pet-assets/${id}/archive/refs/heads/main.zip`,
  author,
  license,
})

export const MOCK_PETS: PetMarketItem[] = [
  mk('boring-pet', 'Boring Pet', 'DeskPet 作者的经典桌宠：16 动作 + 音效，待机/走路/睡觉/出场全齐', '2048Nemo', 'GPL-3.0', BORING_IDLE_GIF),
  mk('whale-ui-pet', '鲸鱼娘·界面版', '23 动作 1007 帧，干活会游泳的小鲸鱼娘', '鸭鸭', 'MIT', BORING_IDLE_GIF),
  mk('fat-fish-maid', '大肥鱼女仆', '蓝色大肥鱼，可爱粘人', '鸭鸭', 'MIT'),
  ...Array.from({ length: 27 }, (_, i) => mk(
    `pet-demo-${i + 1}`,
    `示例桌宠 ${i + 1}`,
    `用于测试无限滚动与虚拟列表的占位桌宠 #${i + 1}`,
    `作者${i + 1}`,
  )),
]
