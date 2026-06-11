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
    // Split once per items change (via the destructured tuple) so a body
    // re-render from an unrelated state change (e.g. loadingMore flipping)
    // doesn't recompute both columns.
    private var columns: (left: [FeedItem], right: [FeedItem]) {
        var left: [FeedItem] = []
        var right: [FeedItem] = []
        for (i, item) in items.enumerated() {
            if i.isMultiple(of: 2) { left.append(item) } else { right.append(item) }
        }
        return (left, right)
    }

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
                    let cols = columns
                    HStack(alignment: .top, spacing: 10) {
                        column(cols.left)
                        column(cols.right)
                    }
                    .padding(.horizontal, 10)
                    // Cross-fade when the items array swaps wholesale (category
                    // change). Without an explicit transition, iOS 17/18 snaps
                    // the LazyVStack from old → new identities with no easing.
                    .transition(.opacity)
                    // Re-establish identity per category so the ScrollView
                    // doesn't try to diff a totally different list against the
                    // old one — that diff is what produces the visible jump.
                    .id(category ?? "all")

                    if loadingMore {
                        ProgressView().padding(.vertical, 16)
                    }
                }
            }
            .animation(.easeInOut(duration: 0.2), value: items.count)
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
            // Clear the old grid immediately so the user doesn't see stale
            // items snap to new ones — the ProgressView covers the gap until
            // the new page lands. Wrapped in withAnimation so the cross-fade
            // transition on the items HStack picks it up.
            withAnimation(.easeInOut(duration: 0.18)) {
                category = value
                items = []
            }
            Task { await load(reset: true) }
        } label: {
            Text(label)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(category == value ? Theme.primary : Color(.systemGray6))
                .foregroundStyle(category == value ? .white : Color(.label))
                .clipShape(Capsule())
                // Explicit easing on the selected-state swap; iOS 18 dropped
                // the implicit color animation Button labels used to get.
                .animation(.easeInOut(duration: 0.18), value: category)
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
            withAnimation(.easeInOut(duration: 0.2)) {
                if reset { items = resp.items } else { items += resp.items }
            }
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
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @State private var showingAfter = true
    @State private var isQuoting = false
    @State private var quoteError: String?
    @State private var quoteSummary: QuoteThisLookResponse?

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

                // Flagship: inspiration → AI estimate → pre-filled intro DM
                // with the contractor in one tap.
                Button {
                    Task { await quoteThisLook() }
                } label: {
                    HStack(spacing: 8) {
                        if isQuoting {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "wand.and.stars")
                        }
                        Text(isQuoting
                             ? "Sending your message…"
                             : "Quote this look from \(item.business.companyName)")
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .foregroundStyle(.white)
                    .background(Theme.primary, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isQuoting)

                Text("We'll start a message with \(item.business.companyName) so they have your project context up front.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)

                if let err = quoteError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
            }
            .padding(16)
        }
        .navigationTitle(item.business.companyName)
        .navigationBarTitleDisplayMode(.inline)
        .alert("Message sent",
               isPresented: Binding(get: { quoteSummary != nil },
                                    set: { if !$0 { quoteSummary = nil } })) {
            Button("Open message") {
                if let id = quoteSummary?.conversationId {
                    notifications.pendingConversationId = id
                    TabRouter.shared.selection = TabRouter.messages
                }
                quoteSummary = nil
            }
            Button("Stay here", role: .cancel) { quoteSummary = nil }
        } message: {
            if let range = quoteSummary?.estimateRangeText {
                Text("Sent the photo and your AI estimate (\(range)) to \(item.business.companyName).")
            } else {
                Text("Sent the photo to \(item.business.companyName).")
            }
        }
    }

    private func quoteThisLook() async {
        guard auth.isLoggedIn else {
            auth.requireSignIn()
            return
        }
        isQuoting = true
        quoteError = nil
        defer { isQuoting = false }
        do {
            quoteSummary = try await APIService.shared.quoteThisLook(
                portfolioProjectId: item.projectId,
                imageUrl: item.imageUrl
            )
        } catch {
            quoteError = error.localizedDescription
        }
    }
}
