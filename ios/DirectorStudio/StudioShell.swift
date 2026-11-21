import SafariServices
import SwiftUI
import WebKit

let studioGround = Color(red: 0.937, green: 0.937, blue: 0.961)
let studioInk = Color(red: 0.067, green: 0.067, blue: 0.078)
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
    @State private var resets: [Destination: Int] = [:]

    enum Destination: Hashable {
        case studio, director, agents, library
    }

    /// Tapping the tab you are already on returns that tab to its start, like native apps.
    private var tabs: Binding<Destination> {
        Binding(get: { selection }, set: { next in
            if next == selection { resets[next, default: 0] += 1 }
            selection = next
        })
    }

    var body: some View {
        TabView(selection: tabs) {
            web("/studio", .studio)
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Studio", systemImage: "square.grid.2x2") }
                .tag(Destination.studio)
            ProjectsView(api: api, fixture: session.fixture, commerce: session.commerce) { await session.signOut() }
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Director", systemImage: "viewfinder") }
                .tag(Destination.director)
            web("/agents", .agents)
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Agents", systemImage: "person.2") }
                .tag(Destination.agents)
            web("/library", .library)
                .toolbarBackground(studioGround, for: .tabBar)
                .tabItem { Label("Library", systemImage: "folder") }
                .tag(Destination.library)
        }
        .tint(studioInk)
        .sensoryFeedback(.selection, trigger: selection)
        .task(id: session.commerce) {
            if session.commerce { await StoreReceipt.listen(api) }
        }
    }

    private func web(_ path: String, _ tab: Destination) -> some View {
        StudioWebScreen(api: api, path: path, dataStore: websiteData, reset: resets[tab, default: 0])
    }
}

private struct StudioDownload: Identifiable {
    let id = UUID()
    let url: URL
}

private struct StudioLink: Identifiable {
    let id = UUID()
    let url: URL
}

/// Live state of one web tab, published by its web view.
@MainActor @Observable
final class StudioPage {
    var progress: Double = 0
    var loading = true
    var canGoBack = false
    var title = ""
    weak var web: WKWebView?

    func back() { web?.goBack() }
}

private struct StudioWebScreen: View {
    let api: StudioAPI
    let path: String
    let dataStore: WKWebsiteDataStore
    let reset: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page = StudioPage()
    @State private var problem: String?
    @State private var download: StudioDownload?
    @State private var link: StudioLink?
    @State private var loadID = UUID()

    var body: some View {
        VStack(spacing: 0) {
            if page.canGoBack {
                header.transition(.move(edge: .top).combined(with: .opacity))
            }
            ZStack(alignment: .top) {
                studioGround
                StudioWebView(api: api, path: path, dataStore: dataStore, page: page, reset: reset,
                              onProblem: { problem = $0 }, onDownload: { download = StudioDownload(url: $0) },
                              onExternal: { link = StudioLink(url: $0) })
                    .id(loadID)
                StudioProgressBar(value: page.progress, visible: page.loading)
                if let problem {
                    ContentUnavailableView {
                        Label("Workspace unavailable", systemImage: "network.slash")
                    } description: {
                        Text(problem)
                    } actions: {
                        Button("Try again") {
                            self.problem = nil
                            page.loading = true
                            loadID = UUID()
                        }.buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(studioGround)
                }
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86), value: page.canGoBack)
        .sheet(item: $download, onDismiss: { download = nil }) { item in
            StudioShareSheet(file: item.url)
        }
        .sheet(item: $link) { item in
            StudioSafari(url: item.url).ignoresSafeArea()
        }
        .sensoryFeedback(.error, trigger: problem) { _, new in new != nil }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Button { page.back() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background { StudioPlate(radius: 20) }
                    .contentShape(Circle())
            }
            .buttonStyle(StudioPressStyle())
            .accessibilityLabel("Back")
            Text(page.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .contentTransition(.opacity)
            Color.clear.frame(width: 40, height: 40)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }
}

/// Native press: a quick 3D sink with a light tap, used on custom buttons.
struct StudioPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.94 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.7), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

private struct StudioProgressBar: View {
    let value: Double
    let visible: Bool

