import SwiftUI

/// Email-verification step. Shown after registration (or after a sign-in that
/// was blocked because the email isn't verified yet). The user enters the
/// 6-digit code we emailed; verifying completes sign-in.
struct VerifyEmailView: View {
    @EnvironmentObject private var auth: AuthStore

    let email: String
    @State private var code = ""
    @State private var resent = false

    private var canSubmit: Bool {
        !auth.isLoading && code.trimmingCharacters(in: .whitespaces).count >= 4
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    Image(systemName: "envelope.badge.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Theme.primary)
                    Text("Check your email")
                        .font(.title2.bold())
                    Text("We sent a verification code to\n\(email). Enter it below to finish setting up your account.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                InputField(icon: "number", placeholder: "6-digit code", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)

                if let error = auth.error {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
                        Text(error).font(.caption).foregroundStyle(.red)
                        Spacer()
                    }
                }

                Button {
                    Task { await auth.verifyEmail(code: code) }
                } label: {
                    Group {
                        if auth.isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Text("Verify & continue").font(.headline).foregroundStyle(.white)
                        }
                    }
                    .frame(maxWidth: .infinity).frame(height: 52)
                    .background(Theme.gradient)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .opacity(canSubmit ? 1 : 0.55)
                .disabled(!canSubmit)

                Button {
                    Task {
                        await auth.resendVerification()
                        resent = true
                    }
                } label: {
                    Text(resent ? "Code re-sent ✓" : "Didn't get it? Resend code")
                        .font(.subheadline)
                        .foregroundStyle(resent ? .secondary : Theme.primary)
                }
                .disabled(resent)

                Spacer()
            }
            .padding(24)
            .navigationTitle("Verify email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { auth.cancelVerification() }
                }
            }
        }
    }
}
