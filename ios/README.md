# MotionShelf iPhone 伴侣

这是 MotionShelf 的原生 iPhone 导入端。它使用 Apple PhotoKit 读取原始照片资源，因此能够把 Live Photo 的静态照片和配对视频作为两个同名文件发送给桌面端；桌面端会自动把它们合并为一个可播放的 Live Photo 资产。

## 运行方式

本目录提供可直接放进 Xcode 的 SwiftUI 源码和一个 XcodeGen `project.yml`。当前开发环境没有完整 Xcode（只有 Command Line Tools），所以这里无法代替用户完成 iOS 签名和安装 IPA。

1. 在 Mac 安装 Xcode 15 或更高版本。
2. 安装 XcodeGen 后，在本目录运行 `xcodegen generate`；或者新建一个 iOS App 项目，把 `MotionShelfMobile` 目录里的 Swift 文件和 `Info.plist` 加入项目。
3. 用数据线连接 iPhone，选择 iPhone 作为运行目标并运行。首次运行时允许访问照片和相机；使用个人 Apple ID 也可以在自己的设备上测试（签名有效期由 Apple 账号规则决定）。
4. 在 MotionShelf 桌面端开启“手机传输”，用 iPhone 相机扫描二维码。二维码页面上的“用 MotionShelf iPhone 伴侣导入 Live Photo 原始资源”链接也可以直接启动伴侣。
5. 在伴侣中选择照片。Live Photo 会导出为同名的 `.HEIC`/`.JPG` 和 `.MOV`，随后通过局域网直接上传到桌面端 `Incoming` 文件夹，不经过云端。

桌面端也继续支持普通 Safari/Chrome 选择器；但 iOS 浏览器出于系统权限限制可能只返回一张 JPEG，想完整保留 Live Photo 时请使用这个原生伴侣。
