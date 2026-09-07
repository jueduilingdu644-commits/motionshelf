import Combine
import Foundation
import Photos
import PhotosUI
import UniformTypeIdentifiers

struct TransferItem: Identifiable {
    let id = UUID()
    let filename: String
    var state: String
}

@MainActor
final class TransferViewModel: ObservableObject {
    @Published var manualURL = ""
    @Published private(set) var host: String?
    @Published private(set) var isConnected = false
    @Published private(set) var isSending = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var items: [TransferItem] = []
    @Published var errorMessage: String?

    private var transferURL: URL?
    private var transferToken: String?

    var progressText: String {
        let complete = items.filter { $0.state == "已完成" }.count
        return items.isEmpty ? "" : "\(complete)/\(items.count) 个文件"
    }

    func handleIncomingURL(_ url: URL) {
        if url.scheme?.lowercased() == "motionshelf",
           let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value {
            handleIncomingText(value)
            return
        }
        handleIncomingText(url.absoluteString)
    }

    func handleIncomingText(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let hostName = components.host else {
            if !trimmed.isEmpty { errorMessage = "二维码地址无效，请回到电脑端重新开启手机传输后再扫描。" }
            return
        }
        transferURL = url
        transferToken = token
        host = components.port.map { "\(hostName):\($0)" } ?? hostName
        manualURL = trimmed
        isConnected = true
        Task { await notifyDesktop() }
    }

    private func notifyDesktop() async {
        guard let transferURL else { return }
        var request = URLRequest(url: transferURL)
        request.httpMethod = "GET"
        _ = try? await URLSession.shared.data(for: request)
    }

    func importResults(_ results: [PHPickerResult]) async {
        guard isConnected, transferURL != nil, transferToken != nil else {
            errorMessage = "请先扫描电脑上的二维码。"
            return
        }
        guard !results.isEmpty else { return }

        isSending = true
        progress = 0
        items = []
        do {
            let workDirectory = FileManager.default.temporaryDirectory
                .appendingPathComponent("MotionShelf-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: workDirectory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: workDirectory) }

            var exported: [ExportedFile] = []
            var seenAssets = Set<String>()
            for result in results {
                guard let identifier = result.assetIdentifier,
                      !seenAssets.contains(identifier) else { continue }
                seenAssets.insert(identifier)
                guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject else { continue }
                exported.append(contentsOf: try await exportResources(for: asset, to: workDirectory))
            }

            guard !exported.isEmpty else {
                throw TransferError.noOriginalResources
            }

            items = exported.map { TransferItem(filename: $0.filename, state: "准备中") }
            for (index, file) in exported.enumerated() {
                updateItem(at: index, state: "发送中")
                try await upload(file)
                updateItem(at: index, state: "已完成")
                progress = Double(index + 1) / Double(exported.count)
            }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        isSending = false
    }

    private func updateItem(at index: Int, state: String) {
        guard items.indices.contains(index) else { return }
        items[index].state = state
    }

    private func exportResources(for asset: PHAsset, to directory: URL) async throws -> [ExportedFile] {
        let resources = PHAssetResource.assetResources(for: asset)
        var result: [ExportedFile] = []

        if asset.mediaType == .video {
            let video = resources.first(where: { [.fullSizeVideo, .video].contains($0.type) }) ?? resources.first
            if let video {
                result.append(try await write(video, to: directory))
            }
            return result
        }

        let photo = resources.first(where: { [.fullSizePhoto, .photo, .alternatePhoto].contains($0.type) }) ?? resources.first
        if let photo {
            result.append(try await write(photo, to: directory))
        }

        // Live Photo's moving part is a paired video resource. Keeping the
        // original filename is important because the desktop pairs same names.
        if let pairedVideo = resources.first(where: { [.fullSizePairedVideo, .pairedVideo].contains($0.type) }) {
            result.append(try await write(pairedVideo, to: directory))
        }
        return result
    }

    private func write(_ resource: PHAssetResource, to directory: URL) async throws -> ExportedFile {
        let filename = sanitisedFilename(resource.originalFilename)
        let destination = directory.appendingPathComponent(filename)
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(for: resource, toFile: destination, options: options) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
        return ExportedFile(filename: filename, url: destination)
    }

    private func upload(_ file: ExportedFile) async throws {
        guard let baseURL = transferURL, let token = transferToken else { throw TransferError.notConnected }
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = "/upload"
        components?.queryItems = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "name", value: file.filename),
            URLQueryItem(name: "total", value: String(items.count)),
        ]
        guard let endpoint = components?.url else { throw TransferError.invalidAddress }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(mimeType(for: file.filename), forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: request, fromFile: file.url)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw TransferError.serverRejected
        }
    }

    private func mimeType(for filename: String) -> String {
        switch (filename as NSString).pathExtension.lowercased() {
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "mov": return "video/quicktime"
        case "mp4": return "video/mp4"
        default: return "application/octet-stream"
        }
    }

    private func sanitisedFilename(_ filename: String) -> String {
        let fallback = "MotionShelf-\(UUID().uuidString)"
        let value = filename.isEmpty ? fallback : filename
        return value.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
    }
}

private struct ExportedFile {
    let filename: String
    let url: URL
}

private enum TransferError: LocalizedError {
    case noOriginalResources
    case notConnected
    case invalidAddress
    case serverRejected

    var errorDescription: String? {
        switch self {
        case .noOriginalResources:
            return "没有读到照片的原始资源。请允许 MotionShelf 访问照片后再试。"
        case .notConnected:
            return "尚未连接电脑。"
        case .invalidAddress:
            return "电脑地址无效，请重新扫描二维码。"
        case .serverRejected:
            return "电脑拒绝了文件，请确认桌面端仍在等待手机传输。"
        }
    }
}
