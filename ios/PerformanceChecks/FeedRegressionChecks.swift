import Foundation
import Combine

/// Network double only: the runner compiles the real feed models and stores.
@MainActor final class APIService {
    static let shared = APIService()
    var calls: [String] = []
    var handler: (Int, String?) async throws -> FeedResponse = { _, _ in fatalError("Configure fixture") }
    func feed(page: Int, category: String?) async throws -> FeedResponse {
        calls.append("\(category ?? "all"):\(page)")
        return try await handler(page, category)
    }
}

@main struct FeedRegressionChecks {
    @MainActor static func item(_ id: String, category: String = "Kitchen") -> FeedItem {
        FeedItem(id: id, kind: .post, postId: id, projectId: nil, title: id, caption: nil, category: category,
                 costMin: nil, costMax: nil, slides: [], slideCount: 1, beforeAfterCount: 0,
                 business: FeedBusiness(id: "demo", companyName: "Demo", logoUrl: nil, city: "City", state: "IL", verified: nil),
                 imageUrl: "https://fixtures.invalid/\(id).jpg", beforeImageUrl: nil, isBeforeAfter: false)
    }

    @MainActor static func main() async throws {
        let api = APIService.shared
        api.handler = { page, _ in
            if page == 2 { try await Task.sleep(for: .milliseconds(20)) }
            return FeedResponse(items: page == 1 ? [item("one"), item("two")] : [item("two"), item("three")],
                                page: page, limit: 2, hasMore: page == 1)
        }
        let feed = InspirationFeedStore()
        await feed.load(reset: true)
        assert(feed.columns.left.map(\.id) == ["one"])
        assert(feed.columns.right.map(\.id) == ["two"])
        for _ in 0..<12 { feed.loadMoreIfNeeded(currentItemId: "two", lookahead: 4) }
        try await Task.sleep(for: .milliseconds(100))
        assert(api.calls.filter { $0 == "all:2" }.count == 1)
        assert(feed.items.map(\.id) == ["one", "two", "three"], "Pagination must deduplicate")
        assert(feed.columns.left.map(\.id) == ["one", "three"])
        assert(feed.featuredItems.count == 3)
        assert(feed.roomCovers["Kitchen"] != nil)

        api.handler = { _, category in
            try await Task.sleep(for: .milliseconds(category == "Kitchen" ? 50 : 10))
            return FeedResponse(items: [item(category!, category: category!)], page: 1, limit: 30, hasMore: false)
        }
        let slow = Task { await feed.setCategory("Kitchen") }
        await Task.yield()
        let fast = Task { await feed.setCategory("Bathroom") }
        await fast.value
        assert(feed.items.first?.id == "Bathroom")
        await slow.value
        assert(feed.items.first?.id == "Bathroom", "Stale request must not replace selected room")
        assert(!feed.isLoading && !feed.loadingMore)

        let snapshot = InspirationFeedStore(savedItems: [item("saved")])
        let before = api.calls.count
        snapshot.loadMoreIfNeeded(currentItemId: "saved", lookahead: 4)
        await Task.yield()
        assert(api.calls.count == before)
        assert(snapshot.columns.left.first?.id == "saved")

        let suite = "inspiration-checks-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let saved = SavedInspirationStore(defaults: defaults)
        saved.toggle(item("one")); saved.toggle(item("two"))
        assert(saved.columns.left.first?.id == "two")
        let restarted = SavedInspirationStore(defaults: defaults)
        assert(restarted.items.map(\.id) == ["two", "one"])
        restarted.useAccount("alice"); assert(restarted.items.isEmpty)
        restarted.toggle(item("one")); restarted.useAccount("bob"); assert(restarted.items.isEmpty)
        restarted.useAccount("alice"); assert(restarted.contains(item("one")))
        restarted.toggle(item("one")); assert(restarted.items.isEmpty)
        restarted.useAccount(nil); assert(restarted.items.count == 2)
        print("PASS: cached columns, duplicate pagination, concurrent loads, stale response isolation, saved viewer, persistence and account isolation")
    }
}
