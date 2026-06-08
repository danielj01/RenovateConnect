import SwiftUI

/// The Inspiration tab: a Pinterest-style masonry feed of real contractor
/// project photos (and before/afters). Tapping a photo routes to the contractor
/// behind it, with a "price this look" path into the estimator. Browsing only —
/// deliberately not a social network.
struct InspirationView: View {
    @State private var items: [FeedItem] = []
    @State private var page = 1
    @State private var hasMore = true
    @State private var isLoading = false
    @State private var loadingMore = false
    @State private var error: String?
    @State private var category: String?

    private let categories = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Whole home", "Exterior"]

    // Simple two-column waterfall: alternate items by index. Good enough without
    // knowing image dimensions up front; heights vary naturally with each photo.
    private var leftColumn: [FeedItem] { items.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element) }
    private var rightColumn: [FeedItem] { items.enumerated().filter { !$0.offset.isMultiple(of: 2) }.map(\.element) }

    var body: some View {
        NavigationStack {
            ScrollView {
                categoryChips

                if isLoading && items.isEmpty {
                    ProgressView().padding(.top, 80)
                } else if let error, items.isEmpty {
                    ContentUnavailableView(error, systemImage: "photo.on.rectangle.angled").padding(.top, 60)
                } else if items.isEmpty {
                    ContentUnavailableView(
                        "No inspiration yet",
                        systemImage: "photo.on.rectangle.angled",
                        description: Text("Project photos from contractors will appear here.")
                    ).padding(.top, 60)
                } else {
                    HStack(alignment: .top, spacing: 10) {
                        column(leftColumn)
                        column(rightColumn)
                    }
                    .padding(.horizontal, 10)

                    if loadingMore {
                        ProgressView().padding(.vertical, 16)
                    }
                }
            }
            .navigationTitle("Inspiration")
            .task { if items.isEmpty { await load(reset: true) } }
            .refreshable { await load(reset: true) }
        }
    }

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", value: nil)
                ForEach(categories, id: \.self) { chip($0, value: $0) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
    }

    private func chip(_ label: String, value: String?) -> some View {
        Button {
            guard category != value else { return }
            category = value
            Task { await load(reset: true) }
        } label: {
            Text(label)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(category == value ? Theme.primary : Color(.systemGray6))
                .foregroundStyle(category == value ? .white : Color(.label))
                .clipShape(Capsule())
        }
    }

    private func column(_ colItems: [FeedItem]) -> some View {
        LazyVStack(spacing: 10) {
            ForEach(colItems) { item in
                NavigationLink {
                    FeedDetailView(item: item)
                } label: {
                    FeedCard(item: item)
                }
                .buttonStyle(.plain)
                .onAppear { maybeLoadMore(after: item) }
            }
        }
    }

    private func maybeLoadMore(after item: FeedItem) {
        guard hasMore, !loadingMore else { return }
        // Trigger when one of the last few items appears.
        if let idx = items.firstIndex(where: { $0.id == item.id }), idx >= items.count - 4 {
            Task { await load(reset: false) }
        }
    }

    private func load(reset: Bool) async {
        if reset {
            isLoading = true
            page = 1
            hasMore = true
        } else {
            guard hasMore, !loadingMore else { return }
            loadingMore = true
        }
        defer { isLoading = false; loadingMore = false }
        error = nil
        do {
            let resp = try await APIService.shared.feed(page: reset ? 1 : page, category: category)
            if reset { items = resp.items } else { items += resp.items }
            hasMore = resp.hasMore
            page = resp.page + 1
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Card

private struct FeedCard: View {
    let item: FeedItem

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                AsyncImage(url: URL(string: item.imageUrl)) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure: Color(.systemGray5).frame(height: 160).overlay(Image(systemName: "photo").foregroundStyle(.secondary))
                    default: Color(.systemGray6).frame(height: 160).overlay(ProgressView())
                    }
                }
                .frame(maxWidth: .infinity)
                .clipped()

                if item.isBeforeAfter {
                    Text("Before & After")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(8)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(item.business.companyName).font(.caption.weight(.semibold)).lineLimit(1)
                if let cost = item.costText {
                    Text(cost).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(8)
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Detail

private struct FeedDetailView: View {
    let item: FeedItem
    @State private var showingAfter = true

    private var shownURL: String {
        (!showingAfter && item.beforeImageUrl != nil) ? item.beforeImageUrl! : item.imageUrl
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AsyncImage(url: URL(string: shownURL)) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure: Color(.systemGray5).frame(height: 240).overlay(Image(systemName: "photo"))
                    default: Color(.systemGray6).frame(height: 240).overlay(ProgressView())
                    }
                }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                if item.isBeforeAfter {
                    Picker("View", selection: $showingAfter) {
                        Text("Before").tag(false)
                        Text("After").tag(true)
                    }
                    .pickerStyle(.segmented)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(item.title).font(.title3.bold())
                    HStack(spacing: 8) {
                        if let category = item.category {
                            Text(category).font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color(.systemGray6), in: Capsule())
                        }
                        if let cost = item.costText {
                            Text(cost).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primary)
                        }
                    }
                }

                // The contractor behind the photo — the whole point of the tap.
                NavigationLink {
                    BusinessDetailView(businessId: item.business.id)
                } label: {
                    RCCard {
                        HStack(spacing: 12) {
                            BusinessAvatar(name: item.business.companyName, logoUrl: item.business.logoUrl, size: 44, cornerRadius: 10)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 5) {
                                    Text(item.business.companyName).font(.subheadline.weight(.semibold))
                                    if item.business.isVerified {
                                        Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(VerifiedBadge.trust)
                                    }
                                }
                                Text("\(item.business.city), \(item.business.state)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .padding(14)
                    }
                }
                .buttonStyle(.plain)

                // Our wedge: inspiration → instant cost → hire.
                Button {
                    TabRouter.shared.selection = TabRouter.estimate
                } label: {
                    Label("Get an instant estimate for a project like this", systemImage: "wand.and.stars")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .foregroundStyle(.white)
                        .background(Theme.primary, in: RoundedRectangle(cornerRadius: 14))
                }
            }
            .padding(16)
        }
        .navigationTitle(item.business.companyName)
        .navigationBarTitleDisplayMode(.inline)
    }
}
