import SwiftUI

// MARK: - Brand tokens
// "Indigo & Coral" — a modern indigo primary with a warm coral accent. Amber is
// reserved for star ratings, and semantic success/info tokens keep status
// colors consistent across the app.
enum Theme {
    static let primary      = Color(red: 0.310, green: 0.275, blue: 0.898) // #4F46E5 indigo
    static let primaryDark  = Color(red: 0.263, green: 0.220, blue: 0.792) // #4338CA
    static let primaryLight = Color(red: 0.878, green: 0.906, blue: 1.000) // #E0E7FF tint

    // Warm coral accent for secondary CTAs, highlights, and the Featured badge.
    static let accent       = Color(red: 0.984, green: 0.443, blue: 0.522) // #FB7185 coral
    static let accentDark   = Color(red: 0.957, green: 0.247, blue: 0.369) // #F43F5E

    // Amber — used specifically for star ratings (reads as "rating gold").
    static let gold         = Color(red: 0.961, green: 0.620, blue: 0.043) // #F59E0B amber

    // Semantic status colors.
    static let success      = Color(red: 0.063, green: 0.725, blue: 0.506) // #10B981 emerald
    static let info         = Color(red: 0.231, green: 0.510, blue: 0.965) // #3B82F6 blue

    // Hero gradient: indigo → violet.
    static let gradient = LinearGradient(
        colors: [Color(red: 0.310, green: 0.275, blue: 0.898),  // #4F46E5
                 Color(red: 0.486, green: 0.227, blue: 0.929)], // #7C3AED
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    static let cardShadow = Color(red: 0.06, green: 0.05, blue: 0.20).opacity(0.10)

    // Deterministic avatar color per business name — a modern set that
    // harmonizes with the indigo/coral brand.
    private static let avatarPalette: [Color] = [
        Color(red: 0.310, green: 0.275, blue: 0.898), // indigo
        Color(red: 0.984, green: 0.443, blue: 0.522), // coral
        Color(red: 0.063, green: 0.725, blue: 0.506), // emerald
        Color(red: 0.486, green: 0.227, blue: 0.929), // violet
        Color(red: 0.231, green: 0.510, blue: 0.965), // blue
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
