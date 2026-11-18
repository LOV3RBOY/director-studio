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
                    ProjectsView(api: api, fixture: session.fixture, commerce: session.commerce) { await session.signOut() }
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
    private enum Field: Hashable { case address, email, password }
    @Bindable var session: StudioSession
    @State private var email = ""
    @State private var password = ""
    @State private var signup = false
    @State private var working = false
    @State private var error: String?
    @FocusState private var focusedField: Field?

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
                        .focused($focusedField, equals: .address)
                }
                Section(signup ? "Create an account" : "Sign in") {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focusedField, equals: .email)
                    SecureField("Password", text: $password)
                        .textContentType(signup ? .newPassword : .password)
                        .focused($focusedField, equals: .password)
                    Button(working ? "Connecting…" : (signup ? "Create account" : "Sign in")) {
                        focusedField = nil
                        Task { await connect() }
                    }
                    .disabled(working || email.isEmpty || password.isEmpty || session.address.isEmpty)
                    Button(signup ? "Use an existing account" : "Create an account") { signup.toggle() }
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button("Open offline demo") { session.inDemo = true }
                        .accessibilityIdentifier("open-offline-demo")
                } footer: {
                    Text("Explore sample material without a server or provider account.")
                }
            }
            .scrollDismissesKeyboard(.interactively)
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
