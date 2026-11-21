import Foundation

struct StyleSummary: Decodable, Identifiable {
    let id: String
    let title: String
    let notes: String
    let assetId: String
    let latest: StyleVersion?
}

struct StyleDetail: Decodable {
    let id: String
    let title: String
    let notes: String
    let assetId: String
    let versions: [StyleVersion]
    let analysis: [StudioJob]
}

struct StyleVersion: Decodable, Identifiable {
    let id: String
    let version: Int
    let saved: Bool
    let profile: StyleProfile
}

struct StyleProfile: Decodable {
    let schemaVersion: Int?
    let guide: String
    let fixture: Bool
    let rules: [StyleRule]
    let evidence: Evidence
}

struct StyleRule: Codable {
    let topic: String
    let basis: String
    let reuse: String
    var detail: String
    let evidence: [Int]
    let measures: [String]?
}

struct Evidence: Decodable {
    let width: Int
    let height: Int
    let duration: Double?
    let hasAudio: Bool
    let audioCues: [AudioCue]?
    let frames: [EvidenceFrame]
    let sources: [EvidenceSource]?
    let metrics: StyleMetrics?
    let metricSpread: [String: Double]?
}

struct EvidenceSource: Decodable {
    let assetId: String
    let digest: String
    let duration: Double?
    let width: Int
    let height: Int
    let hasAudio: Bool
    let metrics: StyleMetrics
}

struct StyleMetrics: Decodable {
    struct Editing: Decodable {
        let cutTimes: [Double]?
        let shotLengths: [String: Double?]
        let cutsPer10s: Double?
    }

    struct PaletteColor: Decodable {
        let hex: String
        let lab: [Double]
        let weight: Double
    }

    struct Motion: Decodable {
        let translation: [String: Double]?
        let rotation: Double?
        let zoom: Double?
        let jitter: Double?
        let motionEnergy: Double?
        let camera: String?
    }

    let editing: Editing
    let palette: [PaletteColor]?
    let tone: [String: Double?]
    let grain: Double?
    let motion: Motion
    let audio: [String: Double?]
    let reasons: [String: String]
}

struct AudioCue: Decodable {
    let seconds: Double
    let type: String
}

struct EvidenceFrame: Decodable, Identifiable {
    let ordinal: Int
    let seconds: Double?
    let cutCandidate: Bool
    let source: Int?
    var id: Int { ordinal }
}

struct ProjectSummary: Decodable, Identifiable {
    let id: String
    let title: String
}

struct PinnedStyle: Decodable {
    let id: String
    let title: String
    let version: Int
}

struct ProjectDetail: Decodable {
    let project: ProjectSummary
    let brief: ProjectBrief
    let pinnedStyle: PinnedStyle
    let pack: Snapshot?
    let versions: [SnapshotVersion]
    let jobs: [StudioJob]
}

struct SnapshotVersion: Decodable, Identifiable {
    let id: String
    let version: Int
}

struct ProjectBrief: Codable {
    var title = ""
    var styleVersionId = ""
    var brief = ""
    var constraints = ""
    var cast: [CastMember] = []
    var duration = 5
    var aspect = "9:16"
    var model = "seedance-2.0"
}

/// A render model the Director can use: Seedance omni-reference, or a registry video model
/// that renders from the prompt and optional start and end keyframes.
struct DirectorModelOption: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let engine: String
    let durations: [Int]
    let aspects: [String]?
    let resolutions: [String]
    let defaultResolution: String
    let slots: [String]
    let seed: Bool
    let quality: Bool
    let available: Bool

    static let allAspects = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]
    /// Shown until the server list arrives.
    static let seedance = [
        DirectorModelOption(id: "seedance-2.0", name: "Seedance 2.0", engine: "omni", durations: Array(4...15), aspects: nil,
                            resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "720p", slots: [], seed: false, quality: true, available: true),
        DirectorModelOption(id: "seedance-2.5", name: "Seedance 2.5", engine: "omni", durations: Array(5...30), aspects: nil,
                            resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "720p", slots: [], seed: true, quality: false, available: true),
    ]

    var summary: String {
        let lengths = durations.count > 2 && durations.last! - durations.first! == durations.count - 1
            ? "\(durations.first!)–\(durations.last!) s" : durations.map(String.init).joined(separator: ", ") + " s"
        if engine == "omni" { return "\(lengths) clips with identity, style, motion and sound references." }
        let frames = slots.count == 2 ? " and start/end keyframes" : slots.count == 1 ? " and a start keyframe" : ""
        return "\(lengths) clips from the prompt\(frames). The style travels in the prompt."
    }
}

