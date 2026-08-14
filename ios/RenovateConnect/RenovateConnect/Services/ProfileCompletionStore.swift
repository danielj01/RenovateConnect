import Foundation
import Combine

/// Tracks how "lead-ready" a contractor's profile is, beyond the required
/// fields already enforced at signup (business created, license number).
/// Shared (not per-screen) so the Profile Strength checklist, the Dashboard
/// card, and the Leads empty state all agree without each fetching separately.
@MainActor
final class ProfileCompletionStore: ObservableObject {
    static let shared = ProfileCompletionStore()

    @Published private(set) var hasPortfolioPhoto = false
    @Published private(set) var hasSubmittedVerification = false
    @Published private(set) var hasLoaded = false

    /// The two required-at-signup steps (business profile + license) are
    /// already guaranteed by the time this store is relevant, so the
    /// checklist starts at 2 of 4 rather than 0 — the remaining two are the
    /// ones this store actually tracks.
    private let stepsAlreadyDone = 2
    private let totalSteps = 4

    var completedCount: Int {
        stepsAlreadyDone + (hasPortfolioPhoto ? 1 : 0) + (hasSubmittedVerification ? 1 : 0)
    }
    var isComplete: Bool { hasPortfolioPhoto && hasSubmittedVerification }

    func refresh(businessId: String) async {
        async let portfolio = try? APIService.shared.getPortfolio(businessId: businessId)
        async let docs = try? APIService.shared.verificationDocuments(businessId: businessId)
        let (p, d) = await (portfolio, docs)
        hasPortfolioPhoto = (p ?? []).contains { !$0.imageUrls.isEmpty || !($0.beforeImageUrls ?? []).isEmpty }
        hasSubmittedVerification = !(d ?? []).isEmpty
        hasLoaded = true
    }
}
