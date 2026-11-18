import SwiftUI

struct StylesView: View {
    let api: StudioAPI
    let fixture: Bool
    @State private var styles: [StyleSummary] = []
    @State private var path: [String] = []
    @State private var showNew = false
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if fixture {
                    Label("Provider-free workspace", systemImage: "testtube.2")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if !loaded { ProgressView("Loading styles") }
                if loaded && styles.isEmpty {
                    ContentUnavailableView("No styles yet", systemImage: "rectangle.on.rectangle", description: Text("Study an image or video to create a reusable guide."))
                }
                ForEach(styles) { style in
                    NavigationLink(value: style.id) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(style.title).font(.headline)
                            if let version = style.latest {
                                Text(version.saved ? "Saved · v\(version.version)" : "Draft · v\(version.version)")
                                    .font(.caption).foregroundStyle(.secondary)
                            } else {
                                Text("Analysis pending").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Style Library")
            .toolbar {
                Button { showNew = true } label: { Label("Learn a style", systemImage: "plus") }
                    .accessibilityIdentifier("learn-style")
            }
            .navigationDestination(for: String.self) { id in StyleEditor(api: api, styleId: id) }
            .task(id: path.isEmpty) { if path.isEmpty { await reload() } }
            .refreshable { await reload() }
            .sheet(isPresented: $showNew) {
                LearnStyleForm(api: api) { id in
                    showNew = false
                    path.append(id)
                }
            }
            .studioError($error)
        }
    }

    private func reload() async {
        do {
            let response: StylesResponse = try await api.get("/api/director/styles")
            styles = response.styles
            loaded = true
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct LearnStyleForm: View {
    let api: StudioAPI
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var notes = ""
    @State private var asset: MediaAsset?
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Reference") {
                    if let asset { Label(asset.title, systemImage: asset.kind == "video" ? "film" : "photo") }
                    MediaPicker(photos: .any(of: [.images, .videos]), files: [.image, .movie], label: "Import") { media in
                        await upload(media)
                    }
                    if working && asset == nil { ProgressView("Uploading reference") }
                }
                Section("What should the Director study?") {
                    TextField("Style name", text: $title)
                    TextField("What to carry over or ignore", text: $notes, axis: .vertical)
                        .lineLimit(3...7)
                }
                Button("Analyze reference") { Task { await analyze() } }
                    .disabled(working || asset == nil || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .disabled(working)
            .navigationTitle("Learn a Style")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .studioError($error)
        }
        .interactiveDismissDisabled(working)
    }

    private func upload(_ media: ImportedMedia) async {
        working = true
        defer { working = false }
        do { asset = try await api.upload(media) }
        catch { self.error = error.localizedDescription }
    }

    private func analyze() async {
        guard let asset else { return }
        working = true
        defer { working = false }
        do {
            let response: NewStyleResponse = try await api.post("/api/director/styles", ["assetId": asset.id, "title": title, "notes": notes])
            onCreated(response.styleId)
        } catch { self.error = error.localizedDescription }
    }
}

private struct StyleEditor: View {
    let api: StudioAPI
    let styleId: String
    @State private var detail: StyleDetail?
    @State private var guide = ""
    @State private var rules: [StyleRule] = []
    @State private var showingRules = false
    @State private var watch = 0
    @State private var saving = false
    @State private var error: String?
    private var latest: StyleVersion? { detail?.versions.first }
    private var endpoint: String { "/api/director/styles/\(styleId)" }

    var body: some View {
        Form {
            if let job = detail?.analysis.first {
                Section("Analysis") {
                    JobLine(job: job)
                    if job.state == "failed" {
                        Button("Retry analysis") { Task { await retry() } }
                    }
                }
            } else if detail == nil {
                ProgressView("Loading style")
            }
            if let latest {
                Section(latest.saved ? "Saved guide · v\(latest.version)" : "Draft guide") {
                    if latest.profile.fixture { Label("Provider-free fixture", systemImage: "testtube.2") }
                    TextEditor(text: $guide)
                        .frame(minHeight: 180)
                        .accessibilityLabel("Style guide")
                    Button(saving ? "Saving…" : "Save style") { Task { await save(latest) } }
                        .disabled(guide.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                }
                evidence(latest)
                Section {
                    DisclosureGroup("Structured profile", isExpanded: $showingRules) {
                        ForEach(rules.indices, id: \.self) { i in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(rules[i].topic.replacingOccurrences(of: "-", with: " ").capitalized).font(.headline)
                                Text("\(rules[i].basis.capitalized) · \(rules[i].reuse.capitalized)").font(.caption).foregroundStyle(.secondary)
                                TextField("Rule", text: $rules[i].detail, axis: .vertical)
                                if !rules[i].evidence.isEmpty {
                                    Text("Frames \(rules[i].evidence.map { String($0 + 1) }.joined(separator: ", "))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(detail?.title ?? "Style")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: watch) {
            await reload()
            while detail?.analysis.first?.isActive == true && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled { await reload() }
            }
        }
        .refreshable { await reload() }
        .studioError($error)
    }

    private func evidence(_ version: StyleVersion) -> some View {
        let evidence = version.profile.evidence
        return Section("Reference evidence") {
            Text("\(evidence.width) × \(evidence.height) · \(evidence.hasAudio ? "Audio stream" : "No audio stream")")
                .font(.footnote).foregroundStyle(.secondary)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(evidence.frames) { frame in
                        VStack(alignment: .leading, spacing: 4) {
                            RemoteThumbnail(api: api, path: "\(endpoint)/frames/\(version.id)/\(frame.ordinal)", label: "Reference frame \(frame.ordinal + 1)")
                                .frame(width: 136, height: 90)
                            Text(frame.seconds.map { seconds in "\(seconds.formatted(.number.precision(.fractionLength(2)))) s" } ?? "Still")
                                .font(.caption.monospacedDigit())
                            if frame.cutCandidate { Text("Cut candidate").font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
        }
    }

    private func reload() async {
        do {
            let updated: StyleDetail = try await api.get(endpoint)
            if updated.versions.first?.id != latest?.id, let version = updated.versions.first {
                guide = version.profile.guide
                rules = version.profile.rules
            }
            detail = updated
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func retry() async {
        do {
            let _: JobResponse = try await api.post("\(endpoint)/retry", EmptyBody())
            watch += 1
        } catch { self.error = error.localizedDescription }
    }

    private func save(_ previous: StyleVersion) async {
        struct Edits: Encodable { let previousId: String; let guide: String; let rules: [StyleRule] }
        saving = true
        defer { saving = false }
        do {
            let _: VersionResponse = try await api.post("\(endpoint)/save", Edits(previousId: previous.id, guide: guide, rules: rules))
            await reload()
        } catch { self.error = error.localizedDescription }
    }
}
