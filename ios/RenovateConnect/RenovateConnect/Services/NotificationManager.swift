import SwiftUI
import Combine
import UserNotifications
import UIKit

/// Owns the app's push-notification lifecycle: permission priming, the system
/// authorization prompt, APNs token registration, and logout cleanup. Shared as
/// a singleton so the `AppDelegate` (which receives the device token) and the
/// SwiftUI view tree can talk to the same instance.
@MainActor
final class NotificationManager: NSObject, ObservableObject {
    static let shared = NotificationManager()

    @Published var authorizationStatus: UNAuthorizationStatus = .notDetermined
    /// Drives our custom "Stay updated" priming sheet (not the cold system prompt).
    @Published var showPriming = false
    /// Set when a push referencing a conversation is tapped (incl. cold start).
    /// The view tree observes this to switch tabs and open the thread, then clears it.
    @Published var pendingConversationId: String?
    /// Set when any push (or in-app activity) is tapped — a normalized
    /// destination the view tree routes on (conversation/appointment/quote/
    /// business), then clears. Cold-start safe: the manager outlives launch.
    @Published var pendingDeepLink: DeepLink?

    private let askedKey = "hasAskedPushPermission"
    private let tokenKey = "apnsDeviceToken"

    private override init() { super.init() }

    // MARK: - APNs token (called from AppDelegate)

    func handleDeviceToken(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: tokenKey)
        Task { try? await APIService.shared.registerDevice(token: token) }
    }

    // MARK: - Permission flow

    func refreshStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    /// Show our own priming UI once, after the user does something valuable.
    /// We never cold-prompt the system dialog — that tanks opt-in rates.
    func considerPriming() {
        guard !UserDefaults.standard.bool(forKey: askedKey) else { return }
        Task {
            await refreshStatus()
            if authorizationStatus == .notDetermined { showPriming = true }
        }
    }

    /// User accepted our priming screen → fire the real system prompt and,
    /// if granted, register for remote notifications.
    func requestAuthorization() async {
        UserDefaults.standard.set(true, forKey: askedKey)
        showPriming = false
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        await refreshStatus()
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func declinePriming() {
        UserDefaults.standard.set(true, forKey: askedKey)
        showPriming = false
    }

    /// On logout, drop the token server-side so the previous user stops getting pushes.
    func unregisterCurrentDevice() async {
        guard let token = UserDefaults.standard.string(forKey: tokenKey) else { return }
        try? await APIService.shared.unregisterDevice(token: token)
        UserDefaults.standard.removeObject(forKey: tokenKey)
    }
}
