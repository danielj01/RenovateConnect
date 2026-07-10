import SwiftUI

/// Signed-in password change. Requires the current password and a new one; on
/// success it pops back with a brief confirmation.
struct ChangePasswordView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    @State private var current = ""
    @State private var newPassword = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var errorText: String?
    @State private var done = false

    private var canSubmit: Bool {
        !busy && !current.isEmpty && newPassword.count >= 8 && confirm == newPassword
    }

    var body: some View {
        Form {
            Section("Current password") {
                SecureField("Current password", text: $current).textContentType(.password)
            }
            Section("New password") {
                SecureField("New password (8+ chars)", text: $newPassword).textContentType(.newPassword)
                SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
            }
            if !newPassword.isEmpty, confirm != newPassword {
                Section { Text("Passwords don't match.").font(.caption).foregroundStyle(.red) }
            }
            if let errorText {
                Section { Text(errorText).font(.caption).foregroundStyle(.red) }
            }
            if done {
                Section { Label("Password updated", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Spacer()
                        if busy { ProgressView() } else { Text("Update password").bold() }
                        Spacer()
                    }
                }
                .disabled(!canSubmit)
            }
        }
        .navigationTitle("Change Password")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() async {
        busy = true
        errorText = nil
        defer { busy = false }
        do {
            try await auth.changePassword(current: current, new: newPassword)
            done = true
            try? await Task.sleep(nanoseconds: 700_000_000)
            dismiss()
        } catch let APIError.requestFailed(code, message) {
            errorText = code == 401 ? "Your current password is incorrect." : message
        } catch {
            errorText = "Couldn't update your password. Please try again."
        }
    }
}
