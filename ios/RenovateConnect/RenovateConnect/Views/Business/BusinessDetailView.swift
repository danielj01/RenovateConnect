import SwiftUI

struct BusinessDetailView: View {
    let businessId: String
    @State private var business: Business?
    @State private var isLoading = true
    @State private var showContact = false
    @State private var showBooking = false
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var favorites: FavoritesStore

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
                    if auth.currentUser?.role == .client {
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
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if auth.currentUser?.role == .client, let biz = business {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        favorites.toggle(biz)
                    } label: {
                        Image(systemName: favorites.isSaved(biz.id) ? "heart.fill" : "heart")
                            .foregroundStyle(favorites.isSaved(biz.id) ? Theme.primary : Color(.label))
                    }
                    .accessibilityLabel(favorites.isSaved(biz.id) ? "Remove from saved" : "Save contractor")
                }
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
                InitialsAvatar(name: biz.companyName, size: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
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
                        if biz.isPromoted { FeaturedBadge() }
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
                     label: "Yrs exp.", icon: "briefcase.fill", iconColor: Color(red: 0.20, green: 0.55, blue: 0.87))
        }
        .padding(.vertical, 16)
        .background(.white)
        .shadow(color: Theme.cardShadow, radius: 8, y: 3)
    }

    // MARK: - Main content

    @ViewBuilder
    private func contentSection(_ biz: Business) -> some View {
        VStack(alignment: .leading, spacing: 16) {

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

            // Trust & credentials — shown when verified or a license is on file.
            if biz.isVerified || (biz.licenseNumber?.isEmpty == false) {
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
            if let reviews = biz.reviews, !reviews.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Reviews", systemImage: "star.bubble.fill")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                        .padding(.horizontal, 16)

                    ForEach(reviews) { review in
                        RCCard {
                            ReviewCard(review: review)
                        }
                    }
                }
            }

            Spacer(minLength: 90)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Contact button

    @ViewBuilder
    private func contactButton(_ biz: Business) -> some View {
        VStack(spacing: 10) {
            Divider()
            Button {
                showContact = true
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

            Button {
                showBooking = true
            } label: {
                Label("Request an appointment", systemImage: "calendar.badge.plus")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.bordered)
            .tint(Theme.primary)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .background(.ultraThinMaterial)
    }

    private func load() async {
        defer { isLoading = false }
        business = try? await APIService.shared.getBusiness(id: businessId)
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

struct ReviewCard: View {
    let review: Review

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(review.authorName).font(.subheadline.bold())
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
                        InitialsAvatar(name: business.companyName, size: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
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