struct AgentKeyRequest: Encodable {
    var name = "Agent · full access (iPhone)"
    var scopes = ["read", "generate", "account"]
}

struct AgentKey: Decodable {
    let secret: String
}

struct DirectorModelsResponse: Decodable {
    let models: [DirectorModelOption]
}

struct CastMember: Codable {
    var name: String
    var notes = ""
    var assetIds: [String]
}

struct Snapshot: Decodable, Identifiable {
    let id: String
    let version: Int
    let body: Pack
}

struct Pack: Decodable {
    var plan: Storyboard
    var settings: RenderSettings
    let clips: [CompiledClip]
    let notes: [String]
}

struct RenderSettings: Codable, Equatable {
    var model: String
    var resolution: String
    var quality: String?
    var seed: Int?
    var styleRefs: Bool? = nil
}

struct Storyboard: Codable, Equatable {
    var clips: [StoryClip]
    var imagePrompts: [ImagePrompt]
    var notes: String
}

struct StoryClip: Codable, Equatable {
    var startMs: Int
    var endMs: Int
    var mode: String
    var shots: [Shot]
    var references: [Reference]
    var promptOverride: String
}

struct Shot: Codable, Equatable {
    var startMs: Int
    var endMs: Int
    var start: String
    var action: String
    var movement: String
    var end: String
    var framing: String
    var continuity: String
    var sound: String
    var transition: String
}

struct Reference: Codable, Equatable {
    let assetId: String
    let modality: String
    var role: String
    var scope: String
}

struct ImagePrompt: Codable, Equatable {
    let kind: String
    var title: String
    var prompt: String
    var assetIds: [String]
}

struct CompiledClip: Decodable {
    let endpoint: String
    let prompt: String
    let duration: Int
    let attachments: [Attachment]
}

struct Attachment: Decodable, Identifiable {
    let assetId: String
    let modality: String
    let role: String
    let scope: String
    let index: Int
    let filename: String
    var id: String { assetId }
}

struct StudioJob: Decodable, Identifiable {
    let id: String
    let kind: String
    let state: String
    let fixture: Bool
    let snapshotId: String?
    let message: String?
    let clip: Int?
    let error: StudioProblem?
    let credits: CreditRecord
    let result: JobResult?

    var isActive: Bool { ["queued", "running", "submitting", "polling"].contains(state) }
}

struct JobResult: Decodable {
    let reply: String?
    let url: String?
    let filename: String?
    let duration: Double?
    let estimatedUsd: Double?
    let providerCost: Double?
}

struct CreditRecord: Decodable {
    let reserved: Int
    let spent: Int
    let released: Int
}

struct StudioProblem: Decodable, LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
}

struct MediaAsset: Decodable, Identifiable {
    let id: String
    let title: String
    let kind: String
    let url: String
    let posterUrl: String?
}

struct Quote: Decodable {
    let millicredits: Int
    let estimatedUsd: Double
    let fixture: Bool
    let sendsReferencesToMuapi: Bool?
}

struct ImageAttempt: Decodable, Identifiable {
    let index: Int
    let job: ImageJob
    var id: String { job.id }
}

struct ImageJob: Decodable, Identifiable {
    let id: String
    let status: String
    let assets: [MediaAsset]
    let error: StudioProblem?
}

struct Submission: Encodable {
    let clip: Int?
    let index: Int?
    let requestKey: String
    let maxCredits: Int
}
