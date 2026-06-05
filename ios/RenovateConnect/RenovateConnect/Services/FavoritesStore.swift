import SwiftUI
import Combine

/// Tracks the homeowner's saved contractors. Keeps the full saved `Business`
/// objects (for the "My Projects" hub) plus a fast lookup set of ids so any
/// card or detail view can render its heart state without a round-trip.
/// Toggles are optimistic — the UI flips immediately and reconciles on failure.
@MainActor
final class FavoritesStore: ObservableObject {
    /// Shared instance so toolbar content (outside the injected SwiftUI
    /// environment) can resolve it without an `@EnvironmentObject` lookup.
    static let shared = FavoritesStore()

    @Published private(set) var businesses: [Business] = []
    @Published private(set) var savedIds: Set<String> = []

    /// "What's new with your saved contractors" digest + a badge count of the
    /// total new items across all saved businesses.
    @Published private(set) var digest: [FavoritesDigestEntry] = []
    @Published private(set) var digestUnseen = 0

    func isSaved(_ businessId: String) -> Bool { savedIds.contains(businessId) }

    func refresh() async {
        guard let saved = try? await APIService.shared.myFavorites() else { return }
        businesses = saved
        savedIds = Set(saved.map(\.id))
    }

    /// Pull the full digest and refresh the badge count in one pass.
    func refreshDigest() async {
        digest = (try? await APIService.shared.favoritesDigest()) ?? []
        digestUnseen = (try? await APIService.shared.favoritesDigestUnseen())?.items ?? 0
    }

    /// Cheap badge-only refresh for the entry point (no full payload).
    func refreshDigestBadge() async {
        digestUnseen = (try? await APIService.shared.favoritesDigestUnseen())?.items ?? 0
    }

    /// Mark everything currently in the digest as seen and clear it locally.
    func markDigestSeen() async {
        guard digestUnseen > 0 || !digest.isEmpty else { return }
        try? await APIService.shared.markFavoritesDigestSeen()
        digest = []
        digestUnseen = 0
    }

    /// Flip the saved state for a business. Updates the UI first, then calls the
    /// API; on failure the optimistic change is rolled back.
    func toggle(_ business: Business) {
        if savedIds.contains(business.id) {
            // Optimistic remove
            savedIds.remove(business.id)
            businesses.removeAll { $0.id == business.id }
            Task {
                do { try await APIService.shared.removeFavorite(businessId: business.id) }
                catch { await refresh() }
            }
        } else {
            // Optimistic add
            savedIds.insert(business.id)
            if !businesses.contains(where: { $0.id == business.id }) {
                businesses.insert(business, at: 0)
            }
            Task {
                do { try await APIService.shared.saveFavorite(businessId: business.id) }
                catch { await refresh() }
            }
        }
    }

    /// Clear local state on logout so a new account doesn't inherit it.
    func clear() {
        businesses = []
        savedIds = []
        digest = []
        digestUnseen = 0
    }
}
