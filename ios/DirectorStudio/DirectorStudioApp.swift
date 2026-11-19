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
                    #if DEBUG
                    if session.isPilot {
                        StudioPilotSignIn(session: session)
                    } else {
                        StudioSignIn(session: session)
                    }
                    #else
                    StudioSignIn(session: session)
                    #endif
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

#if DEBUG
private struct StudioPilotSignIn: View {
    @Bindable var session: StudioSession
    @Environment(\.openURL) private var openURL
    @State private var connecting = false
    @State private var problem: String?
    @State private var showNetworkSettings = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image("Wordmark")
                    .resizable().scaledToFit().frame(width: 140)
                    .accessibilityLabel("Out of Order")
                Text("Open the studio.")
                    .font(.custom("InterTight-Regular", size: 47, relativeTo: .largeTitle).weight(.heavy))
                    .tracking(-2.5)
                    .accessibilityAddTraits(.isHeader)
                Button {
                    Task { await connect() }
                } label: {
                    HStack {
                        if connecting { ProgressView().tint(.white) }
                        Label(connecting ? "Connecting…" : "Open Studio", systemImage: "viewfinder")
                        Spacer()
                        Image(systemName: "arrow.up.right").accessibilityHidden(true)
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(17)
                    .background(LinearGradient(colors: [Color(white: 0.18), .black], startPoint: .topLeading, endPoint: .bottomTrailing), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(connecting)
                .accessibilityIdentifier("open-local-studio")
                if let problem {
                    Text(problem).font(.callout).foregroundStyle(.secondary)
                    if showNetworkSettings {
                        Button("Open iPhone Settings") {
                            if let settings = URL(string: UIApplication.openSettingsURLString) { openURL(settings) }
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Button("Open offline demo") { session.inDemo = true }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("open-offline-demo")
            }
            .padding(24)
            .padding(.top, 28)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .background { StudioGround() }
    }

    private func connect() async {
        connecting = true
        problem = nil
        showNetworkSettings = false
        defer { connecting = false }
        do { try await session.openPilot() }
        catch {
            problem = error.localizedDescription
            if let error = error as? StudioAPIError, case .localNetwork = error { showNetworkSettings = true }
        }
    }
}
#endif
