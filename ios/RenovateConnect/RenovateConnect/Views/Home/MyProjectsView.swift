import SwiftUI

/// Homeowner "return hub": one place to come back to saved contractors and
/// past AI estimates. Estimates carry a "find contractors" CTA so an estimate
/// can convert into a lead — the core retention → revenue loop.
struct MyProjectsView: View {
    enum Segment: String, CaseIterable, Identifiable {
        case saved = "Saved"
        case estimates = "Estimates"
        var id: String { rawValue }
    }

    @EnvironmentObject private var favorites: FavoritesStore
    @EnvironmentObject private var router: TabRouter
    @Environment(\.dismiss) private var dismiss
    @State private var segment: Segment = .saved
    @State private var estimations: [Estimation] = []
    @State private var loadingEstimates = true

    var body: some View {
        VStack(spacing: 0) {
            Picker("View", selection: $segment) {
                ForEach(Segment.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            ScrollView {
                switch segment {
                case .saved: savedSection
                case .estimates: estimatesSection
                }
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("My Projects")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await favorites.refresh()
            await favorites.refreshDigestBadge()
            await loadEstimates()
        }
        .refreshable {
            await favorites.refresh()
            await favorites.refreshDigestBadge()
            await loadEstimates()
        }
    }

    // MARK: - Saved contractors

    @ViewBuilder
    private var savedSection: some View {
        if favorites.businesses.isEmpty {
            ContentUnavailableView {
                Label("No saved contractors", systemImage: "heart")
            } description: {
                Text("Tap the heart on a contractor to save them here for later.")
            } actions: {
                Button {
                    goToTab(TabRouter.explore)
                } label: {
                    Text("Explore contractors").fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.primary)
            }
            .padding(.top, 60)
        } else {
            LazyVStack(spacing: 12) {
                digestBanner
                ForEach(favorites.businesses) { biz in
                    NavigationLink(destination: BusinessDetailView(businessId: biz.id)) {
                        BusinessListCard(business: biz)
                            .padding(.horizontal, 16)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 40)
        }
    }

    /// Entry point to the "what's new with your saved pros" digest, with an
    /// unread badge. Shown above the saved list so updates are the first thing
    /// a returning homeowner sees.
    @ViewBuilder
    private var digestBanner: some View {
        NavigationLink(destination: FavoritesDigestView()) {
            RCCard {
                HStack(spacing: 12) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "sparkles")
                            .foregroundStyle(Theme.primary)
                            .frame(width: 28)
                        if favorites.digestUnseen > 0 {
                            Circle().fill(Color.red).frame(width: 8, height: 8).offset(x: 6, y: -4)
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Updates from saved pros").font(.subheadline).foregroundStyle(.primary)
                        Text(favorites.digestUnseen > 0
                             ? "\(favorites.digestUnseen) new update\(favorites.digestUnseen == 1 ? "" : "s")"
                             : "New projects & reviews show up here")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Past estimates

    @ViewBuilder
    private var estimatesSection: some View {
        if loadingEstimates {
            ProgressView().padding(.top, 60)
        } else if estimations.isEmpty {
            ContentUnavailableView {
                Label("No estimates yet", systemImage: "camera.viewfinder")
            } description: {
                Text("Snap a photo of your space to get an instant AI cost breakdown.")
            } actions: {
                Button {
                    goToTab(TabRouter.estimate)
                } label: {
                    Text("Get an estimate").fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.primary)
            }
            .padding(.top, 60)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(estimations) { est in
                    EstimateSummaryCard(estimation: est)
                        .padding(.horizontal, 16)
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 40)
        }
    }

    /// Pop back to the Profile root, then switch to the target tab so the user
    /// lands cleanly on Explore/Estimate rather than behind the pushed hub.
    private func goToTab(_ tab: Int) {
        dismiss()
        router.selection = tab
    }

    private func loadEstimates() async {
        loadingEstimates = true
        defer { loadingEstimates = false }
        estimations = (try? await APIService.shared.myEstimations()) ?? []
    }
}

// MARK: - Estimate card

private struct EstimateSummaryCard: View {
    let estimation: Estimation

    private var totalRange: String {
        let lo = Int(estimation.result.totalLow)
        let hi = Int(estimation.result.totalHigh)
        return "$\(lo.formatted()) – $\(hi.formatted())"
    }

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(estimation.roomType ?? "Estimate", systemImage: "camera.viewfinder")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                    Spacer()
                    Text(estimation.createdAt.shortDate)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(estimation.result.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)

                HStack {
                    Text(totalRange)
                        .font(.title3.bold())
                    Spacer()
                    Text(estimation.result.confidence.capitalized + " confidence")
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.primaryLight)
                        .foregroundStyle(Theme.primary)
                        .clipShape(Capsule())
                }

                Divider()

                // The conversion CTA: turn an estimate into a contractor search.
                NavigationLink(destination: ContractorsForEstimateView(specialty: estimation.roomType)) {
                    HStack {
                        Label("Find contractors for this estimate", systemImage: "magnifyingglass")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(16)
        }
    }
}

// MARK: - Contractors for an estimate

/// Lands the homeowner on a contractor list pre-filtered by the estimate's
/// room type (used as a specialty filter), the natural next step after pricing.
struct ContractorsForEstimateView: View {
    let specialty: String?
    @State private var businesses: [Business] = []
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().padding(.top, 60)
            } else if businesses.isEmpty {
                ContentUnavailableView(
                    "No contractors found",
                    systemImage: "building.2",
                    description: Text("We couldn't find contractors matching this project yet.")
                )
                .padding(.top, 60)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(businesses) { biz in
                        NavigationLink(destination: BusinessDetailView(businessId: biz.id)) {
                            BusinessListCard(business: biz)
                                .padding(.horizontal, 16)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(specialty.map { "\($0) Pros" } ?? "Contractors")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        let resp = try? await APIService.shared.searchBusinesses(specialty: specialty)
        businesses = resp?.businesses ?? []
    }
}

// MARK: - Helpers

private extension String {
    /// Format an ISO-8601 createdAt timestamp as a short local date.
    var shortDate: String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: self) ?? ISO8601DateFormatter().date(from: self)
        guard let date else { return "" }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        return fmt.string(from: date)
    }
}
