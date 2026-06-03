import SwiftUI

/// Lists a homeowner's saved searches. Tapping one re-applies its filters to
/// the Explore screen; swiping deletes it. New saved searches generate an alert
/// (push + activity feed) whenever a matching contractor joins.
struct SavedSearchesView: View {
    /// Re-apply a saved search's filters to the parent Explore screen.
    let onApply: (SavedSearch) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var searches: [SavedSearch] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                } else if searches.isEmpty {
                    ContentUnavailableView {
                        Label("No saved searches", systemImage: "bookmark")
                    } description: {
                        Text("Save a search from Explore to get notified when a new matching contractor joins.")
                    }
                } else {
                    List {
                        Section {
                            ForEach(searches) { search in
                                Button {
                                    onApply(search)
                                    dismiss()
                                } label: {
                                    row(search)
                                }
                                .buttonStyle(.plain)
                            }
                            .onDelete(perform: delete)
                        } footer: {
                            Text("We'll alert you when a new contractor matches one of these searches.")
                        }
                    }
                }
            }
            .navigationTitle("Saved Searches")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    @ViewBuilder
    private func row(_ search: SavedSearch) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.primary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(search.displayLabel).font(.subheadline).foregroundStyle(.primary)
                if let sub = criteriaSummary(search) {
                    Text(sub).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    /// A compact one-line summary of the active filters, shown under the label.
    private func criteriaSummary(_ search: SavedSearch) -> String? {
        var parts: [String] = []
        if let s = search.specialty { parts.append(s) }
        if let q = search.q { parts.append("matching \u{201C}\(q)\u{201D}") }
        let loc = [search.city, search.state].compactMap { $0 }.joined(separator: ", ")
        if !loc.isEmpty { parts.append(loc) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func load() async {
        isLoading = true; error = nil
        defer { isLoading = false }
        do { searches = try await APIService.shared.mySavedSearches() }
        catch { self.error = error.localizedDescription }
    }

    private func delete(at offsets: IndexSet) {
        let removed = offsets.map { searches[$0] }
        searches.remove(atOffsets: offsets) // optimistic
        Task {
            for s in removed {
                do { try await APIService.shared.deleteSavedSearch(id: s.id) }
                catch { await load() } // reconcile on failure
            }
        }
    }
}
