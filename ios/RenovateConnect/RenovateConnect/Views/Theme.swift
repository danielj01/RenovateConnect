import SwiftUI

// MARK: - Brand tokens
// "Azure & Coral" — a modern royal-blue primary with a warm coral accent. Amber
// is reserved for star ratings, and semantic success/info tokens keep status
// colors consistent across the app.
enum Theme {
    static let primary      = Color(red: 0.145, green: 0.388, blue: 0.922) // #2563EB royal blue
    static let primaryDark  = Color(red: 0.114, green: 0.306, blue: 0.847) // #1D4ED8
    static let primaryLight = Color(red: 0.859, green: 0.918, blue: 0.996) // #DBEAFE tint

    // Warm coral accent for secondary CTAs, highlights, and the Featured badge —
    // a deliberate warm counterpoint to the cool blue brand.
    static let accent       = Color(red: 0.984, green: 0.443, blue: 0.522) // #FB7185 coral
    static let accentDark   = Color(red: 0.957, green: 0.247, blue: 0.369) // #F43F5E

    // Amber — used specifically for star ratings (reads as "rating gold").
    static let gold         = Color(red: 0.961, green: 0.620, blue: 0.043) // #F59E0B amber

    // Semantic status colors.
    static let success      = Color(red: 0.063, green: 0.725, blue: 0.506) // #10B981 emerald
    static let info         = Color(red: 0.024, green: 0.643, blue: 0.808) // #06A4CE cyan

    // Hero gradient: royal blue → sky blue.
    static let gradient = LinearGradient(
        colors: [Color(red: 0.145, green: 0.388, blue: 0.922),  // #2563EB
                 Color(red: 0.055, green: 0.647, blue: 0.914)], // #0EA5E9
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    static let cardShadow = Color(red: 0.04, green: 0.10, blue: 0.25).opacity(0.10)

    // Deterministic avatar color per business name — a modern set that
    // harmonizes with the azure/coral brand.
    private static let avatarPalette: [Color] = [
        Color(red: 0.145, green: 0.388, blue: 0.922), // royal blue #2563EB
        Color(red: 0.984, green: 0.443, blue: 0.522), // coral
        Color(red: 0.063, green: 0.725, blue: 0.506), // emerald
        Color(red: 0.055, green: 0.647, blue: 0.914), // sky blue #0EA5E9
        Color(red: 0.118, green: 0.251, blue: 0.686), // navy #1E40AF
        Color(red: 0.024, green: 0.616, blue: 0.639), // teal #06A9A3
    ]

    static func avatarColor(for name: String) -> Color {
        avatarPalette[abs(name.hashValue) % avatarPalette.count]
    }

    static func initials(for name: String) -> String {
        name.split(separator: " ").prefix(2)
            .compactMap { $0.first.map(String.init) }
            .joined().uppercased()
    }
}

// MARK: - Shared components

/// The app's brand logomark — the "R + roof" mark rendered from the bundled
/// `Logo` image asset. Same asset as the app icon (minus the alpha strip);
/// rendered at `size` square with the brand's rounded-corner radius and a
/// soft drop shadow tying it to the rest of the UI.
struct BrandLogo: View {
    var size: CGFloat = 80

    private var corner: CGFloat { size * 0.225 }   // matches the iOS icon mask roughly

    var body: some View {
        Image("Logo")
            .resizable()
            .interpolation(.high)
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
            .shadow(color: Theme.primary.opacity(0.30), radius: size * 0.14, y: size * 0.08)
    }
}

struct InitialsAvatar: View {
    let name: String
    let size: CGFloat

