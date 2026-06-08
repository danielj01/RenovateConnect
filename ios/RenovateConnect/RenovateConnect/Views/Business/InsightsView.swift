import SwiftUI

/// Pro Insights ($10 tier): aggregated, de-identified market demand + the
/// contractor's own performance. Every figure is a group of at least
/// `minBucket`; nothing here identifies an individual homeowner.
struct InsightsView: View {
    @State private var insights: ProInsights?
    @State private var isLoading = true
    @State private var error: String?

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if isLoading && insights == nil {
                    ProgressView().padding(.top, 80)
                } else if let e = insights {
                    privacyNote(e)
                    performanceGrid(e.performance)
                    demandSection("Demand by category", icon: "tag.fill", buckets: e.demandByCategory,
                                  empty: "Not enough activity yet to show category demand.")
                    demandSection("Demand by project type", icon: "square.grid.2x2.fill", buckets: e.demandByProjectType,
                                  empty: "Not enough estimates yet to show project-type demand.")
                    demandSection("Demand by area", icon: "mappin.and.ellipse", buckets: e.demandByArea,
                                  empty: "Not enough activity yet to show area demand.")
                } else if let error {
                    ContentUnavailableState(error: error) { await load() }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Insights")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func privacyNote(_ e: ProInsights) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield.fill").foregroundStyle(Theme.primary)
            Text("Market trends only — aggregated and anonymized. Every figure groups at least \(e.minBucket) people; we never show individual homeowner data.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
    }

    private func performanceGrid(_ p: InsightsPerformance) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your performance").font(.headline)
            LazyVGrid(columns: columns, spacing: 14) {
                MetricCard(title: "Impressions", value: "\(p.searchImpressions)", icon: "magnifyingglass", tint: .teal)
                MetricCard(title: "Profile Views", value: "\(p.profileViews)", icon: "eye.fill", tint: .blue)
                MetricCard(title: "Leads", value: "\(p.totalLeads)", icon: "person.2.fill", tint: Theme.primary)
                MetricCard(title: "Conversion", value: "\(p.conversionRate)%", icon: "chart.line.uptrend.xyaxis", tint: .green)
            }
        }
    }

    @ViewBuilder
    private func demandSection(_ title: String, icon: String, buckets: [DemandBucket], empty: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.headline)
            RCCard {
                if buckets.isEmpty {
                    Text(empty).font(.caption).foregroundStyle(.secondary).padding(16)
                } else {
                    let maxCount = buckets.map(\.count).max() ?? 1
                    VStack(spacing: 12) {
                        ForEach(buckets) { b in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Text(b.label).font(.subheadline.weight(.medium))
                                    Spacer()
                                    Text("\(b.count)").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                                }
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Color(.systemGray5)).frame(height: 8)
                                        Capsule().fill(Theme.primary)
                                            .frame(width: max(8, geo.size.width * CGFloat(b.count) / CGFloat(maxCount)), height: 8)
                                    }
                                }
                                .frame(height: 8)
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
    }

    private func load() async {
        error = nil
        if insights == nil { isLoading = true }
        defer { isLoading = false }
        do {
            insights = try await APIService.shared.proInsights()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
