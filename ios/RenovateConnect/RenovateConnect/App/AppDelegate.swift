import UIKit
import UserNotifications

/// Minimal UIKit app delegate bridged into SwiftUI via `@UIApplicationDelegateAdaptor`.
/// Handles APNs device-token callbacks and notification presentation/taps.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in NotificationManager.shared.handleDeviceToken(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[push] Failed to register for remote notifications: \(error.localizedDescription)")
    }

    // Show banners while the app is foregrounded.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .badge, .sound]
    }

    // Deep link on tap — stash the conversation id on the (always-alive) manager
    // so the SwiftUI tree can switch tabs and open the thread, even on cold start.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        if let conversationId = info["conversationId"] as? String {
            await MainActor.run {
                NotificationManager.shared.pendingConversationId = conversationId
            }
        }
    }
}
