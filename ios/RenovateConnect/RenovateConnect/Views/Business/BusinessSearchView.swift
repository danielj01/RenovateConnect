import SwiftUI
import CoreLocation

struct BusinessSearchView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var location = LocationManager()
    @State private var query = ""
    @State private var selectedSpecialty: String? = nil
    @State private var businesses: [Business] = []
    @State private var sponsored: [Business] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var showSavedSearches = false
    @State private var saveState: SaveState = .idle
    @State private var nearMe = false
    @State private var showLocationDenied = false
    @State private var showAIChat = false

    /// Tracks the inline "save this search" button across taps so the homeowner
    /// gets feedback without a disruptive alert.
    private enum SaveState { case idle, saving, saved }

    private var isClient: Bool { auth.currentUser?.role == .client }
    private var hasActiveFilter: Bool { selectedSpecialty != nil || !query.isEmpty }

    private let specialties: [(String, String)] = [
        ("Kitchen", "fork.knife"), ("Bathroom", "shower"),
        ("Basement", "rectangle.3.group.fill"), ("Roofing", "house.fill"),
        ("Flooring", "square.grid.2x2.fill"), ("Painting", "paintbrush.fill"),
        ("HVAC", "wind"), ("Electrical", "bolt.fill"), ("Plumbing", "drop.fill"),
    ]

    // Admin-verified contractors get the featured treatment (curated trust),
    // replacing the old paid-promotion carousel.
    private var featured: [Business] { businesses.filter { $0.isVerified } }
    private var all: [Business] { businesses }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {

                    // Specialty filter chips (preceded by the "Near me" toggle)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Button {
                                Task { await toggleNearMe() }
                            } label: {
                                Label("Near me",
                                      systemImage: location.isResolving ? "location.circle" : (nearMe ? "location.fill" : "location"))
                                    .font(.subheadline.weight(.medium))
                                    .padding(.horizontal, 14).padding(.vertical, 9)
                                    .background(nearMe ? Theme.primary : Color(.systemGray6))
                                    .foregroundStyle(nearMe ? .white : Color(.label))
                                    .clipShape(Capsule())
                            }
                            .disabled(location.isResolving)

                            ForEach(specialties, id: \.0) { name, icon in
                                Button {
                                    withAnimation(.spring(duration: 0.25)) {
                                        selectedSpecialty = selectedSpecialty == name ? nil : name
                                    }
                                } label: {
                                    Label(name, systemImage: icon)
                                        .font(.subheadline.weight(.medium))
                                        .padding(.horizontal, 14).padding(.vertical, 9)
                                        .background(selectedSpecialty == name ? Theme.primary : Color(.systemGray6))
                                        .foregroundStyle(selectedSpecialty == name ? .white : Color(.label))
                                        .clipShape(Capsule())
                                        .animation(.spring(duration: 0.25), value: selectedSpecialty)
                                }
                            }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 14)
                    }

                    // Save the current filters so new matching contractors trigger an alert.
                    if isClient && hasActiveFilter {
                        saveSearchButton
                            .padding(.horizontal, 16)
                            .padding(.bottom, 6)
                    }

                    if isLoading {
                        VStack { ProgressView() }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 80)

                    } else if let error {
                        ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                            .padding(.top, 60)

                    } else {
                        // Verified contractors horizontal scroll
                        if !featured.isEmpty && selectedSpecialty == nil && query.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionHeader(icon: "checkmark.seal.fill", title: "Verified Pros")
                                    .padding(.horizontal, 16)

                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 14) {
                                        ForEach(featured) { biz in
                                            NavigationLink(destination: BusinessDetailView(businessId: biz.id)) {
                                                FeaturedBusinessCard(business: biz)
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                    .padding(.horizontal, 16).padding(.bottom, 4)
                                }
                            }
                            .padding(.bottom, 24)
                        }

                        // Sponsored (Pro) — clearly labeled, shown above organic
                        // results without reordering them.
                        if !sponsored.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionHeader(icon: "megaphone.fill", title: "Sponsored")
                                    .padding(.horizontal, 16)
                                ForEach(sponsored) { biz in
                                    NavigationLink(destination: BusinessDetailView(businessId: biz.id)) {
                                        BusinessListCard(business: biz)
                                            .padding(.horizontal, 16)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.bottom, 20)
                        }

                        // All contractors
                        VStack(alignment: .leading, spacing: 12) {
                            sectionHeader(
                                icon: "building.2.fill",
                                title: selectedSpecialty.map { "\($0) Contractors" } ?? "All Contractors"
                            )
                            .padding(.horizontal, 16)

                            if all.isEmpty {
                                ContentUnavailableView(
                                    "No contractors found",
                                    systemImage: "building.2",
                                    description: Text("Try a different search or category.")
                                )
                                .padding(.top, 24)
                            } else {
                                ForEach(all) { biz in
                                    NavigationLink(destination: BusinessDetailView(businessId: biz.id)) {
                                        BusinessListCard(business: biz)
                                            .padding(.horizontal, 16)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        Spacer(minLength: 40)
                    }
                }
            }
            .background(Color(.systemBackground))
            .searchable(text: $query, prompt: "Search contractors…")
            .onSubmit(of: .search) { Task { await search() } }
            .onChange(of: query) {
                saveState = .idle
                if query.isEmpty { Task { await search() } }
            }
            .onChange(of: selectedSpecialty) {
                saveState = .idle
                Task { await search() }
            }
            .navigationTitle("Explore")
            .toolbar {
                if isClient {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            showSavedSearches = true
                        } label: {
                            Image(systemName: "bookmark")
                        }
                        .accessibilityLabel("Saved searches")
                    }
                    // AI Assistant moved here from its own tab (replaced by Inspiration).
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showAIChat = true
                        } label: {
                            Image(systemName: "bubble.left.and.bubble.right.fill")
                        }
                        .accessibilityLabel("AI assistant")
                    }
                }
                // Guests have no activity feed (and no ActivityStore in their
                // environment), so the bell is only for signed-in users.
                if auth.isLoggedIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        ActivityBellButton()
                    }
                }
            }
            .sheet(isPresented: $showAIChat) {
                // AIChatView has its own NavigationStack; re-inject the stores it
                // (and the business detail it links to) need, via shared singletons.
                AIChatView()
                    .environmentObject(ChatStore.shared)
                    .environmentObject(auth)
                    .environmentObject(FavoritesStore.shared)
                    .environmentObject(TabRouter.shared)
            }
            .sheet(isPresented: $showSavedSearches) {
                SavedSearchesView { applied in
                    selectedSpecialty = applied.specialty
                    query = applied.q ?? ""
                    saveState = .idle
                    Task { await search() }
                }
            }
            .task { await search() }
            .alert("Location access is off", isPresented: $showLocationDenied) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Turn on location for RenovateConnect in Settings to sort contractors by distance.")
            }
        }
    }

    // MARK: - Save current search

    @ViewBuilder
    private var saveSearchButton: some View {
        Button {
            Task { await saveCurrentSearch() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: saveState == .saved ? "bell.badge.fill" : "bell.badge")
                Text(saveState == .saved ? "Alert saved" : "Save & alert me on new matches")
                    .font(.subheadline.weight(.medium))
                if saveState == .saving { ProgressView().controlSize(.small) }
            }
            .foregroundStyle(saveState == .saved ? .secondary : Theme.primary)
        }
        .buttonStyle(.plain)
        .disabled(saveState != .idle)
    }

    private func saveCurrentSearch() async {
        saveState = .saving
        do {
            _ = try await APIService.shared.createSavedSearch(
                specialty: selectedSpecialty,
                q: query.isEmpty ? nil : query
            )
            saveState = .saved
        } catch {
            saveState = .idle
        }
    }

    @ViewBuilder
    private func sectionHeader(icon: String, title: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).foregroundStyle(Theme.primary).font(.subheadline)
            Text(title).font(.title3.bold())
        }
    }

    private func search() async {
        isLoading = true; error = nil
        defer { isLoading = false }
        let coord = nearMe ? location.coordinate : nil
        do {
            let resp = try await APIService.shared.searchBusinesses(
                specialty: selectedSpecialty,
                q: query.isEmpty ? nil : query,
                lat: coord?.latitude,
                lng: coord?.longitude
            )
            businesses = resp.businesses
            sponsored = resp.sponsored ?? []
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Toggle "near me": off → on requests location (and re-searches on success);
    /// on → off clears the distance ranking. Denied permission surfaces an alert.
    private func toggleNearMe() async {
        if nearMe {
            nearMe = false
            await search()
            return
        }
        let coord = await location.requestLocation()
        if coord != nil {
            nearMe = true
        } else {
            showLocationDenied = location.denied
        }
        await search()
    }
}

// MARK: - Featured card (horizontal scroll)

struct FeaturedBusinessCard: View {
    let business: Business

    private static let cardWidth: CGFloat = 230
    private static let heroHeight: CGFloat = 132

    // Prefer a real project photo for the hero; fall back to the logo, then a
    // brand gradient so the card never looks broken while data loads.
    private var heroImageUrl: String? {
        business.portfolio?.first(where: { !$0.imageUrls.isEmpty })?.imageUrls.first
            ?? business.logoUrl
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            hero
            details
        }
        .frame(width: Self.cardWidth, alignment: .leading)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: Theme.cardShadow, radius: 14, x: 0, y: 5)
    }

    private var hero: some View {
        ZStack(alignment: .topLeading) {
            Group {
                if let heroImageUrl, let url = URL(string: heroImageUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFill()
                        case .empty: Theme.primaryLight.overlay(ProgressView())
                        default: brandGradient
                        }
                    }
                } else {
                    brandGradient
                }
            }
            .frame(width: Self.cardWidth, height: Self.heroHeight)
            .clipped()

            // Keep the Verified badge legible over any photo.
            LinearGradient(colors: [.black.opacity(0.28), .clear],
                           startPoint: .top, endPoint: .center)
                .frame(width: Self.cardWidth, height: Self.heroHeight)
                .allowsHitTesting(false)

            VerifiedBadge().padding(10)
        }
    }

    private var brandGradient: some View {
        LinearGradient(colors: [Theme.primary, Theme.primaryDark],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay(
                Image(systemName: "building.2.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            )
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 5) {
                Text(business.companyName)
                    .font(.subheadline.bold())
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if business.isVerified {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.caption2)
                        .foregroundStyle(VerifiedBadge.trust)
                        .accessibilityLabel("Verified")
                }
            }

            HStack(spacing: 3) {
                Image(systemName: "mappin.circle.fill")
                    .foregroundStyle(Theme.primary.opacity(0.8))
                    .font(.caption2)
                Text("\(business.city), \(business.state)")
                    .font(.caption).foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack {
                StarRating(rating: business.averageRating, count: business.reviewCount)
                Spacer()
                if let spec = business.specialties.first {
                    SpecialtyTag(text: spec)
                }
            }
        }
        .padding(12)
    }
}

