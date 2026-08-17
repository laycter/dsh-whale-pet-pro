# dsh-whale-pet-pro 🐳

> A silky 24fps desktop-pet engine with behavior AI, as a
> [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH) plugin.
> Forked from [dsh-desktop-pet](https://github.com/) (MIT).

**This repo ships the engine only (MIT) — no pet assets.** Download assets
separately from [whale-pet-assets](https://github.com/laycter/whale-pet-assets).

中文文档见 [README.zh.md](README.zh.md)。

---

## Quick start

1. **Install** the plugin:
   ```bash
   dsh plugin add dsh-whale-pet-pro   # or: npm install dsh-whale-pet-pro
   ```
2. **Download a pet** (required — the pet shows nothing without assets):
   grab `boring-pet.zip` from
   [whale-pet-assets](https://github.com/laycter/whale-pet-assets) and unzip it
   into `assets/pets/boring-pet/`.
3. **Summon**: DSH settings → 桌宠 (desktop pet) → toggle the summon switch.

> ⚠️ The pet **does not auto-start** (`enabled: false`); it appears only after
> you toggle the summon switch.

---

## Features

- **24fps animation** — frame pre-caching + streaming decode, arbitrary frame counts
- **Externalized semantic mapping** — `pet.json` maps semantic states → actions; swapping pets is zero-code
- **Multi-variant + loop control** — `idle_0/1/2/3` auto-merge; `loops` for one-shot vs looping
- **Audio** — UWP MediaPlayer for m4a, triggered by semantic state, right-click "Toggle sound"
- **Behavior AI** — mood, idle variant cycling, yawning, autonomous wandering
- **On-demand summon + crash isolation** — never auto-starts; asset loading is lazy; GUI always survives
- **Pet marketplace** — built-in "get more pets" browser/downloader

## Layout

```text
dsh-whale-pet-pro/
├── src/
│   ├── renderer/            # animation controller, window, frame decoder, backends, audio
│   ├── behavior/            # MoodSystem + BehaviorAI (behavior AI)
│   ├── integration/         # HarnessBridge (DSH events)
│   ├── core/                # PetStateMachine + type vocabulary
│   ├── client/              # settings UI + pet marketplace
│   └── index.ts             # plugin entry (wires everything)
├── assets/pets/             # pet assets (NOT shipped; user-downloaded)
├── docs/                    # architecture / asset spec / adding-a-pet
├── tests/                   # vitest unit tests
├── cordis.patch.yml         # default bundle config
├── LICENSE                  # MIT
└── CREDITS.md               # credits + asset licensing
```

## How it works

```
DSH events → HarnessBridge → PetStateMachine (10 semantic states)
    ├→ PetWindow.setState()      # semantic action (idle/walk/happy/...)
    └→ BehaviorAI (idle only)    # variant cycling / yawn / wander
           └→ MoodSystem         # mood 0-100, activity boosts/drops
    → AnimationController (24fps) → WindowBackend (Win32 overlay)
```

## Configuration

`cordis.patch.yml` ships defaults (`enabled: false`, `alwaysOnTop: true`,
`petScale: 1`, …). User-editable settings live in the `desktop-pet` namespace:
`enabled`, `petId`, `petScale`, `hideWhenIdle`.

> ⚠️ **DSH whitelist patch**: DSH's API gateway does not expose newly registered
> settings namespaces to the browser by default. Add `'desktop-pet'` to
> `WEB_SETTINGS_NAMESPACES` in `packages/host/apiproxy/src/api-proxy.ts`, and
> re-apply after every DSH upgrade.

## Getting pet assets

Engine ships no assets. See [whale-pet-assets](https://github.com/laycter/whale-pet-assets)
for ready-made pet packs, or extract `BoringPet/` from
[DeskPet](https://github.com/2048Nemo/DeskPet). Asset format: a directory with
`pet.json` + action dirs (`idle_0/1.png …`), optionally per-action `sound.m4a`.
See [docs/adding-a-pet.md](docs/adding-a-pet.md) and
[docs/pet-asset-spec.md](docs/pet-asset-spec.md).

## Example pet: BoringPet

BoringPet (@2048Nemo, GPL-3.0) is the reference pet — 16 actions / 1778 frames /
14 m4a. Its `pet.json` demonstrates semantic mapping, action variants/loops, and
audio. Key mappings: `idle→idle`, `working→walk`, `success→happy`, `error→hurt`,
`sleeping→sleep`, `hover→happy`, `drag→drag`, `fall→fall`, `starting→fall`.
Audio policy mirrors DeskPet: `idle`/`home` are silent, others play once.

## Credits & license

- **Engine**: MIT — see [LICENSE](LICENSE).
- **BoringPet assets**: GPL-3.0 by [@2048Nemo](https://github.com/2048Nemo)
  (DeskPet). Not shipped here; distributed separately via whale-pet-assets.
  Thanks and credit: [CREDITS.md](CREDITS.md).
