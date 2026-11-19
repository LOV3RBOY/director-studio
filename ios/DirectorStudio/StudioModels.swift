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
}

struct Evidence: Decodable {
    let width: Int
    let height: Int
    let duration: Double?
    let hasAudio: Bool
    let audioCues: [AudioCue]?
    let frames: [EvidenceFrame]
}

struct AudioCue: Decodable {
    let seconds: Double
    let type: String
}

struct EvidenceFrame: Decodable, Identifiable {
    let ordinal: Int
    let seconds: Double?
    let cutCandidate: Bool
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
