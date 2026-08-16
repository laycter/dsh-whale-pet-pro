/**
 * Host-side pet catalog: scans the bundled `assets/pets/` directory at startup
 * and loads a pet directory into a decoded atlas.
 */

import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PetCatalogEntry } from './config'
import { loadPet } from './renderer/codex-pet/PetLoader'
import type { LoadedPet } from './renderer/codex-pet/PetLoader'
import type { PetManifest } from './renderer/codex-pet/PetContract'
import type { AtlasBuffer } from './renderer/FrameDecoder'
import { loadPetDir, type DirFrameTable } from './renderer/petdir/PetDirLoader'

const ASSETS_DIR = fileURLToPath(new URL('../assets/pets/', import.meta.url))

/** Fallback entry used when no pet directory can be found on disk. */
const FALLBACK_ENTRY: PetCatalogEntry = { id: 'text', displayName: 'Text (test)' }

/**
 * Scan a directory of pets (`assets/pets/` by default) for pet directories and
 * read their `pet.json` manifests.
 *
 * A directory is a pet if it contains a readable `pet.json` with a string
 * `id`. The directory name is the pet id (a `dsh-` prefix on the manifest id
 * is stripped for display). Invalid directories are skipped so one broken pet
 * never takes down the catalog. Returns the fallback `text` entry when nothing
 * valid is found.
 *
 * Synchronous so the settings namespace can be registered with the complete
 * catalog as its `base` during the plugin's synchronous startup.
 *
 * @param directory - overrides the assets directory (used by tests).
 */
export function scanPets(directory: string = ASSETS_DIR): PetCatalogEntry[] {
  let entries: PetCatalogEntry[] = []
  try {
    const names = readdirSync(directory, { withFileTypes: true })
    for (const dirent of names) {
      if (!dirent.isDirectory()) continue
      const id = dirent.name
      try {
        const raw = readFileSync(join(directory, id, 'pet.json'), 'utf8')
        const manifest = JSON.parse(raw) as Record<string, unknown>
        if (typeof manifest.id !== 'string' || manifest.id.length === 0) continue
        const displayName = typeof manifest.displayName === 'string' && manifest.displayName.length > 0
          ? manifest.displayName
          : id
        entries.push({ id, displayName })
      } catch {
        // Not a valid pet directory; skip it.
      }
    }
  } catch {
    // Assets directory missing entirely; fall through to the fallback.
  }

  if (entries.length === 0) entries = [FALLBACK_ENTRY]
  return entries
}

function toAtlas(loaded: LoadedPet): AtlasBuffer {
  return { width: loaded.atlasWidth, height: loaded.atlasHeight, rgba: loaded.rgba }
}

/** whale-pet-pro 扩展：图集 + 清单 + （dir 格式的）帧表 + 目录路径一起返回。 */
export interface LoadedPetAtlas {
  atlas: AtlasBuffer
  manifest: PetManifest
  /** dir 格式素材的帧表；codex 格式为 undefined。 */
  tables?: Map<string, DirFrameTable>
  /** pet 目录绝对路径（M4 音效用：manifest.audio 相对路径拼到此目录）。 */
  directory: string
}

/**
 * Load a pet by id (a directory name under `assets/pets/`) into an atlas.
 * codex 格式（pet.json 声明 spritesheetPath）走 spritesheet 加载；
 * dir 格式（无 spritesheetPath）额外加载各动作目录的序列帧。
 */
export async function loadPetAtlas(petId: string): Promise<LoadedPetAtlas> {
  const directory = join(ASSETS_DIR, petId)
  const loaded = await loadPet({ directory })
  const atlas: AtlasBuffer = toAtlas(loaded)
  if (loaded.manifest.format === 'dir') {
    const tables = await loadPetDir(directory, loaded.manifest)
    return { atlas, manifest: loaded.manifest, tables, directory }
  }
  return { atlas, manifest: loaded.manifest, directory }
}
