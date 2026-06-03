import SwiftUI

/// Toolbar bell that opens the activity feed and shows an unread badge.
/// Drop into any screen's `.toolbar`; relies on the shared `ActivityStore`.
struct ActivityBellButton: View {
    @EnvironmentObject private var activity: ActivityStore
    @EnvironmentObject private var router: TabRouter
    @EnvironmentObject private var notifications: NotificationManager
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var favorites: FavoritesStore
    @State private var showCenter = false

    var body: some View {
        Button {
            showCenter = true
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell")
                if activity.unreadCount > 0 {
                    Text(activity.unreadCount > 99 ? "99+" : "\(activity.unreadCount)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color.red, in: Capsule())
                        .offset(x: 10, y: -8)
                }
            }
        }
        .accessibilityLabel(activity.unreadCount > 0 ? "Notifications, \(activity.unreadCount) unread" : "Notifications")
        .sheet(isPresented: $showCenter) {
            // Re-inject shared stores so the sheet (and any view it pushes,
            // e.g. AppointmentsView) has them — matching the app's sheet convention.
            NotificationCenterView()
                .environmentObject(activity)
                .environmentObject(router)
                .environmentObject(notifications)
                .environmentObject(auth)
                .environmentObject(favorites)
        }
        .task { await activity.refreshUnread() }
    }
}

/// The activity feed itself: a durable record of leads, messages, and
/// appointment updates, each deep-linking to the relevant screen.
struct NotificationCenterView: View {
    @EnvironmentObject private var activity: ActivityStore
    @EnvironmentObject private var router: TabRouter
    @EnvironmentObject private var notifications: NotificationManager
    @Environment(\.dismiss) private var dismiss

    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if activity.activities.isEmpty {
                    ContentUnavailableView {
                        Label("Nothing new", systemImage: "bell.slash")
                    } description: {
                        Text("Leads, messages, and appointment updates will show up here.")
                    }
                } else {
                    List {
                        ForEach(activity.activities) { item in
                            row(for: item)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                if !activity.activities.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Mark all read") { Task { await activity.markAllRead() } }
                            .disabled(activity.unreadCount == 0)
                    }
                }
            }
        }
        .task {
            await activity.refresh()
            isLoading = false
        }
        // Clear the badge once the user has seen the feed.
        .onDisappear { Task { await activity.markAllRead() } }
    }

    @ViewBuilder
    private func row(for item: Activity) -> some View {
        if let conversationId = item.data?.conversationId {
            Button { openConversation(conversationId) } label: {
                ActivityRow(item: item)
            }
            .buttonStyle(.plain)
        } else if item.data?.appointmentId != nil {
            NavigationLink {
                AppointmentsView()
            } label: {
                ActivityRow(item: item)
            }
        } else if let businessId = item.data?.businessId {
            NavigationLink {
                BusinessDetailView(businessId: businessId)
            } label: {
                ActivityRow(item: item)
            }
        } else {
            ActivityRow(item: item)
        }
    }

    /// Hand off to the existing push deep-link path: set the pending id and
    /// switch to Messages; ConversationsView opens the thread.
    private func openConversation(_ id: String) {
        dismiss()
        notifications.pendingConversationId = id
        router.selection = TabRouter.messages
    }
}

// MARK: - Row

private struct ActivityRow: View {
    let item: Activity

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(item.isUnread ? Theme.primaryLight : Color(.systemGray6))
                    .frame(width: 40, height: 40)
                Image(systemName: item.type.systemImage)
                    .foregroundStyle(item.isUnread ? Theme.primary : .secondary)
                    .font(.subheadline)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.subheadline)
                    .fontWeight(item.isUnread ? .semibold : .regular)
                Text(item.body)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(item.createdAt.activityRelativeText)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            if item.isUnread {
                Circle().fill(Theme.primary).frame(width: 8, height: 8)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

// MARK: - Helpers

private extension String {
    /// ISO-8601 createdAt → relative phrase ("3 hours ago").
    var activityRelativeText: String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: self) ?? ISO8601DateFormatter().date(from: self) else { return "" }
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .abbreviated
        return fmt.localizedString(for: date, relativeTo: Date())
    }
}
