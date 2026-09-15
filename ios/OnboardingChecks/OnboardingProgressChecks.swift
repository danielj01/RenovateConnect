import Foundation
// Same persisted role raw values as the app.
enum UserRole: String { case client = "CLIENT", business = "BUSINESS", admin = "ADMIN" }
@main struct Checks {
 static func main() {
  let name = "onboarding-checks-" + UUID().uuidString
  let defaults = UserDefaults(suiteName: name)!
  defer { defaults.removePersistentDomain(forName: name) }
  let p = OnboardingProgress(defaults: defaults)
  assert(p.shouldPresent(userID: "new", role: .client, sawGuestIntro: false))
  p.complete(userID: "new", role: .client)
  assert(!p.shouldPresent(userID: "new", role: .client, sawGuestIntro: false))
  assert(p.shouldPresent(userID: "other", role: .client, sawGuestIntro: false))
  assert(!p.shouldPresent(userID: "guest", role: .client, sawGuestIntro: true))
  assert(p.shouldPresent(userID: "guest", role: .business, sawGuestIntro: true))
  assert(!p.shouldPresent(userID: "admin", role: .admin, sawGuestIntro: false))
  defaults.set(true, forKey: "hasCompletedOnboarding")
  assert(!p.shouldPresent(userID: "legacy", role: .business, sawGuestIntro: false))
  assert(p.shouldPresent(userID: "next", role: .business, sawGuestIntro: false))
  p.completeChecklist(userID: "legacy")
  assert(p.hasCompletedChecklist(userID: "legacy"))
  assert(!p.hasCompletedChecklist(userID: "next"))
  defaults.set(true, forKey: "hasSeenProfileChecklist")
  assert(p.hasCompletedChecklist(userID: "migration"))
  assert(!p.hasCompletedChecklist(userID: "another"))
  print("PASS: first run, completion, account and role isolation, guest handoff, admins, legacy migration, contractor checklist")
 }
}
