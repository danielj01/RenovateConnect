import SwiftUI

struct BusinessSearchView: View {
    @State private var query = ""
    @State private var city = ""
    @State private var selectedSpecialty: String? = nil
    @State private var businesses: [Business] = []
    @State private var isLoading = false
    @State private var error: String?

    let specialties = ["Kitchen", "Bathroom", "Basement", "Roofing", "Flooring", "Painting", "HVAC", "Electrical", "Plumbing"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(specialties, id: \.self) { s in
                            Button(s) { selectedSpecialty = selectedSpecialty == s ? nil : s }
                                .buttonStyle(.bordered)
                                .tint(selectedSpecialty == s ? .blue : .secondary)
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 8)

                if isLoading {
                    ProgressView().frame(maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                } else {
                    List(businesses) { biz in
                        NavigationLink(destination: BusinessDetailView(businessId: biz.id)) {
                            BusinessRowView(business: biz)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .searchable(text: $query, prompt: "Search contractors…")
            .onSubmit(of: .search) { Task { await search() } }
            .onChange(of: selectedSpecialty) { Task { await search() } }
            .navigationTitle("Find Contractors")
            .task { await search() }
        }
    }

    private func search() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let resp = try await APIService.shared.searchBusinesses(
                specialty: selectedSpecialty,
                city: city.isEmpty ? nil : city,
                q: query.isEmpty ? nil : query
            )
            businesses = resp.businesses
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BusinessRowView: View {
    let business: Business

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: business.logoUrl ?? "")) { img in
                img.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Color.secondary.opacity(0.2)
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(business.companyName).font(.headline)
                    if business.isPromoted {
                        Text("Promoted")
                            .font(.caption2.bold())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.blue.opacity(0.15))
                            .foregroundStyle(.blue)
                            .clipShape(Capsule())
                    }
                }
                Text("\(business.city), \(business.state)").font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption)
                    Text(String(format: "%.1f", business.averageRating)).font(.caption)
                    Text("(\(business.reviewCount))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}
