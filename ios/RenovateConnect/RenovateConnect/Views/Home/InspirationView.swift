import SwiftUI
import Combine

/// The Inspiration tab.
///
/// Two surfaces over one feed:
///   • a Pinterest-style masonry grid of post covers (the browse view), and
///   • `InspirationReelView` — a full-screen, vertically-paging reel where each
///     post is a horizontal slideshow you swipe through (the immersive view).
///
/// A feed item is a POST, not a photo: a five-photo kitchen is one card with
/// five slides, not five unrelated tiles. Items come either from a contractor
/// posting straight to the feed (`kind == .post`) or from their approved
/// portfolio work (`kind == .project`).
///
/// Tapping through routes to the contractor behind the photos, with a "quote
/// this look" path into the estimator. Browsing only — deliberately not a
/// social network.

// MARK: - Feed store

/// Pagination shared by the grid and the reel, so opening the reel doesn't
/// re-fetch what the grid already has and scrolling the reel past the end
/// keeps loading into the same list the grid is showing.
@MainActor
final class InspirationFeedStore: ObservableObject {
    @Published private(set) var items: [FeedItem] = []
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

    func setCategory(_ value: String?) async {
        guard category != value else { return }
        category = value
        items = []
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
            guard hasMore, !loadingMore, loadMoreError == nil else { return }
            loadingMore = true
            loadMoreError = nil
        }
        loadToken += 1
        let token = loadToken
        let requestedCategory = category
        defer { isLoading = false; loadingMore = false }
        do {
            let resp = try await APIService.shared.feed(page: reset ? 1 : page, category: requestedCategory)
            // A newer load (or a category swap) started while this was in
            // flight — drop the stale page rather than mixing categories.
            guard token == loadToken, requestedCategory == category else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                if reset { items = resp.items } else { items += resp.items }
            }
            hasMore = resp.hasMore
            page = resp.page + 1
        } catch {
            guard token == loadToken else { return }
            if reset { self.error = error.localizedDescription }
            else { loadMoreError = error.localizedDescription }
        }
    }

    /// Called as the user nears the end of either surface.
    func loadMoreIfNeeded(currentItemId: String, lookahead: Int) {
        guard hasMore, !loadingMore, loadMoreError == nil else { return }
        guard let idx = items.firstIndex(where: { $0.id == currentItemId }) else { return }
        guard idx >= items.count - lookahead else { return }
        Task { await load(reset: false) }
    }

    func retryLoadMore() {
        loadMoreError = nil
        Task { await load(reset: false) }
    }
}

// MARK: - Grid

struct InspirationView: View {
    @StateObject private var store = InspirationFeedStore()
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager

    /// The post the reel opens on. Non-nil presents the full-screen reel.
    @State private var reelStartId: String?

    private let categories = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Whole home", "Exterior"]

