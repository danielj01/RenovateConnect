import SwiftUI
import Combine

/// The Inspiration tab.
///
/// Two surfaces over one feed:
///   • a featured carousel, room shortcuts, and project grid (the browse view), and
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

// MARK: - Inspiration discovery

struct InspirationView: View {
    @StateObject private var store = InspirationFeedStore()
    @StateObject private var saved = SavedInspirationStore()
    @State private var showSaved = false
    // The reference itself is stable; only header subviews observe progress.
    @State private var headerState = InspirationHeaderState()
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @State private var reelStartId: String?
    @ScaledMetric(relativeTo: .title) private var featuredHeight = 292

    private let categories = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Whole home", "Exterior"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    InspirationLargeHeader(state: headerState)
                    featuredProjects
                        .frame(height: featuredHeight)
                        .allowsHitTesting(!store.isLoading)
                    roomBrowser
                    projectSection
                }
                .padding(.top, 0)
                .padding(.bottom, 28)
            }
            .coordinateSpace(name: "inspirationScroll")
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Inspiration")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    InspirationCompactHeader(state: headerState)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSaved = true } label: {
                        Image(systemName: "bookmark")
                    }
                    .accessibilityLabel("Saved inspiration")
                }
            }
            .task(id: auth.currentUser?.id) {
                saved.useAccount(auth.currentUser?.id)
                if store.items.isEmpty { await store.load(reset: true) }
            }
            .refreshable { await store.load(reset: true) }

        }
        .environmentObject(saved)
        .sheet(isPresented: $showSaved) {
            SavedInspirationView()
                .environmentObject(saved)
                .environmentObject(auth)
                .environmentObject(notifications)
        }
        .alert("Saved inspiration", isPresented: Binding(
            get: { saved.errorMessage != nil }, set: { if !$0 { saved.errorMessage = nil } }
        )) { Button("OK") { saved.errorMessage = nil } } message: {
            Text(saved.errorMessage ?? "")
        }
        .fullScreenCover(item: Binding(
            get: { reelStartId.map(ReelStart.init(id:)) },
            set: { if $0 == nil { reelStartId = nil } }
        )) { start in
            InspirationReelView(store: store, startItemId: start.id)
                .environmentObject(saved)
                .environmentObject(auth)
                .environmentObject(notifications)
        }
    }

    private struct ReelStart: Identifiable { let id: String }

    private var featuredProjects: some View {
        ZStack {
            if store.items.isEmpty {
                RoundedRectangle(cornerRadius: 24)
                    .fill(Theme.primary.opacity(0.06))
                    .overlay {
                        VStack(spacing: 12) {
                            if store.isLoading {
                                ProgressView("Finding inspiration…")
                            } else {
                                Image(systemName: "photo.on.rectangle.angled").font(.largeTitle)
                                Text("New spaces to discover soon").font(.subheadline)
                            }
                        }
                        .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 20)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(store.featuredItems) { item in
                        ZStack(alignment: .topTrailing) {
                            Button { reelStartId = item.id } label: {
                                FeaturedInspirationCard(item: item)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Explore \(item.title), \(item.costText ?? "price not listed")")
                        }
                        .containerRelativeFrame(.horizontal) { width, _ in min(width - 44, 420) }
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, 20, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
        }
    }

    private var roomBrowser: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Browse by room").font(.title3.weight(.bold))
                Spacer()
                Button("See all") { Task { await store.setCategory(nil) } }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primary)
                    .accessibilityLabel("See projects from all rooms")
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(categories, id: \.self) { category in
                        Button {
                            Task { await store.setCategory(store.category == category ? nil : category) }
                        } label: {
                            VStack(spacing: 8) {
                                InspirationPhoto(url: store.roomCovers[category], symbol: roomSymbol(category))
                                    .frame(width: 76, height: 80)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 18)
                                            .strokeBorder(store.category == category ? Theme.primary : .clear, lineWidth: 3)
                                    }
                                Text(category)
                                    .font(.caption.weight(store.category == category ? .bold : .medium))
                                    .foregroundStyle(store.category == category ? Theme.primary : Color.primary)
                                    .frame(width: 76)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(store.category == category ? .isSelected : [])
                        .accessibilityLabel("Browse \(category) projects")
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private var projectSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.category.map { "\($0) ideas" } ?? "Find your next project")
                        .font(.title3.weight(.bold))
                    Text("Real spaces. Local expertise.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if store.isLoading && !store.items.isEmpty { ProgressView() }
                if store.category != nil {
                    Button("Clear") { Task { await store.setCategory(nil) } }
                        .font(.subheadline).foregroundStyle(Theme.primary)
                }
            }

            if store.isLoading && store.items.isEmpty {
                ProgressView("Finding inspiration…")
                    .frame(maxWidth: .infinity).padding(.vertical, 56)
            } else if let error = store.error, store.items.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load inspiration", systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Try again") { Task { await store.load(reset: true) } }
                }
            } else if store.items.isEmpty {
                ContentUnavailableView(
                    "More inspiration is on its way",
                    systemImage: "photo.on.rectangle.angled",
                    description: Text("Project photos from contractors will appear here. Try another room or check back soon.")
                )
            } else {
                HStack(alignment: .top, spacing: 4) {
                    galleryColumn(offset: 0)
                    galleryColumn(offset: 1)
                }
                .allowsHitTesting(!store.isLoading)
                if store.loadingMore {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } else if let error = store.loadMoreError {
                    VStack(spacing: 8) {
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Button("Load more projects") { store.retryLoadMore() }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 20)
    }

    // Independent columns let each photo determine its own height instead
    // of forcing neighboring photos into equal-height grid rows.
    private func galleryColumn(offset: Int) -> some View {
        let items = offset == 0 ? store.columns.left : store.columns.right
        return LazyVStack(spacing: 4) {
            ForEach(items) { item in
                ZStack(alignment: .topTrailing) {
                    Button { reelStartId = item.id } label: { FeedCard(item: item) }
                        .buttonStyle(.plain)
                }
                .onAppear { store.loadMoreIfNeeded(currentItemId: item.id, lookahead: 4) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func roomSymbol(_ category: String) -> String {
        switch category {
        case "Kitchen": return "oven"
        case "Bathroom": return "bathtub"
        case "Bedroom": return "bed.double"
        case "Living room": return "sofa"
        case "Exterior": return "tree"
        default: return "house"
        }
    }
}

/// A bounded image keeps differently proportioned uploads from changing the layout.
private struct InspirationPhoto: View {
    let url: String?
    var symbol = "photo"

    var body: some View {
        GeometryReader { geometry in
            InspirationRemoteImage(url: url, pixelLimit: symbol == "photo" ? 1536 : 256) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    ZStack {
                        Theme.primary.opacity(0.08)
                        if url != nil && phase.error == nil {
                            ProgressView()
                        } else {
                            Image(systemName: symbol)
                                .font(.title2).foregroundStyle(Theme.primary.opacity(0.6))
                        }
                    }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .accessibilityHidden(true)
    }
}

private struct FeaturedInspirationCard: View {
    let item: FeedItem
    @ScaledMetric(relativeTo: .title) private var cardHeight = 292

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            InspirationPhoto(url: item.imageUrl)
            LinearGradient(colors: [.clear, .black.opacity(0.15), .black.opacity(0.8)],
                           startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 10) {
                Text(item.category?.uppercased() ?? "EXPLORE THE POSSIBILITIES")
                    .font(.caption2.weight(.bold)).tracking(1.5)
                HStack(alignment: .bottom, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.title)
                            .font(.system(.title, design: .serif, weight: .semibold))
                            .lineLimit(3)
                        Text(item.costText ?? item.business.companyName)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.primary)
                        .frame(width: 42, height: 42)
                        .background(.white, in: Circle())
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(.white)
            .padding(20)
        }
        .frame(height: cardHeight)
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }
}

struct FeedCard: View {
    let item: FeedItem

    var body: some View {
        InspirationRemoteImage(url: item.imageUrl, pixelLimit: 768) { phase in
            if let image = phase.image {
                image.resizable().scaledToFit()
            } else {
                Rectangle()
                    .fill(Theme.primary.opacity(0.06))
                    .aspectRatio(InspirationImagePipeline.shared.cachedAspectRatio(for: item.imageUrl) ?? 0.85, contentMode: .fit)
                    .overlay {
                        if phase.error != nil {
                            Image(systemName: "photo").foregroundStyle(.secondary)
                        } else {
                            ProgressView()
                        }
                    }
            }
        }
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(alignment: .topLeading) {
            if item.hasBeforeAfter {
                Text("Before & after")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(.regularMaterial, in: Capsule())
                    .padding(8)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.hasBeforeAfter ? "\(item.title), before and after" : item.title)
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
            // Dark theming belongs to the reel's own page and nothing else.
            // Two placements this must NOT have:
            //   * .preferredColorScheme(.dark) — that is a *preference*, so it
            //     propagates UP out of this fullScreenCover and restyles the
            //     whole window; the Profile tab then renders dark as well.
            //   * this same modifier on the NavigationStack — the environment
            //     would flow DOWN into pushed destinations, so tapping the
            //     action rail's Profile button would open the contractor's
            //     BusinessDetailView in dark mode.
            // Attached here it scopes to this ZStack alone: the reel stays
            // dark, the window is untouched, and anything pushed on top of it
            // keeps whatever scheme the system is actually in.
            .environment(\.colorScheme, .dark)
        }
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

    @EnvironmentObject private var saved: SavedInspirationStore
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    /// Dismisses the reel's fullScreenCover. ReelPage is the cover's content
    /// rather than a pushed view, so this closes the reel itself.
    @Environment(\.dismiss) private var dismiss
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
                // Page dots ride centred above the text block, so they read as
                // part of the photo rather than as a footer under the caption.
                if item.isMultiSlide { slideDots }

                HStack(alignment: .bottom, spacing: 12) {
                    info
                    actionRail
                }
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
                    // MainTabView observes this and switches to Messages, and
                    // ConversationsView opens the thread — but all of that
                    // happens *underneath* this reel. Without the dismiss the
                    // routing silently succeeds behind a full-screen cover and
                    // the button looks broken.
                    notifications.pendingConversationId = id
                    TabRouter.shared.selection = TabRouter.messages
                }
                quoteSummary = nil
                dismiss()
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
                    .font(.callout)
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
            railButton(systemImage: saved.contains(item) ? "bookmark.fill" : "bookmark",
                       label: saved.contains(item) ? "Saved" : "Save") {
                saved.toggle(item)
            }
            .accessibilityLabel(saved.contains(item) ? "Unsave \(item.title)" : "Save \(item.title)")
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
                InspirationRemoteImage(url: url, pixelLimit: 1536) { phase in
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
