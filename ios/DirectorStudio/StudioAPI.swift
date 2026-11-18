import Foundation
import Observation
import Security

enum StudioAPIError: LocalizedError {
    case address, session, invalidResponse, uploadSize, keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .address: "Enter an HTTPS Studio server address without a path."
        case .session: "The server did not start a session. Check your sign-in and try again."
        case .invalidResponse: "The server returned an unreadable result."
        case .uploadSize: "Choose a file under 30 MB."
        case .keychain: "Keychain could not save the sign-in. Unlock your device and try again."
        }
    }
}

struct StudioAPI {
    let base: URL
    let token: String?

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 90
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    static func address(_ raw: String) throws -> URL {
        let cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: cleaned), let host = components.host,
              !host.isEmpty, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/", let url = components.url else {
            throw StudioAPIError.address
        }
        if components.scheme == "https" { return url }
        #if DEBUG
        if components.scheme == "http", ["127.0.0.1", "localhost"].contains(host) { return url }
        #endif
        throw StudioAPIError.address
    }

    private func request(_ path: String) throws -> URLRequest {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let url = URL(string: path, relativeTo: base)?.absoluteURL,
              url.host == base.host, url.scheme == base.scheme, url.port == base.port else {
            throw StudioAPIError.address
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("Director Studio for iPhone", forHTTPHeaderField: "User-Agent")
        if let token { request.setValue("px_session=\(token)", forHTTPHeaderField: "Cookie") }
        return request
    }

    @discardableResult
    private func check(_ response: URLResponse, data: Data?) throws -> HTTPURLResponse {
        guard let response = response as? HTTPURLResponse else { throw StudioAPIError.invalidResponse }
        if (200..<300).contains(response.statusCode) { return response }
        if let data, let parsed = try? JSONDecoder().decode(ProblemEnvelope.self, from: data) {
            throw parsed.error
        }
        throw StudioProblem(code: "http_error", message: "The Studio server returned HTTP \(response.statusCode).")
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, response) = try await Self.session.data(for: request(path))
        try check(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    func post<T: Decodable>(_ path: String, _ body: some Encodable) async throws -> T {
        let (data, _) = try await send(path, body)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func send(_ path: String, _ body: some Encodable) async throws -> (Data, HTTPURLResponse) {
        var request = try request(path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await Self.session.data(for: request)
        return (data, try check(response, data: data))
    }

    func authenticate(email: String, password: String, signup: Bool) async throws -> String {
        let (_, response) = try await send("/api/auth/\(signup ? "signup" : "login")", ["email": email, "password": password])
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            result[String(describing: item.key)] = String(describing: item.value)
        }
        guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: base).first(where: { $0.name == "px_session" }),
              !cookie.value.isEmpty else { throw StudioAPIError.session }
        return cookie.value
    }

    func upload(_ media: ImportedMedia) async throws -> MediaAsset {
        guard media.data.count <= 30_000_000 else { throw StudioAPIError.uploadSize }
        let boundary = "DirectorStudio-\(UUID().uuidString)"
        let name = media.filename.replacingOccurrences(of: "[\\r\\n\"\\\\]", with: "_", options: .regularExpression)
        let header = "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        var body = Data(header.utf8)
        body.append(media.data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = try request("/api/assets")
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await Self.session.upload(for: request, from: body)
        try check(response, data: data)
        return try JSONDecoder().decode(AssetResponse.self, from: data).asset
    }

    func bytes(_ path: String) async throws -> Data {
        let (data, response) = try await Self.session.data(for: request(path))
        try check(response, data: data)
        return data
    }

    func download(_ path: String, filename: String) async throws -> URL {
        let (temporary, response) = try await Self.session.download(for: request(path))
        try check(response, data: nil)
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        let safeName = filename.replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "_", options: .regularExpression)
        let destination = parent.appendingPathComponent(safeName.isEmpty || [".", ".."].contains(safeName) ? "export" : safeName)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct ProblemEnvelope: Decodable { let error: StudioProblem }
struct AssetResponse: Decodable { let asset: MediaAsset }
struct ModeResponse: Decodable { let mode: String; let commerce: Bool? }
struct StylesResponse: Decodable { let styles: [StyleSummary] }
struct ProjectsResponse: Decodable { let projects: [ProjectSummary] }
struct AssetsResponse: Decodable { let assets: [MediaAsset] }
struct NewStyleResponse: Decodable { let styleId: String }
struct NewProjectResponse: Decodable { let projectId: String }
struct JobResponse: Decodable { let job: StudioJob }
struct VersionResponse: Decodable { let version: StyleVersion }
struct SnapshotResponse: Decodable { let pack: Snapshot }
struct ImagesResponse: Decodable { let images: [ImageAttempt] }
struct EmptyBody: Codable {}
struct LogoutResponse: Decodable {}

private enum SessionsKeychain {
    private static func query(_ base: URL) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "Director Studio session",
            kSecAttrAccount as String: base.absoluteString,
        ]
    }

    static func read(_ base: URL) -> String? {
        var request = query(base)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String, for base: URL) throws {
        let request = query(base)
        let data = Data(token.utf8)
        let change = [kSecValueData as String: data]
        var status = SecItemUpdate(request as CFDictionary, change as CFDictionary)
        if status == errSecItemNotFound {
            var item = request
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        if status != errSecSuccess { throw StudioAPIError.keychain(status) }
    }

    static func delete(_ base: URL) {
        SecItemDelete(query(base) as CFDictionary)
    }
}

@Observable @MainActor
final class StudioSession {
    var api: StudioAPI?
    var fixture = false
    var commerce = false
    var inDemo = false
    var address = UserDefaults.standard.string(forKey: "studioAddress") ?? ""

    func restore() async throws {
        guard let base = try? StudioAPI.address(address), let token = SessionsKeychain.read(base) else { return }
        do {
            try await open(base: base, token: token)
        } catch let problem as StudioProblem where problem.code == "unauthorized" {
            SessionsKeychain.delete(base)
        }
    }

    func signIn(email: String, password: String, signup: Bool) async throws {
        let base = try StudioAPI.address(address)
        let token = try await StudioAPI(base: base, token: nil).authenticate(email: email, password: password, signup: signup)
        try await open(base: base, token: token)
    }

    private func open(base: URL, token: String) async throws {
        let session = StudioAPI(base: base, token: token)
        let status: ModeResponse = try await session.get("/api/director/status")
        try SessionsKeychain.save(token, for: base)
        UserDefaults.standard.set(base.absoluteString, forKey: "studioAddress")
        fixture = status.mode == "mock"
        commerce = status.commerce == true
        api = session
    }

    func signOut() async {
        guard let api else { return }
        let _: LogoutResponse? = try? await api.post("/api/auth/logout", EmptyBody())
        SessionsKeychain.delete(api.base)
        self.api = nil
        fixture = false
        commerce = false
    }
}