    // Simple two-column waterfall: alternate items by index. Good enough without
    // knowing image dimensions up front; heights vary naturally with each photo.
    // Split once per items change (via the destructured tuple) so a body
    // re-render from an unrelated state change (e.g. loadingMore flipping)
    // doesn't recompute both columns.
    private var columns: (left: [FeedItem], right: [FeedItem]) {
        var left: [FeedItem] = []
        var right: [FeedItem] = []
        for (i, item) in store.items.enumerated() {
            if i.isMultiple(of: 2) { left.append(item) } else { right.append(item) }
        }
        return (left, right)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                categoryChips

                if store.isLoading && store.items.isEmpty {
                    ProgressView().padding(.top, 80)
                } else if let error = store.error, store.items.isEmpty {
                    ContentUnavailableView(error, systemImage: "photo.on.rectangle.angled").padding(.top, 60)
                } else if store.items.isEmpty {
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
                    // Fade-out-then-in on category swap (see Theme.contentSwap).
                    // Plain .opacity cross-faded both columns simultaneously
                    // and the previous category's photos visibly bled through
                    // the new ones at the same grid positions.
                    .transition(.contentSwap)
                    // Re-establish identity per category so the ScrollView
                    // doesn't try to diff a totally different list against the
                    // old one — that diff is what produces the visible jump.
                    .id(store.category ?? "all")

                    if store.loadingMore {
                        ProgressView().padding(.vertical, 16)
                    } else if let loadMoreError = store.loadMoreError {
                        VStack(spacing: 6) {
                            Text(loadMoreError).font(.caption).foregroundStyle(.secondary)
                            Button("Retry") { store.retryLoadMore() }
                                .font(.caption.weight(.semibold))
                        }
                        .padding(.vertical, 16)
                    }
                }
            }
            .animation(.easeInOut(duration: 0.2), value: store.items.count)
            .navigationTitle("Inspiration")
            .task { if store.items.isEmpty { await store.load(reset: true) } }
            .refreshable { await store.load(reset: true) }
        }
        .fullScreenCover(item: Binding(
            get: { reelStartId.map(ReelStart.init(id:)) },
            set: { if $0 == nil { reelStartId = nil } }
        )) { start in
            InspirationReelView(store: store, startItemId: start.id)
                .environmentObject(auth)
                .environmentObject(notifications)
        }
    }

    /// `fullScreenCover(item:)` needs an Identifiable; the raw id string can't
    /// conform, so wrap it.
    private struct ReelStart: Identifiable { let id: String }

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
            guard store.category != value else { return }
            // Clear the old grid immediately so the user doesn't see stale
            // items snap to new ones — the ProgressView covers the gap until
            // the new page lands.
            Task { await store.setCategory(value) }
        } label: {
            Text(label)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(store.category == value ? Theme.primary : Color(.systemGray6))
                .foregroundStyle(store.category == value ? .white : Color(.label))
                .clipShape(Capsule())
                // Explicit easing on the selected-state swap; iOS 18 dropped
                // the implicit color animation Button labels used to get.
                .animation(.easeInOut(duration: 0.18), value: store.category)
        }
    }

    private func column(_ colItems: [FeedItem]) -> some View {
        LazyVStack(spacing: 10) {
            ForEach(colItems) { item in
                Button {
                    reelStartId = item.id
                } label: {
                    FeedCard(item: item)
                }
                .buttonStyle(.plain)
                .onAppear { store.loadMoreIfNeeded(currentItemId: item.id, lookahead: 4) }
            }
        }
    }
}

// MARK: - Grid card

private struct FeedCard: View {
    let item: FeedItem

    // Pinterest-style tile: full-bleed cover photo, no boxed text panel, no
    // price (cost stays in the reel — a grid full of dollar signs reads as an
    // ad feed, not inspiration). The business name is a light on-image caption
    // rather than a separate white strip, so the photo does the work.
    var body: some View {
        ZStack(alignment: .bottom) {
            AsyncImage(url: URL(string: item.imageUrl)) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit()
                case .failure: Color(.systemGray5).frame(height: 160).overlay(Image(systemName: "photo").foregroundStyle(.secondary))
                default: Color(.systemGray6).frame(height: 160).overlay(ProgressView())
                }
            }
            .frame(maxWidth: .infinity)
            .clipped()

            LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .bottom, endPoint: .top)
                .frame(height: 54)
                .allowsHitTesting(false)

            HStack {
                Text(item.business.companyName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)

            // No slide-count badge: the tile stays a clean photo. The page
            // dots in the reel carry the "there's more here" signal instead.
            if item.hasBeforeAfter {
                VStack {
                    HStack {
                        Text("Before & After")
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                        Spacer(minLength: 0)
                    }
                    Spacer(minLength: 0)
                }
                .padding(8)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Reel (full-screen, vertically paged)

/// TikTok-shaped browsing over the same feed: swipe UP/DOWN for the next post,
/// LEFT/RIGHT through that post's slides. The vertical pager owns the feed's
/// pagination, so scrolling to the bottom keeps loading.
struct InspirationReelView: View {
    @ObservedObject var store: InspirationFeedStore
    let startItemId: String

    @Environment(\.dismiss) private var dismiss
    @State private var currentId: String?

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Color.black.ignoresSafeArea()

                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(store.items) { item in
                            ReelPage(item: item)
                                .containerRelativeFrame([.horizontal, .vertical])
                                .id(item.id)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: $currentId)
                .scrollIndicators(.hidden)
                .ignoresSafeArea()

                closeButton
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .onAppear { currentId = startItemId }
        .onChange(of: currentId) { _, newValue in
            guard let newValue else { return }
            // Three posts of lookahead — enough that the next page has landed
            // before the user swipes into it, without prefetching the world.
            store.loadMoreIfNeeded(currentItemId: newValue, lookahead: 3)
        }
    }

    private var closeButton: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(.black.opacity(0.35), in: Circle())
            }
            .accessibilityLabel("Close")
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}

/// One post in the reel: its slides as a horizontal pager, with the contractor
/// and actions overlaid.
private struct ReelPage: View {
    let item: FeedItem

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @State private var slideIndex = 0
    /// Per-slide before/after state, keyed by slide id so flipping one slide to
    /// its "before" doesn't flip the rest of the post.
    @State private var showingBefore: Set<String> = []
    @State private var captionExpanded = false
    @State private var isQuoting = false
    @State private var quoteError: String?
    @State private var quoteSummary: QuoteThisLookResponse?

    private var currentSlide: FeedSlide? {
        guard item.slides.indices.contains(slideIndex) else { return item.slides.first }
        return item.slides[slideIndex]
    }

    private func isBefore(_ slide: FeedSlide) -> Bool {
        slide.beforeImageUrl != nil && showingBefore.contains(slide.id)
    }

    /// The photo the "quote this look" request should carry — whichever the
    /// viewer is actually looking at.
    private var quotedImageUrl: String {
        guard let slide = currentSlide else { return item.imageUrl }
        return isBefore(slide) ? (slide.beforeImageUrl ?? slide.imageUrl) : slide.imageUrl
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            slides
            gradientScrim
            VStack(spacing: 14) {
                HStack(alignment: .bottom, spacing: 12) {
                    info
                    actionRail
                }
                // Page dots sit centred under everything, TikTok-style, rather
                // than tucked into the left-hand text column.
                if item.isMultiSlide { slideDots }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 34)
        }
        .background(.black)
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

    // MARK: Slides

