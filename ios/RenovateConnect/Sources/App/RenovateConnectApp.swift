import SwiftUI

@main
struct RenovateConnectApp: App {
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            if auth.isLoggedIn {
                MainTabView()
                    .environmentObject(auth)
            } else {
                LoginView()
                    .environmentObject(auth)
            }
        }
    }
}
