import SwiftUI

/// Settings screen listing everyone the current user has blocked, with a
/// per-row Unblock action. Reachable from ProfileView. Surfacing this view is
/// part of the App Store guideline 1.2 requirement (the user must be able to
/// see and manage their own block list, not just one-way block calls).
struct BlockedUsersView: View {
    @State private var blocks: [BlockedUser] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView().padding(.top, 60)
            } else if blocks.isEmpty {
                ContentUnavailableView(
                    "No blocked users",
                    systemImage: "hand.raised.slash",
                    description: Text("People you block won't be able to message you, and their content won't appear in your feed.")
                )
            } else {
                List {
                    ForEach(blocks) { row in
                        HStack(spacing: 12) {
                            BusinessAvatar(name: row.blocked.name,
                                           logoUrl: row.blocked.avatarUrl,
                                           size: 36, cornerRadius: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.blocked.name).font(.subheadline)
                                Text("Blocked").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Unblock") { Task { await unblock(row) } }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Blocked Users")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Couldn't load",
               isPresented: Binding(get: { errorMessage != nil },
                                    set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func load() async {
        isLoading = true
        do {
            blocks = try await APIService.shared.blockedUsers()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func unblock(_ row: BlockedUser) async {
        do {
            try await APIService.shared.unblock(userId: row.blocked.id)
            blocks.removeAll { $0.id == row.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
