import SwiftUI

/// Shares the feed's bounded, off-main image decoding and memory cache.
struct BrandProjectImage: View {
    let url: String?
    let height: CGFloat

    var body: some View {
        Color(.secondarySystemBackground)
            .frame(height: height)
            .overlay {
                InspirationRemoteImage(url: url, pixelLimit: 1024) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    case .failure:
                        Image(systemName: "photo").font(.title).foregroundStyle(.secondary)
                    default:
                        if url != nil { ProgressView() }
                        else { Image(systemName: "photo").font(.title).foregroundStyle(.secondary) }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .accessibilityHidden(true)
    }
}

struct BrandProjectDetail: View {
    let project: PortfolioProject
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    Text(project.title)
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .accessibilityAddTraits(.isHeader)
                    if let category = project.category { SpecialtyTag(text: category) }
                    if let description = project.description, !description.isEmpty {
                        Text(description).foregroundStyle(.secondary)
                    }
                    if let cost = project.costRangeText {
                        Label(cost, systemImage: "tag")
                        Text("Posted project cost. Your project may differ.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let weeks = project.durationWeeks {
                        Label("\(weeks) weeks", systemImage: "clock")
                    }
                    if !project.imageUrls.isEmpty {
                        Text("Project photos").font(.headline).accessibilityAddTraits(.isHeader)
                        ForEach(Array(project.imageUrls.enumerated()), id: \.offset) { index, url in
                            BrandProjectImage(url: url, height: 280)
                                .accessibilityHidden(false)
                                .accessibilityLabel("Project photo \(index + 1)")
                        }
                    }
                    if let before = project.beforeImageUrls, !before.isEmpty {
                        Text("Before").font(.headline).accessibilityAddTraits(.isHeader)
                        ForEach(Array(before.enumerated()), id: \.offset) { index, url in
                            BrandProjectImage(url: url, height: 280)
                                .accessibilityHidden(false)
                                .accessibilityLabel("Before photo \(index + 1)")
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
