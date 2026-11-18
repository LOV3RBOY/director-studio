import PhotosUI
import SwiftUI

struct ProjectsView: View {
    let api: StudioAPI
    let fixture: Bool
    let commerce: Bool
    let signOut: () async -> Void
    @State private var projects: [ProjectSummary] = []
    @State private var path: [String] = []
    @State private var loaded = false
    @State private var creating = false
    @State private var showAccount = false
    @State private var showPurchases = false
    @State private var error: String?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if fixture {
                    Label("Provider-free workspace", systemImage: "testtube.2")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if !loaded { ProgressView("Loading projects") }
                if loaded && projects.isEmpty {
                    ContentUnavailableView("No projects yet", systemImage: "film.stack", description: Text("Save a style in the Style Library, then start a project with a fresh brief."))
                }
                ForEach(projects) { project in
                    NavigationLink(value: project.id) {
                        Label(project.title, systemImage: "film")
                    }
                }
            }
            .navigationTitle("Director")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showAccount = true } label: { Label("Account", systemImage: "person.crop.circle") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { creating = true } label: { Label("New project", systemImage: "plus") }
                        .accessibilityIdentifier("new-project")
                }
            }
            .navigationDestination(for: String.self) { id in ProjectWorkspace(api: api, projectId: id) }
            .sheet(isPresented: $creating) {
                NewProjectForm(api: api) { id in creating = false; path.append(id) }
            }
            .confirmationDialog("Studio Account", isPresented: $showAccount, titleVisibility: .visible) {
                if commerce { Button("Purchases") { showPurchases = true } }
                Button("Sign out", role: .destructive) { Task { await signOut() } }
            } message: {
                Text(api.base.host ?? "")
            }
            .sheet(isPresented: $showPurchases) { StudioPurchases(api: api) }
            .task(id: path.isEmpty) { if path.isEmpty { await reload() } }
            .refreshable { await reload() }
            .studioError($error)
        }
    }

    private func reload() async {
        do {
            let response: ProjectsResponse = try await api.get("/api/director/projects")
            projects = response.projects
            loaded = true
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct NewProjectForm: View {
    let api: StudioAPI
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var request = ProjectBrief()
    @State private var styles: [StyleSummary] = []
    @State private var selectedStyleId = ""
    @State private var versions: [StyleVersion] = []
    @State private var showCast = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Style") {
                    if styles.isEmpty {
                        Text("Save a style in the Library first.").foregroundStyle(.secondary)
                    } else {
                        Picker("Style", selection: $selectedStyleId) {
                            Text("Choose a style").tag("")
                            ForEach(styles) { style in Text(style.title).tag(style.id) }
                        }
                        Picker("Version", selection: $request.styleVersionId) {
                            Text("Choose a saved version").tag("")
                            ForEach(versions) { version in Text("Version \(version.version)").tag(version.id) }
                        }
                    }
                }
                Section("Brief") {
                    TextField("Project name", text: $request.title)
                    TextField("Concept, brief or storyline", text: $request.brief, axis: .vertical).lineLimit(4...8)
                    TextField("Must-keep constraints", text: $request.constraints, axis: .vertical).lineLimit(2...5)
                }
                Section("Cast") {
                    ForEach(request.cast.indices, id: \.self) { i in
                        LabeledContent(request.cast[i].name, value: "\(request.cast[i].assetIds.count) references")
                    }
                    .onDelete { request.cast.remove(atOffsets: $0) }
                    Button("Add cast member") { showCast = true }
                        .disabled(request.cast.count >= 8)
                }
                Section("Format") {
                    Picker("Frame", selection: $request.aspect) {
                        ForEach(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"], id: \.self) { Text($0) }
                    }
                    Picker("Render model", selection: $request.model) {
                        Text("Seedance 2.0").tag("seedance-2.0")
                        Text("Seedance 2.5").tag("seedance-2.5")
                    }
                    Stepper("\(request.duration) seconds", value: $request.duration, in: (request.model == "seedance-2.5" ? 5 : 4)...60)
                }
                Button(saving ? "Starting…" : "Create storyboard") { Task { await create() } }
                    .disabled(saving || request.styleVersionId.isEmpty || request.title.isEmpty || request.brief.isEmpty)
            }
            .navigationTitle("New Project")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                do {
                    let response: StylesResponse = try await api.get("/api/director/styles")
                    styles = response.styles.filter { $0.latest != nil }
                    if styles.count == 1 { selectedStyleId = styles[0].id }
                } catch { self.error = error.localizedDescription }
            }
            .task(id: selectedStyleId) {
                request.styleVersionId = ""
                versions = []
                guard !selectedStyleId.isEmpty else { return }
                do {
                    let style: StyleDetail = try await api.get("/api/director/styles/\(selectedStyleId)")
                    versions = style.versions.filter(\.saved)
                    request.styleVersionId = versions.first?.id ?? ""
                } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            }
            .onChange(of: request.model) { _, model in
                if model == "seedance-2.5" && request.duration < 5 { request.duration = 5 }
            }
            .sheet(isPresented: $showCast) {
                CastForm(api: api) { cast in request.cast.append(cast); showCast = false }
            }
            .studioError($error)
        }
        .interactiveDismissDisabled(saving)
    }

    private func create() async {
        saving = true
        defer { saving = false }
        do {
            let response: NewProjectResponse = try await api.post("/api/director/projects", request)
            onCreated(response.projectId)
        } catch { self.error = error.localizedDescription }
    }
}

