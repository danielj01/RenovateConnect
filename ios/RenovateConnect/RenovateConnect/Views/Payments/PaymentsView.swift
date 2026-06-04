import SwiftUI

/// Role-aware deposit history. Homeowners see the deposits they've paid (and to
/// whom); contractors see the deposits they've received (and from whom, net of
/// the platform fee). Backed by GET /payments, which is already role-scoped.
struct PaymentsView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var payments: [Payment] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var refundTarget: Payment?
    @State private var refundingId: String?
    @State private var connect: ConnectStatus?
    @State private var onboardURL: URL?
    @State private var onboardLoading = false

    private var isBusiness: Bool { auth.currentUser?.role == .business }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                // Contractor payout setup — gates whether homeowners can pay
                // deposits at all, so it sits above the (possibly empty) history.
                if isBusiness { payoutSetupCard }

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
                    .padding(.top, 40)
                } else {
                    summaryCard
                    ForEach(payments) { payment in
                        PaymentRow(
                            payment: payment,
                            isBusiness: isBusiness,
                            isRefunding: refundingId == payment.id,
                            onRefund: isBusiness && payment.status == .succeeded
                                ? { refundTarget = payment }
                                : nil
                        )
                    }
                }
            }
            .padding(16)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Payments")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(); await loadConnect() }
        .refreshable { await load(); await loadConnect() }
        .sheet(item: $onboardURL, onDismiss: { Task { await loadConnect() } }) { url in
            SafariView(url: url).ignoresSafeArea()
        }
        .confirmationDialog(
            "Refund this deposit?",
            isPresented: Binding(get: { refundTarget != nil },
                                 set: { if !$0 { refundTarget = nil } }),
            titleVisibility: .visible,
            presenting: refundTarget
        ) { payment in
            Button("Refund \(PaymentsView.money(payment.amountCents))", role: .destructive) {
                Task { await refund(payment) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("The homeowner gets the full deposit back, your payout is reversed, and the platform fee is returned. This can't be undone.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { error != nil },
                                                            set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    // MARK: - Payout setup (Stripe Connect)

    /// Shown to contractors. Until payouts are enabled, homeowners can't pay a
    /// deposit on any of their jobs — so this is the gate on all in-app revenue.
    @ViewBuilder
    private var payoutSetupCard: some View {
        if let connect {
            if connect.payoutsEnabled {
                RCCard {
                    HStack(spacing: 12) {
                        Image(systemName: "lock.shield.fill")
                            .font(.title3).foregroundStyle(Theme.success)
                            .frame(width: 36, height: 36)
                            .background(Theme.success.opacity(0.15)).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Payouts active").font(.subheadline.weight(.semibold))
                            Text("Homeowners can pay deposits to confirm your jobs.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(14)
                }
            } else {
                RCCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Set up payouts", systemImage: "building.columns.fill")
                            .font(.headline).foregroundStyle(Theme.primary)
                        Text("Connect a payout account to accept secured deposits from homeowners. Until you do, the \u{201C}Pay deposit\u{201D} button won't appear on your accepted quotes. Powered by Stripe.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button {
                            Task { await startOnboarding() }
                        } label: {
                            HStack(spacing: 8) {
                                if onboardLoading { ProgressView().tint(.white) }
                                Text(connect.onboarded ? "Finish payout setup" : "Set up payouts")
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.primary)
                        .disabled(onboardLoading)
                    }
                    .padding(16)
                }
            }
        }
    }

    private func loadConnect() async {
        guard isBusiness else { return }
        connect = try? await APIService.shared.connectStatus()
    }

    private func startOnboarding() async {
        onboardLoading = true
        defer { onboardLoading = false }
        do {
            onboardURL = try await APIService.shared.connectOnboardURL()
        } catch {
            self.error = error.localizedDescription
        }
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

    // Issue the refund, then reload so the row reflects its new REFUNDED status
    // (the backend settles it via webhook, so a refetch is the source of truth).
    private func refund(_ payment: Payment) async {
        refundingId = payment.id
        defer { refundingId = nil }
        do {
            try await APIService.shared.refundPayment(id: payment.id)
            await load()
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
    var isRefunding: Bool = false
    var onRefund: (() -> Void)?

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
            VStack(spacing: 0) {
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

                if let onRefund {
                    Divider().padding(.horizontal, 14)
                    Button(role: .destructive, action: onRefund) {
                        HStack(spacing: 8) {
                            if isRefunding {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.uturn.backward")
                            }
                            Text(isRefunding ? "Refunding…" : "Refund deposit")
                                .font(.subheadline.weight(.medium))
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    }
                    .disabled(isRefunding)
                }
            }
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
