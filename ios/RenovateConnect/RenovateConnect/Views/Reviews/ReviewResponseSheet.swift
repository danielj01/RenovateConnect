import SwiftUI

/// Lets a business owner publicly reply to (or edit/remove its reply on) one of
/// its reviews. `onComplete` lets the caller refresh after any change.
struct ReviewResponseSheet: View {
    let review: Review
    var onComplete: () async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var text: String
    @State private var isLoading = false
    @State private var error: String?

    init(review: Review, onComplete: @escaping () async -> Void) {
        self.review = review
        self.onComplete = onComplete
        _text = State(initialValue: review.response ?? "")
    }

    private var isEditing: Bool { review.hasResponse }

    var body: some View {
        NavigationStack {
            Form {
                Section("Review") {
                    HStack(spacing: 2) {
                        ForEach(1...5, id: \.self) { i in
                            Image(systemName: i <= review.rating ? "star.fill" : "star")
                                .foregroundStyle(i <= review.rating ? Theme.gold : Color(.systemGray4))
                                .font(.caption)
                        }
                    }
                    if let body = review.body {
                        Text(body).font(.subheadline).foregroundStyle(.secondary)
                    }
                }

                Section("Your public response") {
                    TextField("Reply to \(review.authorName)…", text: $text, axis: .vertical)
                        .lineLimit(4...8)
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isLoading {
                            HStack { ProgressView(); Text(isEditing ? "Saving…" : "Posting…") }
                        } else {
                            Text(isEditing ? "Save response" : "Post response")
                        }
                    }
                    .disabled(isLoading || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                if isEditing {
                    Section {
                        Button(role: .destructive) {
                            Task { await remove() }
                        } label: {
                            Text("Remove response")
                        }
                        .disabled(isLoading)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit response" : "Respond to review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isLoading = true; error = nil
        defer { isLoading = false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try await APIService.shared.respondToReview(id: review.id, response: trimmed)
            await onComplete()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove() async {
        isLoading = true; error = nil
        defer { isLoading = false }
        do {
            _ = try await APIService.shared.deleteReviewResponse(id: review.id)
            await onComplete()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
