import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var stats: DashboardStats?
    @State private var isLoading = true
    @State private var error: String?
    @State private var payouts: ConnectStatus?
    @State private var onboardURL: URL?
    @State private var onboardLoading = false
    @State private var showShare = false
    @State private var pro: ProStatus?
    @State private var proCheckoutURL: URL?
    @State private var proLoading = false
    @State private var showCancelPro = false
    @State private var showPlanDialog = false

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header

                    // Surfaces the admin approval status. PENDING/REJECTED listings
                    // are hidden from public search, so we tell the owner why.
                    if let status = auth.currentUser?.business?.approvalStatus, status != .approved {
                        ApprovalStatusBanner(
                            status: status,
                            reason: auth.currentUser?.business?.rejectionReason
                        )
                    }

                    // Payouts gate all in-app deposits. Nudge the contractor to
                    // finish Stripe Connect setup until it's enabled.
                    if let payouts, !payouts.payoutsEnabled {
                        PayoutSetupBanner(
                            onboarded: payouts.onboarded,
                            isLoading: onboardLoading
                        ) { await startOnboarding() }
                    }

                    // Celebrate the verified badge — the contractor gets the
                    // "Verified Pros" featured spot and higher search placement.
                    if auth.currentUser?.business?.isVerified == true {
                        VerifiedStatusCard()
                    }

                    earningsLink
                    verificationLink
                    shareProfileCard
                    proCard
                    insightsLink

                    if isLoading {
                        ProgressView().padding(.top, 60)
                    } else if let stats {
                        metricsGrid(stats)
                        pipelineCard(stats)
                    } else if let error {
                        ContentUnavailableState(error: error) { await load() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .background(Color(.systemBackground))
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if auth.currentUser?.business != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showShare = true } label: {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel("Share your profile")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    ActivityBellButton()
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $onboardURL, onDismiss: { Task { await loadPayouts() } }) { url in
                SafariView(url: url).ignoresSafeArea()
            }
            .sheet(isPresented: $showShare) {
                if let business = auth.currentUser?.business {
                    ShareProfileView(business: business)
                }
            }
            .sheet(item: $proCheckoutURL, onDismiss: { Task { await loadPro() } }) { url in
                SafariView(url: url).ignoresSafeArea()
            }
            .alert("Manage Pro", isPresented: $showCancelPro) {
                Button("Cancel subscription", role: .destructive) { Task { await cancelPro() } }
                Button("Keep Pro", role: .cancel) {}
            } message: {
                Text("You'll keep Pro until the end of your current period, then stop being featured.")
            }
            .confirmationDialog("Choose your plan", isPresented: $showPlanDialog, titleVisibility: .visible) {
                Button("Sponsored — $5/mo") { Task { await startPro(plan: "sponsored") } }
                Button("Insights — $10/mo") { Task { await startPro(plan: "insights") } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Both include the Sponsored search slot and a 3-month free trial. Insights adds aggregated market demand data.")
            }
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

    // Entry point to the verification center — license + insurance uploads.
    @ViewBuilder
    private var verificationLink: some View {
        if let business = auth.currentUser?.business {
            NavigationLink {
                VerificationCenterView(businessId: business.id)
            } label: {
                RCCard {
                    HStack(spacing: 14) {
                        let verified = business.isVerified
                        Image(systemName: verified ? "checkmark.seal.fill" : "checkmark.shield")
                            .font(.title2)
                            .foregroundStyle(verified ? Theme.success : Theme.primary)
                            .frame(width: 40, height: 40)
                            .background((verified ? Theme.success : Theme.primary).opacity(0.15))
                            .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(verified ? "You're verified" : "Get verified")
                                .font(.subheadline.weight(.semibold))
                            Text(verified
                                 ? "Manage your license and insurance documents."
                                 : "Upload your license and insurance to earn the Verified badge.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .padding(16)
                }
            }
            .buttonStyle(.plain)
        }
    }

    // Entry point to the full earnings breakdown (released vs. in escrow).
    private var earningsLink: some View {
        NavigationLink {
            EarningsView()
        } label: {
            RCCard {
                HStack(spacing: 14) {
                    Image(systemName: "dollarsign.circle.fill")
                        .font(.title2).foregroundStyle(.green)
                        .frame(width: 40, height: 40)
                        .background(Color.green.opacity(0.15)).clipShape(Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Earnings").font(.subheadline.weight(.semibold))
                        Text("See what you've been paid and what's held in escrow.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                .padding(16)
            }
        }
        .buttonStyle(.plain)
    }

    // Growth loop: every contractor who shares becomes a demand channel.
    @ViewBuilder
    private var shareProfileCard: some View {
        if auth.currentUser?.business != nil {
            Button { showShare = true } label: {
                RCCard {
                    HStack(spacing: 14) {
                        Image(systemName: "square.and.arrow.up.circle.fill")
                            .font(.title2).foregroundStyle(Theme.primary)
                            .frame(width: 40, height: 40)
                            .background(Theme.primary.opacity(0.15)).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Share your profile").font(.subheadline.weight(.semibold))
                            Text("Get a link + QR code for your site, Instagram, and cards to win more clients.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .padding(16)
                }
            }
            .buttonStyle(.plain)
        }
    }

    // Pro upsell / status. Subscribers appear in the clearly-labeled "Sponsored"
    // slot in search. $5/mo with a 90-day free trial.
    @ViewBuilder
    private var proCard: some View {
        if auth.currentUser?.business != nil {
            let isPro = pro?.isPro == true
            Button {
                if isPro { showCancelPro = true } else { showPlanDialog = true }
            } label: {
                RCCard {
                    HStack(spacing: 14) {
                        Image(systemName: isPro ? "star.circle.fill" : "star.circle")
                            .font(.title2).foregroundStyle(Theme.gold)
                            .frame(width: 40, height: 40)
                            .background(Theme.gold.opacity(0.15)).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(isPro ? "RenovateConnect Pro" : "Get featured in search")
                                .font(.subheadline.weight(.semibold))
                            Text(proSubtitle(isPro))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        if proLoading {
                            ProgressView()
                        } else {
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(16)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func proSubtitle(_ isPro: Bool) -> String {
        guard isPro else { return "Get featured + market insights. From $5/mo · 3 months free." }
        let tier = pro?.insights == true ? "Insights" : "Sponsored"
        if pro?.isTrialing == true, let ends = pro?.trialEndsAt?.shortDate {
            return "\(tier) · free trial, renews \(ends). Tap to manage."
        }
        return "\(tier) · active. Tap to manage."
    }

    // Insights tier ($10) gets a dedicated market-data screen.
    @ViewBuilder
    private var insightsLink: some View {
        if pro?.insights == true {
            NavigationLink {
                InsightsView()
            } label: {
                RCCard {
                    HStack(spacing: 14) {
                        Image(systemName: "chart.bar.xaxis")
                            .font(.title2).foregroundStyle(.purple)
                            .frame(width: 40, height: 40)
                            .background(Color.purple.opacity(0.15)).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Market Insights").font(.subheadline.weight(.semibold))
                            Text("See aggregated demand by category, project type, and area.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    .padding(16)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func metricsGrid(_ s: DashboardStats) -> some View {
        LazyVGrid(columns: columns, spacing: 14) {
            MetricCard(title: "Impressions", value: "\(s.searchImpressions)", icon: "magnifyingglass", tint: .teal)
            MetricCard(title: "Profile Views", value: "\(s.profileViews)", icon: "eye.fill", tint: .blue)
            MetricCard(title: "Total Leads", value: "\(s.totalLeads)", icon: "person.2.fill", tint: Theme.primary)
            MetricCard(title: "Conversion", value: "\(s.conversionRate)%", icon: "chart.line.uptrend.xyaxis", tint: .green)
            MetricCard(title: "Rating", value: String(format: "%.1f", s.averageRating), icon: "star.fill", tint: Theme.gold)
            MetricCard(title: "Won Value", value: "$\(s.wonValue.formatted())", icon: "checkmark.seal.fill", tint: .green)
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
        await loadPayouts()
        await loadPro()
    }

    private func loadPayouts() async {
        payouts = try? await APIService.shared.connectStatus()
    }

    private func loadPro() async {
        pro = try? await APIService.shared.proStatus()
    }

    private func startPro(plan: String) async {
        proLoading = true
        defer { proLoading = false }
        proCheckoutURL = try? await APIService.shared.proSubscribeURL(plan: plan)
    }

    private func cancelPro() async {
        try? await APIService.shared.cancelPro()
        await loadPro()
    }

    private func startOnboarding() async {
        onboardLoading = true
        defer { onboardLoading = false }
        onboardURL = try? await APIService.shared.connectOnboardURL()
    }
}

private extension String {
    /// ISO-8601 timestamp → short local date ("Sep 3, 2026"), or nil.
    var shortDate: String? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: self) ?? ISO8601DateFormatter().date(from: self) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
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

// MARK: - Approval status banner

/// Inline banner shown on the dashboard while a listing is awaiting admin
/// approval or has been rejected. Tells the owner that homeowners can't see
/// them in search yet, and surfaces the admin's rejection reason if any.
struct ApprovalStatusBanner: View {
    let status: ApprovalStatus
    let reason: String?

    private var tint: Color {
        status == .rejected ? .orange : .blue
    }

    private var headline: String {
        switch status {
        case .pending: return "Awaiting admin review"
        case .rejected: return "Needs changes before going live"
        case .approved: return "Live"
        }
    }

    private var body1: String {
        switch status {
        case .pending: return "Your listing is in the review queue. Homeowners won't see it in search until an admin approves it."
        case .rejected: return reason ?? "An admin asked for changes. Update your profile and it'll go back into the review queue."
        case .approved: return ""
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: status.systemImage)
                .font(.title3).foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(tint.opacity(0.15)).clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(headline).font(.subheadline.weight(.semibold))
                Text(body1).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(tint.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Payout setup banner

/// Dashboard nudge shown until the contractor finishes Stripe Connect payout
/// setup. Without it homeowners can't pay deposits, so it's the gate on all
/// in-app revenue. Tapping it opens hosted onboarding directly.
struct PayoutSetupBanner: View {
    let onboarded: Bool
    let isLoading: Bool
    let action: () async -> Void

    private let tint = Theme.primary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "building.columns.fill")
                    .font(.title3).foregroundStyle(tint)
                    .frame(width: 36, height: 36)
                    .background(tint.opacity(0.15)).clipShape(Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(onboarded ? "Finish payout setup" : "Set up payouts to get paid")
                        .font(.subheadline.weight(.semibold))
                    Text("Homeowners can't pay deposits until you connect a payout account. Powered by Stripe.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            Button {
                Task { await action() }
            } label: {
                HStack(spacing: 8) {
                    if isLoading { ProgressView().tint(.white) }
                    Text(onboarded ? "Finish setup" : "Set up payouts")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 38)
            }
            .buttonStyle(.borderedProminent)
            .tint(tint)
            .disabled(isLoading)
        }
        .padding(14)
        .background(tint.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Verified status card

/// Celebratory dashboard card shown to verified contractors. Mirrors the trust
/// badge homeowners see, and tells the owner what verification earns them:
/// a spot in the "Verified Pros" carousel and higher search placement.
struct VerifiedStatusCard: View {
    private let tint = VerifiedBadge.trust

    var body: some View {
        RCCard {
            HStack(spacing: 14) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.title2).foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.15)).clipShape(Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text("Verified by RenovateConnect")
                        .font(.subheadline.weight(.semibold))
                    Text("You're featured in Verified Pros and rank ahead of unverified contractors in search.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16).stroke(tint.opacity(0.3), lineWidth: 1)
        )
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
