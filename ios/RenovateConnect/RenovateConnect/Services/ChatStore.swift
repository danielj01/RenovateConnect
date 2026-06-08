import SwiftUI
import Combine

/// Holds the AI assistant conversation. Owned above the tab bar so history
/// survives tab switches, and persisted to UserDefaults so it survives app
/// restarts — turning a one-off Q&A into a return-worthy thread.
@MainActor
final class ChatStore: ObservableObject {
    /// Shared instance so AI chat can be presented from anywhere (e.g. the
    /// Explore screen) with consistent history, now that it's no longer a tab.
    static let shared = ChatStore()

    @Published private(set) var messages: [ChatTurn] = []
    @Published var isLoading = false

    private let storageKey = "aiChatHistory"

    init() { load() }

    func send(_ text: String) async {
        let msg = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty else { return }

        messages.append(ChatTurn(role: "user", content: msg))
        persist()

        isLoading = true
        defer { isLoading = false }

        // Prior turns become the model's context; the new message is sent separately.
        let apiHistory = messages.dropLast().map { ["role": $0.role, "content": $0.content] }
        do {
            let result = try await APIService.shared.chat(message: msg, history: Array(apiHistory))
            messages.append(ChatTurn(role: "assistant", content: result.reply, mentioned: result.mentioned))
        } catch {
            messages.append(ChatTurn(role: "assistant", content: "Sorry, something went wrong. Please try again."))
        }
        persist()
    }

    func clear() {
        messages = []
        persist()
    }

    // MARK: - Persistence

    private func persist() {
        if let data = try? JSONEncoder().encode(messages) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode([ChatTurn].self, from: data) else { return }
        messages = saved
    }
}
