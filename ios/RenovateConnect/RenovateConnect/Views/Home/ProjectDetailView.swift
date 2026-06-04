import SwiftUI

/// One engagement's unified timeline: quotes, appointments and deposits with a
/// single contractor, pulled together from the derived /projects/:id endpoint.
/// Read-only — actions (message, new quote, book, pay) live on the contractor
/// profile, which this links out to.
struct ProjectDetailView: View {
    let businessId: String
    let companyName: String

    @State private var detail: ProjectDetail?
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().padding(.top, 60)
            } else if let detail {
                content(detail)
            } else {
                errorState
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(companyName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func content(_ detail: ProjectDetail) -> some View {
        VStack(spacing: 16) {
            header(detail)
            timeline(detail)
        }
        .padding(.vertical, 12)
    }

    // MARK: - Header

    private func header(_ detail: ProjectDetail) -> some View {
        RCCard {
            VStack(spacing: 14) {
                HStack(spacing: 14) {
                    BusinessAvatar(name: detail.business.companyName,
                                   logoUrl: detail.business.logoUrl,
                                   size: 58, cornerRadius: 14)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(detail.business.companyName)
                                .font(.headline).foregroundStyle(.primary)
                            if detail.business.verified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.subheadline)
                                    .foregroundStyle(VerifiedBadge.trust)
                                    .accessibilityLabel("Verified")
                            }
                        }
                        if let city = detail.business.city {
                            HStack(spacing: 4) {
                                Image(systemName: "mappin.circle.fill")
                                    .foregroundStyle(Theme.primary.opacity(0.8)).font(.caption2)
                                Text(city).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }

                NavigationLink(destination: BusinessDetailView(businessId: detail.business.id)) {
                    HStack {
                        Label("Open contractor profile", systemImage: "building.2.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(16)
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Timeline

    @ViewBuilder
    private func timeline(_ detail: ProjectDetail) -> some View {
        let events = detail.timeline
        if events.isEmpty {
            Text("No activity yet.")
                .font(.subheadline).foregroundStyle(.secondary)
                .padding(.top, 40)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text("Timeline")
                    .font(.headline)
                    .padding(.horizontal, 16).padding(.bottom, 8)
                ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                    TimelineRow(event: event, isLast: idx == events.count - 1)
                }
            }
        }
    }

    // MARK: - Loading

    private var errorState: some View {
        ContentUnavailableView {
            Label("Couldn't load project", systemImage: "exclamationmark.triangle")
        } description: {
            Text(loadError ?? "Something went wrong.")
        } actions: {
            Button("Try again") { Task { await load() } }
                .buttonStyle(.borderedProminent).tint(Theme.primary)
        }
        .padding(.top, 60)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await APIService.shared.project(businessId: businessId)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// One row in the vertical timeline, with a connecting rail down the left edge.
private struct TimelineRow: View {
    let event: ProjectTimelineEvent
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                ZStack {
                    Circle().fill(Theme.primaryLight).frame(width: 36, height: 36)
                    Image(systemName: event.systemImage)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.primary)
                }
                if !isLast {
                    Rectangle()
                        .fill(Color(.separator))
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 36)

            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(.subheadline.weight(.semibold))
                Text(event.subtitle).font(.caption).foregroundStyle(.secondary)
                Text(ProjectTimelineEvent.relativeDate(event.date))
                    .font(.caption2).foregroundStyle(Color(.tertiaryLabel))
            }
            .padding(.bottom, isLast ? 0 : 18)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .fixedSize(horizontal: false, vertical: true)
    }
}

extension ProjectTimelineEvent {
    static func relativeDate(_ date: Date) -> String {
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .full
        return fmt.localizedString(for: date, relativeTo: Date())
    }
}
