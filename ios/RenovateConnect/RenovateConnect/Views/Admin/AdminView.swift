import SwiftUI

/// Approval queue for platform admins. Shows everything awaiting review —
/// new business listings and new portfolio projects — and lets the admin
/// approve or reject each. Rejecting prompts for an optional reason that
/// surfaces in the owner's UI so they know what to fix.
struct AdminView: View {
    @State private var queue: AdminPendingQueue?
    @State private var isLoading = true
    @State private var error: String?

    // Rejection sheet state. We use a single sheet for both kinds of targets.
    @State private var rejecting: RejectionTarget?

    enum RejectionTarget: Identifiable {
        case business(id: String, name: String)
        case project(id: String, title: String)

        var id: String {
            switch self {
            case .business(let id, _): return "b-\(id)"
            case .project(let id, _): return "p-\(id)"
            }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && queue == nil {
                    ProgressView()
                } else if let q = queue, q.businesses.isEmpty && q.projects.isEmpty {
                    emptyState
                } else if let q = queue {
                    list(q)
                } else if let error {
                    ContentUnavailableState(error: error) { await load() }
                }
            }
            .background(Color(.systemBackground))
            .navigationTitle("Approvals")
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $rejecting) { target in
                RejectionReasonSheet(target: target) { reason in
                    Task { await reject(target, reason: reason) }
                }
            }
        }
    }

    private func list(_ q: AdminPendingQueue) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                if !q.businesses.isEmpty {
                    Section {
                        sectionHeader("New listings", count: q.businesses.count)
                        ForEach(q.businesses) { biz in
                            PendingBusinessCard(business: biz,
                                                approve: { Task { await approveBusiness(biz) } },
                                                reject: { rejecting = .business(id: biz.id, name: biz.companyName) })
                        }
                    }
                }
                if !q.projects.isEmpty {
                    Section {
                        sectionHeader("Portfolio projects", count: q.projects.count)
                        ForEach(q.projects) { project in
                            PendingProjectCard(project: project,
                                               approve: { Task { await approveProject(project) } },
                                               reject: { rejecting = .project(id: project.id, title: project.title) })
                        }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 24)
        }
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            Text("\(count)")
                .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                .padding(.horizontal, 9).padding(.vertical, 3)
                .background(Color(.systemGray5)).clipShape(Capsule())
        }
        .padding(.top, 6)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 46)).foregroundStyle(.green)
            Text("All caught up").font(.headline)
            Text("No pending listings or portfolio projects. New submissions will show up here.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
    }

    // MARK: - Actions

    private func load() async {
        error = nil
        if queue == nil { isLoading = true }
        defer { isLoading = false }
        do { queue = try await APIService.shared.adminPending() }
        catch { self.error = error.localizedDescription }
    }

    private func approveBusiness(_ b: AdminPendingQueue.PendingBusiness) async {
        _ = try? await APIService.shared.adminApproveBusiness(id: b.id)
        await load()
    }

    private func approveProject(_ p: PortfolioProject) async {
        _ = try? await APIService.shared.adminApprovePortfolio(projectId: p.id)
        await load()
    }

    private func reject(_ target: RejectionTarget, reason: String?) async {
        switch target {
        case .business(let id, _):
            _ = try? await APIService.shared.adminRejectBusiness(id: id, reason: reason)
        case .project(let id, _):
            _ = try? await APIService.shared.adminRejectPortfolio(projectId: id, reason: reason)
        }
        await load()
    }
}

// MARK: - Cards

private struct PendingBusinessCard: View {
    let business: AdminPendingQueue.PendingBusiness
    let approve: () -> Void
    let reject: () -> Void

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(business.companyName).font(.subheadline.weight(.semibold))
                        Text("\(business.city), \(business.state)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Label("Listing", systemImage: "building.2.fill")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.blue.opacity(0.15)).foregroundStyle(.blue)
                        .clipShape(Capsule())
                }
                Text(business.description)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(3)
                Divider()
                HStack(spacing: 6) {
                    Image(systemName: "person.fill")
                        .font(.caption2).foregroundStyle(.tertiary)
                    Text(business.user.name).font(.caption)
                    Text("·").foregroundStyle(.tertiary)
                    Text(business.user.email).font(.caption).foregroundStyle(.secondary)
                }
                approvalButtons(approve: approve, reject: reject)
            }
            .padding(14)
        }
    }
}

private struct PendingProjectCard: View {
    let project: PortfolioProject
    let approve: () -> Void
    let reject: () -> Void

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 10) {
                if let first = project.imageUrls.first, let url = URL(string: first) {
                    AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                        placeholder: { Color(.systemGray5) }
                        .frame(height: 130).frame(maxWidth: .infinity).clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(project.title).font(.subheadline.weight(.semibold))
                        if let biz = project.business {
                            Text(biz.companyName).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Label("Project", systemImage: "photo.fill")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.purple.opacity(0.15)).foregroundStyle(.purple)
                        .clipShape(Capsule())
                }
                if let desc = project.description, !desc.isEmpty {
                    Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                }
                approvalButtons(approve: approve, reject: reject)
            }
            .padding(14)
        }
    }
}

@ViewBuilder
private func approvalButtons(approve: @escaping () -> Void, reject: @escaping () -> Void) -> some View {
    HStack(spacing: 10) {
        Button(role: .destructive, action: reject) {
            Label("Reject", systemImage: "xmark")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)

        Button(action: approve) {
            Label("Approve", systemImage: "checkmark")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(.green)
    }
    .padding(.top, 4)
}

// MARK: - Rejection reason sheet

private struct RejectionReasonSheet: View {
    let target: AdminView.RejectionTarget
    let onSubmit: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reason: String = ""

    private var label: String {
        switch target {
        case .business(_, let n): return n
        case .project(_, let t): return t
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Rejecting") { Text(label) }
                Section("Reason (optional, shown to the owner)") {
                    TextField("What needs to change before this can be approved?", text: $reason, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .navigationTitle("Reject submission")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reject") {
                        onSubmit(reason.isEmpty ? nil : reason)
                        dismiss()
                    }.bold()
                }
            }
        }
    }
}
