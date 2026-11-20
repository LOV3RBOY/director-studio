import PhotosUI
import SwiftUI
import UIKit

struct ProjectsView: View {
    let api: StudioAPI
    let fixture: Bool
    let commerce: Bool
    let signOut: () async -> Void
    @State private var projects: [ProjectSummary] = []
    @State private var createdProject: String?
    @State private var pendingProject: String?
    @State private var loaded = false
    @State private var creating = false
    @State private var showAccount = false
    @State private var showStyles = false
    @State private var showPurchases = false
    @State private var agentMessage: String?
    @State private var connecting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    Text("Projects")
                        .font(.system(.largeTitle, design: .default, weight: .heavy))
                        .accessibilityAddTraits(.isHeader)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    if fixture {
                        Label("Provider-free workspace", systemImage: "testtube.2")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Button { showStyles = true } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "rectangle.on.rectangle")
                                .frame(width: 40, height: 40)
                                .background { StudioPlate(radius: 11) }
                                .accessibilityHidden(true)
                            Text("Style Library").font(.headline)
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("open-style-library")
                    .listRowBackground(StudioPlate())
                    .listRowSeparator(.hidden)
                    if !loaded { ProgressView("Loading projects") }
                    if loaded && projects.isEmpty {
                        ContentUnavailableView("No projects yet", systemImage: "film.stack", description: Text("Save a style in the Style Library, then start a project with a fresh brief."))
                    }
                    ForEach(projects) { project in
                        NavigationLink {
                            ProjectWorkspace(api: api, projectId: project.id)
                        } label: {
                            Label(project.title, systemImage: "film")
                                .font(.body.weight(.medium))
                                .padding(.vertical, 5)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await reload() }
            }
            .scrollContentBackground(.hidden)
            .background { StudioGround() }
            .navigationTitle("Director")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showAccount = true } label: { Label("Account", systemImage: "person.crop.circle") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { creating = true } label: { Label("New project", systemImage: "plus") }
                        .accessibilityIdentifier("new-project")
                }
            }
            .navigationDestination(item: $createdProject) { id in ProjectWorkspace(api: api, projectId: id) }
            .sheet(isPresented: $creating, onDismiss: {
                if let id = pendingProject { createdProject = id; pendingProject = nil }
            }) {
                NewProjectForm(api: api) { id in
                    pendingProject = id
                    creating = false
                }
            }
            .confirmationDialog("Studio Account", isPresented: $showAccount, titleVisibility: .visible) {
                Button("Connect agent") { Task { await connectAgent() } }
                if commerce { Button("Purchases") { showPurchases = true } }
                Button("Sign out", role: .destructive) { Task { await signOut() } }
            } message: {
                Text(api.base.host ?? "")
            }
            .sheet(isPresented: $showPurchases) { StudioPurchases(api: api) }
            .alert("Agent connection copied", isPresented: Binding(get: { agentMessage != nil }, set: { if !$0 { agentMessage = nil } })) {
                Button("Done", role: .cancel) { agentMessage = nil }
            } message: {
                Text("Open Grok Bot and paste it into the chat. It gives your agent full use of the studio as you. Revoke it any time under Developer → Keys on the web.")
            }
            .sheet(isPresented: $showStyles) { StylesView(api: api, fixture: fixture) }
            .task { await reload() }
            .studioError($error)
        }
    }

    /// One tap: makes a full-access agent key and copies the setup message for Grok Bot or any MCP agent.
    private func connectAgent() async {
        guard !connecting else { return }
        connecting = true
        defer { connecting = false }
        do {
            let made: AgentKey = try await api.post("/api/developer/keys", AgentKeyRequest())
            let server = api.base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let message = [
                "Add this MCP server: \(server)/api/mcp",
                "Send this header with every request: Authorization: Bearer \(made.secret)",
                "It is my Out of Order Studio. Call app_routes to see everything you can do, then use app_request to act as me.",
            ].joined(separator: "\n")
            UIPasteboard.general.string = message
            agentMessage = message
        } catch { self.error = error.localizedDescription }
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
    @State private var models = DirectorModelOption.seedance
    private var chosen: DirectorModelOption? { models.first { $0.id == request.model } }
    private var aspects: [String] { chosen?.aspects ?? DirectorModelOption.allAspects }
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
                    Picker("Render model", selection: $request.model) {
                        ForEach(models) { option in Text(option.name).tag(option.id) }
                    }
                    Picker("Frame", selection: $request.aspect) {
                        ForEach(aspects, id: \.self) { Text($0) }
                    }
                    Stepper("\(request.duration) seconds", value: $request.duration, in: max(4, chosen?.durations.first ?? 4)...60)
                    if let chosen { Text(chosen.summary).font(.footnote).foregroundStyle(.secondary) }
                }
                Button(saving ? "Starting…" : "Create storyboard") { Task { await create() } }
                    .disabled(saving || request.styleVersionId.isEmpty || request.title.isEmpty || request.brief.isEmpty)
            }
            .navigationTitle("New Project")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                if let response: DirectorModelsResponse = try? await api.get("/api/director/models") {
                    let available = response.models.filter(\.available)
                    if !available.isEmpty { models = available }
                }
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
            .onChange(of: request.model) { _, _ in
                if let first = chosen?.durations.first, request.duration < first { request.duration = max(4, first) }
                if !aspects.contains(request.aspect) { request.aspect = aspects[0] }
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
            .background(alignment: .bottom) { StudioPlate(radius: 0) }
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
        .background { StudioGround() }
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
        .scrollContentBackground(.hidden)
        .refreshable { await reload() }
    }

    private func reload() async {
        do { detail = try await api.get(endpoint) }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    @discardableResult
    private func send(_ path: String, _ body: some Encodable & Sendable) async -> Bool {
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
