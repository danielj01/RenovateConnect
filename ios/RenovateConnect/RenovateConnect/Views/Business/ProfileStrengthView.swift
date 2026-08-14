import SwiftUI

/// Shown once, right after business setup, in place of dropping straight into
/// the dashboard. The account and business-profile steps are already done by
/// the time a contractor gets here, so this starts at 2 of 4 — an unfinished
/// checklist that's already partway full gets finished more often than one
/// starting from zero. The two remaining items route into screens that
/// already exist (PortfolioManagerView, VerificationCenterView) but that
/// nothing previously pointed a brand-new contractor toward.
struct ProfileStrengthChecklistView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var completion: ProfileCompletionStore
    let onContinue: () -> Void

    private var businessId: String? { auth.currentUser?.business?.id }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    header

                    if completion.hasLoaded {
                        VStack(spacing: 12) {
                            ChecklistRow(
                                icon: "person.crop.circle.badge.checkmark",
                                title: "Account created",
                                isDone: true
                            )
                            ChecklistRow(
                                icon: "building.2.fill",
                                title: "Business profile & license added",
                                isDone: true
                            )
                            if let businessId {
                                NavigationLink {
                                    PortfolioManagerView()
                                } label: {
                                    ChecklistRow(
                                        icon: "photo.stack.fill",
                                        title: "Add your first project photo",
                                        subtitle: "The single biggest reason homeowners message one contractor over another.",
                                        isDone: completion.hasPortfolioPhoto,
                                        showsChevron: true
                                    )
                                }
                                .buttonStyle(.plain)

                                NavigationLink {
                                    VerificationCenterView(businessId: businessId)
                                } label: {
                                    ChecklistRow(
                                        icon: "checkmark.shield.fill",
                                        title: "Upload license & insurance",
                                        subtitle: "Most platforms only ask contractors to claim they're licensed. We check.",
                                        isDone: completion.hasSubmittedVerification,
                                        showsChevron: true
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } else {
                        ProgressView().padding(.top, 40)
                    }

                    Spacer(minLength: 12)

                    Button(action: onContinue) {
                        Text(completion.isComplete ? "Go to Dashboard" : "I'll finish this later")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(20)
            }
            .background(Color(.systemBackground))
            .navigationTitle("Get lead-ready")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                if let businessId { await completion.refresh(businessId: businessId) }
            }
            .refreshable {
                if let businessId { await completion.refresh(businessId: businessId) }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle().fill(Theme.primaryLight).frame(width: 84, height: 84)
                Image(systemName: "checklist")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Theme.primary)
            }
            Text("\(completion.completedCount) of 4 done")
                .font(.title2.bold())
            Text("A couple more steps and homeowners will see a real, trustworthy profile instead of a blank one.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.systemGray5)).frame(height: 8)
                    Capsule().fill(Theme.primary)
                        .frame(width: geo.size.width * (Double(completion.completedCount) / 4.0), height: 8)
                        .animation(.easeInOut(duration: 0.3), value: completion.completedCount)
                }
            }
            .frame(height: 8)
            .padding(.top, 4)
        }
    }
}

// MARK: - Checklist row

struct ChecklistRow: View {
    let icon: String
    let title: String
    var subtitle: String? = nil
    let isDone: Bool
    var showsChevron: Bool = false

    var body: some View {
        RCCard {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: isDone ? "checkmark.circle.fill" : icon)
                    .font(.title2)
                    .foregroundStyle(isDone ? Theme.success : Theme.primary)
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .strikethrough(isDone, color: .secondary)
                    if let subtitle, !isDone {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if showsChevron && !isDone {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
        }
    }
}

// MARK: - Dashboard card

/// Compact, ongoing version of the same nudge, shown on the Dashboard for as
/// long as the profile is incomplete — the one-time checklist above only
/// shows once, but the reasons to finish don't go away just because it did.
struct ProfileStrengthCard: View {
    @EnvironmentObject private var completion: ProfileCompletionStore
    let businessId: String

    var body: some View {
        // The .task lives on this outer Group, which always exists, rather than
        // on the NavigationLink below, which only exists once hasLoaded is
        // already true — otherwise a fresh app launch that lands straight on
        // the Dashboard (skipping the one-time checklist interstitial because
        // it already ran in an earlier session) would never trigger the
        // refresh that hasLoaded depends on, and the card could never appear
        // even on a genuinely incomplete profile.
        Group {
            if completion.hasLoaded && !completion.isComplete {
                NavigationLink {
                    ProfileStrengthInlineView(businessId: businessId)
                } label: {
                    RCCard {
                        HStack(spacing: 14) {
                            Image(systemName: "checklist")
                                .font(.title2).foregroundStyle(Theme.primary)
                                .frame(width: 40, height: 40)
                                .background(Theme.primaryLight).clipShape(Circle())
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Finish setting up your profile")
                                    .font(.subheadline.weight(.semibold))
                                Text("\(completion.completedCount) of 4 done — add a photo and get verified to start winning leads.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        .padding(16)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .task { await completion.refresh(businessId: businessId) }
    }
}

/// Pushed (not full-screen) re-presentation of the same checklist content, for
/// when a contractor taps back into it from the Dashboard card after the
/// one-time interstitial has already run.
private struct ProfileStrengthInlineView: View {
    @EnvironmentObject private var completion: ProfileCompletionStore
    let businessId: String

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                NavigationLink {
                    PortfolioManagerView()
                } label: {
                    ChecklistRow(
                        icon: "photo.stack.fill",
                        title: "Add your first project photo",
                        subtitle: "The single biggest reason homeowners message one contractor over another.",
                        isDone: completion.hasPortfolioPhoto,
                        showsChevron: true
                    )
                }
                .buttonStyle(.plain)

                NavigationLink {
                    VerificationCenterView(businessId: businessId)
                } label: {
                    ChecklistRow(
                        icon: "checkmark.shield.fill",
                        title: "Upload license & insurance",
                        subtitle: "Most platforms only ask contractors to claim they're licensed. We check.",
                        isDone: completion.hasSubmittedVerification,
                        showsChevron: true
                    )
                }
                .buttonStyle(.plain)
            }
            .padding(20)
        }
        .navigationTitle("Profile strength")
        .navigationBarTitleDisplayMode(.inline)
        .task { await completion.refresh(businessId: businessId) }
        .refreshable { await completion.refresh(businessId: businessId) }
    }
}
