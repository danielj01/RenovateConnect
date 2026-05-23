import SwiftUI

struct MessagingView: View {
    let conversation: Conversation
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isSending = false
    @EnvironmentObject private var auth: AuthStore

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
    }

    private func send() async {
        let body = input.trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return }
        input = ""
        isSending = true
        defer { isSending = false }
        if let msg = try? await APIService.shared.sendMessage(conversationId: conversation.id, body: body) {
            messages.append(msg)
        }
    }
}

struct ContactBusinessSheet: View {
    let business: Business
    @State private var message = ""
    @State private var isSending = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Your message to \(business.companyName)") {
                    TextField("Describe your project…", text: $message, axis: .vertical)
                        .lineLimit(4...8)
                }
                if let error { Section { Text(error).foregroundStyle(.red).font(.caption) } }
            }
            .navigationTitle("Contact")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { Task { await send() } }
                        .disabled(message.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
                }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func send() async {
        isSending = true
        defer { isSending = false }
        do {
            _ = try await APIService.shared.startConversation(businessId: business.id, message: message)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
