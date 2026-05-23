import SwiftUI

struct ConversationsView: View {
    @State private var conversations: [Conversation] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if conversations.isEmpty {
                    ContentUnavailableView("No conversations yet", systemImage: "message", description: Text("Contact a business to start a conversation."))
                } else {
                    List(conversations) { conv in
                        NavigationLink(destination: MessagingView(conversation: conv)) {
                            ConversationRowView(conversation: conv)
                        }
                    }
                }
            }
            .navigationTitle("Messages")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        conversations = (try? await APIService.shared.myConversations()) ?? []
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
                    .font(.subheadline.bold())
                if let lastMsg = conversation.messages?.first {
                    Text(lastMsg.body)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}
