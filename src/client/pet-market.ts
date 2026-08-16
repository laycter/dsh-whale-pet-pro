/**
 * 桌宠市场数据模型 + 拉取（多来源仓库）。
 *
 * 前端从**多个**桌宠包仓库拉取各自的 `index.json`（桌宠清单），合并去重后
 * 客户端分页 + 虚拟列表展示。任何人的仓库只要根目录带 `index.json` 就算一个
 * 「宠物仓库」，把 URL 加进 {@link PET_MARKET_SOURCES} 即被市场聚合——
 * 社区桌宠去中心化、源源不断。
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

/**
 * 桌宠市场来源仓库列表（多来源，鸭鸭拍板 2026-08-16）。
 * 每个来源 = 一个 GitHub 仓库的 index.json raw URL。社区成员建好自己的
 * 宠物仓库后，把 URL 加进此数组即可聚合（规范见 docs/pet-repo-spec.md）。
 */
export const PET_MARKET_SOURCES: string[] = [
  'https://raw.githubusercontent.com/laycter/whale-pet-assets/main/index.json',
]

/**
 * 拉取并合并所有来源的桌宠清单（按 id 去重，先到先得）。
 * 来源全部为空时返回 mock 数据（UI 开发阶段）。
 *
 * 更新机制（鸭鸭钦点）：社区桌宠源源不断，index.json 会持续更新——每次
 * 打开市场都强制拉最新（`cache: 'no-store'` + 时间戳绕过 GitHub raw 的
 * 5 分钟缓存）。清单全量拉取（元数据小），客户端分页 + 虚拟列表展示。
 */
export async function fetchPetMarket(): Promise<PetMarketIndex> {
  if (PET_MARKET_SOURCES.length === 0) return { pets: MOCK_PETS }
  const results = await Promise.allSettled(
    PET_MARKET_SOURCES.map(async (source) => {
      const url = `${source}?t=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`pet market fetch failed: ${res.status} (${source})`)
      return (await res.json()) as PetMarketIndex
    }),
  )
  // 合并去重：单个来源失败不影响其它来源（跳过失败源）。
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