    var body: some View {
        GeometryReader { box in
            Capsule()
                .fill(directorAccent)
                .frame(width: max(24, box.size.width * min(max(value, 0.08), 1)), height: 2.5)
                .opacity(visible ? 1 : 0)
                .animation(.easeOut(duration: 0.25), value: value)
                .animation(.easeOut(duration: 0.3).delay(visible ? 0 : 0.15), value: visible)
        }
        .frame(height: 2.5)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct StudioSafari: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = UIColor(studioInk)
        return safari
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
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
    let page: StudioPage
    let reset: Int
    let onProblem: (String) -> Void
    let onDownload: (URL) -> Void
    let onExternal: (URL) -> Void

    /// Makes the web workspace behave like the rest of the app: no zoom on focus, no link
    /// callouts on controls, a gentle fade on each page, and native haptics for taps and toasts.
    static let nativeFeel = """
    (() => {
      const meta = document.querySelector('meta[name=viewport]') || document.head.appendChild(document.createElement('meta'));
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
      const style = document.createElement('style');
      style.textContent = `
        html { -webkit-text-size-adjust: 100%; }
        a, button, [role=button], [role=tab], nav, summary, label, img { -webkit-touch-callout: none; }
        button, [role=button], [role=tab], nav a, summary { -webkit-user-select: none; user-select: none; }
        @media (prefers-reduced-motion: no-preference) {
          body { animation: ooo-native-in .26s cubic-bezier(.2,.8,.2,1) both; }
          @keyframes ooo-native-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        }`;
      document.head.appendChild(style);
      const post = (kind) => { try { window.webkit.messageHandlers.studioHaptic.postMessage(kind); } catch (_) {} };
      document.addEventListener('pointerdown', (event) => {
        const control = event.target.closest && event.target.closest('button, a[href], [role=button], [role=tab], [role=menuitem], [role=option], summary, input[type=checkbox], input[type=radio], select');
        if (control && !control.disabled && control.getAttribute('aria-disabled') !== 'true') post('tap');
      }, { capture: true, passive: true });
      new MutationObserver((changes) => {
        for (const change of changes) for (const node of change.addedNodes) {
          if (!(node instanceof Element)) continue;
          const role = node.getAttribute('role');
          if (role === 'alert') post('error');
          else if (role === 'status' && node.closest('[aria-live]')) post('success');
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(
            WKUserScript(source: Self.nativeFeel, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController.add(HapticRelay(), name: "studioHaptic")
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.allowsLinkPreview = false
        web.isOpaque = false
        web.backgroundColor = UIColor(studioGround)
        web.scrollView.backgroundColor = UIColor(studioGround)
        web.scrollView.keyboardDismissMode = .interactive
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        context.coordinator.watch(web)
        page.web = web

        if let url = rootURL, let token = api.token, let host = api.base.host {
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

    var rootURL: URL? { URL(string: path, relativeTo: api.base)?.absoluteURL }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        guard reset != context.coordinator.reset else { return }
        context.coordinator.reset = reset
        if let root = rootURL, web.url?.path != root.path {
            web.load(URLRequest(url: root))
        } else {
            web.scrollView.setContentOffset(CGPoint(x: 0, y: -web.scrollView.adjustedContentInset.top), animated: true)
        }
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "studioHaptic")
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var parent: StudioWebView
        var reset: Int
        private var files: [ObjectIdentifier: URL] = [:]
        private var observers: [NSKeyValueObservation] = []

        init(_ parent: StudioWebView) {
            self.parent = parent
            self.reset = parent.reset
        }

        func watch(_ web: WKWebView) {
            webView = web
            let page = parent.page
            observers = [
                web.observe(\.estimatedProgress, options: [.new]) { web, _ in
                    let value = web.estimatedProgress
                    Task { @MainActor in page.progress = value }
                },
                web.observe(\.isLoading, options: [.new]) { web, _ in
                    let loading = web.isLoading
                    Task { @MainActor in page.loading = loading }
                },
                web.observe(\.canGoBack, options: [.new]) { web, _ in
                    let back = web.canGoBack
                    Task { @MainActor in page.canGoBack = back }
                },
                web.observe(\.title, options: [.new]) { web, _ in
                    let title = (web.title ?? "").components(separatedBy: " · ").first ?? ""
                    Task { @MainActor in page.title = title }
                },
            ]
        }

        @objc func refresh(_ control: UIRefreshControl) {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { control.endRefreshing() }
        }

        /// Pages that open a new window stay inside the workspace.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if matchesOrigin(url) { webView.load(action.request) } else { parent.onExternal(url) }
            }
            return nil
        }

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
            if action.navigationType == .linkActivated {
                if ["https", "http"].contains(url.scheme ?? "") { parent.onExternal(url) }
                else { await UIApplication.shared.open(url) }
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

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.page.loading = false
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

        private weak var webView: WKWebView?

        private func failed(_ error: Error) {
            let failure = error as NSError
            if (failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled)
                || (failure.domain == "WebKitErrorDomain" && failure.code == 102) { return }
            parent.page.loading = false
            webView?.scrollView.refreshControl?.endRefreshing()
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

/// Turns taps and toasts in the web workspace into native haptics.
@MainActor
private final class HapticRelay: NSObject, WKScriptMessageHandler {
    private let tap = UIImpactFeedbackGenerator(style: .light)
    private let notice = UINotificationFeedbackGenerator()

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.body as? String {
        case "tap": tap.impactOccurred(intensity: 0.6)
        case "success": notice.notificationOccurred(.success)
        case "error": notice.notificationOccurred(.error)
        default: break
        }
    }
}
