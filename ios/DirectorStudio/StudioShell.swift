import SwiftUI
import WebKit

let studioGround = Color(red: 0.937, green: 0.937, blue: 0.961)
private let studioInk = Color(red: 0.067, green: 0.067, blue: 0.078)
private let studioShade = Color(red: 0.886, green: 0.878, blue: 0.934)

struct StudioGround: View {
    var body: some View {
        RadialGradient(colors: [studioShade, studioGround], center: .topTrailing, startRadius: 5, endRadius: 560)
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

struct StudioPlate: View {
    var radius: CGFloat = 18

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape.fill(LinearGradient(colors: [.white, studioGround], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay { shape.strokeBorder(studioInk.opacity(0.14), lineWidth: 1) }
            .shadow(color: studioInk.opacity(0.09), radius: 5, x: 0, y: 3)
            .accessibilityHidden(true)
    }
}

struct StudioSplash: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        ZStack {
            RadialGradient(
                colors: [.white, studioGround, Color(red: 0.887, green: 0.879, blue: 0.937)],
                center: .center, startRadius: 15, endRadius: 510
            )
            .ignoresSafeArea()
            VStack(spacing: 40) {
                Image("Symbol")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 192, height: 192)
                    .background(alignment: .bottom) {
                        Ellipse().fill(.black.opacity(0.21)).frame(width: 148, height: 13).blur(radius: 13).offset(y: 9)
                    }
                    .overlay(alignment: .bottom) {
                        Image("Symbol")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 139, height: 90)
                            .scaleEffect(x: 1, y: -0.55)
                            .opacity(0.10)
                            .mask(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                            .offset(y: 70)
                    }
                Image("Wordmark").resizable().scaledToFit().frame(width: 175)
            }
            .accessibilityLabel("Out of Order")
            .opacity(appeared ? 1 : 0)
            .scaleEffect(appeared ? 1 : 0.95)
        }
        .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.35)) { appeared = true } }
    }
}

struct ConnectedStudio: View {
    @Bindable var session: StudioSession
    let api: StudioAPI
    @State private var selection: Destination = .studio
    @State private var websiteData = WKWebsiteDataStore.nonPersistent()

    enum Destination: Hashable {
        case studio, director, agents, library
    }

    var body: some View {
        TabView(selection: $selection) {
            web("/studio")
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Studio", systemImage: "square.grid.2x2") }
                .tag(Destination.studio)
            ProjectsView(api: api, fixture: session.fixture, commerce: session.commerce) { await session.signOut() }
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Director", systemImage: "viewfinder") }
                .tag(Destination.director)
            web("/agents")
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Agents", systemImage: "person.2") }
                .tag(Destination.agents)
            web("/library")
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Library", systemImage: "folder") }
                .tag(Destination.library)
        }
        .tint(studioInk)
        .task(id: session.commerce) {
            if session.commerce { await StoreReceipt.listen(api) }
        }
    }

    private func web(_ path: String) -> some View {
        StudioWebScreen(api: api, path: path, dataStore: websiteData)
    }
}

private struct StudioDownload: Identifiable {
    let id = UUID()
    let url: URL
}

private struct StudioWebScreen: View {
    let api: StudioAPI
    let path: String
    let dataStore: WKWebsiteDataStore
    @State private var problem: String?
    @State private var download: StudioDownload?
    @State private var loading = true
    @State private var loadID = UUID()

    var body: some View {
        ZStack {
            studioGround
            StudioWebView(api: api, path: path, dataStore: dataStore, onLoading: { loading = $0 },
                          onProblem: { problem = $0 }, onDownload: { download = StudioDownload(url: $0) })
                .id(loadID)
            if loading {
                ProgressView().padding(16).background(.regularMaterial, in: Capsule()).allowsHitTesting(false)
            }
            if let problem {
                ContentUnavailableView {
                    Label("Workspace unavailable", systemImage: "network.slash")
                } description: {
                    Text(problem)
                } actions: {
                    Button("Try again") {
                        self.problem = nil
                        loading = true
                        loadID = UUID()
                    }.buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(studioGround)
            }
        }
        .sheet(item: $download, onDismiss: { download = nil }) { item in
            StudioShareSheet(file: item.url)
        }
    }
}

private struct StudioShareSheet: UIViewControllerRepresentable {
    let file: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [file], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private struct StudioWebView: UIViewRepresentable {
    let api: StudioAPI
    let path: String
    let dataStore: WKWebsiteDataStore
    let onLoading: (Bool) -> Void
    let onProblem: (String) -> Void
    let onDownload: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = UIColor(studioGround)

        if let url = URL(string: path, relativeTo: api.base)?.absoluteURL,
           let token = api.token, let host = api.base.host {
            var fields: [HTTPCookiePropertyKey: Any] = [
                .name: "px_session", .value: token, .domain: host, .path: "/",
                HTTPCookiePropertyKey("HttpOnly"): "TRUE",
            ]
            if api.base.scheme == "https" { fields[.secure] = "TRUE" }
            if let cookie = HTTPCookie(properties: fields) {
                Task { @MainActor [weak web] in
                    await dataStore.httpCookieStore.setCookie(cookie)
                    web?.load(URLRequest(url: url))
                }
            }
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKDownloadDelegate {
        var parent: StudioWebView
        private var files: [ObjectIdentifier: URL] = [:]

        init(_ parent: StudioWebView) { self.parent = parent }

        private func matchesOrigin(_ url: URL) -> Bool {
            url.scheme == parent.api.base.scheme && url.host == parent.api.base.host && url.port == parent.api.base.port
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            if action.targetFrame?.isMainFrame == false { return .allow }
            if matchesOrigin(url) {
                if action.shouldPerformDownload { return .download }
                if action.targetFrame == nil { webView.load(action.request); return .cancel }
                return .allow
            }
            if action.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") {
                await UIApplication.shared.open(url)
            }
            return .cancel
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
            guard response.isForMainFrame else { return .allow }
            guard let url = response.response.url, matchesOrigin(url) else { return .cancel }
            let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
            return !response.canShowMIMEType || disposition?.lowercased().hasPrefix("attachment") == true ? .download : .allow
        }

        func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge) async
            -> (URLSession.AuthChallengeDisposition, URLCredential?) {
            StudioPilotTrust.answer(challenge)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.onLoading(false) }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

        private func failed(_ error: Error) {
            let failure = error as NSError
            if (failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled)
                || (failure.domain == "WebKitErrorDomain" && failure.code == 102) { return }
            parent.onLoading(false)
            parent.onProblem(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let name = (suggestedFilename as NSString).lastPathComponent
            let target = folder.appendingPathComponent(name.isEmpty || name == "." || name == ".." ? "Studio export" : name)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            } catch {
                failed(error)
                return nil
            }
            files[ObjectIdentifier(download)] = target
            return target
        }

        func downloadDidFinish(_ download: WKDownload) {
            if let url = files.removeValue(forKey: ObjectIdentifier(download)) { parent.onDownload(url) }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let url = files.removeValue(forKey: ObjectIdentifier(download)) {
                try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            }
            failed(error)
        }
    }
}
