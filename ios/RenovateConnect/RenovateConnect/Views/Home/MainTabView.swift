import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @StateObject private var inbox = InboxStore()
    @StateObject private var chat = ChatStore.shared
    // Shared singletons (not freshly constructed) so the toolbar bell —
    // hosted outside this view's injected environment — resolves the SAME
    // instances and keeps the badge/polling consistent. See ActivityStore.shared.
    @StateObject private var favorites = FavoritesStore.shared
    @StateObject private var router = TabRouter.shared
    @StateObject private var activity = ActivityStore.shared

    // First-run welcome flow; flipped true once the user finishes or skips.
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    // A tapped push/activity that targets a pushable screen (appointment/quote/
    // business) is presented as a sheet; conversations route via the tab bar.
    @State private var deepLinkSheet: DeepLink?

    // Messages sits at index 3 in both the client and business tab bars.
    private let messagesTab = TabRouter.messages

    init() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.systemBackground
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().tintColor = UIColor(red: 0.310, green: 0.275, blue: 0.898, alpha: 1)
    }

    var body: some View {
        Group {
            if auth.isAdmin {
                adminTabs
            } else if auth.isBusiness {
                // A contractor who hasn't created their business profile yet has
                // nothing to show in the dashboard/leads/portfolio tabs, so gate
                // them behind a one-time setup form.
                if auth.currentUser?.business == nil {
                    BusinessProfileSetupView()
                } else {
                    businessTabs
                }
            } else {
                clientTabs
            }
        }
        .environmentObject(inbox)
        .environmentObject(favorites)
        .environmentObject(chat)
        .environmentObject(router)
        .environmentObject(activity)
        .task {
            inbox.startPolling()
            activity.startPolling()
            // Homeowners can save contractors — preload their list for heart state.
            if !auth.isBusiness { await favorites.refresh() }
            // Cold start from a tapped push: jump straight to Messages…
            if notifications.pendingConversationId != nil { router.selection = messagesTab }
            // …or route whatever normalized deep link launch left pending.
            routeDeepLink(notifications.pendingDeepLink)
        }
        .onDisappear { inbox.stopPolling(); activity.stopPolling() }
        .onChange(of: notifications.pendingConversationId) { _, newValue in
            if newValue != nil { router.selection = messagesTab }
        }
        .onChange(of: notifications.pendingDeepLink) { _, link in
            routeDeepLink(link)
        }
        .sheet(item: $deepLinkSheet) { link in
            NavigationStack { deepLinkDestination(link) }
                .environmentObject(inbox)
                .environmentObject(favorites)
                .environmentObject(chat)
                .environmentObject(router)
                .environmentObject(activity)
                .environmentObject(notifications)
                .environmentObject(auth)
        }
        .sheet(isPresented: $notifications.showPriming) {
            PushPrimingSheet()
                .environmentObject(notifications)
                .presentationDetents([.large])
        }
        .fullScreenCover(isPresented: .constant(!hasCompletedOnboarding && auth.currentUser != nil)) {
            OnboardingView(role: auth.currentUser?.role ?? .client) {
                hasCompletedOnboarding = true
            }
        }
    }

    /// Route a normalized deep link: conversations hand off to the Messages tab
    /// (ConversationsView opens the thread); everything else is presented as a
    /// sheet. Clears the pending link so re-taps re-fire.
    private func routeDeepLink(_ link: DeepLink?) {
        guard let link else { return }
        switch link.screen {
        case .conversation:
            notifications.pendingConversationId = link.id
            router.selection = messagesTab
        case .appointment, .quote, .business, .review, .savedEstimate:
            deepLinkSheet = link
        case .other:
            break
        }
        notifications.pendingDeepLink = nil
    }

    @ViewBuilder
    private func deepLinkDestination(_ link: DeepLink) -> some View {
        switch link.screen {
        case .business:     BusinessDetailView(businessId: link.id)
        case .review:       BusinessDetailView(businessId: link.id, autoPresentReview: true)
        case .appointment:  AppointmentsView()
        case .quote:        QuotesView()
        case .savedEstimate: SavedEstimateView(code: link.id)
        case .conversation, .other: EmptyView()
        }
    }

    // Homeowners: discover contractors, estimate, chat, message.
    private var clientTabs: some View {
        TabView(selection: $router.selection) {
            BusinessSearchView()
                .tabItem { Label("Explore", systemImage: "safari.fill") }
                .tag(0)

            EstimationView()
                .tabItem { Label("Estimate", systemImage: "camera.viewfinder") }
                .tag(1)

            // Inspiration replaces the AI Chat tab; AI chat now opens from Explore.
            InspirationView()
                .tabItem { Label("Inspiration", systemImage: "photo.on.rectangle.angled") }
                .tag(2)

            ConversationsView()
                .tabItem { Label("Messages", systemImage: "message.fill") }
                .badge(inbox.unreadCount)
                .tag(3)

            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
                .tag(4)
        }
    }

    // Platform admins: approval queue + browse search to spot-check listings.
    // Admins also see the search side so they can preview listings as users.
    private var adminTabs: some View {
        TabView(selection: $router.selection) {
            AdminView()
                .tabItem { Label("Approvals", systemImage: "checkmark.shield.fill") }
                .tag(0)

            BusinessSearchView()
                .tabItem { Label("Explore", systemImage: "safari.fill") }
                .tag(1)

            ConversationsView()
                .tabItem { Label("Messages", systemImage: "message.fill") }
                .badge(inbox.unreadCount)
                .tag(2)

            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
                .tag(3)
        }
    }

    // Contractors: run their business — dashboard, leads, portfolio, messages.
    private var businessTabs: some View {
        TabView(selection: $router.selection) {
            DashboardView()
                .tabItem { Label("Dashboard", systemImage: "chart.bar.fill") }
                .tag(0)

            LeadsView()
                .tabItem { Label("Leads", systemImage: "person.2.fill") }
                .tag(1)

            PortfolioManagerView()
                .tabItem { Label("Portfolio", systemImage: "photo.stack.fill") }
                .tag(2)

            ConversationsView()
                .tabItem { Label("Messages", systemImage: "message.fill") }
                .badge(inbox.unreadCount)
                .tag(3)

            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
                .tag(4)
        }
    }
}
