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
        } catch {
            self.error = Self.signInMessage(for: error)
        }
    }

    func register(email: String, password: String, name: String, role: UserRole) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.register(email: email, password: password, name: name, role: role)
            AuthToken.set(resp.token)
            await loadMe()
            landOnFirstTab()
        } catch {
            self.error = Self.registerMessage(for: error)
        }
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
