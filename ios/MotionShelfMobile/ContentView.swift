import PhotosUI
import SwiftUI

struct ContentView: View {
    @ObservedObject var transfer: TransferViewModel
    @State private var showingPicker = false
    @State private var showingScanner = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    connectionCard
                    if transfer.isSending || !transfer.items.isEmpty {
                        uploadCard
                    }
                    helpCard
                }
                .padding(20)
            }
            .background(Color(red: 0.95, green: 0.97, blue: 0.95).ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showingPicker) {
                PhotoPickerView { results in
                    showingPicker = false
                    Task { await transfer.importResults(results) }
                }
            }
            .sheet(isPresented: $showingScanner) {
                QRScannerView { code in
                    showingScanner = false
                    transfer.handleIncomingText(code)
                }
                .ignoresSafeArea()
            }
            .alert("导入遇到问题", isPresented: Binding(
                get: { transfer.errorMessage != nil },
                set: { if !$0 { transfer.errorMessage = nil } }
            )) {
                Button("知道了", role: .cancel) { transfer.errorMessage = nil }
            } message: {
                Text(transfer.errorMessage ?? "请重试")
            }
        }
        .tint(Color(red: 0.16, green: 0.50, blue: 0.46))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("MotionShelf", systemImage: "sparkles")
                .font(.headline.weight(.semibold))
            Text("把 Live Photo 原样传到电脑")
                .font(.system(size: 30, weight: .bold, design: .rounded))
            Text("原生读取照片和配对视频，保留拍摄时的完整动态。")
                .foregroundStyle(.secondary)
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 15) {
            Label("连接电脑", systemImage: transfer.isConnected ? "checkmark.circle.fill" : "wifi")
                .font(.headline)
                .foregroundStyle(transfer.isConnected ? .green : .primary)
            if let host = transfer.host {
                Text("已连接到 \(host)")
                    .font(.subheadline.weight(.medium))
                Text("手机和电脑保持同一个 Wi‑Fi。选择照片后会直接发送到电脑。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("先扫描电脑 MotionShelf 中的二维码")
                    .font(.subheadline.weight(.medium))
                Text("二维码只用于建立局域网连接，不会把照片上传到云端。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Button {
                    showingScanner = true
                } label: {
                    Label("扫描二维码", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Button {
                    transfer.handleIncomingText(transfer.manualURL)
                } label: {
                    Label("连接", systemImage: "link")
                }
                .buttonStyle(.bordered)
            }
            TextField("也可以粘贴电脑地址（http://…/transfer?token=…）", text: $transfer.manualURL)
                .textFieldStyle(.roundedBorder)
                .font(.footnote)
        }
        .padding(18)
        .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var uploadCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(transfer.isSending ? "正在传输" : "传输完成", systemImage: transfer.isSending ? "arrow.up.circle" : "checkmark.circle.fill")
                    .font(.headline)
                Spacer()
                Text(transfer.progressText)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: transfer.progress)
            ForEach(transfer.items) { item in
                HStack(spacing: 10) {
                    Image(systemName: item.filename.lowercased().hasSuffix(".mov") ? "livephoto" : "photo")
                        .foregroundStyle(.teal)
                    Text(item.filename)
                        .lineLimit(1)
                    Spacer()
                    Text(item.state)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(18)
        .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var helpCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("准备好后开始选择", systemImage: "photo.on.rectangle.angled")
                .font(.headline)
            Text("Live Photo 会自动拆成同名照片 + MOV，再由电脑端合并。普通照片和视频也可以一起选择。")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button {
                showingPicker = true
            } label: {
                Label("选择照片和视频", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!transfer.isConnected || transfer.isSending)
        }
        .padding(18)
        .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
