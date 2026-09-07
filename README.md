# MotionShelf

MotionShelf 是一个本地优先的桌面照片管理器，面向 macOS 和 Windows，帮助你把手机照片、视频、Apple Live Photo 与 Android Motion Photo 传到电脑后统一浏览、播放和整理。

> 当前仓库是持续迭代中的 0.5.x 原型。桌面端可直接开发和构建；Android 伴侣目录目前是 Gradle/Manifest scaffold，Manifest 引用的 Kotlin Activity/Service 源文件尚未随本分支提交，因此 Android 工程暂不宣称可独立构建。

## 为什么是 MotionShelf

手机系统相册里的“动态照片”到了电脑上，常常会被拆成一张静态图片和一个视频，拍摄时间、地点、设备和相机参数也容易丢失。MotionShelf 把导入、配对、元数据和播放放在一个本地媒体库里：

- **统一动态资产**：自动配对同名图片与 MOV/MP4，识别 Apple Live Photo 和 Android Motion Photo。
- **完整原文件**：原始 HEIC/HEIF、JPEG、MOV、MP4 等文件保留在媒体库，不经过云端压缩。
- **元数据整理**：读取可用的 EXIF/XMP/QuickTime 信息，包括拍摄时间、GPS、设备、镜头、曝光、ISO 等。
- **两种导入方式**：电脑文件夹/USB 导入，以及局域网二维码直传；无线传输支持分片确认与断点恢复。
- **桌面浏览体验**：实况照片自动播放并保留声音，视频按普通、慢动作、延时摄影、电影效果、屏幕录制等类型展示。
- **全屏查看**：左右切换、缩放与拖拽查看细节、收藏、多选移入应用回收站并恢复。
- **性能自适应**：可在设置中开启自适应性能策略；设备负载较高时降低高成本动效，但不关闭媒体能力。
- **中英文界面**：首次启动跟随系统语言，也可以在设置中固定使用中文或 English；语言偏好会保存在本机。
- **隐私优先**：媒体库和传输服务默认在本机运行，二维码只用于建立当前局域网会话。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 桌面壳 | Electron 34 |
| UI | React 19、TypeScript 5、Vite 6 |
| 图标与元数据 | Phosphor Icons、exifr、heic-convert |
| 传输 | Electron 主进程 HTTP 服务、SHA-256 去重、4 MiB 分片 |
| iPhone 伴侣 | SwiftUI、PhotoKit、XcodeGen 配置 |
| Android 伴侣 | Android Gradle Plugin/Kotlin scaffold（见下方状态说明） |

## 环境要求

- macOS 或 Windows（x64/arm64 均可运行 Electron 开发环境）。
- Node.js 20 或更高版本。
- pnpm 11（仓库通过 `packageManager` 字段声明）。如果系统没有 pnpm，可先运行 `corepack enable`。
- 若要构建 iOS 伴侣，需要 macOS、Xcode 15+、iOS 16+ SDK 和可用的 Apple 开发签名。
- 若要继续完善 Android 伴侣，需要 Android Studio、Android SDK 35 与 JDK 17。

## 快速开始

```bash
corepack enable
pnpm install
pnpm run dev
```

首次启动会引导你选择媒体库存储位置。媒体库为空时，界面会提示从手机导入或选择电脑文件夹，不会预置虚构照片。

常用命令：

```bash
# 只启动 Vite 渲染进程
pnpm run dev:web

# 启动已构建的 Electron 渲染内容
pnpm run dev:desktop

# 类型检查并构建 dist/
pnpm run build

# 运行语言选择与翻译回退测试
pnpm test

# 构建 Electron 安装包（输出到本地 release/，不会提交到 Git）
pnpm run dist
```

## 导入手机照片

### 局域网二维码导入

