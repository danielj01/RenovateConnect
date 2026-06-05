import SwiftUI

/// First-run welcome flow. Role-aware paged intro shown once after a user's
/// first login, then suppressed via `hasCompletedOnboarding`. Pure client-side
/// — orients new homeowners and contractors to the features that drive
/// retention (estimates, booking, leads, portfolio).
///
/// Also runs for signed-out visitors on first launch (`isGuest`), using a
/// homeowner-focused deck that ends on a slide explaining what signing in
/// unlocks (messaging, quotes, booking) — with a secondary "Sign in" action.
struct OnboardingView: View {
    let role: UserRole
    var isGuest: Bool = false
    let onFinish: () -> Void
    var onSignIn: (() -> Void)? = nil

    @State private var page = 0

    private var pages: [OnboardingPage] {
        if isGuest { return OnboardingPage.guest }
        return role == .business ? OnboardingPage.business : OnboardingPage.client
    }

    private var isLastPage: Bool { page == pages.count - 1 }

    private var primaryTitle: String {
        if !isLastPage { return "Next" }
        return (isGuest && onSignIn != nil) ? "Sign in" : "Get started"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button("Skip") { onFinish() }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .opacity(page == pages.count - 1 ? 0 : 1)
            }

            TabView(selection: $page) {
                ForEach(Array(pages.enumerated()), id: \.offset) { idx, item in
                    OnboardingSlide(page: item).tag(idx)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.easeInOut, value: page)

            // Page dots
            HStack(spacing: 8) {
                ForEach(pages.indices, id: \.self) { i in
                    Capsule()
                        .fill(i == page ? Theme.primary : Color(.systemGray4))
                        .frame(width: i == page ? 22 : 8, height: 8)
                        .animation(.easeInOut, value: page)
                }
            }
            .padding(.bottom, 24)

            Button {
                if !isLastPage {
                    withAnimation { page += 1 }
                } else if isGuest, let onSignIn {
                    // On the final guest slide the primary CTA leads to sign-in;
                    // browsing stays available via the secondary button below.
                    onSignIn()
                } else {
                    onFinish()
                }
            } label: {
                Text(primaryTitle)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.primary)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 24)
            .padding(.bottom, isGuest && isLastPage ? 12 : 32)

            // Guests can always skip sign-in and keep browsing.
            if isGuest && isLastPage {
                Button("Keep browsing") { onFinish() }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 28)
            }
        }
        .background(Color(.systemBackground))
    }
}

// MARK: - Slide

private struct OnboardingSlide: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle()
                    .fill(Theme.primaryLight)
                    .frame(width: 180, height: 180)
                Image(systemName: page.icon)
                    .font(.system(size: 76, weight: .semibold))
                    .foregroundStyle(Theme.primary)
            }

            VStack(spacing: 14) {
                Text(page.title)
                    .font(.title.bold())
                    .multilineTextAlignment(.center)
                Text(page.subtitle)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }
            .padding(.horizontal, 32)

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Content

private struct OnboardingPage: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let subtitle: String

    static let client: [OnboardingPage] = [
        .init(icon: "safari.fill",
              title: "Find trusted pros",
              subtitle: "Browse verified renovation contractors near you, with reviews and real project photos."),
        .init(icon: "camera.viewfinder",
              title: "Instant AI estimates",
              subtitle: "Snap a photo of your space and get an instant, itemized cost breakdown before you commit."),
        .init(icon: "calendar.badge.plus",
              title: "Message & book",
              subtitle: "Chat with contractors and request appointments — all in one place."),
        .init(icon: "folder.fill",
              title: "Keep it organized",
              subtitle: "Save your favorite pros and revisit past estimates anytime in My Projects."),
    ]

    // Shown to signed-out visitors on first launch. Mirrors the homeowner
    // value props, then closes by spelling out what an account unlocks.
    static let guest: [OnboardingPage] = [
        .init(icon: "safari.fill",
              title: "Find trusted pros",
              subtitle: "Browse verified renovation contractors near you, with reviews and real project photos — no account needed."),
        .init(icon: "camera.viewfinder",
              title: "Instant AI estimates",
              subtitle: "Snap a photo of your space and get an instant, itemized cost breakdown before you commit. Free to try."),
        .init(icon: "person.crop.circle.badge.checkmark",
              title: "Sign in to do more",
              subtitle: "Create a free account to message contractors, request quotes, book appointments, and save your favorite pros."),
    ]

    static let business: [OnboardingPage] = [
        .init(icon: "briefcase.fill",
              title: "Grow your business",
              subtitle: "Get matched with homeowners actively looking for renovation work in your area."),
        .init(icon: "person.2.fill",
              title: "Win more leads",
              subtitle: "New leads land in your inbox the moment a homeowner reaches out — never miss a job."),
        .init(icon: "photo.stack.fill",
              title: "Showcase your work",
              subtitle: "Build a portfolio of past projects that turns browsers into booked clients."),
        .init(icon: "chart.bar.fill",
              title: "Stay on top of it",
              subtitle: "Track leads, messages, and appointments from a single dashboard."),
    ]
}
