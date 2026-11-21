import StoreKit
import SwiftUI

struct StoreShelf: Decodable {
    struct ListedProduct: Decodable { let id: String; let kind: String }
    let appAccountToken: UUID
    let balance: Int
    let expiresAt: Double?
    let environment: String
    let products: [ListedProduct]
}

enum StoreReceipt {
    private struct SignedTransaction: Encodable { let signedTransaction: String }

    static func send(_ result: VerificationResult<StoreKit.Transaction>, api: StudioAPI) async throws -> StoreShelf {
        guard case let .verified(transaction) = result else {
            throw StudioProblem(code: "unverified_purchase", message: "This device could not verify the App Store transaction.")
        }
        let shelf: StoreShelf = try await api.post(
            "/api/director/store/transactions", SignedTransaction(signedTransaction: result.jwsRepresentation)
        )
        await transaction.finish()
        return shelf
    }

    static func listen(_ api: StudioAPI) async {
        for await result in StoreKit.Transaction.updates {
            if Task.isCancelled { return }
            _ = try? await send(result, api: api)
        }
    }
}

struct StudioPurchases: View {
    let api: StudioAPI
    @Environment(\.dismiss) private var dismiss
    @State private var shelf: StoreShelf?
    @State private var products: [Product] = []
    @State private var working = false
    @State private var status: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let shelf {
                    Section {
                        if shelf.environment == "sandbox" { Text("Sandbox purchases and test balance") }
                        LabeledContent("Render credits", value: (Double(shelf.balance) / 1000).formatted(.number.precision(.fractionLength(0...3))))
                        if let expiration = shelf.expiresAt {
                            LabeledContent("Subscription through", value: Date(timeIntervalSince1970: expiration / 1000).formatted(date: .abbreviated, time: .omitted))
                        }
                    }
                    if products.isEmpty {
                        Text("No products are available from the App Store.").foregroundStyle(.secondary)
                    }
                    ForEach(products) { product in
                        Section {
                            Text(product.description)
                            if let period = product.subscription?.subscriptionPeriod {
                                Text(periodText(period)).font(.footnote).foregroundStyle(.secondary)
                            }
                            Button("Buy for \(product.displayPrice)") {
                                Task { await buy(product, token: shelf.appAccountToken) }
                            }
                        } header: { Text(product.displayName) }
                    }
                    Button("Restore purchases") { Task { await restore() } }
                } else if working {
                    ProgressView("Loading App Store products")
                }
                if let status { Text(status).foregroundStyle(.secondary) }
            }
            .disabled(working)
            .navigationTitle("Purchases")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task {
                working = true
                defer { working = false }
                do {
                    let snapshot: StoreShelf = try await api.get("/api/director/store")
                    shelf = snapshot
                    products = try await Product.products(for: snapshot.products.map(\.id))
                    for await result in StoreKit.Transaction.unfinished {
                        shelf = try await StoreReceipt.send(result, api: api)
                    }
                } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            }
            .studioError($error)
        }
    }

    private func periodText(_ period: Product.SubscriptionPeriod) -> String {
        let interval: String
        switch period.unit {
        case .day: interval = period.value == 1 ? "day" : "days"
        case .week: interval = period.value == 1 ? "week" : "weeks"
        case .month: interval = period.value == 1 ? "month" : "months"
        case .year: interval = period.value == 1 ? "year" : "years"
        @unknown default: return "Auto-renewing subscription"
        }
        return "Renews every \(period.value) \(interval) until canceled."
    }

    private func buy(_ product: Product, token: UUID) async {
        working = true
        status = nil
        defer { working = false }
        do {
            switch try await product.purchase(options: [.appAccountToken(token)]) {
            case let .success(result):
                shelf = try await StoreReceipt.send(result, api: api)
            case .pending:
                status = "The App Store is waiting for approval."
            case .userCancelled:
                break
            @unknown default:
                status = "Check your App Store purchase status."
            }
        } catch { self.error = error.localizedDescription }
    }

    private func restore() async {
        working = true
        status = nil
        defer { working = false }
        do {
            try await AppStore.sync()
            for await entitlement in StoreKit.Transaction.currentEntitlements {
                shelf = try await StoreReceipt.send(entitlement, api: api)
            }
            shelf = try await api.get("/api/director/store")
            status = "Purchase history refreshed."
        } catch { self.error = error.localizedDescription }
    }
}
