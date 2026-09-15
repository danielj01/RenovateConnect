import SwiftUI

/// A short, optional tour ending in a useful first action, not an account wall.
struct OnboardingView: View {
    let role: UserRole
    var isGuest = false
    let onFinish: () -> Void
    var onSignIn: (() -> Void)? = nil
    var onChooseDestination: ((Int) -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page = 0
    @State private var destination = TabRouter.inspiration

    private var pages: [WelcomePage] { role == .business ? WelcomePage.business : WelcomePage.homeowner }
    private var isLast: Bool { page == pages.count - 1 }
    private var primaryTitle: String {
        guard isLast else { return "Next" }
        if role == .business { return "Continue" }
        switch destination {
        case TabRouter.estimate: return "Estimate my project"
        case TabRouter.explore: return "Find contractors"
        default: return "Browse inspiration"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if page > 0 {
                    Button { changePage(page - 1) } label: {
                        Image(systemName: "chevron.left").frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Previous step")
                }
                Text("RENOVATECONNECT")
                    .font(.caption2.weight(.bold)).tracking(1.6)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Skip") { onFinish() }
                    .font(.subheadline.weight(.medium))
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel(role == .business ? "Skip tour and continue to setup" : "Skip tour and start browsing")
            }
            .padding(.horizontal, 20)

            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { index in
                    ScrollView {
                        VStack(alignment: .leading, spacing: index == pages.count - 1 ? 16 : 22) {
                            Image(systemName: pages[index].icon)
                                .font(.system(size: index == pages.count - 1 ? 34 : 48, weight: .medium))
                                .foregroundStyle(Theme.primary)
                                .frame(width: index == pages.count - 1 ? 64 : 100, height: index == pages.count - 1 ? 64 : 100)
                                .background(Theme.primary.opacity(0.09), in: RoundedRectangle(cornerRadius: 28))
                                .accessibilityHidden(true)
                            Text(pages[index].title)
                                .font(.system(.largeTitle, design: .serif, weight: .bold))
                                .accessibilityAddTraits(.isHeader)
                            Text(!isGuest && role != .business && index == pages.count - 1
                                 ? "Choose your next step. Your account is ready for messages, quote requests, and appointments."
                                 : pages[index].subtitle)
                                .font(.body).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)

                            if index == pages.count - 1 && role != .business {
                                destinationChoice("Find my style", subtitle: "Browse rooms and save inspiration", icon: "photo.on.rectangle.angled", tab: TabRouter.inspiration)
                                destinationChoice("Plan my budget", subtitle: "Start with a photo of your space", icon: "camera.viewfinder", tab: TabRouter.estimate)
                                destinationChoice("Find a contractor", subtitle: "Compare local profiles and reviews", icon: "person.2", tab: TabRouter.explore)
                            } else {
                                Label(!isGuest && role != .business && index == 0
                                      ? "Find your bookmarked posts in Saved at the top of Inspiration."
                                      : pages[index].detail, systemImage: pages[index].detailIcon)
                                    .font(.subheadline)
                                    .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
                            }
                        }
                        .padding(24)
                    }
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            VStack(spacing: 12) {
                HStack(spacing: 6) {
                    ForEach(pages.indices, id: \.self) { index in
                        Capsule().fill(index == page ? Theme.primary : Color(.systemGray4))
                            .frame(width: index == page ? 22 : 7, height: 6)
                    }
                    Text("\(page + 1) of \(pages.count)")
                        .font(.caption).foregroundStyle(.secondary).padding(.leading, 6)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Step \(page + 1) of \(pages.count)")

                Button {
                    if !isLast { changePage(page + 1) }
                    else if role != .business, let onChooseDestination { onChooseDestination(destination) }
                    else { onFinish() }
                } label: {
                    Text(primaryTitle).font(.headline)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                }
                .buttonStyle(.borderedProminent).tint(Theme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                if isGuest, let onSignIn {
                    Button("Already have an account? Sign in", action: onSignIn)
                        .font(.subheadline).frame(minHeight: 44)
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 16)
        }
        .background(Color(.systemGroupedBackground))
        .interactiveDismissDisabled()
    }

    private func changePage(_ value: Int) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { page = value }
    }

    private func destinationChoice(_ title: String, subtitle: String, icon: String, tab: Int) -> some View {
        Button { destination = tab } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).foregroundStyle(Theme.primary).frame(width: 26)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: destination == tab ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(destination == tab ? Theme.primary : Color.secondary)
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(destination == tab ? Theme.primary : .clear, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(destination == tab ? .isSelected : [])
    }
}

private struct WelcomePage {
    let icon: String
    let title: String
    let subtitle: String
    let detail: String
    let detailIcon: String

    static let homeowner: [WelcomePage] = [
        .init(icon: "photo.on.rectangle.angled", title: "A home that feels like you.",
              subtitle: "Explore ideas room by room. Open a photo and tap Save to keep the looks you love in Saved inspiration.",
              detail: "Browse without an account. Inspiration saves stay on this device.", detailIcon: "bookmark"),
        .init(icon: "camera.viewfinder", title: "Get a starting budget.",
              subtitle: "Add photos of your space and describe your plans. An AI estimate helps you explore what the work might cost.",
              detail: "Estimates are a planning guide. A contractor confirms the scope and final quote.", detailIcon: "doc.text.magnifyingglass"),
        .init(icon: "house", title: "Start wherever you are.",
              subtitle: "Browse freely. Sign in when you're ready to message contractors, request quotes, or book appointments.",
              detail: "", detailIcon: ""),
    ]
    static let business: [WelcomePage] = [
        .init(icon: "building.2", title: "Introduce your business.",
              subtitle: "Add your specialties and service area so homeowners can understand the work you do.",
              detail: "Your listing goes through review before it appears in search.", detailIcon: "checkmark.shield"),
        .init(icon: "photo.stack", title: "Let your work speak.",
              subtitle: "Add project photos, useful descriptions, and before-and-after pairs to your portfolio. Share ideas in Inspiration too.",
              detail: "Use photos you own or have permission to share.", detailIcon: "photo.badge.checkmark"),
        .init(icon: "message", title: "Keep the next steps together.",
              subtitle: "Review inquiries, reply to homeowners, send quotes, and manage appointment requests from the app.",
              detail: "Next, complete your business profile and review the setup checklist.", detailIcon: "checklist"),
    ]
}