// MARK: - Full-width list card

struct BusinessListCard: View {
    let business: Business
    @EnvironmentObject private var favorites: FavoritesStore
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        RCCard {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    BusinessAvatar(name: business.companyName, logoUrl: business.logoUrl,
                                   size: 58, cornerRadius: 14)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .top) {
                            Text(business.companyName)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            if business.isVerified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.subheadline)
                                    .foregroundStyle(VerifiedBadge.trust)
                                    .accessibilityLabel("Verified")
                            }
                            if business.sponsored == true {
                                Text("Sponsored")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color(.systemGray5), in: Capsule())
                            }
                            Spacer()
                            if !auth.isBusiness && !auth.isAdmin {
                                Button {
                                    if auth.isLoggedIn { favorites.toggle(business) } else { auth.requireSignIn() }
                                } label: {
                                    Image(systemName: favorites.isSaved(business.id) ? "heart.fill" : "heart")
                                        .foregroundStyle(favorites.isSaved(business.id) ? Theme.primary : Color(.tertiaryLabel))
                                        .font(.subheadline)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(favorites.isSaved(business.id) ? "Remove from saved" : "Save contractor")
                            }
                        }

                        HStack(spacing: 4) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(Theme.primary.opacity(0.8)).font(.caption2)
                            Text("\(business.city), \(business.state)")
                                .font(.subheadline).foregroundStyle(.secondary)
                            if let distance = business.distanceText {
                                Text("· \(distance)")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Theme.primary)
                            }
                        }

                        HStack(spacing: 10) {
                            StarRating(rating: business.averageRating, count: business.reviewCount)
                            if business.yearsInBusiness > 0 {
                                Text("·").foregroundStyle(.secondary).font(.caption)
                                Text("\(business.yearsInBusiness) yrs")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(16)

                if !business.specialties.isEmpty {
                    Divider().padding(.horizontal, 16)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(business.specialties.prefix(5), id: \.self) { SpecialtyTag(text: $0) }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 11)
                    }
                }
            }
        }
    }
}
