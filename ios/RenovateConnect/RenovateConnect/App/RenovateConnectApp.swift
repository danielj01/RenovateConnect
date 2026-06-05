import SwiftUI

@main
struct RenovateConnectApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var notifications = NotificationManager.shared

    init() {
        Self.suppressGuestIntroForExistingInstalls()
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
            if auth.isLoggedIn {
                MainTabView()
                    .environmentObject(auth)
                    .environmentObject(notifications)
            } else {
                // Signed-out visitors get a full browse + estimate experience,
                // not a login wall. Sign-in is prompted only when they reach for
                // an account-only action.
                GuestTabView()
                    .environmentObject(auth)
            }
        }
    }
}
