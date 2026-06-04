import SwiftUI

@main
struct RenovateConnectApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var notifications = NotificationManager.shared

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
