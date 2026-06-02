import SwiftUI

struct BusinessSearchView: View {
    @State private var query = ""
    @State private var selectedSpecialty: String? = nil
    @State private var businesses: [Business] = []
    @State private var isLoading = false
    @State private var error: String?

    private let specialties: [(String, String)] = [
        ("Kitchen", "fork.knife"), ("Bathroom", "shower"),
        ("Basement", "rectangle.3.group.fill"), ("Roofing", "house.fill"),
        ("Flooring", "square.grid.2x2.fill"), ("Painting", "paintbrush.fill"),
        ("HVAC", "wind"), ("Electrical", "bolt.fill"), ("Plumbing", "drop.fill"),
    ]

    private var promoted: [Business] { businesses.filter { $0.isPromoted } }
    private var all: [Business] { businesses }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {

                    // Specialty filter chips
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
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

                    if isLoading {
                        VStack { ProgressView() }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 80)

                    } else if let error {
                        ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                            .padding(.top, 60)

                    } else {
                        // Featured horizontal scroll
                        if !promoted.isEmpty && selectedSpecialty == nil && query.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionHeader(icon: "bolt.fill", title: "Featured")
                                    .padding(.horizontal, 16)

                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 14) {
                                        ForEach(promoted) { biz in
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
            .background(Color(.systemGroupedBackground))
            .searchable(text: $query, prompt: "Search contractors…")
            .onSubmit(of: .search) { Task { await search() } }
            .onChange(of: query) { if query.isEmpty { Task { await search() } } }
            .onChange(of: selectedSpecialty) { Task { await search() } }
            .navigationTitle("Explore")
            .task { await search() }
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
        do {
            let resp = try await APIService.shared.searchBusinesses(
                specialty: selectedSpecialty,
                q: query.isEmpty ? nil : query
            )
            businesses = resp.businesses
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Featured card (horizontal scroll)

struct FeaturedBusinessCard: View {
    let business: Business

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    InitialsAvatar(name: business.companyName, size: 46)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    Spacer()
                    FeaturedBadge()
                }

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        Text(business.companyName)
                            .font(.subheadline.bold())
                            .foregroundStyle(.primary)
                            .lineLimit(2)
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
                    }
                }

                StarRating(rating: business.averageRating, count: business.reviewCount)

                if let spec = business.specialties.first {
                    SpecialtyTag(text: spec)
                }
            }
            .padding(14)
            .frame(width: 185, alignment: .leading)
        }
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
                    InitialsAvatar(name: business.companyName, size: 58)
                        .clipShape(RoundedRectangle(cornerRadius: 14))

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
                            Spacer()
                            if business.isPromoted { FeaturedBadge() }
                            if auth.currentUser?.role == .client {
                                Button {
                                    favorites.toggle(business)
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
