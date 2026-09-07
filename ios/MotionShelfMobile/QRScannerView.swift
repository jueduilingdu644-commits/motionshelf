import AVFoundation
import SwiftUI
import UIKit

struct QRScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerController {
        QRScannerController(onCode: onCode)
    }

    func updateUIViewController(_ uiViewController: QRScannerController, context: Context) {}

    static func dismantleUIViewController(_ uiViewController: QRScannerController, coordinator: ()) {
        uiViewController.stop()
    }
}

final class QRScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let onCode: (String) -> Void
    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var didReadCode = false

    init(onCode: @escaping (String) -> Void) {
        self.onCode = onCode
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let close = UIButton(type: .system)
        close.setTitle("关闭", for: .normal)
        close.tintColor = .white
        close.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        close.layer.cornerRadius = 10
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            close.widthAnchor.constraint(equalToConstant: 72),
            close.heightAnchor.constraint(equalToConstant: 40),
        ])
        configureCapture()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func configureCapture() {
        guard let camera = AVCaptureDevice.default(for: .video) else { return }
        do {
            let input = try AVCaptureDeviceInput(device: camera)
            let output = AVCaptureMetadataOutput()
            guard session.canAddInput(input), session.canAddOutput(output) else { return }
            session.addInput(input)
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let preview = AVCaptureVideoPreviewLayer(session: session)
            preview.videoGravity = .resizeAspectFill
            view.layer.insertSublayer(preview, at: 0)
            previewLayer = preview
            DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
        } catch {
            // The system permission prompt and the app's alert handle unavailable cameras.
        }
    }

    func stop() {
        if session.isRunning { session.stopRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !didReadCode,
              let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue else { return }
        didReadCode = true
        stop()
        onCode(value)
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }
}
