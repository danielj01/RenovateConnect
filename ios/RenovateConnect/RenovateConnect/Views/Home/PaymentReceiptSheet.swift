import SwiftUI

/// Branded receipt for one payment. Shows the line-item breakdown the homeowner
/// was actually charged (contractor portion + platform fee = total), the
/// payment status, the refund/dispute path, and the paid/refunded dates.
///
/// This is what the homeowner is referred to when there's any question about
/// what they paid — defensible against chargebacks because every number in the
/// receipt corresponds to a column the API actually stores.
struct PaymentReceiptSheet: View {
    let payment: ProjectPayment
    let businessName: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    breakdownCard
                    statusCard
                    if payment.status != .refunded {
                        disputeCard
                    }
                    Spacer(minLength: 12)
                }
                .padding(16)
            }
            .background(Color(.systemBackground))
            .navigationTitle("Receipt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(headlineCopy).font(.title3.weight(.semibold))
            Text("Paid to \(businessName)").font(.subheadline).foregroundStyle(.secondary)
            if let paid = payment.paidAt {
                Text("Paid \(shortDate(paid))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var breakdownCard: some View {
        RCCard {
            VStack(spacing: 12) {
                lineRow(label: "Contractor portion",
                        value: payment.contractorPortionText ?? payment.totalText)
                if let fee = payment.commissionText {
                    lineRow(label: "Platform service fee", value: fee)
                }
                Divider()
                lineRow(label: "Total charged",
                        value: payment.totalText,
                        bold: true)
                if let desc = payment.description, !desc.isEmpty {
                    Divider()
                    Text(desc).font(.caption).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
        }
    }

    private var statusCard: some View {
        RCCard {
            HStack(spacing: 12) {
                Image(systemName: statusIcon)
                    .foregroundStyle(statusColor)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(statusLabel).font(.subheadline.weight(.semibold))
                    Text(statusCopy).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(16)
        }
    }

    private var disputeCard: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 6) {
                Label("Something's wrong?",
                      systemImage: "exclamationmark.bubble")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primary)
                Text(payment.kind == "MILESTONE"
                     ? "Funds for milestone payments are held in escrow for 7 days after the contractor submits work. During that window you can dispute the milestone from the project screen to pause the auto-release."
                     : "If the work doesn't match what was agreed, message the contractor first. If you can't resolve it, contact RenovateConnect support and we'll help refund the deposit per our policy.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var headlineCopy: String {
        switch payment.kind {
        case "MILESTONE": return "Milestone payment"
        default:          return "Deposit"
        }
    }

    private var statusIcon: String {
        switch payment.status {
        case .succeeded: return "checkmark.seal.fill"
        case .pending:   return "clock.fill"
        case .failed:    return "xmark.octagon.fill"
        case .refunded:  return "arrow.uturn.backward.circle.fill"
        }
    }

    private var statusColor: Color {
        switch payment.status {
        case .succeeded: return Theme.success
        case .pending:   return .orange
        case .failed:    return .red
        case .refunded:  return .secondary
        }
    }

    private var statusLabel: String {
        switch payment.status {
        case .succeeded: return "Payment received"
        case .pending:   return "Payment pending"
        case .failed:    return "Payment failed"
        case .refunded:  return "Refunded"
        }
    }

    private var statusCopy: String {
        switch payment.status {
        case .succeeded:
            if payment.kind == "MILESTONE" { return "Funds are held in escrow." }
            return "The deposit was sent to the contractor."
        case .pending:
            return "We're waiting for Stripe to confirm the payment."
        case .failed:
            return "The charge didn't go through. Try again from the project screen."
        case .refunded:
            if let r = payment.refundedAt {
                return "Refunded \(shortDate(r)) — the funds are back on your card."
            }
            return "The funds are back on your card."
        }
    }

    @ViewBuilder
    private func lineRow(label: String, value: String, bold: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(bold ? .subheadline.weight(.semibold) : .subheadline)
            Spacer()
            Text(value)
                .font(bold ? .subheadline.monospacedDigit().weight(.semibold)
                           : .subheadline.monospacedDigit())
        }
    }

    private func shortDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d = parsed else { return iso }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: d)
    }
}
