import SwiftUI

/// Homeowner-only scratchpad for one project. Editing posts to
/// PATCH /projects/:id/notes; the server caps at 8000 chars. Empty string
/// clears the field on the server side.
struct ProjectNotesEditor: View {
    let projectId: String
    let initialText: String

    let onSaved: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(projectId: String, initialText: String, onSaved: @escaping (String?) -> Void) {
        self.projectId = projectId
        self.initialText = initialText
        self.onSaved = onSaved
        _text = State(initialValue: initialText)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 220)
                } footer: {
                    Text("Only you can see this. Measurements, paint colors, contractor notes — anything you want to remember.")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.caption) }
                }
            }
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(isSaving || text == initialText)
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        do {
            let stored = try await APIService.shared.updateProjectNotes(
                projectId: projectId, notes: text
            )
            onSaved(stored)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}
