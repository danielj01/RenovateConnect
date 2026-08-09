import SwiftUI

struct AIChatView: View {
    @EnvironmentObject private var chat: ChatStore
    @State private var input = ""

    var body: some View {
        NavigationStack {
            VStack {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if chat.messages.isEmpty {
                                emptyState
                            }

                            ForEach(chat.messages) { msg in
                                VStack(alignment: msg.isUser ? .trailing : .leading, spacing: 6) {
                                    ChatBubble(text: msg.content, isUser: msg.isUser)
                                    // Deep links to any contractors the assistant named.
                                    if !msg.mentioned.isEmpty {
                                        recommendations(msg.mentioned)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: msg.isUser ? .trailing : .leading)
                                .id(msg.id)
                            }

                            if chat.isLoading {
                                TypingIndicatorBubble()
                            }
                        }
                        .padding()
                    }
                    .onChange(of: chat.messages.count) {
                        if let last = chat.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                HStack {
                    TextField("Ask about contractors…", text: $input, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...4)
                    Button {
                        let text = input
                        input = ""
                        Task { await chat.send(text) }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || chat.isLoading)
                }
                .padding()
            }
            .navigationTitle("AI Assistant")
            .toolbar {
                if !chat.messages.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Clear") { chat.clear() }
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 48))
                .foregroundStyle(Theme.primary)
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

    @ViewBuilder
    private func recommendations(_ refs: [BusinessRef]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(refs) { ref in
                NavigationLink(destination: BusinessDetailView(businessId: ref.id)) {
                    HStack(spacing: 6) {
                        Image(systemName: "building.2.fill").font(.caption2)
                        Text(ref.companyName).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Image(systemName: "chevron.right").font(.caption2)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.primaryLight)
                    .foregroundStyle(Theme.primary)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: 280, alignment: .leading)
    }
}

struct ChatBubble: View {
    let text: String
    let isUser: Bool

    // The assistant replies with inline Markdown (**bold** for business names,
    // etc.), which a plain Text(String) shows as literal asterisks. Parse it
    // so it renders properly; fall back to the raw string if parsing fails
    // (malformed Markdown shouldn't ever drop a reply on the floor).
    private var rendered: AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }

    var body: some View {
        HStack {
            if isUser { Spacer() }
            Text(rendered)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(isUser ? Theme.primary : Color(.systemGray5))
                .foregroundStyle(isUser ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: 280, alignment: isUser ? .trailing : .leading)
            if !isUser { Spacer() }
        }
    }
}

/// Three dots that bounce in sequence while the assistant is composing a
/// reply — replaces a static "…" so a slow response reads as "thinking",
/// not "frozen".
struct TypingIndicatorBubble: View {
    @State private var bounce = false

    var body: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .frame(width: 7, height: 7)
                        .foregroundStyle(.secondary)
                        .offset(y: bounce ? -4 : 0)
                        .animation(
                            .easeInOut(duration: 0.5)
                                .repeatForever(autoreverses: true)
                                .delay(Double(i) * 0.15),
                            value: bounce
                        )
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color(.systemGray5))
            .clipShape(RoundedRectangle(cornerRadius: 18))
            Spacer()
        }
        .onAppear { bounce = true }
    }
}
