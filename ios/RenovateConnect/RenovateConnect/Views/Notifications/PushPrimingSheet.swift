import SwiftUI

/// Our own value-first "Stay updated" screen, shown before the system prompt so
/// users understand *why* we want to notify them — which dramatically improves
/// opt-in rates versus cold-prompting the OS dialog.
struct PushPrimingSheet: View {
    @EnvironmentObject private var notifications: NotificationManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            ZStack {
                Circle()
                    .fill(Theme.primaryLight)
                    .frame(width: 110, height: 110)
                Image(systemName: "bell.badge.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.primary)
                    .symbolRenderingMode(.hierarchical)
            }
            .padding(.bottom, 24)

            Text("Stay in the loop")
                .font(.title.bold())

            Text("Get notified the moment a contractor replies or a new lead comes in — so you never miss the conversations that matter.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 14) {
                primingRow(icon: "message.fill", text: "New message replies")
                primingRow(icon: "person.2.fill", text: "New leads and inquiries")
                primingRow(icon: "sparkles", text: "When your estimate is ready")
            }
            .padding(24)

            Spacer()

            VStack(spacing: 12) {
                Button {
                    Task {
                        await notifications.requestAuthorization()
                        dismiss()
                    }
                } label: {
                    Text("Enable notifications")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                Button {
                    notifications.declinePriming()
                    dismiss()
                } label: {
                    Text("Not now")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .interactiveDismissDisabled(true)
    }

    private func primingRow(icon: String, text: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.headline)
                .foregroundStyle(Theme.primary)
                .frame(width: 28)
            Text(text)
                .font(.subheadline)
            Spacer()
        }
    }
}
