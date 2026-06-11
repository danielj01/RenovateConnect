import SwiftUI

@main
struct RenovateConnectApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var notifications = NotificationManager.shared

    init() {
        Self.suppressGuestIntroForExistingInstalls()
        Self.configureImageCache()
    }

    /// AsyncImage uses URLSession.shared's URLCache, which defaults to ~20 MB
    /// memory / ~5 MB disk — too small for an image-heavy feed (Inspiration,
    /// portfolio galleries, before/afters). Without this, switching categories
    /// in the Inspiration tab re-downloads every photo, the grid flashes blank
    /// placeholders, and the masonry layout snaps as images decode at
    /// different rates. Bumping the cache up front keeps recently-viewed
    /// images instant and the transition smooth.
    private static func configureImageCache() {
        let mb = 1024 * 1024
        URLCache.shared = URLCache(memoryCapacity: 64 * mb,
                                   diskCapacity:   256 * mb,
                                   diskPath:       "rc_image_cache")
    }

    /// The guest intro should appear only on a genuine fresh install — not when
    /// an existing user updates to the version that introduced it. On upgrade the
    /// `hasSeenGuestIntro` flag is simply absent (reads false), which would
    /// replay the intro. So on first launch, if the flag was never set but this
    /// install already has state written by older versions, mark it seen.
    /// A truly fresh install has none of these keys, so it still gets the intro.
    private static func suppressGuestIntroForExistingInstalls() {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: "hasSeenGuestIntro") == nil else { return }
        let priorUseKeys = ["authToken", "hasCompletedOnboarding",
                            "aiChatHistory", "hasAskedPushPermission"]
        let isExistingInstall = priorUseKeys.contains { defaults.object(forKey: $0) != nil }
        if isExistingInstall { defaults.set(true, forKey: "hasSeenGuestIntro") }
    }

    var body: some Scene {
        WindowGroup {
            rootView
                // Universal links (contractor share URLs, e.g. /b/:id) — opened
                // from Safari/Messages when the app is installed. Both hooks are
                // needed: cold-start delivers a browsing user-activity, warm
                // foreground delivers via onOpenURL.
                .onOpenURL { handleIncomingURL($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { handleIncomingURL(url) }
                }
        }
    }

    @ViewBuilder
    private var rootView: some View {
        if auth.isLoggedIn {
            MainTabView()
                .environmentObject(auth)
                .environmentObject(notifications)
                // Re-sync the APNs token for this account on every signed-in
                // launch/sign-in (logout removed it server-side; tokens rotate).
                .task { await notifications.registerIfAuthorized() }
        } else {
            // Signed-out visitors get a full browse + estimate experience, not a
            // login wall. Sign-in is prompted only when they reach for an
            // account-only action.
            GuestTabView()
                .environmentObject(auth)
        }
    }

    /// Route an incoming universal link by reusing the existing deep-link
    /// pipeline: set the pending link and let the active shell present it (the
    /// same path push notifications use).
    private func handleIncomingURL(_ url: URL) {
        guard let link = DeepLink(webURL: url) else { return }
        notifications.pendingDeepLink = link
    }
}
