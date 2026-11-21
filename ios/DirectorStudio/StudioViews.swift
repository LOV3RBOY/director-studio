import AVKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

let directorAccent = Color(red: 0.067, green: 0.067, blue: 0.078)

extension View {
    func studioError(_ message: Binding<String?>) -> some View {
        alert("Director Studio", isPresented: Binding(
            get: { message.wrappedValue != nil },
            set: { if !$0 { message.wrappedValue = nil } }
        )) {
            Button("OK", role: .cancel) { message.wrappedValue = nil }
        } message: {
            Text(message.wrappedValue ?? "")
        }
        // A short error buzz the moment something fails, wherever the error is shown.
        .sensoryFeedback(trigger: message.wrappedValue) { _, new in new == nil ? nil : .error }
    }
}

struct ImportedMedia {
    let filename: String
    let data: Data

    init(filename: String, data: Data) throws {
        guard data.count <= 30_000_000 else { throw StudioAPIError.uploadSize }
        // Preserve original bytes for formats the server and both render adapters accept.
        let header = [UInt8](data.prefix(12))
        let canKeepImage = data.starts(with: [0xff, 0xd8, 0xff]) || data.starts(with: [0x89, 0x50, 0x4e, 0x47]) ||
            (header.count == 12 && String(bytes: header[8..<12], encoding: .ascii) == "WEBP")
        if !canKeepImage, let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.92) {
            self.filename = (filename as NSString).deletingPathExtension + ".jpg"
            self.data = jpeg
        } else {
            self.filename = filename
            self.data = data
        }
    }

    init(file: URL) throws {
        let allowed = file.startAccessingSecurityScopedResource()
        defer { if allowed { file.stopAccessingSecurityScopedResource() } }
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 30_000_000 else { throw StudioAPIError.uploadSize }
        try self.init(filename: file.lastPathComponent, data: Data(contentsOf: file, options: .mappedIfSafe))
    }
}

struct MediaPicker: View {
    var photos: PHPickerFilter
    var files: [UTType]
    var label = "Add reference"
    let receive: (ImportedMedia) async -> Void
    @State private var picked: PhotosPickerItem?
    @State private var importing = false
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            PhotosPicker(selection: $picked, matching: photos) {
                Label("\(label) from Photos", systemImage: "photo.on.rectangle")
            }
            Button { importing = true } label: {
                Label("\(label) from Files", systemImage: "folder")
            }
            if loading { ProgressView("Preparing media") }
        }
        .buttonStyle(.borderless)
        .disabled(loading)
        .fileImporter(isPresented: $importing, allowedContentTypes: files) { result in
            Task {
                loading = true
                defer { loading = false }
                do { await receive(try ImportedMedia(file: result.get())) }
                catch { self.error = error.localizedDescription }
            }
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                loading = true
                defer { loading = false; picked = nil }
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else { throw StudioAPIError.invalidResponse }
                    let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "media"
                    await receive(try ImportedMedia(filename: "Reference.\(ext)", data: data))
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
        .studioError($error)
    }
}

struct RemoteThumbnail: View {
    let api: StudioAPI
    let path: String
    var label: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            Rectangle().fill(.quaternary)
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else if failed {
                Image(systemName: "photo").foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .frame(idealWidth: 130, minHeight: 75, idealHeight: 88)
        .clipShape(.rect(cornerRadius: 8))
        .accessibilityLabel(label)
        .task(id: path) {
            image = nil
            failed = false
            do {
                let data = try await api.bytes(path)
                image = UIImage(data: data)
                failed = image == nil
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

struct JobLine: View {
    let job: StudioJob

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                if job.isActive { ProgressView().controlSize(.small) }
                Text(job.state == "review" ? "Needs provider review" : job.state.capitalized)
                    .font(.subheadline.weight(.semibold))
                if job.fixture { Text("Fixture").font(.caption).foregroundStyle(.secondary) }
            }
            if let error = job.error { Text(error.message).font(.footnote).foregroundStyle(.secondary) }
        }
        .accessibilityElement(children: .combine)
    }
}

struct TimelineLabel: View {
    let start: Int
    let end: Int

    var body: some View {
        Text("\(Double(start) / 1000, format: .number.precision(.fractionLength(0...3)))–\(Double(end) / 1000, format: .number.precision(.fractionLength(0...3))) s")
            .font(.caption.monospacedDigit().weight(.medium))
            .foregroundStyle(.secondary)
    }
}

struct TakePlayer: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
                    .accessibilityLabel("Take playback")
            } else {
                ProgressView("Opening take")
            }
        }
        .navigationTitle("Take")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: url) { player = AVPlayer(url: url) }
        .onDisappear { player?.pause() }
    }
}

struct TemporaryFile: Identifiable {
    let url: URL
    var id: URL { url }
}
