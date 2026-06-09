import SwiftUI

struct BusinessDetailView: View {
    let businessId: String
    /// When opened from the post-release "leave a review" nudge, auto-present the
    /// review composer once the business has loaded.
    var autoPresentReview: Bool = false
    @State private var business: Business?
    @State private var isLoading = true
    @State private var showContact = false
    @State private var showBooking = false
    @State private var showQuote = false
    @State private var showReview = false
    @State private var didAutoPresentReview = false
    @State private var showHoursEditor = false
    @State private var respondingTo: Review?
    @State private var verifying = false
    @State private var showReportSheet = false
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var favorites: FavoritesStore

    /// The current homeowner's own review of this business, if any.
    private var myReview: Review? {
        guard let uid = auth.currentUser?.id else { return nil }
        return business?.reviews?.first { $0.authorId == uid }
    }

    /// Homeowners — and signed-out guests previewing the app — see the contact /
    /// quote / book / save affordances. Guests get a sign-in prompt on tap.
    private var canActAsClient: Bool {
        !auth.isBusiness && !auth.isAdmin
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let biz = business {
                ScrollView {
                    VStack(spacing: 0) {
                        heroSection(biz)
                        statsRow(biz)
                        contentSection(biz)
                    }
                }
                .ignoresSafeArea(edges: .top)
                .safeAreaInset(edge: .bottom) {
                    if canActAsClient {
                        contactButton(biz)
                    }
                }
                .sheet(isPresented: $showContact) {
                    if let biz = business {
                        ContactBusinessSheet(business: biz)
                            .environmentObject(auth)
                    }
                }
                .sheet(isPresented: $showBooking) {
                    if let biz = business {
                        BookAppointmentSheet(business: biz)
                    }
                }
                .sheet(isPresented: $showQuote) {
                    if let biz = business {
                        RequestQuoteSheet(business: biz)
                    }
                }
                .sheet(isPresented: $showReview) {
                    if let biz = business {
                        WriteReviewSheet(businessId: biz.id, businessName: biz.companyName,
                                         existing: myReview) {
                            await load()
                        }
                    }
                }
                .sheet(item: $respondingTo) { review in
                    ReviewResponseSheet(review: review) { await load() }
                }
                .sheet(isPresented: $showHoursEditor) {
                    if let biz = business {
                        BusinessHoursEditorView(businessId: biz.id, existing: biz.hours ?? []) {
                            await load()
                        }
                    }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canActAsClient, let biz = business {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        if auth.isLoggedIn { favorites.toggle(biz) } else { auth.requireSignIn() }
                    } label: {
                        Image(systemName: favorites.isSaved(biz.id) ? "heart.fill" : "heart")
                            .foregroundStyle(favorites.isSaved(biz.id) ? Theme.primary : Color(.label))
                    }
                    .accessibilityLabel(favorites.isSaved(biz.id) ? "Remove from saved" : "Save contractor")
                }
            }
            if business != nil, auth.isLoggedIn {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(role: .destructive) {
                            showReportSheet = true
                        } label: {
                            Label("Report this business", systemImage: "flag")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(Color(.label))
                    }
                    .accessibilityLabel("More options")
                }
            }
        }
        .sheet(isPresented: $showReportSheet) {
            if let biz = business {
                ReportSheet(targetType: .business, targetId: biz.id)
            }
        }
        .task { await load() }
    }

    // MARK: - Hero

    @ViewBuilder
    private func heroSection(_ biz: Business) -> some View {
        ZStack(alignment: .bottomLeading) {
            Theme.gradient
                .frame(height: 220)

            VStack(alignment: .leading, spacing: 10) {
                BusinessAvatar(name: biz.companyName, logoUrl: biz.logoUrl,
                               size: 72, cornerRadius: 18)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(.white.opacity(0.4), lineWidth: 2)
                    )
                    .shadow(color: .black.opacity(0.2), radius: 8, y: 4)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(biz.companyName)
                            .font(.title2.bold())
                            .foregroundStyle(.white)
                        if biz.isVerified { VerifiedBadge() }
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "mappin.circle.fill").font(.caption)
                        Text("\(biz.city), \(biz.state)").font(.subheadline)
                    }
                    .foregroundStyle(.white.opacity(0.85))
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    // MARK: - Stats row

    @ViewBuilder
    private func statsRow(_ biz: Business) -> some View {
        HStack(spacing: 0) {
            StatCell(value: String(format: "%.1f", biz.averageRating),
                     label: "Rating", icon: "star.fill", iconColor: Theme.gold)
            Divider().frame(height: 40)
            StatCell(value: "\(biz.reviewCount)",
                     label: "Reviews", icon: "bubble.left.fill", iconColor: Theme.primary)
            Divider().frame(height: 40)
            StatCell(value: "\(biz.yearsInBusiness)",
                     label: "Yrs exp.", icon: "briefcase.fill", iconColor: Theme.info)
        }
        .padding(.vertical, 16)
        .background(Color(.systemBackground))
        .shadow(color: Theme.cardShadow, radius: 8, y: 3)
    }

    // MARK: - Main content

    @ViewBuilder
    private func contentSection(_ biz: Business) -> some View {
        VStack(alignment: .leading, spacing: 16) {

            // Admin-only verification control. Verifying grants the trust badge
            // and sorts the business ahead of unverified ones in search.
            if auth.isAdmin {
                adminVerifyCard(biz)
            }

            // About
            RCCard {
                VStack(alignment: .leading, spacing: 10) {
                    Label("About", systemImage: "info.circle.fill")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                    Text(biz.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineSpacing(4)
                }
                .padding(16)
            }

            // Trust & credentials — shown when verified, licensed, or able to
            // accept secured in-app payments.
            if biz.isVerified || (biz.licenseNumber?.isEmpty == false) || (biz.payoutsEnabled == true) {
                RCCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Trust & Credentials", systemImage: "checkmark.shield.fill")
                            .font(.headline)
                            .foregroundStyle(VerifiedBadge.trust)

                        if biz.isVerified {
                            HStack(spacing: 10) {
                                Image(systemName: "checkmark.seal.fill")
                                    .foregroundStyle(VerifiedBadge.trust)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Verified by RenovateConnect")
                                        .font(.subheadline.weight(.semibold))
                                    if let checked = biz.verifiedAt?.verifiedDateText {
                                        Text("Checked \(checked)")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        if let license = biz.licenseNumber, !license.isEmpty {
                            HStack(spacing: 10) {
                                Image(systemName: "doc.text.fill")
                                    .foregroundStyle(Theme.primary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("License").font(.subheadline.weight(.semibold))
                                    Text(license).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }

                        if biz.payoutsEnabled == true {
                            HStack(spacing: 10) {
                                Image(systemName: "lock.shield.fill")
                                    .foregroundStyle(Theme.success)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Accepts in-app payments")
                                        .font(.subheadline.weight(.semibold))
                                    Text("Pay a secured deposit through RenovateConnect")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .padding(16)
                }
            }

            // Specialties
            if !biz.specialties.isEmpty {
                RCCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Specialties", systemImage: "wrench.and.screwdriver.fill")
                            .font(.headline)
                            .foregroundStyle(Theme.primary)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))], spacing: 8) {
                            ForEach(biz.specialties, id: \.self) { SpecialtyTag(text: $0) }
                        }
                    }
                    .padding(16)
                }
            }

            // Business hours
            hoursSection(biz)

            // Portfolio
            if let projects = biz.portfolio, !projects.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Recent Projects", systemImage: "photo.stack.fill")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                    ForEach(projects) { project in
                        PortfolioCard(project: project)
                    }
                }
            }

            // Website
            if let site = biz.website, let url = URL(string: site) {
                RCCard {
                    Link(destination: url) {
                        HStack {
                            Label("Visit Website", systemImage: "globe")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Theme.primary)
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(16)
                    }
                }
            }

            // Reviews
            reviewsSection(biz)

            Spacer(minLength: 90)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .background(Color(.systemBackground))
    }

    // MARK: - Admin verification

    @ViewBuilder
    private func adminVerifyCard(_ biz: Business) -> some View {
        let verified = biz.isVerified
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Admin Controls", systemImage: "checkmark.shield.fill")
                    .font(.headline)
                    .foregroundStyle(VerifiedBadge.trust)

                HStack(spacing: 10) {
                    Image(systemName: verified ? "checkmark.seal.fill" : "seal")
                        .foregroundStyle(verified ? VerifiedBadge.trust : .secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verified ? "Verified" : "Not verified")
                            .font(.subheadline.weight(.semibold))
                        Text(verified
                             ? "Shows the trust badge and ranks ahead of unverified listings in search."
                             : "Verifying grants the trust badge and boosts search placement.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }

                Button {
                    Task { await setVerified(!verified, on: biz) }
                } label: {
                    HStack(spacing: 8) {
                        if verifying { ProgressView().tint(.white) }
                        Text(verified ? "Remove verification" : "Verify business")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 38)
                }
                .buttonStyle(.borderedProminent)
                .tint(verified ? Color(.systemGray) : VerifiedBadge.trust)
                .disabled(verifying)
            }
            .padding(16)
        }
    }

    private func setVerified(_ verified: Bool, on biz: Business) async {
        verifying = true
        defer { verifying = false }
        // Refetch so the badge, hero, and trust card all reflect the new state.
        _ = try? await APIService.shared.adminVerifyBusiness(id: biz.id, verified: verified)
        await load()
    }

    // MARK: - Reviews

    @ViewBuilder
    private func reviewsSection(_ biz: Business) -> some View {
        let reviews = biz.reviews ?? []
        let isClient = auth.currentUser?.role == .client
        let isOwner = auth.myBusinessId == biz.id

        if !reviews.isEmpty || isClient {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Reviews", systemImage: "star.bubble.fill")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                    Spacer()
                    if isClient {
                        Button {
                            showReview = true
                        } label: {
                            Label(myReview == nil ? "Write a review" : "Edit your review",
                                  systemImage: myReview == nil ? "square.and.pencil" : "pencil")
                                .font(.subheadline.weight(.semibold))
                        }
                        .tint(Theme.primary)
                    }
                }
                .padding(.horizontal, 16)

                if reviews.isEmpty {
                    Text("No reviews yet. Be the first to share your experience.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                } else {
                    ForEach(reviews) { review in
                        RCCard {
                            ReviewCard(
                                review: review,
                                companyName: biz.companyName,
                                isOwner: isOwner,
                                onRespond: isOwner ? { respondingTo = review } : nil
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Business hours

    @ViewBuilder
    private func hoursSection(_ biz: Business) -> some View {
        let hours = biz.hours ?? []
        let isOwner = auth.myBusinessId == biz.id

        // Show the card when hours exist, or when the owner can add them.
        if !hours.isEmpty || isOwner {
            RCCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label("Hours", systemImage: "clock.fill")
                            .font(.headline)
                            .foregroundStyle(Theme.primary)
                        Spacer()
                        if hours.isEmpty {
                            if isOwner {
                                Button("Set hours") { showHoursEditor = true }
                                    .font(.subheadline.weight(.semibold))
                                    .tint(Theme.primary)
                            }
                        } else {
                            OpenStatusPill(isOpen: Self.isOpenNow(hours))
                        }
                    }

                    if hours.isEmpty {
                        Text("No hours posted yet.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    } else {
                        let todayIdx = Self.currentWeekday()
                        ForEach(hours.sorted { $0.dayOfWeek < $1.dayOfWeek }, id: \.dayOfWeek) { row in
                            HStack {
                                Text(row.dayName)
                                    .font(.subheadline.weight(row.dayOfWeek == todayIdx ? .bold : .regular))
                                Spacer()
                                Text(row.rangeText)
                                    .font(.subheadline)
                                    .foregroundStyle(row.closed ? .secondary : .primary)
                            }
                        }

                        if isOwner {
                            Button {
                                showHoursEditor = true
                            } label: {
                                Label("Edit hours", systemImage: "pencil")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .tint(Theme.primary)
                            .padding(.top, 2)
                        }
                    }
                }
                .padding(16)
            }
        }
    }

    /// Local-time weekday index (0 = Sunday … 6 = Saturday) matching dayOfWeek.
    static func currentWeekday() -> Int {
        Calendar.current.component(.weekday, from: Date()) - 1
    }

    /// Whether the business is open at the current local time per its hours.
    static func isOpenNow(_ hours: [BusinessHours]) -> Bool {
        let now = Date()
        let cal = Calendar.current
        let weekday = cal.component(.weekday, from: now) - 1
        guard let row = hours.first(where: { $0.dayOfWeek == weekday }), !row.closed else { return false }
        let minutes = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        return minutes >= row.openMinute && minutes < row.closeMinute
    }

    // MARK: - Contact button

    @ViewBuilder
    private func contactButton(_ biz: Business) -> some View {
        VStack(spacing: 10) {
            Divider()
            Button {
                if auth.isLoggedIn { showContact = true } else { auth.requireSignIn() }
            } label: {
                Label("Contact \(biz.companyName)", systemImage: "message.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.primary)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 20)

            HStack(spacing: 10) {
                Button {
                    if auth.isLoggedIn { showQuote = true } else { auth.requireSignIn() }
                } label: {
                    Label("Get a quote", systemImage: "doc.text.magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                Button {
                    if auth.isLoggedIn { showBooking = true } else { auth.requireSignIn() }
                } label: {
                    Label("Appointment", systemImage: "calendar.badge.plus")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .background(.ultraThinMaterial)
    }

    private func load() async {
        defer { isLoading = false }
        business = try? await APIService.shared.getBusiness(id: businessId)
        // Honor a review-nudge deep link, but only for someone who can review
        // (homeowners/guests), and only once after the first successful load.
        if autoPresentReview, business != nil, canActAsClient, !didAutoPresentReview {
            didAutoPresentReview = true
            showReview = true
        }
    }
}

// MARK: - Helpers

private extension String {
    /// Render an ISO-8601 verifiedAt timestamp as a relative phrase
    /// (e.g. "2 days ago") for the dynamic "Verified · checked …" badge.
    var verifiedDateText: String? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: self) ?? ISO8601DateFormatter().date(from: self) else { return nil }
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .full
        return fmt.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Supporting views

struct StatCell: View {
    let value: String
    let label: String
    let icon: String
    let iconColor: Color

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon).foregroundStyle(iconColor).font(.headline)
            Text(value).font(.title3.bold())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

/// A small "Open now" / "Closed" status indicator for a business's hours.
struct OpenStatusPill: View {
    let isOpen: Bool
    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(isOpen ? Color.green : Color.secondary)
                .frame(width: 7, height: 7)
            Text(isOpen ? "Open now" : "Closed")
                .font(.caption.weight(.semibold))
                .foregroundStyle(isOpen ? Color.green : Color.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background((isOpen ? Color.green : Color.secondary).opacity(0.12), in: Capsule())
    }
}

struct ReviewCard: View {
    let review: Review
    var companyName: String? = nil
    var isOwner: Bool = false
    var onRespond: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(review.authorName).font(.subheadline.bold())
                if review.isVerified {
                    Label("Verified", systemImage: "checkmark.seal.fill")
                        .labelStyle(.titleAndIcon)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(VerifiedBadge.trust)
                        .accessibilityLabel("Verified booking")
                }
                Spacer()
                HStack(spacing: 2) {
                    ForEach(1...5, id: \.self) { i in
                        Image(systemName: i <= review.rating ? "star.fill" : "star")
                            .foregroundStyle(i <= review.rating ? Theme.gold : Color(.systemGray4))
                            .font(.caption)
                    }
                }
            }
            if let body = review.body {
                Text(body).font(.subheadline).foregroundStyle(.secondary).lineSpacing(3)
            }

            // Public reply from the business.
            if review.hasResponse {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Response from \(companyName ?? "the business")",
                          systemImage: "arrowshape.turn.up.left.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.primary)
                    Text(review.response ?? "")
                        .font(.subheadline).foregroundStyle(.secondary).lineSpacing(3)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }

            // Owner-only respond / edit affordance.
            if isOwner, let onRespond {
                Button {
                    onRespond()
                } label: {
                    Label(review.hasResponse ? "Edit response" : "Respond",
                          systemImage: review.hasResponse ? "pencil" : "arrowshape.turn.up.left")
                        .font(.caption.weight(.semibold))
                }
                .tint(Theme.primary)
                .padding(.top, 2)
            }
        }
        .padding(16)
    }
}

struct FlowLayout: View {
    let tags: [String]
    init(_ tags: [String]) { self.tags = tags }
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 8) {
            ForEach(tags, id: \.self) { SpecialtyTag(text: $0) }
        }
    }
}

// MARK: - Contact sheet

struct ContactBusinessSheet: View {
    let business: Business
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var isLoading = false
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {

                    // Business header card
                    HStack(spacing: 14) {
                        BusinessAvatar(name: business.companyName, logoUrl: business.logoUrl,
                                       size: 52, cornerRadius: 12)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(business.companyName).font(.headline)
                            HStack(spacing: 3) {
                                Image(systemName: "mappin.circle.fill")
                                    .foregroundStyle(Theme.primary).font(.caption2)
                                Text("\(business.city), \(business.state)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            StarRating(rating: business.averageRating, count: business.reviewCount)
                        }
                        Spacer()
                    }
                    .padding(16)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    if sent {
                        VStack(spacing: 14) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 60))
                                .foregroundStyle(.green)
                            Text("Message sent!").font(.title2.bold())
                            Text("You'll hear back soon. Check Messages to continue the conversation.")
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Describe your project")
                                .font(.subheadline.weight(.semibold))

                            TextField("e.g. Kitchen remodel — new cabinets, countertops, and tile…", text: $message, axis: .vertical)
                                .lineLimit(5...10)
                                .padding(14)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        if let error {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.caption).foregroundStyle(.red)
                        }

                        Button {
                            Task { await send() }
                        } label: {
                            Group {
                                if isLoading { ProgressView().tint(.white) }
                                else { Label("Send message", systemImage: "paperplane.fill").font(.headline) }
                            }
                            .frame(maxWidth: .infinity).frame(height: 52)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Contact Business")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                if sent {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
        }
    }

    private func send() async {
        isLoading = true; error = nil
        defer { isLoading = false }
        do {
            _ = try await APIService.shared.startConversation(businessId: business.id, message: message)
            sent = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}
