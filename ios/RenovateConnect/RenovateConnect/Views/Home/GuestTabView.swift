import SwiftUI

/// What a signed-out visitor sees. The whole point is low friction: they can
/// browse verified contractors and run an AI estimate immediately, with no
/// account. Account-only actions (message, save, quote, book, pay) call
/// `auth.requireSignIn()`, which flips `promptSignIn` and presents sign-in here.
struct GuestTabView: View {
    @EnvironmentObject private var auth: AuthStore

    // Child views (search/detail/estimate) expect these in the environment.
    // Shared singletons keep parity with the signed-in shell and the toolbar bell.
    @StateObject private var favorites = FavoritesStore.shared
    @StateObject private var router = TabRouter.shared
    @StateObject private var notifications = NotificationManager.shared

    var body: some View {
        TabView(selection: $router.selection) {
            BusinessSearchView()
                .tabItem { Label("Explore", systemImage: "safari.fill") }
                .tag(TabRouter.explore)

            EstimationView()
                .tabItem { Label("Estimate", systemImage: "camera.viewfinder") }
                .tag(TabRouter.estimate)

            GuestSignInTab()
                .tabItem { Label("Sign In", systemImage: "person.crop.circle") }
                .tag(TabRouter.aiChat)
        }
        .environmentObject(favorites)
        .environmentObject(router)
        .environmentObject(notifications)
        // A gated action anywhere in the guest shell raises this.
        .fullScreenCover(isPresented: $auth.promptSignIn) {
            GuestSignInCover()
                .environmentObject(auth)
        }
    }
}

/// Sign-in surfaced from the tab bar. No dismiss affordance needed — successful
/// auth flips the app root to the full experience.
private struct GuestSignInTab: View {
    @EnvironmentObject private var auth: AuthStore
    var body: some View {
        LoginView().environmentObject(auth)
    }
}

/// Sign-in surfaced as a cover after tapping a gated action. Adds a way to back
/// out and keep browsing.
private struct GuestSignInCover: View {
    @EnvironmentObject private var auth: AuthStore
    var body: some View {
        ZStack(alignment: .topTrailing) {
            LoginView().environmentObject(auth)
            Button {
                auth.promptSignIn = false
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white, .black.opacity(0.35))
                    .padding(16)
            }
            .accessibilityLabel("Keep browsing without signing in")
        }
    }
}
