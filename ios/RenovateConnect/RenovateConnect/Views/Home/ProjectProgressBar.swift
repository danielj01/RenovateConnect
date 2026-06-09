import SwiftUI

/// Single horizontal stepper at the top of ProjectDetailView. Compresses the
/// quote → deposit → escrow → done sequence into one glance — the research
/// doc's "status bar" recommendation.
///
/// Steps the bar reads from the detail payload:
///   1. Quote sent       (any quote exists)
///   2. Accepted         (an ACCEPTED quote)
///   3. Deposit paid     (a SUCCEEDED DEPOSIT-kind payment)
///   4. Milestone funded (any milestone in FUNDED+ status)
///   5. Complete         (Project.status == COMPLETED)
struct ProjectProgressBar: View {
    let detail: ProjectDetail

    private struct Step {
        let label: String
        let icon: String
        let done: Bool
    }

    private var steps: [Step] {
        let hasQuote = !detail.quotes.isEmpty
        let accepted = detail.quotes.contains { $0.status == .accepted }
        let deposit  = detail.payments.contains {
            $0.status == .succeeded && ($0.kind ?? "DEPOSIT") == "DEPOSIT"
        }
        let funded   = (detail.project?.milestones ?? []).contains {
            $0.status == .funded || $0.status == .submitted
                || $0.status == .approved || $0.status == .disputed
        }
        let done     = detail.project?.status == "COMPLETED"
        return [
            Step(label: "Quote",     icon: "doc.text",                 done: hasQuote),
            Step(label: "Accepted",  icon: "checkmark.circle",         done: accepted),
            Step(label: "Deposit",   icon: "creditcard",               done: deposit),
            Step(label: "Escrow",    icon: "lock.fill",                done: funded),
            Step(label: "Complete",  icon: "flag.checkered",           done: done),
        ]
    }

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 4) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                        stepCircle(step)
                        if idx < steps.count - 1 {
                            connector(filled: steps[idx].done && steps[idx + 1].done)
                        }
                    }
                }
                HStack(spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                        Text(step.label)
                            .font(.caption2)
                            .foregroundStyle(step.done ? Color(.label) : .secondary)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private func stepCircle(_ step: Step) -> some View {
        ZStack {
            Circle()
                .fill(step.done ? Theme.primary : Color(.tertiarySystemFill))
                .frame(width: 30, height: 30)
            Image(systemName: step.icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(step.done ? .white : .secondary)
        }
    }

    private func connector(filled: Bool) -> some View {
        Rectangle()
            .fill(filled ? Theme.primary : Color(.tertiarySystemFill))
            .frame(height: 3)
            .frame(maxWidth: .infinity)
    }
}