    private var slides: some View {
        TabView(selection: $slideIndex) {
            ForEach(Array(item.slides.enumerated()), id: \.element.id) { idx, slide in
                ReelPhoto(url: isBefore(slide) ? (slide.beforeImageUrl ?? slide.imageUrl) : slide.imageUrl)
                    .tag(idx)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
    }

    /// Keeps white text legible over an arbitrary photo without dimming the
    /// middle of the image.
    private var gradientScrim: some View {
        LinearGradient(
            colors: [.black.opacity(0.75), .black.opacity(0.35), .clear],
            startPoint: .bottom, endPoint: .center
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    // MARK: Overlay — the contractor + the project

    private var info: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                BusinessDetailView(businessId: item.business.id)
            } label: {
                HStack(spacing: 9) {
                    BusinessAvatar(name: item.business.companyName,
                                   logoUrl: item.business.logoUrl,
                                   size: 34, cornerRadius: 8)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(item.business.companyName)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            if item.business.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.caption2).foregroundStyle(.white)
                            }
                        }
                        Text("\(item.business.city), \(item.business.state)")
                            .font(.caption2).foregroundStyle(.white.opacity(0.8))
                    }
                }
            }
            .buttonStyle(.plain)

            Text(item.title)
                .font(.headline)
                .foregroundStyle(.white)
                .lineLimit(2)

            if let caption = item.caption, !caption.isEmpty {
                Text(caption)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.92))
                    .lineSpacing(2)
                    .lineLimit(captionExpanded ? nil : 4)
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { captionExpanded.toggle() } }
            }

            HStack(spacing: 6) {
                if let category = item.category { pill(category) }
                if let cost = item.costText { pill(cost, emphasized: true) }
                if let slide = currentSlide, slide.isBeforeAfter {
                    pill(isBefore(slide) ? "Before" : "After")
                }
            }

            if let quoteError {
                Text(quoteError).font(.caption2).foregroundStyle(Theme.accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var slideDots: some View {
        HStack(spacing: 6) {
            ForEach(item.slides.indices, id: \.self) { i in
                Capsule()
                    .fill(.white.opacity(i == slideIndex ? 0.95 : 0.35))
                    .frame(width: i == slideIndex ? 18 : 6, height: 5)
            }
        }
        .frame(maxWidth: .infinity) // centres the strip across the page
        .animation(.easeInOut(duration: 0.2), value: slideIndex)
        .accessibilityLabel("Photo \(slideIndex + 1) of \(item.slideCount)")
    }

    private func pill(_ text: String, emphasized: Bool = false) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(emphasized ? AnyShapeStyle(Theme.primary.opacity(0.9))
                                   : AnyShapeStyle(.ultraThinMaterial),
                        in: Capsule())
    }

    // MARK: Overlay — actions

    private var actionRail: some View {
        VStack(spacing: 18) {
            // Flagship: inspiration → AI estimate → pre-filled intro DM with
            // the contractor in one tap.
            railButton(systemImage: isQuoting ? nil : "wand.and.stars",
                       label: "Quote this",
                       busy: isQuoting) {
                Task { await quoteThisLook() }
            }
            .disabled(isQuoting)

            if let slide = currentSlide, slide.isBeforeAfter {
                railButton(systemImage: "arrow.triangle.2.circlepath",
                           label: isBefore(slide) ? "After" : "Before") {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        if showingBefore.contains(slide.id) { showingBefore.remove(slide.id) }
                        else { showingBefore.insert(slide.id) }
                    }
                }
            }

            NavigationLink {
                BusinessDetailView(businessId: item.business.id)
            } label: {
                railLabel(systemImage: "person.crop.circle", label: "Profile", busy: false)
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 4)
    }

    private func railButton(systemImage: String?, label: String, busy: Bool = false,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            railLabel(systemImage: systemImage, label: label, busy: busy)
        }
        .buttonStyle(.plain)
    }

    private func railLabel(systemImage: String?, label: String, busy: Bool) -> some View {
        VStack(spacing: 5) {
            ZStack {
                Circle().fill(.black.opacity(0.35)).frame(width: 46, height: 46)
                if busy {
                    ProgressView().tint(.white)
                } else if let systemImage {
                    Image(systemName: systemImage).font(.title3).foregroundStyle(.white)
                }
            }
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
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
                inspirationPostId: item.postId,
                imageUrl: quotedImageUrl
            )
        } catch {
            quoteError = error.localizedDescription
        }
    }
}

/// A reel photo: the image fitted whole (renovation shots are wide, and
/// filling a phone screen crops the actual work out of frame) over a blurred
/// copy of itself so the page never shows raw letterbox bars.
private struct ReelPhoto: View {
    let url: String

    var body: some View {
        GeometryReader { geo in
            ZStack {
                AsyncImage(url: URL(string: url)) { phase in
                    switch phase {
                    case .success(let image):
                        ZStack {
                            image.resizable().scaledToFill()
                                .frame(width: geo.size.width, height: geo.size.height)
                                .clipped()
                                .blur(radius: 40)
                                .overlay(Color.black.opacity(0.45))
                            image.resizable().scaledToFit()
                        }
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle).foregroundStyle(.white.opacity(0.5))
                    default:
                        ProgressView().tint(.white)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
    }
}
