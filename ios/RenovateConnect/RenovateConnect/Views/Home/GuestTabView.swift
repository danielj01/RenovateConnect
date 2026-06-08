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

    // First-launch intro for signed-out visitors. Persisted so it shows once;
    // separate from the post-login `hasCompletedOnboarding` flag.
    @AppStorage("hasSeenGuestIntro") private var hasSeenGuestIntro = false

    // A universal link (contractor profile /b/:id or saved estimate /e/:code)
    // tapped while signed out — guests can view both.
    @State private var deepLink: DeepLink?

    var body: some View {
        TabView(selection: $router.selection) {
            BusinessSearchView()
                .tabItem { Label("Explore", systemImage: "safari.fill") }
                .tag(TabRouter.explore)

            EstimationView()
                .tabItem { Label("Estimate", systemImage: "camera.viewfinder") }
                .tag(TabRouter.estimate)

            InspirationView()
                .tabItem { Label("Inspiration", systemImage: "photo.on.rectangle.angled") }
                .tag(TabRouter.aiChat)

            GuestSignInTab()
                .tabItem { Label("Sign In", systemImage: "person.crop.circle") }
                .tag(TabRouter.profile)
        }
        .environmentObject(favorites)
        .environmentObject(router)
        .environmentObject(notifications)
        // A gated action anywhere in the guest shell raises this.
        .fullScreenCover(isPresented: $auth.promptSignIn) {
            GuestSignInCover()
                .environmentObject(auth)
        }
        // First-launch intro: explains the app and what signing in unlocks.
        .fullScreenCover(isPresented: .constant(!hasSeenGuestIntro)) {
            OnboardingView(role: .client, isGuest: true) {
                hasSeenGuestIntro = true
            } onSignIn: {
                // Dismiss the intro first, then raise sign-in on the next runloop
                // so the two full-screen covers don't fight over presentation.
                hasSeenGuestIntro = true
                DispatchQueue.main.async { auth.requireSignIn() }
            }
        }
        // Universal links while signed out: guests can view a contractor profile
        // or a saved estimate directly (account-only actions inside still prompt
        // sign-in).
        .onChange(of: notifications.pendingDeepLink) { _, link in
            if let link, link.screen == .business || link.screen == .savedEstimate {
                deepLink = link
                notifications.pendingDeepLink = nil
            }
        }
        .sheet(item: $deepLink) { link in
            Group {
                if link.screen == .savedEstimate {
                    SavedEstimateView(code: link.id)
                } else {
                    NavigationStack { BusinessDetailView(businessId: link.id) }
                }
            }
            .environmentObject(auth)
            .environmentObject(favorites)
            .environmentObject(router)
            .environmentObject(notifications)
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