private struct CastForm: View {
    let api: StudioAPI
    let add: (CastMember) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var notes = ""
    @State private var assets: [MediaAsset] = []
    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Character name", text: $name)
                TextField("Identity and wardrobe notes", text: $notes, axis: .vertical).lineLimit(3...5)
                Section("Original identity images") {
                    ForEach(assets) { asset in
                        HStack {
                            RemoteThumbnail(api: api, path: asset.url, label: "Original identity reference")
                                .frame(width: 72, height: 58)
                            Text(asset.title)
                        }
                    }
                    .onDelete { assets.remove(atOffsets: $0) }
                    if assets.count < 6 {
                        MediaPicker(photos: .images, files: [.image], label: "Import") { media in
                            uploading = true
                            defer { uploading = false }
                            do { assets.append(try await api.upload(media)) }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                    if uploading { ProgressView("Uploading image") }
                }
            }
            .navigationTitle("Cast Member")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add(CastMember(name: name, notes: notes, assetIds: assets.map(\.id))) }
                        .disabled(name.isEmpty || assets.isEmpty || uploading)
                }
            }
            .studioError($error)
        }
    }
}

struct ProjectWorkspace: View {
    let api: StudioAPI
    let projectId: String
    @State private var detail: ProjectDetail?
    @State private var tab = 0
    @State private var message = ""
    @State private var working = false
    @State private var watch = 0
    @State private var error: String?
    private var endpoint: String { "/api/director/projects/\(projectId)" }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Workspace", selection: $tab) {
                Text("Director").tag(0)
                Text("Project Pack").tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)
            if let detail {
                if tab == 0 {
                    director(detail)
                } else if let pack = detail.pack {
                    PackEditor(api: api, detail: detail, snapshot: pack) { watch += 1 }
                        .id(pack.id)
                } else {
                    ContentUnavailableView("Storyboard pending", systemImage: "film.stack", description: Text("The Project Pack becomes available after the Director saves a storyboard."))
                }
            } else {
                ProgressView("Loading project").frame(maxHeight: .infinity)
            }
        }
        .navigationTitle(detail?.project.title ?? "Project")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: watch) {
            await reload()
            while detail?.jobs.contains(where: \.isActive) == true && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled { await reload() }
            }
        }
        .studioError($error)
    }

    private func director(_ detail: ProjectDetail) -> some View {
        Form {
            Section("Brief") {
                LabeledContent("Pinned style", value: "\(detail.pinnedStyle.title) · v\(detail.pinnedStyle.version)")
                Text(detail.brief.brief)
                if !detail.brief.constraints.isEmpty {
                    Text(detail.brief.constraints).font(.footnote).foregroundStyle(.secondary)
                }
                LabeledContent("Format", value: "\(detail.brief.duration) s · \(detail.brief.aspect)")
            }
            if let job = detail.jobs.first(where: { $0.kind == "plan" }) {
                Section("Storyboard") {
                    if detail.pack != nil {
                        Button("Open Project Pack") { tab = 1 }
                    } else {
                        JobLine(job: job)
                        if job.state == "failed" {
                            Button("Retry storyboard") { Task { await send("\(endpoint)/plan", EmptyBody()) } }
                        }
                    }
                }
            }
            Section("Director chat") {
                ForEach(detail.jobs.filter { $0.kind == "chat" }.reversed()) { job in
                    VStack(alignment: .leading, spacing: 8) {
                        if let message = job.message { Text(message).font(.subheadline.weight(.semibold)) }
                        if let reply = job.result?.reply { Text(reply) } else { JobLine(job: job) }
                    }
                }
                TextField("Give the Director a note", text: $message, axis: .vertical)
                    .lineLimit(2...6)
                Button("Send to Director") {
                    let draft = message
                    Task {
                        if await send("\(endpoint)/chat", ["message": draft]) && message == draft { message = "" }
                    }
                }
                .disabled(working || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .refreshable { await reload() }
    }

    private func reload() async {
        do { detail = try await api.get(endpoint) }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    @discardableResult
    private func send(_ path: String, _ body: some Encodable) async -> Bool {
        working = true
        defer { working = false }
        do {
            let _: JobResponse = try await api.post(path, body)
            watch += 1
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
