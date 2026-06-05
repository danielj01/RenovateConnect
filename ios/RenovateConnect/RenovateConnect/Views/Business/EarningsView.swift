import SwiftUI

/// Contractor-facing earnings summary. Distinguishes money already settled to
/// the contractor (deposit nets + released milestones) from milestone funds
/// still held in escrow, and surfaces lifetime platform fees and refunds.
/// Backed by GET /payments/earnings. Pushed from the dashboard, so it relies on
/// the parent NavigationStack.
struct EarningsView: View {
    @State private var earnings: Earnings?
    @State private var isLoading = true
    @State private var error: String?

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if isLoading && earnings == nil {
                    ProgressView().padding(.top, 80)
                } else if let e = earnings {
                    releasedHero(e)
                    grid(e)
                    detailCard(e)
                    historyLink
                } else if let error {
                    ContentUnavailableState(error: error) { await load() }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Earnings")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    // MARK: - Sections

    private func releasedHero(_ e: Earnings) -> some View {
        ZStack(alignment: .leading) {
            Theme.gradient
            VStack(alignment: .leading, spacing: 6) {
                Text("Paid out to you")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.85))
                Text(PaymentsView.money(e.releasedCents))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("\(e.releasedCount) released \(e.releasedCount == 1 ? "payment" : "payments")")
                    .font(.caption).foregroundStyle(.white.opacity(0.85))
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func grid(_ e: Earnings) -> some View {
        LazyVGrid(columns: columns, spacing: 14) {
            MetricCard(
                title: e.inEscrowCount == 1 ? "In escrow · 1 milestone" : "In escrow · \(e.inEscrowCount) milestones",
                value: PaymentsView.money(e.inEscrowCents),
                icon: "lock.fill", tint: Theme.primary
            )
            MetricCard(
                title: "Platform fees",
                value: PaymentsView.money(e.lifetimeFeesCents),
                icon: "percent", tint: .orange
            )
        }
    }

    private func detailCard(_ e: Earnings) -> some View {
        RCCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(Theme.primary)
                    Text("Milestone funds are held in escrow until you submit the work and the homeowner releases them (or it auto-releases). Deposits settle to you right away.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if e.refundedCents > 0 {
                    Divider()
                    HStack {
                        Label("Refunded", systemImage: "arrow.uturn.backward")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(PaymentsView.money(e.refundedCents))
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .padding(18)
        }
    }

    private var historyLink: some View {
        NavigationLink {
            PaymentsView()
        } label: {
            HStack {
                Text("View all transactions")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
            }
            .foregroundStyle(Theme.primary)
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(Theme.primary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: - Load

    private func load() async {
        error = nil
        if earnings == nil { isLoading = true }
        defer { isLoading = false }
        do {
            earnings = try await APIService.shared.earnings()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
