import SwiftUI
import Combine

// MARK: - Saved inspiration

/// Device-local collections, scoped to the current account (or guest).
/// Store complete post snapshots so saves survive pagination and app restarts.
@MainActor
final class SavedInspirationStore: ObservableObject {
    @Published private(set) var items: [FeedItem] = [] {
        didSet {
            columns = InspirationColumns(items: items)
            savedIds = Set(items.map(\.id))
        }
    }
    private(set) var columns = InspirationColumns(items: [])
    private var savedIds: Set<String> = []
    @Published var errorMessage: String?
    private let defaults: UserDefaults
    private var key = "inspiration.saved.guest"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        useAccount(nil)
    }

    func useAccount(_ userId: String?) {
        key = "inspiration.saved." + (userId.map { "account.\($0)" } ?? "guest")
        errorMessage = nil
        guard let data = defaults.data(forKey: key) else { items = []; return }
        do { items = try JSONDecoder().decode([FeedItem].self, from: data) }
        catch {
            items = []
            errorMessage = "Your saved inspiration couldn't be read on this device."
        }
    }

    func contains(_ item: FeedItem) -> Bool { savedIds.contains(item.id) }

    func toggle(_ item: FeedItem) {
        var updated = items
        if contains(item) { updated.removeAll { $0.id == item.id } }
        else { updated.insert(item, at: 0) }
        do {
            let data = try JSONEncoder().encode(updated)
            defaults.set(data, forKey: key)
            items = updated
        } catch { errorMessage = "Couldn't save this post. Please try again." }
    }
}

struct SavedInspirationView: View {
    @EnvironmentObject private var saved: SavedInspirationStore
    @Environment(\.dismiss) private var dismiss
    @State private var selection: SavedSelection?

    private struct SavedSelection: Identifiable {
        let id: String
        let store: InspirationFeedStore
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if saved.items.isEmpty {
                    ContentUnavailableView("Save a little inspiration", systemImage: "bookmark",
                        description: Text("Tap the bookmark on any photo to find it here later."))
                        .padding(.top, 60)
                } else {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Your favorite ideas, all in one place.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        HStack(alignment: .top, spacing: 4) {
                            column(0)
                            column(1)
                        }
                    }
                    .padding(20)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Saved inspiration")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Text("Saved on this device")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(10).frame(maxWidth: .infinity)
                    .background(.bar)
            }
        }
        .fullScreenCover(item: $selection) { selection in
            InspirationReelView(store: selection.store, startItemId: selection.id)
        }
    }

    private func column(_ offset: Int) -> some View {
        let items = offset == 0 ? saved.columns.left : saved.columns.right
        return LazyVStack(spacing: 4) {
            ForEach(items) { item in
                ZStack(alignment: .topTrailing) {
                    Button {
                        // Keep the viewer's pages stable while unsaving.
                        selection = SavedSelection(id: item.id, store: InspirationFeedStore(savedItems: saved.items))
                    } label: { FeedCard(item: item) }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
