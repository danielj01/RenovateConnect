import Foundation
import Combine

@MainActor
final class AuthStore: ObservableObject {
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var error: String?

    // Set when a signed-out guest taps an account-only action (message, save,
    // quote, book, pay). The guest shell observes this and presents sign-in.
    @Published var promptSignIn = false

    // Set after registration, or after a login blocked for an unverified email.
    // The auth screens observe this and present the email-verification sheet.
    @Published var pendingVerification: PendingVerification?

    var isLoggedIn: Bool { currentUser != nil }

    /// Ask the guest to sign in before continuing a gated action. No-op if the
    /// user is already logged in (callers should branch on this).
    func requireSignIn() {
        guard currentUser == nil else { return }
        promptSignIn = true
    }

    /// After a successful sign-in, land on the first tab (Explore for homeowners,
    /// Dashboard for contractors) rather than wherever the shared tab router was
    /// left — e.g. the guest "Sign In" tab, which would otherwise drop the user
    /// on Profile.
    private func landOnFirstTab() {
        guard currentUser != nil else { return }
        TabRouter.shared.selection = TabRouter.explore
    }

    init() {
        if AuthToken.value != nil {
            Task { await loadMe() }
        }
    }

    func login(email: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.login(email: email, password: password)
            AuthToken.set(resp.token)
            // Hydrate the full profile (includes the linked business) before
            // flipping to the logged-in UI, so contractors land on their tab bar
            // and not momentarily on the "set up your business" screen.
            await loadMe()
            landOnFirstTab()
        } catch APIError.requestFailed(let code, _) where code == 403 {
            // The account exists and the password was right, but the email isn't
            // verified yet — route the user to the verification screen instead of
            // showing a generic error.
            pendingVerification = PendingVerification(email: email)
        } catch {
            self.error = Self.signInMessage(for: error)
        }
    }

    func register(email: String, password: String, name: String, role: UserRole, acceptedTerms: Bool) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            // Registration no longer logs the user in — it creates an unverified
            // account and emails a code. Route to the verification screen.
            _ = try await APIService.shared.register(
                email: email, password: password, name: name, role: role, acceptedTerms: acceptedTerms
            )
            pendingVerification = PendingVerification(email: email)
        } catch {
            self.error = Self.registerMessage(for: error)
        }
    }

    /// Confirm the emailed verification code for `pendingVerification` and, on
    /// success, complete sign-in.
    func verifyEmail(code: String) async {
        guard let email = pendingVerification?.email else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.verifyEmail(email: email, code: code)
            AuthToken.set(resp.token)
            pendingVerification = nil
            await loadMe()
            landOnFirstTab()
        } catch {
            self.error = Self.codeMessage(for: error)
        }
    }

    /// Re-send the verification code for the pending email. Best-effort.
    func resendVerification() async {
        guard let email = pendingVerification?.email else { return }
        try? await APIService.shared.resendVerification(email: email)
    }

    /// Dismiss the verification screen (user backed out).
    func cancelVerification() {
        pendingVerification = nil
        error = nil
    }

    /// Request a password-reset code. Always reports success (the server never
    /// reveals whether the address exists).
    func requestPasswordReset(email: String) async -> Bool {
        error = nil
        do {
            try await APIService.shared.forgotPassword(email: email)
            return true
        } catch {
            self.error = "We couldn't start a reset. Please check your connection and try again."
            return false
        }
    }

    /// Complete a password reset with the emailed code + new password; on success
    /// the user is signed in.
    func resetPassword(email: String, code: String, newPassword: String) async -> Bool {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.resetPassword(email: email, code: code, password: newPassword)
            AuthToken.set(resp.token)
            await loadMe()
            landOnFirstTab()
            return true
        } catch {
            self.error = Self.codeMessage(for: error)
            return false
        }
    }

    /// Change the signed-in user's password. Throws so the settings screen can
    /// surface success/failure inline.
    func changePassword(current: String, new: String) async throws {
        try await APIService.shared.changePassword(currentPassword: current, newPassword: new)
    }

    func signInWithApple(identityToken: String, givenName: String?, familyName: String?, email: String?) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.appleSignIn(
                identityToken: identityToken,
                givenName: givenName,
                familyName: familyName,
                email: email
            )
            AuthToken.set(resp.token)
            // Hydrate the full profile (including any linked business) the same
            // way login/register do, rather than trusting the lean auth payload.
            await loadMe()
            landOnFirstTab()
        } catch {
            self.error = "We couldn't sign you in with Apple. Please try again."
        }
    }

    func signInWithGoogle(idToken: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.googleSignIn(idToken: idToken)
            AuthToken.set(resp.token)
            await loadMe()
            landOnFirstTab()
        } catch {
            self.error = "We couldn't sign you in with Google. Please try again."
        }
    }

    // MARK: - Friendly error messages

    /// Turn a raw API error into a short, human sign-in message. We deliberately
    /// don't reveal whether it was the email or the password that was wrong.
    private static func signInMessage(for error: Error) -> String {
        switch error {
        case APIError.unauthorized:
            return "Incorrect email or password. Please try again."
        case APIError.requestFailed(let code, _):
            switch code {
            case 400: return "Please enter a valid email address and password."
            case 401: return "Incorrect email or password. Please try again."
            case 429: return "Too many attempts. Please wait a moment and try again."
            default:  return "We couldn't sign you in. Please try again."
            }
        default:
            return "We couldn't sign you in. Please check your connection and try again."
        }
    }

    /// Account-creation errors. The server now returns readable 400 validation
    /// messages (e.g. password length), so we surface those directly.
    private static func registerMessage(for error: Error) -> String {
        switch error {
        case APIError.requestFailed(let code, let message):
            switch code {
            case 409: return "That email is already in use. Try signing in instead."
            case 400: return message
            default:  return "We couldn't create your account. Please try again."
            }
        default:
            return "We couldn't create your account. Please check your connection and try again."
        }
    }

    /// Messages for the code-entry flows (email verification, password reset).
    /// The server returns a readable 400 for a bad/expired code.
    private static func codeMessage(for error: Error) -> String {
        switch error {
        case APIError.requestFailed(let code, let message):
            switch code {
            case 400: return message.isEmpty ? "That code is invalid or has expired." : message
            case 429: return "Too many attempts. Please wait a moment and try again."
            default:  return "Something went wrong. Please try again."
            }
        default:
            return "Something went wrong. Please check your connection and try again."
        }
    }

    func logout() {
        // Unregister this device from push before dropping the session.
        Task { await NotificationManager.shared.unregisterCurrentDevice() }
        AuthToken.clear()
        // Drop locally-persisted AI chat history so the next account on this
        // device doesn't inherit the previous user's conversation.
        UserDefaults.standard.removeObject(forKey: "aiChatHistory")
        // Re-show the welcome flow for whoever signs in next (role may differ).
        UserDefaults.standard.removeObject(forKey: "hasCompletedOnboarding")
        currentUser = nil
    }

    var isBusiness: Bool { currentUser?.role == .business }
    var isAdmin: Bool { currentUser?.role == .admin }
    var myBusinessId: String? { currentUser?.business?.id }

    /// Persist the push-notification preference and reflect it locally.
    func setPushEnabled(_ enabled: Bool) async {
        if let updated = try? await APIService.shared.updateProfile(pushEnabled: enabled) {
            currentUser = updated
        }
    }

    /// Persist a single per-category notification preference and reflect it locally.
    func setNotificationPref(leads: Bool? = nil, messages: Bool? = nil,
                             appointments: Bool? = nil, reviews: Bool? = nil) async {
        if let updated = try? await APIService.shared.updateNotificationPrefs(
            notifyLeads: leads, notifyMessages: messages,
            notifyAppointments: appointments, notifyReviews: reviews) {
            currentUser = updated
        }
    }

    /// Persist a new display name and reflect it locally. Throws on failure so
    /// the UI can surface an error.
    func updateName(_ name: String) async throws {
        currentUser = try await APIService.shared.updateName(name)
    }

    /// Upload a new profile picture and reflect the updated user locally.
    func uploadAvatar(_ image: Data) async throws {
        currentUser = try await APIService.shared.uploadAvatar(image)
    }

    /// Permanently delete the account, then tear down the local session exactly
    /// like a sign-out so the app returns to the welcome flow.
    func deleteAccount() async throws {
        try await APIService.shared.deleteAccount()
        logout()
    }

    func loadMe() async {
        do {
            currentUser = try await APIService.shared.me()
        } catch {
            // Only sign out if we don't already have a session (e.g. cold start with a stale token).
            if currentUser == nil {
                AuthToken.clear()
            }
        }
    }
}
