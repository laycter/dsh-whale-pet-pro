# Credits & 素材许可说明（Credits & Asset Licensing）

## 引擎（dsh-whale-pet-pro）

本项目的代码（动画引擎、语义映射、音效播放、行为 AI、市场 UI）基于
[dsh-desktop-pet](https://github.com/)（MIT）二次开发，采用 **MIT** 许可。

## 示例宠物 BoringPet 素材

- **作者**：[**@2048Nemo**](https://github.com/2048Nemo)，桌面宠物项目
  [DeskPet](https://github.com/2048Nemo/DeskPet) 的作者。
- **内容**：BoringPet 素材包 —— 16 个动作、1778 帧透明 PNG、14 个 m4a 音效。
- **许可**：**GPL-3.0**（copyleft）。

> 衷心感谢 @2048Nemo 提供这套精美、帧数充足的桌宠素材，并开放其
> DeskPet 项目供学习与参考。BoringPet 的动作语义（idle/walk/happy/hurt/
> sleep/yawn/drag/fall/home/eat）与音效策略，直接启发了本项目的
> 语义映射与音效设计。

### 为什么 BoringPet 素材不随本包分发

BoringPet 素材是 **GPL-3.0**，而 dsh-whale-pet-pro 引擎是 **MIT**。二者混合分发
会形成「混合许可」，使引擎失去 MIT 允许下游闭源商用的自由度。因此：

- ✅ **引擎包（本仓库 / npm）**：MIT，**不含任何宠物素材**
- ✅ **素材独立仓库** [whale-pet-assets](https://github.com/laycter/whale-pet-assets)：
  单独托管宠物素材包（含 BoringPet，标注 GPL-3.0），用户按需下载

### 获取 BoringPet 素材

两种方式，详见 [README](./README.zh.md) 的「获取宠物素材」一节：

1. **推荐**：从 [whale-pet-assets](https://github.com/laycter/whale-pet-assets)
   下载现成的 `boring-pet.zip`，解压到 `assets/pets/boring-pet/`。
2. **备选**：从 [DeskPet](https://github.com/2048Nemo/DeskPet) 仓库提取
   `BoringPet/` 目录，自行整理成 `pet.json + 动作目录` 的素材包格式
   （参见 `docs/adding-a-pet.zh.md`）。
