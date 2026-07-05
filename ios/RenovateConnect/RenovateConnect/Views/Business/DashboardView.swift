import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var stats: DashboardStats?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showShare = false
    @State private var pro: ProStatus?
    @State private var proCheckoutURL: URL?
    @State private var proLoading = false
    @State private var showCancelPro = false
    @State private var showSubscribeConfirm = false
    @State private var showBoostConfirm = false
    @State private var boostError: String?

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

                    // Celebrate the verified badge — the contractor gets the
                    // "Verified Pros" featured spot and higher search placement.
                    if auth.currentUser?.business?.isVerified == true {
                        VerifiedStatusCard()
                    }

                    delistedBanner
                    verificationLink
                    shareProfileCard
                    proCard
                    boostCard
                    if let stats { boostPerformanceCard(stats) }
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
            .sheet(isPresented: $showShare) {
                if let business = auth.currentUser?.business {
                    ShareProfileView(business: business)
                }
            }
            .sheet(item: $proCheckoutURL, onDismiss: { Task { await loadPro() } }) { url in
                SafariView(url: url).ignoresSafeArea()
            }
            .alert("Manage subscription", isPresented: $showCancelPro) {
                Button("Cancel subscription", role: .destructive) { Task { await cancelPro() } }
                Button("Keep subscription", role: .cancel) {}
            } message: {
                Text("You'll stay listed until the end of your paid period, then your profile is hidden from homeowners until you re-subscribe.")
            }
            // CA Automatic-Renewal Law: the auto-renewal terms (price, interval,
            // how to cancel) must sit adjacent to the action that starts the
            // subscription — that's this confirmation, not a buried settings page.
            .confirmationDialog("RenovateConnect listing", isPresented: $showSubscribeConfirm, titleVisibility: .visible) {
                Button("Subscribe — $10/month") { Task { await startPro() } }
                Button("Not now", role: .cancel) {}
            } message: {
                Text(subscribeDisclosure)
            }
            .confirmationDialog("Boost your profile", isPresented: $showBoostConfirm, titleVisibility: .visible) {
                Button("Boost — $5 for 7 days") { Task { await startBoost() } }
                Button("Not now", role: .cancel) {}
            } message: {
                Text("A one-time $5 payment — no renewal. Your profile appears in the labeled “Boosted” row above search results for 7 days. Slots are limited per area, first come first served.")
            }
            .alert("Boost unavailable", isPresented: .init(
                get: { boostError != nil },
                set: { if !$0 { boostError = nil } }
            )) {
                Button("OK", role: .cancel) { boostError = nil }
            } message: {
                Text(boostError ?? "")
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

    // Urgent state: approved but the free month is over and there's no live
    // subscription — the profile is invisible to homeowners until they pay.
    @ViewBuilder
    private var delistedBanner: some View {
        if auth.currentUser?.business?.approvalStatus == .approved,
           let pro, !pro.isListed {
            RCCard {
                HStack(spacing: 14) {
                    Image(systemName: "eye.slash.fill")
                        .font(.title2).foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(Color.red.opacity(0.85)).clipShape(Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Your listing is hidden").font(.subheadline.weight(.semibold))
                        Text("Your free month has ended. Subscribe for $10/mo to get back in front of homeowners.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Button("Subscribe") { showSubscribeConfirm = true }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.borderedProminent)
                }
                .padding(16)
            }
        }
    }

    // Listing subscription status / upsell. One plan: $10/mo to be listed,
    // Market Insights included. The first month (from admin approval) is free.
    @ViewBuilder
    private var proCard: some View {
        if auth.currentUser?.business != nil {
            let isPro = pro?.isPro == true
            Button {
                if isPro { showCancelPro = true } else { showSubscribeConfirm = true }
            } label: {
                RCCard {
                    HStack(spacing: 14) {
                        Image(systemName: isPro ? "star.circle.fill" : "star.circle")
                            .font(.title2).foregroundStyle(Theme.gold)
                            .frame(width: 40, height: 40)
                            .background(Theme.gold.opacity(0.15)).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(isPro ? "Listing subscription" : "Keep your listing live")
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
        guard isPro else {
            if let freeEnds = pro?.freeListingEndsAt?.shortDate, pro?.isListed == true {
                return "Free month ends \(freeEnds). $10/mo after — includes Market Insights."
            }
            return "$10/mo to stay in search — includes Market Insights."
        }
        if pro?.isTrialing == true, let ends = pro?.trialEndsAt?.shortDate {
            return "Active · billing starts \(ends). Tap to manage."
        }
        return "Active · you're listed. Tap to manage."
    }

    // ARL-compliant disclosure shown adjacent to the Subscribe button.
    private var subscribeDisclosure: String {
        var lines = "Automatically renews at $10/month until you cancel. Cancel anytime here in the app (Dashboard → Listing subscription); your listing stays live through the period you've paid for. Includes Market Insights."
        if let freeEnds = pro?.freeListingEndsAt?.shortDate, pro?.isListed == true, pro?.isPro != true {
            lines += " Your free month is still active — billing starts \(freeEnds)."
        }
        return lines
    }

    // Boost upsell: a one-time $5 payment for 7 days in the labeled "Boosted"
    // row above search results. Slots are capped per city, first come.
    @ViewBuilder
    private var boostCard: some View {
        if auth.currentUser?.business != nil, pro?.isListed == true {
            Button { showBoostConfirm = true } label: {
                RCCard {
                    HStack(spacing: 14) {
                        Image(systemName: pro?.isBoosted == true ? "bolt.circle.fill" : "bolt.circle")
                            .font(.title2).foregroundStyle(Theme.primary)
                            .frame(width: 40, height: 40)
                            .background(Theme.primary.opacity(0.15)).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(pro?.isBoosted == true ? "You're boosted" : "Boost your profile")
                                .font(.subheadline.weight(.semibold))
                            Text(boostSubtitle)
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

    private var boostSubtitle: String {
        if pro?.isBoosted == true, let until = pro?.boostedUntil?.shortDate {
            return "Top of search until \(until). Tap to extend another week."
        }
        return "$5 one-time · 7 days at the top of search. Limited slots per area."
    }

    // Boost performance — the "is the $5 working?" card. Shown while a boost
    // is running or once it has ever collected numbers; impressions/clicks/CTR
    // come straight from the dashboard payload so they match the server.
    @ViewBuilder
    private func boostPerformanceCard(_ stats: DashboardStats) -> some View {
        if pro?.isBoosted == true || (stats.sponsoredImpressions ?? 0) > 0 {
            RCCard {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        Image(systemName: "bolt.fill")
                            .foregroundStyle(Theme.primary)
                        Text("Boost performance")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                    }

                    HStack(spacing: 0) {
                        sponsoredStat(value: "\((stats.sponsoredImpressions ?? 0).formatted())",
                                      label: "Times shown")
                        sponsoredStat(value: "\((stats.sponsoredClicks ?? 0).formatted())",
                                      label: "Profile opens")
                        sponsoredStat(value: ctrText(stats),
                                      label: "Open rate")
                    }

                    Text(sponsoredFooter(stats))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(16)
            }
        }
    }

    private func sponsoredStat(value: String, label: String) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.title3.monospacedDigit().weight(.semibold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func ctrText(_ stats: DashboardStats) -> String {
        guard let ctr = stats.sponsoredCtr, (stats.sponsoredImpressions ?? 0) > 0 else { return "—" }
        return "\(ctr.formatted())%"
    }

    private func sponsoredFooter(_ stats: DashboardStats) -> String {
        let impressions = stats.sponsoredImpressions ?? 0
        if impressions == 0 {
            return "Your Boost is live — numbers appear as homeowners search in your categories."
        }
        return "Counts across your Boost weeks. Profile opens are homeowners who tapped your Boosted card."
    }

    // Market Insights — included with the listing subscription.
    @ViewBuilder
    private var insightsLink: some View {
        if pro?.isPro == true {
            NavigationLink {
                InsightsView()
            } label: {
                RCCard {
                    HStack(spacing: 14) {
                        Image(systemName: "chart.bar.xaxis")
                            .font(.title2).foregroundStyle(.teal)
                            .frame(width: 40, height: 40)
                            .background(Color.teal.opacity(0.15)).clipShape(Circle())
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
        await loadPro()
    }

    private func loadPro() async {
        pro = try? await APIService.shared.proStatus()
    }

    private func startPro() async {
        proLoading = true
        defer { proLoading = false }
        proCheckoutURL = try? await APIService.shared.proSubscribeURL()
    }

    private func startBoost() async {
        proLoading = true
        defer { proLoading = false }
        do {
            proCheckoutURL = try await APIService.shared.boostURL()
        } catch {
            // Surfaces the 409s ("slots full in your area", "subscribe first")
            // with the server's message rather than failing silently.
            boostError = error.localizedDescription
        }
    }

    private func cancelPro() async {
        try? await APIService.shared.cancelPro()
        await loadPro()
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
