import PhotosUI
import SwiftUI
import UIKit

struct PackEditor: View {
    let api: StudioAPI
    let detail: ProjectDetail
    let snapshot: Snapshot
    let refreshed: () -> Void
    @State private var plan: Storyboard
    @State private var settings: RenderSettings
    @State private var selected = 0
    @State private var showReference = false
    @State private var working = false
    @State private var error: String?
    @State private var approval: Approval?
    @State private var playing: TemporaryFile?
    @State private var sharing: TemporaryFile?
    @State private var attempts: [ImageAttempt] = []
    @State private var imageWatch = 0
    private var endpoint: String { "/api/director/packs/\(snapshot.id)" }
    private var changed: Bool { plan != snapshot.body.plan || settings != snapshot.body.settings }

    init(api: StudioAPI, detail: ProjectDetail, snapshot: Snapshot, refreshed: @escaping () -> Void) {
        self.api = api
        self.detail = detail
        self.snapshot = snapshot
        self.refreshed = refreshed
        _plan = State(initialValue: snapshot.body.plan)
        _settings = State(initialValue: snapshot.body.settings)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Project Pack", value: "Version \(snapshot.version)")
                LabeledContent("Pinned style", value: "\(detail.pinnedStyle.title) · v\(detail.pinnedStyle.version)")
                ForEach(snapshot.body.notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
                Button("Save new version") { Task { await save() } }.disabled(!changed || working)
            }
            settingsView
            if plan.clips.indices.contains(selected) {
                Section("Storyboard") {
                    Picker("Clip", selection: $selected) {
                        ForEach(plan.clips.indices, id: \.self) { Text("Clip \($0 + 1)").tag($0) }
                    }
                }
                ClipEditor(clip: $plan.clips[selected]) { showReference = true }
                Section("Seedance prompt") {
                    if changed {
                        Text("Save your changes to compile the exact request.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text(snapshot.body.clips[selected].endpoint).font(.caption).foregroundStyle(.secondary)
                        Text(snapshot.body.clips[selected].prompt).font(.callout).textSelection(.enabled)
                        Button("Copy exact prompt") { UIPasteboard.general.string = snapshot.body.clips[selected].prompt }
                    }
                    TextField("Optional prompt replacement", text: $plan.clips[selected].promptOverride, axis: .vertical)
                        .lineLimit(3...12)
                }
                Section("Delivery") {
                    Button("Export Project Pack") { Task { await export() } }
                    Button("Review render quote") { Task { await quote(.render, selected) } }
                }
                .disabled(changed || working)
            }
            imagePrompts
            takeHistory
            if detail.versions.count > 1 {
                Section("Pack versions") {
                    ForEach(detail.versions.dropFirst()) { version in
                        NavigationLink("Version \(version.version)") { PreviousPack(api: api, version: version) }
                    }
                }
            }
        }
        .sheet(isPresented: $showReference) {
            ReferencePicker(api: api) { reference in
                showReference = false
                if !plan.clips[selected].references.contains(where: { $0.assetId == reference.assetId }) {
                    plan.clips[selected].references.append(reference)
                } else { error = "This clip already uses that file." }
            }
        }
        .sheet(item: $approval) { item in
            NavigationStack {
                Form {
                    LabeledContent("Quoted credits", value: credits(item.quote.millicredits))
                    LabeledContent("Estimated provider cost", value: item.quote.estimatedUsd.formatted(.currency(code: "USD")))
                    if item.quote.fixture { Text("This workspace uses provider-free fixtures.") }
                    Button(item.kind == .render ? "Approve render" : "Approve image") {
                        approval = nil
                        Task { await submit(item) }
                    }
                    .accessibilityIdentifier("approve-generation")
                }
                .navigationTitle(item.kind == .render ? "Render Clip \(item.index + 1)" : "Generate Image")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { approval = nil } } }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $playing) { file in
            NavigationStack {
                TakePlayer(url: file.url)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { playing = nil } } }
            }
        }
        .sheet(item: $sharing) { file in
            NavigationStack {
                Form { ShareLink(item: file.url) { Label("Share ZIP", systemImage: "square.and.arrow.up") } }
                    .navigationTitle("Project Pack ZIP")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { sharing = nil } } }
            }
            .presentationDetents([.medium, .large])
        }
        .task(id: imageWatch) {
            await reloadImages()
            while attempts.contains(where: { ["queued", "running"].contains($0.job.status) }) && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled { await reloadImages() }
            }
        }
        .refreshable { refreshed(); await reloadImages() }
        .studioError($error)
    }

    private var settingsView: some View {
        Section("Render settings") {
            Picker("Model", selection: $settings.model) {
                Text("Seedance 2.0").tag("seedance-2.0")
                Text("Seedance 2.5").tag("seedance-2.5")
            }
            .onChange(of: settings.model) { _, model in
                settings.quality = model == "seedance-2.0" ? "high" : nil
                settings.seed = model == "seedance-2.5" ? -1 : nil
            }
            Picker("Resolution", selection: $settings.resolution) {
                ForEach(["480p", "720p", "1080p", "4k"], id: \.self) { Text($0) }
            }
            if settings.model == "seedance-2.0" {
                Picker("Quality", selection: Binding(get: { settings.quality ?? "high" }, set: { settings.quality = $0 })) {
                    Text("High").tag("high")
                    Text("Basic").tag("basic")
                }
            } else {
                TextField("Seed (-1 for random)", value: Binding(get: { settings.seed ?? -1 }, set: { settings.seed = $0 }), format: .number.grouping(.never))
                    .keyboardType(.numbersAndPunctuation)
            }
        }
    }

    private var imagePrompts: some View {
        Section("Character sheets and keyframes") {
            ForEach(plan.imagePrompts.indices, id: \.self) { i in
                DisclosureGroup(plan.imagePrompts[i].title) {
                    TextField("Image prompt", text: $plan.imagePrompts[i].prompt, axis: .vertical).lineLimit(3...8)
                    if !plan.imagePrompts[i].assetIds.isEmpty {
                        Text("Original references").font(.caption).foregroundStyle(.secondary)
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(plan.imagePrompts[i].assetIds, id: \.self) { assetId in
                                    RemoteThumbnail(api: api, path: "/api/assets/\(assetId)/file", label: "Original image reference")
                                        .frame(width: 100, height: 75)
                                }
                            }
                        }
                    }
                    Button("Review image quote") { Task { await quote(.image, i) } }.disabled(changed || working)
                    ForEach(attempts.filter { $0.index == i }) { attempt in
                        Text(attempt.job.status.capitalized).font(.caption).foregroundStyle(.secondary)
                        if let problem = attempt.job.error { Text(problem.message).font(.footnote) }
                        ForEach(attempt.job.assets) { asset in
                            RemoteThumbnail(api: api, path: asset.url, label: "Generated image draft")
                                .frame(height: 110)
                            if plan.clips.indices.contains(selected) {
                                Button("Approve and attach to Clip \(selected + 1)") { attachDraft(asset) }
                                    .disabled(plan.clips[selected].references.contains(where: { $0.assetId == asset.id }))
                            }
                        }
                    }
                }
            }
        }
    }

    private var takeHistory: some View {
        Section("Takes and exports") {
            ForEach(detail.jobs.filter { ["render", "export"].contains($0.kind) }) { job in
                VStack(alignment: .leading, spacing: 8) {
                    Text(deliveryTitle(job)).font(.headline)
                    JobLine(job: job)
                    if job.credits.reserved > 0 {
                        let held = max(0, job.credits.reserved - job.credits.spent - job.credits.released)
                        Text("Reserved \(credits(held)) · Spent \(credits(job.credits.spent)) · Released \(credits(job.credits.released))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let cost = job.result?.providerCost ?? job.result?.estimatedUsd {
                        Text(cost.formatted(.currency(code: "USD"))).font(.caption).foregroundStyle(.secondary)
                    }
                    if job.result?.url != nil && job.state == "succeeded" {
                        Button(job.kind == "render" ? "Play take" : "Download ZIP") { Task { await open(job) } }
                            .disabled(working)
                    }
                }
            }
            if !detail.jobs.contains(where: { ["render", "export"].contains($0.kind) }) {
                Text("Takes and exports appear here after submission.").foregroundStyle(.secondary)
            }
        }
    }

    private func deliveryTitle(_ job: StudioJob) -> String {
        let version = detail.versions.first { $0.id == job.snapshotId }?.version
        let title = job.kind == "render" ? "Clip \((job.clip ?? 0) + 1) take" : "Project Pack ZIP"
        return version.map { "\(title) · v\($0)" } ?? title
    }

    private func attachDraft(_ asset: MediaAsset) {
        plan.clips[selected].references.append(Reference(
            assetId: asset.id, modality: "image", role: "keyframe", scope: "Approved visual draft for framing and staging. Preserve original cast identity."
        ))
    }

    private func save() async {
        struct Update: Encodable { let previousId: String; let plan: Storyboard; let settings: RenderSettings }
        working = true
        defer { working = false }
        do {
            let _: SnapshotResponse = try await api.post("/api/director/projects/\(detail.project.id)/pack", Update(previousId: snapshot.id, plan: plan, settings: settings))
            refreshed()
        } catch { self.error = error.localizedDescription }
    }

    private func quote(_ kind: Approval.Kind, _ index: Int) async {
        working = true
        defer { working = false }
        do {
            let quote: Quote = try await api.get("\(endpoint)/\(kind == .render ? "quote" : "image-quote")/\(index)")
            approval = Approval(kind: kind, index: index, quote: quote)
        } catch { self.error = error.localizedDescription }
    }

    private func submit(_ approval: Approval) async {
        working = true
        defer { working = false }
        let kind = approval.kind
        let keyName = "director-approval-\(api.base.absoluteString)-\(snapshot.id)-\(kind)-\(approval.index)"
        let key = UserDefaults.standard.string(forKey: keyName) ?? UUID().uuidString
        UserDefaults.standard.set(key, forKey: keyName)
        let payload = Submission(
            clip: kind == .render ? approval.index : nil, index: kind == .image ? approval.index : nil,
            requestKey: key, maxCredits: approval.quote.millicredits
        )
        do {
            if kind == .render {
                let _: JobResponse = try await api.post("\(endpoint)/render", payload)
                refreshed()
            } else {
                let _: ImageAttempt = try await api.post("\(endpoint)/images", payload)
                imageWatch += 1
            }
            UserDefaults.standard.removeObject(forKey: keyName)
        } catch { self.error = error.localizedDescription }
    }

    private func export() async {
        working = true
        defer { working = false }
        do {
            let _: JobResponse = try await api.post("\(endpoint)/export", EmptyBody())
            refreshed()
        } catch { self.error = error.localizedDescription }
    }

    private func reloadImages() async {
        do {
            let response: ImagesResponse = try await api.get("\(endpoint)/images")
            attempts = response.images
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func open(_ job: StudioJob) async {
        guard let path = job.result?.url else { return }
        working = true
        defer { working = false }
        do {
            let url = try await api.download(path, filename: job.result?.filename ?? "take.mp4")
            if job.kind == "render" { playing = TemporaryFile(url: url) }
            else { sharing = TemporaryFile(url: url) }
        } catch { self.error = error.localizedDescription }
    }

    private func credits(_ millicredits: Int) -> String {
        (Double(millicredits) / 1000).formatted(.number.precision(.fractionLength(0...3)))
    }
}

private struct Approval: Identifiable {
    enum Kind { case render, image }
    let id = UUID()
    let kind: Kind
    let index: Int
    let quote: Quote
}

private struct ClipEditor: View {
    @Binding var clip: StoryClip
    let addReference: () -> Void

    var body: some View {
        Section("Timing and shots") {
            TimelineLabel(start: clip.startMs, end: clip.endMs)
            DisclosureGroup("Edit timing") {
                number("Clip start (ms)", $clip.startMs)
                number("Clip end (ms)", $clip.endMs)
            }
            Picker("Structure", selection: $clip.mode) {
                Text("Continuous take").tag("continuous")
                Text("Cut sequence").tag("cuts")
            }
            ForEach(clip.shots.indices, id: \.self) { index in
                DisclosureGroup {
                    number("Shot start (ms)", $clip.shots[index].startMs)
                    number("Shot end (ms)", $clip.shots[index].endMs)
                    field("Camera start", $clip.shots[index].start)
                    field("Subject action", $clip.shots[index].action)
                    field("Camera movement", $clip.shots[index].movement)
                    field("Camera end", $clip.shots[index].end)
                    field("Framing and reveal", $clip.shots[index].framing)
                    field("Continuity", $clip.shots[index].continuity)
                    field("Sound cue", $clip.shots[index].sound)
                    Picker("Transition", selection: $clip.shots[index].transition) {
                        Text("Continuous").tag("continuous")
                        Text("Cut").tag("cut")
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Shot \(index + 1)").font(.headline)
                            TimelineLabel(start: clip.shots[index].startMs, end: clip.shots[index].endMs)
                        }
                        Text(clip.shots[index].action).font(.subheadline).lineLimit(3)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        Section("Reference order") {
            ForEach(clip.references.indices, id: \.self) { i in
                let ref = clip.references[i]
                let position = clip.references.prefix(i + 1).filter { $0.modality == ref.modality }.count
                VStack(alignment: .leading, spacing: 7) {
                    Text("\(ref.modality.capitalized) \(position) · \(ref.role.capitalized)").font(.subheadline.weight(.semibold))
                    TextField("Reference scope", text: $clip.references[i].scope, axis: .vertical)
                    HStack {
                        Button("Move up", systemImage: "arrow.up") { clip.references.swapAt(i, i - 1) }.disabled(i == 0)
                        Button("Move down", systemImage: "arrow.down") { clip.references.swapAt(i, i + 1) }.disabled(i == clip.references.count - 1)
                        Button(role: .destructive) { clip.references.remove(at: i) } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                    .buttonStyle(.borderless)
                    .labelStyle(.iconOnly)
                }
            }
            Button("Add ordered reference", systemImage: "plus", action: addReference)
        }
    }

    private func number(_ title: String, _ value: Binding<Int>) -> some View {
        LabeledContent(title) {
            TextField(title, value: value, format: .number.grouping(.never))
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
        }
    }

    private func field(_ title: String, _ value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: value, axis: .vertical).lineLimit(2...5)
        }
    }
}

private struct ReferencePicker: View {
    let api: StudioAPI
    let add: (Reference) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var assets: [MediaAsset] = []
    @State private var selected: MediaAsset?
    @State private var role = "composition"
    @State private var scope = ""
    @State private var error: String?

    private var roles: [String] {
        switch selected?.kind {
        case "video": ["motion", "composition", "lighting"]
        case "audio": ["sound"]
        default: ["composition", "lighting", "keyframe"]
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let selected {
                    Section("Reference") {
                        Text(selected.title)
                        Picker("Role", selection: $role) { ForEach(roles, id: \.self) { Text($0.capitalized) } }
                        TextField("What should it guide?", text: $scope, axis: .vertical)
                    }
                    Button("Add to clip") {
                        add(Reference(assetId: selected.id, modality: selected.kind, role: role, scope: scope))
                    }.disabled(scope.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Choose another file") { self.selected = nil }
                } else {
                    Section("Import") {
                        MediaPicker(photos: .any(of: [.images, .videos]), files: [.image, .movie, .audio], label: "Import") { media in
                            do { choose(try await api.upload(media)) }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                    Section("Your media") {
                        ForEach(assets) { asset in
                            Button { choose(asset) } label: {
                                LabeledContent(asset.title, value: asset.kind.capitalized)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Add Reference")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                do {
                    let response: AssetsResponse = try await api.get("/api/assets?limit=100")
                    assets = response.assets
                } catch { self.error = error.localizedDescription }
            }
            .studioError($error)
        }
    }

    private func choose(_ asset: MediaAsset) {
        selected = asset
        role = roles[0]
        scope = ""
    }
}

private struct PreviousPack: View {
    let api: StudioAPI
    let version: SnapshotVersion
    @State private var pack: Snapshot?
    @State private var error: String?

    var body: some View {
        List {
            if let pack {
                LabeledContent("Model", value: pack.body.settings.model)
                ForEach(pack.body.clips.indices, id: \.self) { index in
                    Section("Clip \(index + 1)") {
                        Text(pack.body.clips[index].prompt).textSelection(.enabled)
                        ForEach(pack.body.clips[index].attachments) { ref in
                            Text("\(ref.modality.capitalized) \(ref.index) · \(ref.role) · \(ref.scope)").font(.footnote)
                        }
                    }
                }
            } else {
                ProgressView("Loading version")
            }
        }
        .navigationTitle("Pack v\(version.version)")
        .task {
            do {
                let response: SnapshotResponse = try await api.get("/api/director/packs/\(version.id)")
                pack = response.pack
            } catch { self.error = error.localizedDescription }
        }
        .studioError($error)
    }
}
