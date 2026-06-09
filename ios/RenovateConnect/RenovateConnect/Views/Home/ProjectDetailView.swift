import SwiftUI
import PhotosUI

/// One engagement's unified view: milestone escrow plus a timeline of quotes,
/// appointments and deposits with a single contractor. Milestones are the
/// staged, escrowed payments (Phase B); the timeline is the derived history
/// (Phase A). Role-aware — homeowners fund/release, contractors add/submit.
struct ProjectDetailView: View {
    let businessId: String
    let companyName: String

    @EnvironmentObject private var auth: AuthStore
    @State private var detail: ProjectDetail?
    @State private var isLoading = true
    @State private var loadError: String?

    // Milestone actions
    @State private var fundURL: URL?
    @State private var actionError: String?
    @State private var busyMilestoneId: String?
    @State private var creatingProject = false
    @State private var showAddMilestone = false
    @State private var submitTarget: Milestone?
    @State private var disputeTarget: MilestoneRef?
    @State private var notesTarget: NotesEditorTarget?
    @State private var receiptTarget: ProjectPayment?

    private var isContractor: Bool { auth.isBusiness }

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
        .modifier(MilestoneSheetsModifier(
            fundURL: $fundURL,
            showAddMilestone: $showAddMilestone,
            submitTarget: $submitTarget,
            disputeTarget: $disputeTarget,
            notesTarget: $notesTarget,
            receiptTarget: $receiptTarget,
            initialNotes: detail?.project?.clientNotes ?? "",
            businessName: companyName,
            projectId: detail?.project?.id,
            reload: { Task { await load() } }
        ))
    }

    @ViewBuilder
    private func content(_ detail: ProjectDetail) -> some View {
        VStack(spacing: 16) {
            header(detail)
            ProjectProgressBar(detail: detail)
                .padding(.horizontal, 16)
            if let err = actionError {
                Text(err).font(.caption).foregroundStyle(.red).padding(.horizontal, 16)
            }
            if !isContractor, let project = detail.project {
                notesCard(project)
            }
            milestonesSection(detail)
            timeline(detail)
        }
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func notesCard(_ project: ProjectRecord) -> some View {
        let notes = (project.clientNotes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        Button {
            notesTarget = NotesEditorTarget(projectId: project.id)
        } label: {
            RCCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Image(systemName: "note.text")
                            .foregroundStyle(Theme.primary)
                        Text("My notes").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: notes.isEmpty ? "plus" : "pencil")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    if notes.isEmpty {
                        Text("Jot down measurements, paint colors, or contractor notes. Only you can see this.")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(notes)
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                            .lineLimit(6)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
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

    // MARK: - Milestones (escrow)

    @ViewBuilder
    private func milestonesSection(_ detail: ProjectDetail) -> some View {
        if let project = detail.project {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Milestone payments").font(.headline)
                    Spacer()
                    if isContractor {
                        Button {
                            showAddMilestone = true
                        } label: {
                            Label("Add", systemImage: "plus.circle.fill").font(.subheadline.weight(.semibold))
                        }
                    }
                }
                .padding(.horizontal, 16)

                if project.milestones.isEmpty {
                    Text(isContractor
                         ? "Add a milestone to bill this job in stages. Funds are held safely in escrow and released as you complete each stage."
                         : "No milestones yet. Your contractor can break this job into staged payments held safely in escrow.")
                        .font(.caption).foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                } else {
                    ForEach(project.milestones) { milestone in
                        MilestoneCard(
                            milestone: milestone,
                            isContractor: isContractor,
                            isBusy: busyMilestoneId == milestone.id,
                            onFund: { Task { await fund(project.id, milestone) } },
                            onApprove: { Task { await approve(project.id, milestone) } },
                            onSubmit: { submitTarget = milestone },
                            onDispute: { disputeTarget = MilestoneRef(projectId: project.id, milestone: milestone) },
                            onWithdrawDispute: { Task { await withdrawDispute(project.id, milestone) } }
                        )
                        .padding(.horizontal, 16)
                    }

                    escrowFooter
                }
            }
        } else if let acceptedQuoteId = acceptedQuoteId(detail) {
            // No project yet, but there's an accepted quote — offer to set up escrow.
            RCCard {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Set up milestone payments", systemImage: "lock.shield.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.primary)
                    Text("Break this job into staged payments. Your money is held safely in escrow and only released as work is completed.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button {
                        Task { await createProject(acceptedQuoteId) }
                    } label: {
                        if creatingProject {
                            ProgressView()
                        } else {
                            Text("Set up project").fontWeight(.semibold)
                        }
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.primary)
                    .disabled(creatingProject)
                }
                .padding(16)
            }
            .padding(.horizontal, 16)
        }
    }

    private var escrowFooter: some View {
        Text("Funds are held in escrow and released to the contractor when you approve completed work — or automatically 7 days after they submit it.")
            .font(.caption2).foregroundStyle(.secondary)
            .padding(.horizontal, 16).padding(.top, 2)
    }

    /// The id of an accepted quote in this engagement, if any (escrow starts here).
    private func acceptedQuoteId(_ detail: ProjectDetail) -> String? {
        detail.quotes.first { $0.status == .accepted }?.id
    }

    // MARK: - Timeline

    @ViewBuilder
    private func timeline(_ detail: ProjectDetail) -> some View {
        let events = detail.timeline
        if !events.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Timeline")
                    .font(.headline)
                    .padding(.horizontal, 16).padding(.bottom, 8).padding(.top, 8)
                ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                    timelineEvent(event, isLast: idx == events.count - 1)
                }
            }
        }
    }

    /// Wraps a timeline event in a Button when it's a payment (so the homeowner
    /// can tap to open the receipt). All other event kinds render as plain rows.
    @ViewBuilder
    private func timelineEvent(_ event: ProjectTimelineEvent, isLast: Bool) -> some View {
        if case let .payment(p) = event.kind, !isContractor {
            Button { receiptTarget = p } label: {
                TimelineRow(event: event, isLast: isLast)
            }
            .buttonStyle(.plain)
        } else {
            TimelineRow(event: event, isLast: isLast)
        }
    }

    // MARK: - Loading + actions

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

    private func createProject(_ quoteId: String) async {
        creatingProject = true
        actionError = nil
        defer { creatingProject = false }
        do {
            _ = try await APIService.shared.createProject(quoteRequestId: quoteId)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func fund(_ projectId: String, _ milestone: Milestone) async {
        busyMilestoneId = milestone.id
        actionError = nil
        defer { busyMilestoneId = nil }
        do {
            fundURL = try await APIService.shared.fundMilestone(projectId: projectId, milestoneId: milestone.id)
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func approve(_ projectId: String, _ milestone: Milestone) async {
        busyMilestoneId = milestone.id
        actionError = nil
        defer { busyMilestoneId = nil }
        do {
            _ = try await APIService.shared.approveMilestone(projectId: projectId, milestoneId: milestone.id)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func withdrawDispute(_ projectId: String, _ milestone: Milestone) async {
        busyMilestoneId = milestone.id
        actionError = nil
        defer { busyMilestoneId = nil }
        do {
            try await APIService.shared.withdrawDispute(projectId: projectId, milestoneId: milestone.id)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }
}

/// Pairs a project id with a milestone for `.sheet(item:)` presentation.
struct MilestoneRef: Identifiable {
    let projectId: String
    let milestone: Milestone
    var id: String { milestone.id }
}

/// Identifiable wrapper so the notes editor can be opened via `.sheet(item:)`.
struct NotesEditorTarget: Identifiable {
    let projectId: String
    var id: String { projectId }
}

/// Bundles the four milestone-related sheets (fund Stripe Checkout,
/// add-milestone, submit-work, dispute) in one ViewModifier so the project
/// detail body stays under the SwiftUI type-checker's complexity budget.
private struct MilestoneSheetsModifier: ViewModifier {
    @Binding var fundURL: URL?
    @Binding var showAddMilestone: Bool
    @Binding var submitTarget: Milestone?
    @Binding var disputeTarget: MilestoneRef?
    @Binding var notesTarget: NotesEditorTarget?
    @Binding var receiptTarget: ProjectPayment?
    let initialNotes: String
    let businessName: String
    let projectId: String?
    let reload: () -> Void

    func body(content: Content) -> some View {
        content
            .sheet(item: $fundURL, onDismiss: reload) { url in
                SafariView(url: url).ignoresSafeArea()
            }
            .sheet(isPresented: $showAddMilestone) {
                if let projectId {
                    AddMilestoneSheet(projectId: projectId) { reload() }
                }
            }
            .sheet(item: $submitTarget) { milestone in
                if let projectId {
                    SubmitMilestoneSheet(projectId: projectId, milestone: milestone) { reload() }
                }
            }
            .sheet(item: $disputeTarget) { ref in
                DisputeSheet(projectId: ref.projectId, milestone: ref.milestone) { reload() }
            }
            .sheet(item: $notesTarget) { target in
                ProjectNotesEditor(projectId: target.projectId, initialText: initialNotes) { _ in
                    reload()
                }
            }
            .sheet(item: $receiptTarget) { payment in
                PaymentReceiptSheet(payment: payment, businessName: businessName)
            }
    }
}

// MARK: - Milestone card

private struct MilestoneCard: View {
    let milestone: Milestone
    let isContractor: Bool
    let isBusy: Bool
    let onFund: () -> Void
    let onApprove: () -> Void
    let onSubmit: () -> Void
    let onDispute: () -> Void
    let onWithdrawDispute: () -> Void

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: milestone.status.systemImage).foregroundStyle(Theme.primary)
                    Text(milestone.title).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(milestone.amountText).font(.subheadline.monospacedDigit().weight(.semibold))
                }
                Text(milestone.status.label).font(.caption).foregroundStyle(.secondary)

                if !milestone.proofUrls.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(milestone.proofUrls, id: \.self) { urlStr in
                                AsyncImage(url: URL(string: urlStr)) { img in
                                    img.resizable().aspectRatio(contentMode: .fill)
                                } placeholder: {
                                    Color(.secondarySystemBackground)
                                }
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                }

                action
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private var action: some View {
        if isBusy {
            ProgressView().frame(maxWidth: .infinity)
        } else if isContractor {
            contractorAction
        } else {
            homeownerAction
        }
    }

    @ViewBuilder
    private var contractorAction: some View {
        switch milestone.status {
        case .funded:
            Button(action: onSubmit) {
                Label("Submit completed work", systemImage: "paperplane.fill").fontWeight(.semibold)
            }
            .buttonStyle(.borderedProminent).tint(Theme.primary)
        case .pending:
            Text("Waiting for the homeowner to fund this milestone.")
                .font(.caption2).foregroundStyle(.secondary)
        case .submitted:
            Text("Submitted — awaiting the homeowner's approval.")
                .font(.caption2).foregroundStyle(.secondary)
        case .disputed:
            Text("The homeowner opened a dispute. Funds are paused while our team reviews.")
                .font(.caption2).foregroundStyle(.orange)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var homeownerAction: some View {
        switch milestone.status {
        case .pending:
            Button(action: onFund) {
                Label("Fund — held in escrow", systemImage: "lock.fill").fontWeight(.semibold)
            }
            .buttonStyle(.borderedProminent).tint(Theme.success)
        case .funded:
            VStack(alignment: .leading, spacing: 8) {
                Text("Funds held in escrow. Waiting for the contractor to submit completed work.")
                    .font(.caption2).foregroundStyle(.secondary)
                Button(role: .destructive, action: onDispute) {
                    Label("Raise a dispute", systemImage: "exclamationmark.bubble")
                }
                .font(.caption)
            }
        case .submitted:
            VStack(alignment: .leading, spacing: 8) {
                Button(action: onApprove) {
                    Label("Approve & release payment", systemImage: "checkmark.seal.fill").fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent).tint(Theme.success)
                Button(role: .destructive, action: onDispute) {
                    Label("Something's wrong — dispute", systemImage: "exclamationmark.bubble")
                }
                .font(.caption)
            }
        case .disputed:
            VStack(alignment: .leading, spacing: 8) {
                Text("Your dispute is under review. The 7-day auto-release is paused until it's resolved.")
                    .font(.caption2).foregroundStyle(.orange)
                Button(action: onWithdrawDispute) {
                    Label("Withdraw dispute", systemImage: "arrow.uturn.backward")
                }
                .font(.caption)
            }
        default:
            EmptyView()
        }
    }
}

// MARK: - Add milestone (contractor)

private struct AddMilestoneSheet: View {
    let projectId: String
    let onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var amount = ""
    @State private var saving = false
    @State private var error: String?

    private var amountCents: Int? {
        guard let dollars = Double(amount), dollars > 0 else { return nil }
        return Int((dollars * 100).rounded())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Milestone") {
                    TextField("Title (e.g. Cabinets installed)", text: $title)
                    TextField("Amount (USD)", text: $amount).keyboardType(.decimalPad)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }
                Section {
                    Text("This is the contractor's portion. The homeowner pays a small platform fee on top, and the amount is held in escrow until they release it.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("New milestone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || amountCents == nil || saving)
                }
            }
        }
    }

    private func save() async {
        guard let cents = amountCents else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            _ = try await APIService.shared.addMilestone(projectId: projectId, title: title, amountCents: cents)
            onDone()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Submit milestone proof (contractor)

private struct SubmitMilestoneSheet: View {
    let projectId: String
    let milestone: Milestone
    let onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var images: [UIImage] = []
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Proof of work (up to 8 photos)") {
                    PhotosPicker(selection: $selectedItems, maxSelectionCount: 8, matching: .images) {
                        Label("Select photos", systemImage: "photo.badge.plus")
                    }
                    .onChange(of: selectedItems) { loadImages() }

                    if !images.isEmpty {
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(Array(images.enumerated()), id: \.offset) { _, img in
                                    Image(uiImage: img).resizable().aspectRatio(contentMode: .fill)
                                        .frame(width: 80, height: 80)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                            }
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }
                Section {
                    Text("Submitting notifies the homeowner to review and release the \(milestone.amountText) payment. If they don't respond within 7 days, it releases automatically.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Submit work")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submit() } }.disabled(saving)
                }
            }
        }
    }

    private func loadImages() {
        Task {
            images = []
            for item in selectedItems {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    images.append(img)
                }
            }
        }
    }

    private func submit() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            let data = images.compactMap { $0.jpegData(compressionQuality: 0.7) }
            _ = try await APIService.shared.submitMilestone(projectId: projectId, milestoneId: milestone.id, images: data)
            onDone()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Timeline row

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
