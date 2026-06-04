import SwiftUI

/// Role-aware deposit history. Homeowners see the deposits they've paid (and to
/// whom); contractors see the deposits they've received (and from whom, net of
/// the platform fee). Backed by GET /payments, which is already role-scoped.
struct PaymentsView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var payments: [Payment] = []
    @State private var isLoading = true
    @State private var error: String?

    private var isBusiness: Bool { auth.currentUser?.role == .business }

    var body: some View {
        ScrollView {
            if isLoading && payments.isEmpty {
                ProgressView().padding(.top, 60)
            } else if payments.isEmpty {
                ContentUnavailableView {
                    Label("No payments yet", systemImage: "creditcard")
                } description: {
                    Text(isBusiness
                         ? "Deposits homeowners pay you will appear here."
                         : "Deposits you pay to confirm a job will appear here.")
                }
                .padding(.top, 60)
            } else {
                LazyVStack(spacing: 12) {
                    summaryCard
                    ForEach(payments) { payment in
                        PaymentRow(payment: payment, isBusiness: isBusiness)
                    }
                }
                .padding(16)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Payments")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    // Total successfully settled — what the homeowner has paid, or what the
    // contractor has netted after the platform fee.
    private var settledTotalCents: Int {
        payments
            .filter { $0.status == .succeeded }
            .reduce(0) { sum, p in
                sum + (isBusiness ? (p.amountCents - p.commissionCents) : p.amountCents)
            }
    }

    private var summaryCard: some View {
        RCCard {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(isBusiness ? "Received" : "Paid")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(PaymentsView.money(settledTotalCents))
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.primary)
                }
                Spacer()
                if isBusiness {
                    Text("after fees")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func load() async {
        error = nil
        if payments.isEmpty { isLoading = true }
        defer { isLoading = false }
        do {
            payments = try await APIService.shared.payments()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Formatting (shared by the row)

    static func money(_ cents: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.maximumFractionDigits = cents % 100 == 0 ? 0 : 2
        return f.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$\(cents / 100)"
    }

    static func shortDate(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return nil }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: date)
    }
}

// MARK: - Row

private struct PaymentRow: View {
    let payment: Payment
    let isBusiness: Bool

    // Homeowner sees what they paid (gross); contractor sees the net deposit.
    private var displayCents: Int {
        isBusiness ? (payment.amountCents - payment.commissionCents) : payment.amountCents
    }

    private var counterparty: String {
        isBusiness
            ? (payment.client?.name ?? "Homeowner")
            : (payment.business?.companyName ?? "Contractor")
    }

    private var dateText: String? {
        PaymentsView.shortDate(payment.paidAt ?? payment.createdAt)
    }

    var body: some View {
        RCCard {
            HStack(spacing: 14) {
                if isBusiness {
                    InitialsAvatar(name: counterparty, size: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    BusinessAvatar(name: counterparty,
                                   logoUrl: payment.business?.logoUrl,
                                   size: 44, cornerRadius: 12)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(counterparty)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let dateText {
                        Text(dateText).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 4) {
                    Text(PaymentsView.money(displayCents))
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                    PaymentStatusBadge(status: payment.status)
                }
            }
            .padding(14)
        }
    }
}

// MARK: - Status badge

private struct PaymentStatusBadge: View {
    let status: PaymentStatus

    private var color: Color {
        switch status {
        case .succeeded: return Theme.success
        case .pending:   return Theme.gold
        case .failed:    return .red
        case .refunded:  return Color(.systemGray)
        }
    }

    private var icon: String {
        switch status {
        case .succeeded: return "checkmark.circle.fill"
        case .pending:   return "clock.fill"
        case .failed:    return "xmark.circle.fill"
        case .refunded:  return "arrow.uturn.backward.circle.fill"
        }
    }

    var body: some View {
        Label(status.label, systemImage: icon)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}
