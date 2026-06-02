import Foundation
import Combine

/// Tracks the total unread-message count for the signed-in user so the
/// Messages tab can show a badge. Shared via `@EnvironmentObject` and refreshed
/// whenever the inbox is opened, a message is sent, or a conversation is read.
@MainActor
final class InboxStore: ObservableObject {
    @Published var unreadCount = 0

    private var pollTask: Task<Void, Never>?

    /// Pull the latest unread total. Keeps the old value on failure so a
    /// transient network blip doesn't make the badge flicker to zero.
    func refresh() async {
        if let count = try? await APIService.shared.unreadCount() {
            unreadCount = count
        }
    }

    /// Poll periodically while the app is in the foreground. Cheap endpoint;
    /// a real-time transport (APNs / sockets) can replace this later.
    func startPolling(every seconds: UInt64 = 20) {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }
}
