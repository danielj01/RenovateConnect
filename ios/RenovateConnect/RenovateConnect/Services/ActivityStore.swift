import Foundation
import Combine

/// Backs the in-app activity feed: the full list plus an unread count for the
/// bell badge. Shared via `@EnvironmentObject` and polled in the foreground,
/// mirroring `InboxStore`. A real-time transport can replace polling later.
@MainActor
final class ActivityStore: ObservableObject {
    /// Shared instance. Referenced directly by `ActivityBellButton` so the bell
    /// (hosted in the UIKit navigation bar, outside the SwiftUI environment that
    /// `MainTabView` injects into) can resolve it without an `@EnvironmentObject`
    /// lookup that would crash. The tab views inject this same instance so the
    /// badge count and polling stay consistent app-wide.
    static let shared = ActivityStore()

    @Published var activities: [Activity] = []
    @Published var unreadCount = 0

    private var pollTask: Task<Void, Never>?

    /// Pull the latest unread total. Keeps the old value on failure so a
    /// transient network blip doesn't flicker the badge to zero.
    func refreshUnread() async {
        if let count = try? await APIService.shared.activitiesUnreadCount() {
            unreadCount = count
        }
    }

    /// Load the full feed (used when opening the notification center).
    func refresh() async {
        if let items = try? await APIService.shared.myActivities() {
            activities = items
            unreadCount = items.filter(\.isUnread).count
        }
    }

    /// Mark everything read locally and on the server, then clear the badge.
    func markAllRead() async {
        guard unreadCount > 0 else { return }
        try? await APIService.shared.markActivitiesRead()
        unreadCount = 0
        activities = activities.map {
            Activity(id: $0.id, type: $0.type, title: $0.title, body: $0.body,
                     data: $0.data, link: $0.link,
                     readAt: $0.readAt ?? ISO8601DateFormatter().string(from: Date()),
                     createdAt: $0.createdAt)
        }
    }

    func startPolling(every seconds: UInt64 = 30) {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshUnread()
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }
}
