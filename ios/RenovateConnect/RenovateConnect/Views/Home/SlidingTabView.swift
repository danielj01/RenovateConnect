import SwiftUI

/// One entry in the custom bottom tab bar.
struct RCTabItem: Identifiable {
    let tag: Int
    let title: String
    let icon: String
    var badge: Int = 0
    var id: Int { tag }
}

/// A tab container that slides horizontally between pages when the selection
/// changes — the native SwiftUI `TabView` switches instantly with no animation,
/// so we lay all pages side-by-side in an offset HStack and animate the offset.
///
/// All pages stay mounted (state is preserved across switches, like a native
/// TabView). Selection is tap-driven via `RCTabBar`; we deliberately do NOT add
/// a swipe gesture so it never fights the horizontal ScrollViews inside pages
/// (the specialty / category chip rows).
struct SlidingTabView<Page: View>: View {
    @Binding var selection: Int
    let tabs: [RCTabItem]
    @ViewBuilder var page: (RCTabItem) -> Page

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(tabs) { tab in
                    page(tab)
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }
            .frame(width: geo.size.width, alignment: .leading)
            .offset(x: -CGFloat(selection) * geo.size.width)
            .animation(.easeInOut(duration: 0.28), value: selection)
        }
        // safeAreaInset pins the bar at the bottom and reserves space so page
        // content never draws under it (matches the old opaque native bar).
        .safeAreaInset(edge: .bottom, spacing: 0) {
            RCTabBar(selection: $selection, tabs: tabs)
        }
    }
}

/// Custom bottom tab bar — mirrors the native look (fill SF Symbols, blue tint
/// for the active tab) and re-adds the unread badge + accessibility that the
/// native bar gave us for free.
struct RCTabBar: View {
    @Binding var selection: Int
    let tabs: [RCTabItem]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(tabs) { tab in
                Button {
                    selection = tab.tag
                } label: {
                    VStack(spacing: 3) {
                        ZStack {
                            Image(systemName: tab.icon)
                                .font(.system(size: 21))
                            if tab.badge > 0 {
                                badge(tab.badge).offset(x: 13, y: -9)
                            }
                        }
                        .frame(height: 24)
                        Text(tab.title).font(.system(size: 10, weight: .medium))
                    }
                    .foregroundStyle(selection == tab.tag ? Theme.primary : Color(.secondaryLabel))
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.badge > 0 ? "\(tab.title), \(tab.badge) unread" : tab.title)
                .accessibilityValue(selection == tab.tag ? "Selected" : "")
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity)
        // Frosted-glass background like the native iOS tab bar — the system
        // `.bar` material (a translucent blur) instead of an opaque fill, with
        // a hairline separator on top. Extends into the home-indicator area.
        .background {
            Rectangle()
                .fill(.bar)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color(.separator).opacity(0.5))
                        .frame(height: 0.5)
                }
                .ignoresSafeArea(edges: .bottom)
        }
        // Keep the bar pinned to the bottom even when a keyboard is up, rather
        // than letting it ride up over the keyboard.
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    private func badge(_ count: Int) -> some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .frame(minWidth: 18)
            .background(Color.red, in: Capsule())
    }
}
