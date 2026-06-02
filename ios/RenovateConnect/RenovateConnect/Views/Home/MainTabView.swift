import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @StateObject private var inbox = InboxStore()
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var chat = ChatStore()
    @StateObject private var router = TabRouter()

    // Messages sits at index 3 in both the client and business tab bars.
    private let messagesTab = TabRouter.messages

    init() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.systemBackground
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        UITabBar.appearance().tintColor = UIColor(red: 0.93, green: 0.40, blue: 0.13, alpha: 1)
    }

    var body: some View {
        Group {
            if auth.isBusiness {
                businessTabs
            } else {
                clientTabs
            }
        }
        .environmentObject(inbox)
        .environmentObject(favorites)
        .environmentObject(chat)
        .environmentObject(router)
        .task {
            inbox.startPolling()
            // Homeowners can save contractors — preload their list for heart state.
            if !auth.isBusiness { await favorites.refresh() }
            // Cold start from a tapped push: jump straight to Messages.
            if notifications.pendingConversationId != nil { router.selection = messagesTab }
        }
        .onDisappear { inbox.stopPolling() }
        .onChange(of: notifications.pendingConversationId) { _, newValue in
            if newValue != nil { router.selection = messagesTab }
        }
        .sheet(isPresented: $notifications.showPriming) {
            PushPrimingSheet()
                .environmentObject(notifications)
                .presentationDetents([.large])
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

            AIChatView()
                .tabItem { Label("AI Chat", systemImage: "bubble.left.and.bubble.right.fill") }
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
