import SwiftUI

struct ConversationsView: View {
    @State private var conversations: [Conversation] = []
    @State private var isLoading = true
    @State private var deepLinkConversation: Conversation?
    @EnvironmentObject private var inbox: InboxStore
    @EnvironmentObject private var notifications: NotificationManager
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: TabRouter

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if conversations.isEmpty {
                    if auth.currentUser?.role == .client {
                        ContentUnavailableView {
                            Label("No conversations yet", systemImage: "message")
                        } description: {
                            Text("Find a contractor and start a conversation about your project.")
                        } actions: {
                            Button {
                                router.selection = TabRouter.explore
                            } label: {
                                Text("Explore contractors").fontWeight(.semibold)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Theme.primary)
                        }
                    } else {
                        ContentUnavailableView("No conversations yet", systemImage: "message", description: Text("Leads from homeowners will appear here."))
                    }
                } else {
                    List(conversations) { conv in
                        NavigationLink(destination: MessagingView(conversation: conv)) {
                            ConversationRowView(conversation: conv)
                        }
                    }
                }
            }
            .navigationTitle("Messages")
            .navigationDestination(item: $deepLinkConversation) { conv in
                MessagingView(conversation: conv)
            }
            .task {
                await load()
                consumePendingDeepLink()
            }
            .refreshable { await load() }
            .onChange(of: notifications.pendingConversationId) { _, _ in
                consumePendingDeepLink()
            }
        }
    }

    /// If a push tap left a pending conversation id, open it and clear the flag.
    private func consumePendingDeepLink() {
        guard let id = notifications.pendingConversationId else { return }
        Task { await openConversation(id: id) }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        conversations = (try? await APIService.shared.myConversations()) ?? []
        await inbox.refresh()
    }

    /// Deep link from a tapped push: ensure the thread is loaded, then navigate.
    private func openConversation(id: String) async {
        if !conversations.contains(where: { $0.id == id }) {
            await load()
        }
        deepLinkConversation = conversations.first { $0.id == id }
        notifications.pendingConversationId = nil
    }
}

struct ConversationRowView: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: conversation.business?.logoUrl ?? "")) { img in
                img.resizable().aspectRatio(contentMode: .fill)
            } placeholder: { Color.secondary.opacity(0.2) }
            .frame(width: 48, height: 48)
            .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(conversation.business?.companyName ?? "Business")
                    .font(.subheadline)
                    .fontWeight(conversation.hasUnread ? .bold : .semibold)
                if let lastMsg = conversation.messages?.first {
                    Text(lastMsg.hasText ? lastMsg.body : (lastMsg.images.isEmpty ? "" : "📷 Photo"))
                        .font(.caption)
                        .foregroundStyle(conversation.hasUnread ? .primary : .secondary)
                        .fontWeight(conversation.hasUnread ? .medium : .regular)
                        .lineLimit(1)
                }
            }

            Spacer()

            if conversation.hasUnread {
                Text("\(conversation.unreadCount ?? 0)")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Theme.primary, in: Capsule())
            }
        }
    }
}
