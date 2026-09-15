import Foundation
import Combine

/// Partition once when data changes; scrolling never re-splits the feed.
struct InspirationColumns {
    let left: [FeedItem]
    let right: [FeedItem]

    init(items: [FeedItem]) {
        var left: [FeedItem] = []
        var right: [FeedItem] = []
        left.reserveCapacity((items.count + 1) / 2)
        right.reserveCapacity(items.count / 2)
        for (index, item) in items.enumerated() {
            if index.isMultiple(of: 2) { left.append(item) }
            else { right.append(item) }
        }
        self.left = left
        self.right = right
    }
}

// MARK: - Feed store

/// Pagination shared by the grid and the reel, so opening the reel doesn't
/// re-fetch what the grid already has and scrolling the reel past the end
/// keeps loading into the same list the grid is showing.
@MainActor
final class InspirationFeedStore: ObservableObject {
    @Published private(set) var items: [FeedItem] = [] {
        didSet { prepareFeed() }
    }
    private(set) var columns = InspirationColumns(items: [])
    private(set) var featuredItems: [FeedItem] = []
    private(set) var roomCovers: [String: String] = [:]
    private var itemIndices: [String: Int] = [:]

    private func prepareFeed() {
        columns = InspirationColumns(items: items)
        featuredItems = Array(items.prefix(6))
        itemIndices = Dictionary(items.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        for item in items {
            if let category = item.category { roomCovers[category] = item.imageUrl }
        }
    }
    @Published private(set) var isLoading = false
    @Published private(set) var loadingMore = false
    @Published private(set) var error: String?
    @Published private(set) var loadMoreError: String?
    @Published var category: String?

    private var page = 1
    private var hasMore = true
    /// Guards against a category swap landing an in-flight page from the
    /// previous category into the new list.
    private var loadToken = 0

    init(savedItems: [FeedItem]? = nil) {
        if let savedItems {
            items = savedItems
            hasMore = false
        }
        prepareFeed()
    }

    func setCategory(_ value: String?) async {
        guard category != value else { return }
        category = value
        // Keep the current layout in place until the replacement page arrives.
        await load(reset: true)
    }

    func load(reset: Bool) async {
        if reset {
            isLoading = true
            page = 1
            hasMore = true
            error = nil
            loadMoreError = nil
        } else {
            guard hasMore, !isLoading, !loadingMore, loadMoreError == nil else { return }
            loadingMore = true
            loadMoreError = nil
        }
        loadToken += 1
        let token = loadToken
        let requestedCategory = category
        defer {
            if token == loadToken {
                isLoading = false
                loadingMore = false
            }
        }
        do {
            let resp = try await APIService.shared.feed(page: reset ? 1 : page, category: requestedCategory)
            // A newer load (or a category swap) started while this was in
            // flight — drop the stale page rather than mixing categories.
            guard token == loadToken, requestedCategory == category else { return }
            // Replace in place: animating the whole feed moves every section
            // vertically when a room has a different number of projects.
            var seen = reset ? Set<String>() : Set(items.map(\.id))
            let newItems = resp.items.filter { seen.insert($0.id).inserted }
            if reset { items = newItems } else { items += newItems }
            hasMore = resp.hasMore
            page = resp.page + 1
        } catch {
            guard token == loadToken else { return }
            if reset {
                items = []
                self.error = error.localizedDescription
            }
            else { loadMoreError = error.localizedDescription }
        }
    }

    /// Called as the user nears the end of either surface.
    func loadMoreIfNeeded(currentItemId: String, lookahead: Int) {
        guard hasMore, !isLoading, !loadingMore, loadMoreError == nil else { return }
        guard let idx = itemIndices[currentItemId] else { return }
        guard idx >= items.count - lookahead else { return }
        Task { await load(reset: false) }
    }

    func retryLoadMore() {
        loadMoreError = nil
        Task { await load(reset: false) }
    }
}