    var body: some View {
        ZStack {
            Theme.avatarColor(for: name)
            Text(Theme.initials(for: name))
                .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

/// A contractor logo that renders the remote `logoUrl` when present and falls
/// back to colored initials while loading or when no logo exists. Centralizes
/// the AsyncImage/placeholder dance so every card shows logos consistently.
struct BusinessAvatar: View {
    let name: String
    let logoUrl: String?
    let size: CGFloat
    var cornerRadius: CGFloat = 12

    var body: some View {
        Group {
            if let logoUrl, !logoUrl.isEmpty, let url = URL(string: logoUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .empty:
                        ZStack {
                            Theme.avatarColor(for: name).opacity(0.5)
                            ProgressView().tint(.white)
                        }
                    default:
                        InitialsAvatar(name: name, size: size)
                    }
                }
            } else {
                InitialsAvatar(name: name, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

struct StarRating: View {
    let rating: Double
    let count: Int

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "star.fill").foregroundStyle(Theme.gold).font(.caption)
            Text(String(format: "%.1f", rating)).font(.caption.weight(.semibold))
            Text("(\(count))").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct FeaturedBadge: View {
    var body: some View {
        Label("Featured", systemImage: "bolt.fill")
            .font(.system(size: 10, weight: .bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.accent.opacity(0.16))
            .foregroundStyle(Theme.accentDark)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Theme.accent.opacity(0.35), lineWidth: 0.5))
    }
}

struct VerifiedBadge: View {
    // Trust-blue, distinct from the gold "Featured" badge so the two read
    // as different signals at a glance.
    static let trust = Color(red: 0.16, green: 0.50, blue: 0.86)

    var body: some View {
        Label("Verified", systemImage: "checkmark.seal.fill")
            .font(.system(size: 10, weight: .bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(VerifiedBadge.trust.opacity(0.14))
            .foregroundStyle(VerifiedBadge.trust)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(VerifiedBadge.trust.opacity(0.30), lineWidth: 0.5))
    }
}

/// Price-level chip — "$ / $$ / $$$" with the active level emphasized so the
/// homeowner can read budget vs. high-end at a glance. The inactive dollar
/// signs are dimmed (like a rating that's partly filled).
struct CostTierBadge: View {
    let tier: CostTier
    var showLabel: Bool = false

    private var activeCount: Int {
        switch tier { case .low: return 1; case .medium: return 2; case .high: return 3 }
    }

    var body: some View {
        HStack(spacing: 4) {
            HStack(spacing: 0) {
                ForEach(0..<3) { i in
                    Text("$")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(i < activeCount ? Theme.success : Color(.tertiaryLabel))
                }
            }
            if showLabel {
                Text(tier.label).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Theme.success.opacity(0.10))
        .clipShape(Capsule())
        .accessibilityLabel("Price level: \(tier.label)")
    }
}

struct SpecialtyTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Theme.primaryLight)
            .foregroundStyle(Theme.primary)
            .clipShape(Capsule())
    }
}

struct RCCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            // systemBackground stays white in light mode (preserving the
            // shadow-on-white card look) but adapts for dark mode.
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Theme.cardShadow, radius: 14, x: 0, y: 5)
    }
}

extension AnyTransition {
    /// Fade-out-then-fade-in identity swap. Used on `.id(...)`-keyed content
    /// containers (filter results, segments) where a plain `.transition(.opacity)`
    /// cross-fade would render both view trees in the same parent slot at the
    /// same time and visually overlap their section headers ("Kitchen
    /// Contractors" bleeding through "Bathroom Contractors" during the swap).
    /// The removal animates first; the insertion delays until removal is done.
    static let contentSwap = AnyTransition.asymmetric(
        insertion: .opacity.animation(.easeIn(duration: 0.18).delay(0.18)),
        removal:   .opacity.animation(.easeOut(duration: 0.18))
    )

    /// Directional horizontal slide for in-page filter/segment swaps. `forward`
    /// (moving to a later filter) slides the new content in from the trailing
    /// edge and the old out to the leading edge; backward reverses it. Paired
    /// with a fade so there's no hard clip at the edges.
    static func directionalSlide(forward: Bool) -> AnyTransition {
        .asymmetric(
            insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
            removal:   .move(edge: forward ? .leading : .trailing).combined(with: .opacity)
        )
    }
}
