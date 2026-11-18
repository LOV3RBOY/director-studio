import SwiftUI

@main
struct DirectorStudioApp: App {
    @State private var session = StudioSession()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.inDemo {
                    StudioDemo { session.inDemo = false }
                } else if let api = session.api {
                    TabView {
                        ProjectsView(api: api, fixture: session.fixture, commerce: session.commerce) { await session.signOut() }
                            .tabItem { Label("Director", systemImage: "film.stack") }
                        StylesView(api: api, fixture: session.fixture)
                            .tabItem { Label("Style Library", systemImage: "rectangle.on.rectangle") }
                    }
                    .task(id: session.commerce) {
                        if session.commerce { await StoreReceipt.listen(api) }
                    }
                } else {
                    StudioSignIn(session: session)
                }
            }
            .tint(directorAccent)
        }
    }
}

private struct StudioSignIn: View {
    @Bindable var session: StudioSession
    @State private var email = ""
    @State private var password = ""
    @State private var signup = false
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Director Studio", systemImage: "viewfinder")
                            .font(.largeTitle.weight(.semibold))
                            .foregroundStyle(.primary)
                            .accessibilityAddTraits(.isHeader)
                        Text("Learn a style, direct a project, and review the take.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 12)
                }
                Section("Studio server") {
                    TextField("https://studio.example.com", text: $session.address)
                        .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("Studio server address")
                }
                Section(signup ? "Create an account" : "Sign in") {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(signup ? .newPassword : .password)
                    Button(working ? "Connecting…" : (signup ? "Create account" : "Sign in")) {
                        Task { await connect() }
                    }
                    .disabled(working || email.isEmpty || password.isEmpty || session.address.isEmpty)
                    Button(signup ? "Use an existing account" : "Create an account") { signup.toggle() }
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button("Open offline demo") { session.inDemo = true }
                } footer: {
                    Text("Explore sample material without a server or provider account.")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--fresh-sign-in") { return }
                #endif
                do { try await session.restore() }
                catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            }
            .studioError($error)
        }
    }

    private func connect() async {
        working = true
        defer { working = false }
        do {
            try await session.signIn(email: email, password: password, signup: signup)
            password = ""
        } catch { self.error = error.localizedDescription }
    }
}
