import Foundation

/// Completion belongs to an account and role; signing out must not reset it.
struct OnboardingProgress {
    let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private func key(_ userID: String, _ role: UserRole) -> String {
        "onboarding.completed.\(userID).\(role.rawValue)"
    }

    func complete(userID: String, role: UserRole) {
        defaults.set(true, forKey: key(userID, role))
    }

    func completeChecklist(userID: String) {
        defaults.set(true, forKey: "onboarding.checklist.\(userID)")
    }

    func hasCompletedChecklist(userID: String) -> Bool {
        if defaults.bool(forKey: "onboarding.checklist.\(userID)") { return true }
        if defaults.bool(forKey: "hasSeenProfileChecklist") {
            completeChecklist(userID: userID)
            defaults.removeObject(forKey: "hasSeenProfileChecklist")
            return true
        }
        return false
    }

    func shouldPresent(userID: String, role: UserRole, sawGuestIntro: Bool) -> Bool {
        guard role != .admin else { return false }
        if defaults.bool(forKey: key(userID, role)) { return false }
        // Migrate the current signed-in user's older completion flag once.
        if defaults.bool(forKey: "hasCompletedOnboarding") {
            complete(userID: userID, role: role)
            defaults.removeObject(forKey: "hasCompletedOnboarding")
            return false
        }
        // Homeowners have already seen this tour as guests; don't show it twice.
        if role == .client && sawGuestIntro {
            complete(userID: userID, role: role)
            return false
        }
        return true
    }
}
