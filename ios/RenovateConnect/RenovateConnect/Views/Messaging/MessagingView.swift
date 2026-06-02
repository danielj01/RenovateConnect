import SwiftUI

struct MessagingView: View {
    let conversation: Conversation
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isSending = false
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var inbox: InboxStore
    @EnvironmentObject private var notifications: NotificationManager

    var body: some View {
        VStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(messages) { msg in
                            let isMe = msg.senderId == auth.currentUser?.id
                            ChatBubble(text: msg.body, isUser: isMe)
                                .id(msg.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            HStack {
                TextField("Message…", text: $input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
            }
            .padding()
        }
        .navigationTitle(conversation.business?.companyName ?? "Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        messages = (try? await APIService.shared.getMessages(conversationId: conversation.id)) ?? []
        // Opening the thread marks it read; refresh the inbox badge.
        try? await APIService.shared.markConversationRead(conversationId: conversation.id)
        await inbox.refresh()
    }

    private func send() async {
        let body = input.trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return }
        input = ""
        isSending = true
        defer { isSending = false }
        if let msg = try? await APIService.shared.sendMessage(conversationId: conversation.id, body: body) {
            messages.append(msg)
            // First real engagement → a great moment to ask for push permission.
            notifications.considerPriming()
        }
    }
}
