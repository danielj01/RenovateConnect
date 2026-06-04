import SwiftUI

/// "What's new with your saved contractors" — a pull-based digest of new
/// portfolio projects and reviews on the businesses a homeowner follows.
/// Viewing it marks everything currently shown as seen (on disappear), so the
/// badge clears the way the activity feed does.
struct FavoritesDigestView: View {
    @EnvironmentObject private var favorites: FavoritesStore
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().padding(.top, 80)
            } else if favorites.digest.isEmpty {
                ContentUnavailableView {
                    Label("All caught up", systemImage: "checkmark.seal")
                } description: {
                    Text("New projects and reviews from your saved contractors will show up here.")
                }
                .padding(.top, 60)
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(favorites.digest) { entry in
                        DigestEntryCard(entry: entry)
                            .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Saved Pro Updates")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await favorites.refreshDigest()
            isLoading = false
        }
        .refreshable { await favorites.refreshDigest() }
        // Clear the badge once the homeowner has seen the digest.
        .onDisappear { Task { await favorites.markDigestSeen() } }
    }
}

// MARK: - Entry card

private struct DigestEntryCard: View {
    let entry: FavoritesDigestEntry

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                // Header → tap through to the contractor's profile.
                NavigationLink(destination: BusinessDetailView(businessId: entry.business.id)) {
                    HStack(spacing: 12) {
                        BusinessAvatar(name: entry.business.companyName, logoUrl: entry.business.logoUrl,
                                       size: 44, cornerRadius: 11)

                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(entry.business.companyName)
                                    .font(.subheadline.bold())
                                    .foregroundStyle(.primary)
                                if entry.business.isVerified { VerifiedBadge() }
                            }
                            Text(entry.headline)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Theme.primary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)

                if !entry.newProjects.isEmpty {
                    Divider()
                    ForEach(entry.newProjects) { project in
                        DigestProjectRow(project: project)
                    }
                    if entry.newProjectCount > entry.newProjects.count {
                        moreText(entry.newProjectCount - entry.newProjects.count, noun: "project")
                    }
                }

                if !entry.newReviews.isEmpty {
                    Divider()
                    ForEach(entry.newReviews) { review in
                        DigestReviewRow(review: review)
                    }
                    if entry.newReviewCount > entry.newReviews.count {
                        moreText(entry.newReviewCount - entry.newReviews.count, noun: "review")
                    }
                }
            }
            .padding(16)
        }
    }

    private func moreText(_ n: Int, noun: String) -> some View {
        Text("+ \(n) more \(noun)\(n == 1 ? "" : "s")")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }
}

private struct DigestProjectRow: View {
    let project: DigestProject

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
            VStack(alignment: .leading, spacing: 2) {
                Text(project.title).font(.subheadline)
                if let category = project.category {
                    Text(category).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: "photo.on.rectangle.angled")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let first = project.imageUrls.first, let url = URL(string: first) {
            AsyncImage(url: url) { img in
                img.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Color.secondary.opacity(0.15)
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            RoundedRectangle(cornerRadius: 8)
                .fill(Theme.primaryLight)
                .frame(width: 40, height: 40)
                .overlay(Image(systemName: "hammer.fill").font(.caption).foregroundStyle(Theme.primary))
        }
    }
}

private struct DigestReviewRow: View {
    let review: DigestReview

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                ForEach(0..<5, id: \.self) { i in
                    Image(systemName: i < review.rating ? "star.fill" : "star")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.gold)
                }
                Text(review.authorName).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
            if let body = review.body, !body.isEmpty {
                Text(body).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
