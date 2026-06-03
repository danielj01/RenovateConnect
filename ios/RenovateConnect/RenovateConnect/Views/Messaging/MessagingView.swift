import SwiftUI

struct MessagingView: View {
    let conversation: Conversation
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isSending = false
    @State private var otherLastReadAt: Date?
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var inbox: InboxStore
    @EnvironmentObject private var notifications: NotificationManager

    /// The last message the current user sent (receipts only apply to your own).
    private var myLastMessage: ChatMessage? {
        messages.last { $0.senderId == auth.currentUser?.id }
    }

    /// Show a receipt only when the most recent message in the thread is mine.
    private var showsReceipt: Bool {
        messages.last?.senderId == auth.currentUser?.id && myLastMessage != nil
    }

    /// "Seen" once the other participant's last-read time is at or after my
    /// latest message; otherwise "Sent".
    private var receiptText: String {
        guard let sentAt = myLastMessage?.createdAt.iso8601Date else { return "Sent" }
        if let read = otherLastReadAt, read >= sentAt { return "Seen" }
        return "Sent"
    }

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

                        if showsReceipt {
                            HStack(spacing: 3) {
                                Image(systemName: receiptText == "Seen" ? "checkmark.circle.fill" : "checkmark.circle")
                                Text(receiptText)
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.trailing, 4)
                            .transition(.opacity)
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
        .task {
            await load()
            // Poll the other party's read state while the thread is open so the
            // "Seen" receipt updates live. Cancelled automatically on disappear.
            await pollReceipts()
        }
    }

    private func load() async {
        messages = (try? await APIService.shared.getMessages(conversationId: conversation.id)) ?? []
        // Opening the thread marks it read; refresh the inbox badge.
        try? await APIService.shared.markConversationRead(conversationId: conversation.id)
        await inbox.refresh()
        await refreshReceipt()
    }

    private func send() async {
        let body = input.trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return }
        input = ""
        isSending = true
        defer { isSending = false }
        if let msg = try? await APIService.shared.sendMessage(conversationId: conversation.id, body: body) {
            withAnimation { messages.append(msg) }
            // First real engagement → a great moment to ask for push permission.
            notifications.considerPriming()
        }
    }

    /// Pull the latest read timestamps and keep the receipt for the *other*
    /// participant (the one who would have "seen" my messages).
    private func refreshReceipt() async {
        guard let fresh = try? await APIService.shared.getConversation(id: conversation.id) else { return }
        let stamp = auth.currentUser?.role == .client
            ? fresh.businessLastReadAt
            : fresh.clientLastReadAt
        withAnimation { otherLastReadAt = stamp?.iso8601Date }
    }

    private func pollReceipts() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(5))
            if Task.isCancelled { break }
            await refreshReceipt()
        }
    }
}

private extension String {
    /// Parse an ISO-8601 timestamp (with or without fractional seconds) to Date.
    var iso8601Date: Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: self) ?? ISO8601DateFormatter().date(from: self)
    }
}
