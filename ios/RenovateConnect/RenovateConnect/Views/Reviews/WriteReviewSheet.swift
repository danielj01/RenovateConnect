import SwiftUI

/// Compose, edit, or delete a homeowner's review of a contractor. Reusable
/// from the business detail screen and the post-appointment prompt.
/// `onComplete` lets the caller refresh after any change.
struct WriteReviewSheet: View {
    let businessId: String
    let businessName: String
    var existing: Review?
    var onComplete: () async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var rating: Int
    @State private var body_: String
    @State private var isLoading = false
    @State private var error: String?

    init(businessId: String, businessName: String, existing: Review? = nil,
         onComplete: @escaping () async -> Void) {
        self.businessId = businessId
        self.businessName = businessName
        self.existing = existing
        self.onComplete = onComplete
        _rating = State(initialValue: existing?.rating ?? 5)
        _body_ = State(initialValue: existing?.body ?? "")
    }

    private var isEditing: Bool { existing != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section("Your rating") {
                    HStack(spacing: 8) {
                        ForEach(1...5, id: \.self) { i in
                            Image(systemName: i <= rating ? "star.fill" : "star")
                                .font(.title2)
                                .foregroundStyle(i <= rating ? Theme.gold : Color(.systemGray3))
                                .onTapGesture { rating = i }
                                .accessibilityLabel("\(i) star\(i == 1 ? "" : "s")")
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }

                Section("Review (optional)") {
                    TextField("How was your experience with \(businessName)?",
                              text: $body_, axis: .vertical)
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
                            Text(isEditing ? "Save changes" : "Post review")
                        }
                    }
                    .disabled(isLoading)
                }

                if isEditing {
                    Section {
                        Button(role: .destructive) {
                            Task { await remove() }
                        } label: {
                            Text("Delete review")
                        }
                        .disabled(isLoading)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit review" : "Write a review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        let trimmed = body_.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let existing {
                _ = try await APIService.shared.updateReview(
                    id: existing.id, rating: rating, body: trimmed.isEmpty ? nil : trimmed)
            } else {
                _ = try await APIService.shared.submitReview(
                    businessId: businessId, rating: rating, body: trimmed.isEmpty ? nil : trimmed)
            }
            await onComplete()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove() async {
        guard let existing else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            try await APIService.shared.deleteReview(id: existing.id)
            await onComplete()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
