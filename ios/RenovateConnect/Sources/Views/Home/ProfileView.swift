import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        NavigationStack {
            List {
                if let user = auth.currentUser {
                    Section {
                        HStack(spacing: 16) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 56))
                                .foregroundStyle(.blue)
                            VStack(alignment: .leading) {
                                Text(user.name).font(.headline)
                                Text(user.email).font(.subheadline).foregroundStyle(.secondary)
                                Text(user.role == .client ? "Homeowner" : "Business").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Account") {
                    Button("Sign out", role: .destructive) { auth.logout() }
                }
            }
            .navigationTitle("Profile")
        }
    }
}
