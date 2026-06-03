import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var stats: DashboardStats?
    @State private var isLoading = true
    @State private var error: String?

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header

                    if isLoading {
                        ProgressView().padding(.top, 60)
                    } else if let stats {
                        metricsGrid(stats)
                        pipelineCard(stats)
                        promoCard(stats)
                    } else if let error {
                        ContentUnavailableState(error: error) { await load() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { ActivityBellButton() }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var header: some View {
        ZStack(alignment: .leading) {
            Theme.gradient
            VStack(alignment: .leading, spacing: 6) {
                Text("Welcome back")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.85))
                Text(auth.currentUser?.business?.companyName ?? auth.currentUser?.name ?? "Your business")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func metricsGrid(_ s: DashboardStats) -> some View {
        LazyVGrid(columns: columns, spacing: 14) {
            MetricCard(title: "Impressions", value: "\(s.searchImpressions)", icon: "magnifyingglass", tint: .teal)
            MetricCard(title: "Profile Views", value: "\(s.profileViews)", icon: "eye.fill", tint: .blue)
            MetricCard(title: "Total Leads", value: "\(s.totalLeads)", icon: "person.2.fill", tint: Theme.primary)
            MetricCard(title: "Conversion", value: "\(s.conversionRate)%", icon: "chart.line.uptrend.xyaxis", tint: .green)
            MetricCard(title: "Rating", value: String(format: "%.1f", s.averageRating), icon: "star.fill", tint: Theme.gold)
            MetricCard(title: "Won Value", value: "$\(s.wonValue.formatted())", icon: "checkmark.seal.fill", tint: .green)
            MetricCard(title: "Pipeline", value: "$\(s.pipelineValue.formatted())", icon: "tray.full.fill", tint: .purple)
        }
    }

    private func pipelineCard(_ s: DashboardStats) -> some View {
        RCCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("Lead Pipeline").font(.headline)
                ForEach(LeadStatus.allCases) { status in
                    let count = s.leadsByStatus.count(for: status)
                    let fraction = s.totalLeads == 0 ? 0 : Double(count) / Double(s.totalLeads)
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Label(status.label, systemImage: status.systemImage)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(color(for: status))
                            Spacer()
                            Text("\(count)").font(.subheadline.weight(.semibold))
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color(.systemGray5)).frame(height: 8)
                                Capsule().fill(color(for: status))
                                    .frame(width: max(8, geo.size.width * fraction), height: 8)
                            }
                        }
                        .frame(height: 8)
                    }
                }
            }
            .padding(18)
        }
    }

    private func promoCard(_ s: DashboardStats) -> some View {
        NavigationLink {
            BillingView()
        } label: {
            RCCard {
                HStack(spacing: 14) {
                    Image(systemName: s.isPromoted ? "bolt.fill" : "bolt.slash.fill")
                        .font(.title2)
                        .foregroundStyle(s.isPromoted ? Theme.gold : .secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(s.isPromoted ? "Promoted listing active" : "Billing & promotion")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Text(s.isPromoted
                             ? "You appear at the top of search results."
                             : "Add a card, view lead fees, and get promoted.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(18)
            }
        }
        .buttonStyle(.plain)
    }

    private func color(for status: LeadStatus) -> Color {
        switch status {
        case .new: return Theme.primary
        case .contacted: return .blue
        case .converted: return .green
        case .closed: return .gray
        }
    }

    private func load() async {
        error = nil
        if stats == nil { isLoading = true }
        defer { isLoading = false }
        do {
            stats = try await APIService.shared.dashboard()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Metric card

struct MetricCard: View {
    let title: String
    let value: String
    let icon: String
    let tint: Color

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 36, height: 36)
                    .background(tint.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Text(value)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(title)
                    .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }
}

// MARK: - Error/empty helper

struct ContentUnavailableState: View {
    let error: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle).foregroundStyle(.secondary)
            Text(error).font(.callout).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try Again") { Task { await retry() } }
                .buttonStyle(.bordered)
        }
        .padding(.top, 60)
    }
}
