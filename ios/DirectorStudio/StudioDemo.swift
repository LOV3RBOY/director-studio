import AVFoundation
import CoreGraphics
import SwiftUI

struct StudioDemo: View {
    let exit: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Offline demo") {
                    NavigationLink("Sample style", systemImage: "rectangle.on.rectangle") { sampleStyle }
                    NavigationLink("Sample Project Pack", systemImage: "film.stack") { SamplePack() }
                } footer: {
                    Text("Sample guide, storyboard, and synthetic take. Connect a Studio server to upload, export a complete pack, or generate.")
                }
            }
            .navigationTitle("Director Studio")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Exit demo", action: exit) } }
        }
    }

    private var sampleStyle: some View {
        List {
            Section("Pocket of Light") {
                LabeledContent("Signature", value: "Dark foreground, warm pool of light")
                Text("Hold the starting frame. Let a foreground edge conceal the subject, then let one measured camera move reveal it.")
                Text("Keep the directional contrast and the reveal timing. Adapt the subject, location, and color accent to the brief.")
            }
            Section("Provenance") {
                Text("Demonstration material. No reference clip was analyzed.")
            }
        }
        .navigationTitle("Sample Style")
    }
}

private struct SamplePack: View {
    @State private var prompt = "Open in a fixed wide frame. From 1 to 3 seconds, slide the camera right as a warm red subject clears the dark foreground. Ease to a stop and hold through 4 seconds."
    @State private var file: TemporaryFile?
    @State private var working = false
    @State private var error: String?

    var body: some View {
        Form {
            Section("Storyboard") {
                LabeledContent("Style", value: "Pocket of Light")
                LabeledContent("Clip 1", value: "0–4 s · continuous")
                Text("Reveal a small warm subject from behind a fixed foreground edge.")
            }
            Section("Editable prompt") {
                TextEditor(text: $prompt).frame(minHeight: 140).accessibilityLabel("Sample prompt")
                ShareLink(item: prompt) { Label("Share prompt", systemImage: "square.and.arrow.up") }
            }
            Section("Synthetic take") {
                Button(working ? "Preparing…" : "Play demo take") { Task { await prepare() } }
                    .accessibilityIdentifier("demo-take")
                    .disabled(working)
            }
        }
        .navigationTitle("Sample Project Pack")
        .sheet(item: $file) { item in
            NavigationStack {
                TakePlayer(url: item.url)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { file = nil } } }
            }
        }
        .studioError($error)
    }

    private func prepare() async {
        working = true
        defer { working = false }
        do { file = try await TemporaryFile(url: DemoTake.make()) }
        catch { self.error = error.localizedDescription }
    }
}

private enum DemoTake {
    static func make() async throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("director-demo-v1.mp4")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let working = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        defer { try? FileManager.default.removeItem(at: working) }
        let width = 384, height = 216
        let writer = try AVAssetWriter(outputURL: working, fileType: .mp4)
        let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
        ])
        writer.add(video)
        guard writer.startWriting() else { throw writer.error ?? StudioAPIError.invalidResponse }
        writer.startSession(atSourceTime: .zero)
        guard let pool = adaptor.pixelBufferPool else { throw StudioAPIError.invalidResponse }
        for frame in 0..<96 {
            while !video.isReadyForMoreMediaData {
                guard writer.status == .writing else { throw writer.error ?? StudioAPIError.invalidResponse }
                try await Task.sleep(for: .milliseconds(10))
            }
            var buffer: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
                throw StudioAPIError.invalidResponse
            }
            paint(buffer, frame: frame, width: width, height: height)
            guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 24)) else {
                throw writer.error ?? StudioAPIError.invalidResponse
            }
        }
        video.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? StudioAPIError.invalidResponse }
        try FileManager.default.moveItem(at: working, to: url)
        return url
    }

    private static func paint(_ buffer: CVPixelBuffer, frame: Int, width: Int, height: Int) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return }
        let progress = min(1, max(0, Double(frame - 24) / 48))
        let eased = progress * progress * (3 - 2 * progress)
        let x = 70 + 170 * eased
        context.setFillColor(red: 0.12, green: 0.16, blue: 0.23, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(red: 0.91, green: 0.35, blue: 0.19, alpha: 1)
        context.fillEllipse(in: CGRect(x: x, y: 85, width: 58, height: 58))
        context.setFillColor(red: 0.05, green: 0.06, blue: 0.10, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 148, height: height))
    }
}
