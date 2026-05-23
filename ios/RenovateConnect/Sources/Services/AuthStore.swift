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
        } catch {
            self.error = error.localizedDescription
        }
    }

    func logout() {
        UserDefaults.standard.removeObject(forKey: "authToken")
        currentUser = nil
    }

    private func loadMe() async {
        do {
            currentUser = try await APIService.shared.me()
        } catch {
            UserDefaults.standard.removeObject(forKey: "authToken")
        }
    }
}
