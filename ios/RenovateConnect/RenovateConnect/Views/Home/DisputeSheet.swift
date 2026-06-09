import SwiftUI

/// Homeowner-only sheet to open a dispute on a milestone. Pauses the 7-day
/// auto-release until the homeowner withdraws or an admin resolves.
struct DisputeSheet: View {
    let projectId: String
    let milestone: Milestone
    let onSubmitted: () -> Void

    enum Reason: String, CaseIterable, Identifiable {
        case workNotDone     = "WORK_NOT_DONE"
        case workIncomplete  = "WORK_INCOMPLETE"
        case workLowQuality  = "WORK_LOW_QUALITY"
        case notAsAgreed     = "NOT_AS_AGREED"
        case damage          = "DAMAGE"
        case wrongAmount     = "WRONG_AMOUNT"
        case other           = "OTHER"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .workNotDone: return "Work hasn't started"
            case .workIncomplete: return "Work is incomplete"
            case .workLowQuality: return "Quality is below what we agreed"
            case .notAsAgreed: return "Not what we agreed to"
            case .damage: return "The contractor caused damage"
            case .wrongAmount: return "The amount is wrong"
            case .other: return "Something else"
            }
        }
    }

    @Environment(\.dismiss) private var dismiss
    @State private var reason: Reason = .workIncomplete
    @State private var details: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var canSubmit: Bool {
        details.trimmingCharacters(in: .whitespacesAndNewlines).count >= 10 && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(Reason.allCases) { r in
                            Text(r.label).tag(r)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("What went wrong?")
                }

                Section {
                    TextEditor(text: $details)
                        .frame(minHeight: 120)
                } header: {
                    Text("Tell us what happened (10 chars min)")
                } footer: {
                    Text("Disputing pauses the 7-day automatic release so an admin can review. Be specific — this is what the admin reads first.")
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.caption) }
                }
            }
            .navigationTitle("Dispute milestone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submit() } }
                        .disabled(!canSubmit)
                }
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        do {
            try await APIService.shared.disputeMilestone(
                projectId: projectId,
                milestoneId: milestone.id,
                reason: reason.rawValue,
                details: details.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onSubmitted()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}
