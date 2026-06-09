import SwiftUI

/// Reusable report sheet (App Store guideline 1.2).
///
/// Used from MessagingView (report another user / message) and BusinessDetailView
/// (report a business). The caller supplies the target type and id; this sheet
/// owns the reason picker, optional details field, and submission.
struct ReportSheet: View {
    enum TargetType: String, CaseIterable {
        case user      = "USER"
        case message   = "MESSAGE"
        case review    = "REVIEW"
        case portfolio = "PORTFOLIO"
        case feed      = "FEED"
        case business  = "BUSINESS"

        var displayNoun: String {
            switch self {
            case .user: return "user"
            case .message: return "message"
            case .review: return "review"
            case .portfolio: return "portfolio item"
            case .feed: return "photo"
            case .business: return "business"
            }
        }
    }

    enum Reason: String, CaseIterable, Identifiable {
        case spam          = "SPAM"
        case harassment    = "HARASSMENT"
        case hate          = "HATE"
        case sexual        = "SEXUAL"
        case violence      = "VIOLENCE"
        case scam          = "SCAM"
        case impersonation = "IMPERSONATION"
        case offPlatform   = "OFF_PLATFORM"
        case other         = "OTHER"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .spam: return "Spam or misleading"
            case .harassment: return "Harassment or bullying"
            case .hate: return "Hate speech"
            case .sexual: return "Sexual content"
            case .violence: return "Violence or threats"
            case .scam: return "Scam or fraud"
            case .impersonation: return "Impersonation"
            case .offPlatform: return "Trying to take the deal off-platform"
            case .other: return "Something else"
            }
        }
    }

    let targetType: TargetType
    let targetId: String

    @Environment(\.dismiss) private var dismiss
    @State private var reason: Reason = .spam
    @State private var details: String = ""
    @State private var isSubmitting = false
    @State private var didSubmit = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if didSubmit {
                    Section {
                        Label("Thanks — our team will review this.",
                              systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                } else {
                    Section {
                        Picker("Reason", selection: $reason) {
                            ForEach(Reason.allCases) { r in
                                Text(r.label).tag(r)
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    } header: {
                        Text("Why are you reporting this \(targetType.displayNoun)?")
                    }

                    Section {
                        TextEditor(text: $details)
                            .frame(minHeight: 100)
                    } header: {
                        Text("Add details (optional)")
                    } footer: {
                        Text("We only use these reports to keep RenovateConnect safe. Reports are anonymous to the person you're reporting.")
                    }

                    if let errorMessage {
                        Section { Text(errorMessage).foregroundStyle(.red).font(.caption) }
                    }
                }
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                if !didSubmit {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Submit") { Task { await submit() } }
                            .disabled(isSubmitting)
                    }
                } else {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        do {
            _ = try await APIService.shared.report(
                targetType: targetType.rawValue,
                targetId: targetId,
                reason: reason.rawValue,
                details: details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : details
            )
            didSubmit = true
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}
