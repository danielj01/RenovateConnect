import SwiftUI

// MARK: - Brand tokens
enum Theme {
    static let primary      = Color(red: 0.93, green: 0.40, blue: 0.13)
    static let primaryDark  = Color(red: 0.72, green: 0.28, blue: 0.06)
    static let primaryLight = Color(red: 0.99, green: 0.93, blue: 0.87)
    static let gold         = Color(red: 0.96, green: 0.76, blue: 0.10)

    static let gradient = LinearGradient(
        colors: [Color(red: 0.93, green: 0.40, blue: 0.13),
                 Color(red: 0.72, green: 0.28, blue: 0.06)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    static let cardShadow = Color.black.opacity(0.07)

    // Deterministic avatar color per business name
    private static let avatarPalette: [Color] = [
        Color(red: 0.93, green: 0.40, blue: 0.13),
        Color(red: 0.20, green: 0.55, blue: 0.87),
        Color(red: 0.17, green: 0.70, blue: 0.48),
        Color(red: 0.58, green: 0.32, blue: 0.78),
        Color(red: 0.88, green: 0.24, blue: 0.38),
        Color(red: 0.10, green: 0.60, blue: 0.60),
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
            .background(Theme.gold.opacity(0.18))
            .foregroundStyle(Color(red: 0.70, green: 0.52, blue: 0.0))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Theme.gold.opacity(0.35), lineWidth: 0.5))
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
            .background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Theme.cardShadow, radius: 14, x: 0, y: 5)
    }
}
