import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        TabView {
            BusinessSearchView()
                .tabItem { Label("Explore", systemImage: "magnifyingglass") }

            EstimationView()
                .tabItem { Label("Estimate", systemImage: "camera.viewfinder") }

            AIChatView()
                .tabItem { Label("AI Assistant", systemImage: "bubble.left.and.bubble.right") }

            ConversationsView()
                .tabItem { Label("Messages", systemImage: "message") }

            ProfileView()
                .tabItem { Label("Profile", systemImage: "person") }
        }
    }
}
