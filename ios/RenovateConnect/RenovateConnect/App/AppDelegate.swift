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

    // Deep link on tap — resolve the payload to a normalized destination and
    // stash it on the (always-alive) manager so the SwiftUI tree can route,
    // even on cold start. Falls back to the conversation-only path so older
    // payloads (and the Messages tab handoff) keep working.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let link = DeepLink(userInfo: info) else { return }
        await MainActor.run {
            NotificationManager.shared.pendingDeepLink = link
        }
    }
}
