import Foundation
import Combine

@MainActor
final class AuthStore: ObservableObject {
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var error: String?

    var isLoggedIn: Bool { currentUser != nil }

    init() {
        if UserDefaults.standard.string(forKey: "authToken") != nil {
            Task { await loadMe() }
        }
    }

    func login(email: String, password: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.login(email: email, password: password)
            UserDefaults.standard.set(resp.token, forKey: "authToken")
            currentUser = resp.user
            await loadMe() // hydrate full profile (includes linked business)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func register(email: String, password: String, name: String, role: UserRole) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.register(email: email, password: password, name: name, role: role)
            UserDefaults.standard.set(resp.token, forKey: "authToken")
            currentUser = resp.user
            await loadMe()
        } catch {
            self.error = error.localizedDescription
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
            UserDefaults.standard.set(resp.token, forKey: "authToken")
            currentUser = resp.user
        } catch {
            self.error = error.localizedDescription
        }
    }

    func logout() {
        // Unregister this device from push before dropping the session.
        Task { await NotificationManager.shared.unregisterCurrentDevice() }
        UserDefaults.standard.removeObject(forKey: "authToken")
        // Drop locally-persisted AI chat history so the next account on this
        // device doesn't inherit the previous user's conversation.
        UserDefaults.standard.removeObject(forKey: "aiChatHistory")
        // Re-show the welcome flow for whoever signs in next (role may differ).
        UserDefaults.standard.removeObject(forKey: "hasCompletedOnboarding")
        currentUser = nil
    }

    var isBusiness: Bool { currentUser?.role == .business }
    var myBusinessId: String? { currentUser?.business?.id }

    /// Persist the push-notification preference and reflect it locally.
    func setPushEnabled(_ enabled: Bool) async {
        if let updated = try? await APIService.shared.updateProfile(pushEnabled: enabled) {
            currentUser = updated
        }
    }

    func loadMe() async {
        do {
            currentUser = try await APIService.shared.me()
        } catch {
            // Only sign out if we don't already have a session (e.g. cold start with a stale token).
            if currentUser == nil {
                UserDefaults.standard.removeObject(forKey: "authToken")
            }
        }
    }
}
