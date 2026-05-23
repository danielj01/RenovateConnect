import SwiftUI

struct AIChatView: View {
    @State private var history: [(role: String, content: String)] = []
    @State private var input = ""
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            VStack {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if history.isEmpty {
                                VStack(spacing: 8) {
                                    Image(systemName: "bubble.left.and.bubble.right.fill")
                                        .font(.system(size: 48))
                                        .foregroundStyle(.blue)
                                    Text("AI Renovation Assistant")
                                        .font(.headline)
                                    Text("Describe your project and I'll match you with the right contractors.")
                                        .multilineTextAlignment(.center)
                                        .foregroundStyle(.secondary)
                                        .font(.subheadline)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.top, 60)
                            }

                            ForEach(Array(history.enumerated()), id: \.offset) { i, msg in
                                ChatBubble(text: msg.content, isUser: msg.role == "user")
                                    .id(i)
                            }

                            if isLoading {
                                ChatBubble(text: "…", isUser: false)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: history.count) {
                        withAnimation { proxy.scrollTo(history.count - 1, anchor: .bottom) }
                    }
                }

                HStack {
                    TextField("Ask about contractors…", text: $input, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...4)
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                }
                .padding()
            }
            .navigationTitle("AI Assistant")
        }
    }

    private func send() async {
        let msg = input.trimmingCharacters(in: .whitespaces)
        guard !msg.isEmpty else { return }
        input = ""
        history.append((role: "user", content: msg))
        isLoading = true
        defer { isLoading = false }
        do {
            let apiHistory = history.dropLast().map { ["role": $0.role, "content": $0.content] }
            let reply = try await APIService.shared.chat(message: msg, history: apiHistory)
            history.append((role: "assistant", content: reply))
        } catch {
            history.append((role: "assistant", content: "Sorry, something went wrong. Please try again."))
        }
    }
}

struct ChatBubble: View {
    let text: String
    let isUser: Bool

    var body: some View {
        HStack {
            if isUser { Spacer() }
            Text(text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(isUser ? Color.blue : Color(.systemGray5))
                .foregroundStyle(isUser ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: 280, alignment: isUser ? .trailing : .leading)
            if !isUser { Spacer() }
        }
    }
}
