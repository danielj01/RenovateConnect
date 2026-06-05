import SwiftUI
import Combine

/// Owns the selected tab so any screen can route the user to another tab —
/// e.g. an empty inbox offering "Explore contractors". Tab positions are the
/// same numeric slots in both the client and business bars (Messages = 3,
/// Profile = 4); the client-only slots are named below for the CTAs that use them.
@MainActor
final class TabRouter: ObservableObject {
    /// Shared instance so toolbar content (outside the injected SwiftUI
    /// environment) can route tabs without an `@EnvironmentObject` lookup.
    static let shared = TabRouter()

    @Published var selection: Int = 0

    // Client tab bar: Explore(0) · Estimate(1) · AI Chat(2) · Messages(3) · Profile(4)
    static let explore = 0
    static let estimate = 1
    static let aiChat = 2
    // Shared across both bars.
    static let messages = 3
    static let profile = 4
}
