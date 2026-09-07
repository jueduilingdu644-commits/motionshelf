import SwiftUI

@main
struct MotionShelfMobileApp: App {
    @StateObject private var transfer = TransferViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(transfer: transfer)
                .onOpenURL { url in
                    transfer.handleIncomingURL(url)
                }
        }
    }
}
