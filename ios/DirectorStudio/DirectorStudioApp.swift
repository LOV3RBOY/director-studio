import SwiftUI

@main
struct DirectorStudioApp: App {
    @State private var session = StudioSession()
    @State private var showingSplash = true

    var body: some Scene {
        WindowGroup {
            Group {
                if session.inDemo {
                    StudioDemo { session.inDemo = false }
                } else if let api = session.api {
                    ConnectedStudio(session: session, api: api)
                } else {
                    StudioSignIn(session: session)
                }
            }
            .environment(\.colorScheme, .light)
            .tint(directorAccent)
            .overlay {
                if showingSplash {
                    StudioSplash()
                        .transition(.opacity)
                        .task {
                            try? await Task.sleep(for: .milliseconds(820))
                            withAnimation(.easeOut(duration: 0.23)) { showingSplash = false }
                        }
                }
            }
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
                        Image("Wordmark").resizable().scaledToFit().frame(width: 122)
                            .accessibilityLabel("Out of Order")
                        Text("Open the studio.")
                            .font(.custom("InterTight-Regular", size: 41, relativeTo: .largeTitle).weight(.heavy))
                            .tracking(-2.4).accessibilityAddTraits(.isHeader)
                        Text("Bring your references, work with your crew, and review the cut.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 12)
                }
                #if DEBUG
                if let pilot = session.pilotAddress {
                    Section {
                        Button(working ? "Connecting…" : "Open local studio") {
                            Task { await connectPilot(pilot) }
                        }
                        .disabled(working)
                        .accessibilityIdentifier("open-local-studio")
                    } footer: {
                        Text("Connect to the Studio server on this Mac’s local network.")
                    }
                }
                #endif
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
            .scrollContentBackground(.hidden)
            .background { StudioGround() }
            .scrollDismissesKeyboard(.interactively)
            .navigationBarTitleDisplayMode(.inline)
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--fresh-sign-in") { return }
                #endif
                do {
                    try await session.restore()
                    #if DEBUG
                    if session.api == nil, let pilot = session.pilotAddress { await connectPilot(pilot) }
                    #endif
                } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            }
            .studioError($error)
        }
    }

    #if DEBUG
    private func connectPilot(_ pilot: String) async {
        working = true
        defer { working = false }
        do { try await session.connectPilot(pilot) }
        catch { self.error = error.localizedDescription }
    }
    #endif

    private func connect() async {
        working = true
        defer { working = false }
        do {
            try await session.signIn(email: email, password: password, signup: signup)
            password = ""
        } catch { self.error = error.localizedDescription }
    }
}
