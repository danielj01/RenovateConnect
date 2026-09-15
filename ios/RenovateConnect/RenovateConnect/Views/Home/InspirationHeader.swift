import SwiftUI
import Combine

/// Observable only by the two headers, never by the photo feed.
@MainActor
final class InspirationHeaderState: ObservableObject {
    @Published var progress: CGFloat = 0
}

struct InspirationLargeHeader: View {
    @ObservedObject var state: InspirationHeaderState
    @ScaledMetric(relativeTo: .largeTitle) private var headingSize = 40

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("INTERIOR IDEAS")
                .font(.caption2.weight(.bold))
                .tracking(2.5)
                .foregroundStyle(.secondary)
            Text("Inspiration")
                .font(.system(size: headingSize, weight: .bold, design: .serif))
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
                .onGeometryChange(for: CGFloat.self) { geometry in
                    let minY = geometry.frame(in: .named("inspirationScroll")).minY
                    return min(1, max(0, -minY / 32))
                } action: { progress in
                    state.progress = progress
                }
            Text("Create the space you love.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .opacity(1 - state.progress)
        .accessibilityHidden(state.progress > 0.95)
    }
}

/// Only the title content is custom. NavigationStack owns the background,
/// scroll-edge treatment and adaptive colors, exactly as on Explore.
struct InspirationCompactHeader: View {
    @ObservedObject var state: InspirationHeaderState

    var body: some View {
        Text("Inspiration")
            .font(.headline)
            .opacity(state.progress)
            .accessibilityHidden(state.progress <= 0.95)
    }
}
