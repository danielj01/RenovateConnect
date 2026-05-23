import SwiftUI

struct BusinessDetailView: View {
    let businessId: String
    @State private var business: Business?
    @State private var isLoading = true
    @State private var showContact = false
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let biz = business {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Header
                        HStack(spacing: 16) {
                            AsyncImage(url: URL(string: biz.logoUrl ?? "")) { img in
                                img.resizable().aspectRatio(contentMode: .fill)
                            } placeholder: { Color.secondary.opacity(0.2) }
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 12))

                            VStack(alignment: .leading) {
                                Text(biz.companyName).font(.title2.bold())
                                Text("\(biz.city), \(biz.state)").foregroundStyle(.secondary)
                                HStack {
                                    Image(systemName: "star.fill").foregroundStyle(.yellow)
                                    Text(String(format: "%.1f", biz.averageRating))
                                    Text("(\(biz.reviewCount) reviews)").foregroundStyle(.secondary)
                                }
                                .font(.subheadline)
                            }
                        }
                        .padding(.horizontal)

                        Divider()

                        // Description
                        VStack(alignment: .leading, spacing: 8) {
                            Text("About").font(.headline)
                            Text(biz.description).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal)

                        // Specialties
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Specialties").font(.headline)
                            FlowLayout(biz.specialties)
                        }
                        .padding(.horizontal)

                        // Reviews
                        if let reviews = biz.reviews, !reviews.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Reviews").font(.headline).padding(.horizontal)
                                ForEach(reviews) { review in
                                    ReviewRowView(review: review)
                                }
                            }
                        }

                        Spacer(minLength: 80)
                    }
                    .padding(.top)
                }
                .safeAreaInset(edge: .bottom) {
                    if auth.currentUser?.role == .client {
                        Button("Contact \(biz.companyName)") { showContact = true }
                            .buttonStyle(.borderedProminent)
                            .padding()
                            .background(.ultraThinMaterial)
                    }
                }
                .sheet(isPresented: $showContact) {
                    if let biz = business {
                        ContactBusinessSheet(business: biz)
                    }
                }
            }
        }
        .navigationTitle(business?.companyName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        defer { isLoading = false }
        business = try? await APIService.shared.getBusiness(id: businessId)
    }
}

struct ReviewRowView: View {
    let review: Review
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(review.authorName).font(.subheadline.bold())
                Spacer()
                HStack(spacing: 2) {
                    ForEach(1...5, id: \.self) { i in
                        Image(systemName: i <= review.rating ? "star.fill" : "star")
                            .foregroundStyle(.yellow).font(.caption)
                    }
                }
            }
            if let body = review.body {
                Text(body).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
    }
}

struct FlowLayout: View {
    let tags: [String]
    init(_ tags: [String]) { self.tags = tags }
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 8) {
            ForEach(tags, id: \.self) { tag in
                Text(tag)
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.12))
                    .foregroundStyle(.blue)
                    .clipShape(Capsule())
            }
        }
    }
}
