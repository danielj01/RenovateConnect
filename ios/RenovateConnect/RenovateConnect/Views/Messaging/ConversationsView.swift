import SwiftUI

struct ConversationsView: View {
    @State private var loadError: String?
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
                } else if loadError != nil && conversations.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn’t load messages", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Your conversations haven’t been removed. Check your connection and try again.")
                    } actions: {
                        Button("Try again") { Task { await load() } }.buttonStyle(.borderedProminent).tint(Theme.primary)
                    }
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
                    List {
                        Section {
                            ForEach(conversations) { conv in
                                NavigationLink(destination: MessagingView(conversation: conv)) {
                                    ConversationRowView(conversation: conv)
                                }
                                .listRowInsets(EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
                            }
                        } header: { Text("Your conversations") }
                    }
                    .safeAreaInset(edge: .top) {
                        if loadError != nil {
                            HStack { Text("Couldn’t refresh. Showing previous messages.").font(.caption); Button("Retry") { Task { await load() } } }.padding()
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
        isLoading = conversations.isEmpty
        loadError = nil
        defer { isLoading = false }
        do {
            conversations = try await APIService.shared.myConversations()
            await inbox.refresh()
        } catch {
            loadError = error.localizedDescription

        }
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
    @EnvironmentObject private var auth: AuthStore
    private var participant: String {
        auth.isBusiness ? (conversation.client?.name ?? "Homeowner") : (conversation.business?.companyName ?? "Business")
    }

    var body: some View {
        HStack(spacing: 12) {

            BusinessAvatar(name: participant, logoUrl: auth.isBusiness ? conversation.client?.avatarUrl : conversation.business?.logoUrl, size: 48, cornerRadius: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(participant)
                    .font(.subheadline)
                    .fontWeight(conversation.hasUnread ? .bold : .semibold)
                if let lastMsg = conversation.messages?.first {
                    Text(lastMsg.hasText ? lastMsg.body : (lastMsg.images.isEmpty ? "" : "📷 Photo"))
                        .font(.subheadline)
                        .foregroundStyle(conversation.hasUnread ? .primary : .secondary)
                        .fontWeight(conversation.hasUnread ? .medium : .regular)
                        .lineLimit(2)
                }
            }

            Spacer()

            if let date = (conversation.messages?.first?.createdAt ?? conversation.updatedAt).iso8601Date {
                Text(date, format: .dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(.secondary)
            }
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
