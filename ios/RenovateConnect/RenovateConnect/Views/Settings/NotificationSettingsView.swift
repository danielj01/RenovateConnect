import SwiftUI

/// Per-category notification toggles. Each switch persists immediately via
/// PATCH /auth/me and gates both push delivery and the in-app activity feed
/// for that category server-side. Only the categories a given role can
/// receive are shown.
struct NotificationSettingsView: View {
    @EnvironmentObject private var auth: AuthStore

    private var isBusiness: Bool { auth.currentUser?.role == .business }

    var body: some View {
        Form {
            Section {
                if isBusiness {
                    toggle(.leads)
                    toggle(.messages)
                    toggle(.appointments)
                    toggle(.reviews)
                } else {
                    toggle(.messages)
                    toggle(.appointments)
                }
            } header: {
                Text("Notify me about")
            } footer: {
                Text("Turning a category off silences both push notifications and the in-app activity feed for it. The master switch in Profile turns off all push.")
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func toggle(_ category: NotifyCategory) -> some View {
        HStack(spacing: 12) {
            Image(systemName: category.icon)
                .font(.subheadline)
                .foregroundStyle(Theme.primary)
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(category.title).font(.subheadline)
                Text(category.subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Toggle("", isOn: binding(for: category))
                .labelsHidden()
                .tint(Theme.primary)
        }
    }

    /// Reads the current value off the live user and writes through the store,
    /// so there's no local copy to fall out of sync.
    private func binding(for category: NotifyCategory) -> Binding<Bool> {
        Binding(
            get: { category.value(from: auth.currentUser) },
            set: { newValue in
                Task { await category.persist(newValue, via: auth) }
            }
        )
    }
}

// MARK: - Categories

private enum NotifyCategory {
    case leads, messages, appointments, reviews

    var title: String {
        switch self {
        case .leads: return "New leads"
        case .messages: return "Messages"
        case .appointments: return "Appointments"
        case .reviews: return "Reviews"
        }
    }

    var subtitle: String {
        switch self {
        case .leads: return "When a homeowner first contacts you"
        case .messages: return "New messages in your conversations"
        case .appointments: return "Requests and status updates"
        case .reviews: return "When someone reviews your business"
        }
    }

    var icon: String {
        switch self {
        case .leads: return "person.2.fill"
        case .messages: return "message.fill"
        case .appointments: return "calendar"
        case .reviews: return "star.fill"
        }
    }

    func value(from user: User?) -> Bool {
        switch self {
        case .leads: return user?.notifyLeads ?? true
        case .messages: return user?.notifyMessages ?? true
        case .appointments: return user?.notifyAppointments ?? true
        case .reviews: return user?.notifyReviews ?? true
        }
    }

    func persist(_ value: Bool, via auth: AuthStore) async {
        switch self {
        case .leads: await auth.setNotificationPref(leads: value)
        case .messages: await auth.setNotificationPref(messages: value)
        case .appointments: await auth.setNotificationPref(appointments: value)
        case .reviews: await auth.setNotificationPref(reviews: value)
        }
    }
}
