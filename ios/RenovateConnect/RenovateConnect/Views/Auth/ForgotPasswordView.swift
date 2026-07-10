import SwiftUI

/// Password reset. Two steps in one sheet: request a code by email, then enter
/// the code + a new password. A successful reset signs the user in, at which
/// point the root view swaps to the app and this sheet goes away.
struct ForgotPasswordView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    /// Pre-filled from whatever the user typed on the sign-in screen.
    @State var email: String
    @State private var code = ""
    @State private var newPassword = ""
    @State private var codeSent = false

    private var canSend: Bool {
        !auth.isLoading && email.contains("@")
    }
    private var canReset: Bool {
        !auth.isLoading && code.trimmingCharacters(in: .whitespaces).count >= 4 && newPassword.count >= 8
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    Image(systemName: "lock.rotation")
                        .font(.system(size: 42))
                        .foregroundStyle(Theme.primary)
                    Text("Reset your password")
                        .font(.title2.bold())
                    Text(codeSent
                         ? "Enter the code we emailed to \(email) and choose a new password."
                         : "Enter your email and we'll send you a reset code.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 20)

                InputField(icon: "envelope", placeholder: "Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(codeSent)
                    .opacity(codeSent ? 0.6 : 1)

                if codeSent {
                    InputField(icon: "number", placeholder: "6-digit code", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                    InputField(icon: "lock", placeholder: "New password (8+ chars)", text: $newPassword, isSecure: true)
                        .textContentType(.newPassword)
                }

                if let error = auth.error {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
                        Text(error).font(.caption).foregroundStyle(.red)
                        Spacer()
                    }
                }

                if codeSent {
                    primaryButton(title: "Reset password", enabled: canReset) {
                        Task {
                            let ok = await auth.resetPassword(email: email, code: code, newPassword: newPassword)
                            if ok { dismiss() }
                        }
                    }
                    Button("Use a different email") {
                        codeSent = false
                        code = ""; newPassword = ""; auth.error = nil
                    }
                    .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    primaryButton(title: "Send reset code", enabled: canSend) {
                        Task {
                            if await auth.requestPasswordReset(email: email) { codeSent = true }
                        }
                    }
                }

                Spacer()
            }
            .padding(24)
            .navigationTitle("Forgot password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { auth.error = nil; dismiss() }
                }
            }
        }
    }

    private func primaryButton(title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if auth.isLoading {
                    ProgressView().tint(.white)
                } else {
                    Text(title).font(.headline).foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity).frame(height: 52)
            .background(Theme.gradient)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.55)
        .disabled(!enabled)
    }
}