1. 在 MotionShelf 右上角选择“导入 → 用手机扫码导入”。
2. 让电脑和手机连接同一个 Wi-Fi，用手机相机扫描二维码。
3. 在手机页面选择照片或视频；原始文件会直接写入媒体库的 `Incoming/`，完成后桌面端自动扫描、去重、配对和解析元数据。
4. 手机浏览器或 Wi-Fi 短暂中断时，可以回到传输页继续/恢复未完成的文件。Windows 首次运行需要允许 MotionShelf 访问专用网络。

对 iPhone 来说，Safari 的网页文件选择器可能只返回一张 JPEG。若要完整保留 Live Photo 的静态照片与配对视频，请使用仓库中的原生 iOS 伴侣；Android Motion Photo 请尽量从系统文件选择器或 Google 相册导出原始文件。

### USB 导入

右上角选择“导入 → 通过 USB 导入 Live Photo”，按向导完成以下步骤：

1. 用数据线连接并解锁手机，按系统提示信任电脑。
2. macOS 使用图像捕捉，Windows 使用系统照片导入，把原始文件导入一个容易找到的文件夹。
3. 回到 MotionShelf 选择该文件夹，在预览网格中勾选要加入媒体库的项目。

Windows 导入 Live Photo 时，系统可能把同一张实况照片显示为同名 `.HEIC` 与 `.MOV` 两个项目；请同时勾选它们，MotionShelf 才能合并为一个动态资产。

## 动态照片与元数据说明

- Apple Live Photo 通常由同名静态图片与 MOV 组成；MotionShelf 会保留两份原始文件并在 UI 中显示为一个“实况照片”。
- Android Motion Photo 可能是带内嵌 MP4 的单个 HEIC/JPEG，也可能是图片 + 视频两个文件；能否完整识别取决于手机厂商导出的原始封装。
- 元数据字段按文件实际提供的内容显示；如果系统导入流程已经移除了 EXIF/XMP/QuickTime 字段，应用无法从压缩后的副本恢复这些信息。
- GPS 属于敏感信息，媒体库默认只在本机显示和索引，不会上传到第三方服务。

## 目录结构

```text
src/                         React 渲染进程、媒体库 UI 与样式
electron/                    Electron 主进程、HTTP 传输服务与安全 IPC
scripts/                     Vite/Electron 开发脚本
ios/MotionShelfMobile/       SwiftUI iPhone 伴侣源码与 XcodeGen 配置
android/                     Android Gradle scaffold 与使用说明
marketing/xiaohongshu/       可公开的产品演示图与宣传文案
```

`node_modules/`、`dist/`、`release/`、Android/Gradle 构建目录和 `outputs/` 均为本地生成内容，已通过 `.gitignore` 排除。安装包建议作为 GitHub Release 附件发布，而不是提交进源码历史。

## 隐私与安全

- 应用没有必需的云端账号、API Key 或数据库连接配置。
- 局域网服务只在用户主动开启手机导入时启动，并使用临时 token；传输完成或点击“结束传输”后会关闭。
- 请不要把真实照片、导出的手机目录、签名证书、`.env` 文件或本机日志提交到公开仓库。
- 发布前可使用 `git diff --cached` 和 `git grep --cached` 再次审查暂存区。

## 贡献

欢迎提交 Issue 和 Pull Request：

1. Fork 仓库并创建功能分支。
2. 使用 `pnpm install --frozen-lockfile` 安装依赖。
3. 修改后至少运行 `pnpm run build`，并在 PR 中说明测试平台（macOS/Windows）。
4. 涉及照片格式、传输协议或隐私行为的改动，请附上复现文件类型和不包含个人信息的日志。

Android 伴侣当前缺少 Manifest 所引用的 Kotlin 源文件；如果你准备贡献 Android 实现，请先补齐 `MainActivity`、`TrashActivity` 和 `TransferService`，并在 Android Studio 中验证 `assembleDebug`。

## License

本项目以 [MIT License](LICENSE) 发布。第三方依赖各自遵循其上游许可证。
