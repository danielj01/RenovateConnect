import SwiftUI
import PhotosUI
import UIKit

struct PortfolioManagerView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var projects: [PortfolioProject] = []
    @State private var isLoading = true
    @State private var showAdd = false
    @State private var editing: PortfolioProject?

    var body: some View {
        NavigationStack {
            Group {
                if auth.myBusinessId == nil {
                    noProfileState
                } else if isLoading {
                    ProgressView()
                } else if projects.isEmpty {
                    emptyState
                } else {
                    grid
                }
            }
            .background(Color(.systemBackground))
            .navigationTitle("Portfolio")
            .toolbar {
                if auth.myBusinessId != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showAdd = true } label: { Image(systemName: "plus") }
                    }
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .sheet(isPresented: $showAdd) {
                PortfolioEditorSheet(businessId: auth.myBusinessId ?? "", project: nil) { saved in
                    projects.insert(saved, at: 0)
                }
            }
            .sheet(item: $editing) { project in
                PortfolioEditorSheet(
                    businessId: auth.myBusinessId ?? "",
                    project: project,
                    onSave: { saved in
                        if let i = projects.firstIndex(where: { $0.id == saved.id }) { projects[i] = saved }
                    },
                    onDelete: { id in
                        projects.removeAll { $0.id == id }
                    }
                )
            }
        }
    }

    private var grid: some View {
        ScrollView {
            VStack(spacing: 14) {
                ForEach(projects) { project in
                    Button { editing = project } label: {
                        PortfolioCard(project: project)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { editing = project } label: { Label("Edit", systemImage: "pencil") }
                        Button(role: .destructive) {
                            Task { await delete(project) }
                        } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "photo.stack")
                .font(.system(size: 46)).foregroundStyle(.secondary)
            Text("Showcase your work").font(.headline)
            Text("Add past projects with cost ranges and timelines. Homeowners see these on your profile — it's the #1 way to win trust.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 36)
            Button { showAdd = true } label: {
                Label("Add a project", systemImage: "plus")
                    .font(.headline).frame(maxWidth: .infinity).frame(height: 50)
            }
            .buttonStyle(.borderedProminent).tint(Theme.primary)
            .padding(.horizontal, 40).padding(.top, 6)
        }
    }

    private var noProfileState: some View {
        VStack(spacing: 12) {
            Image(systemName: "building.2.crop.circle")
                .font(.system(size: 46)).foregroundStyle(.secondary)
            Text("Set up your business profile first")
                .font(.headline)
            Text("Once your business profile exists you can start adding portfolio projects.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
    }

    private func load() async {
        defer { isLoading = false }
        guard let id = auth.myBusinessId else { return }
        projects = (try? await APIService.shared.getPortfolio(businessId: id)) ?? []
    }

    private func delete(_ project: PortfolioProject) async {
        guard let id = auth.myBusinessId else { return }
        try? await APIService.shared.deletePortfolioProject(businessId: id, projectId: project.id)
        projects.removeAll { $0.id == project.id }
    }
}

// MARK: - Shared card (used here and on the public business detail)

struct PortfolioCard: View {
    let project: PortfolioProject

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 0) {
                // Image strip or gradient placeholder
                ZStack {
                    if let first = project.imageUrls.first, let url = URL(string: first) {
                        AsyncImage(url: url) { img in
                            img.resizable().scaledToFill()
                        } placeholder: { Theme.primaryLight }
                    } else {
                        Theme.gradient.opacity(0.85)
                        Image(systemName: "hammer.fill")
                            .font(.system(size: 30)).foregroundStyle(.white.opacity(0.8))
                    }
                }
                .frame(height: 130)
                .frame(maxWidth: .infinity)
                .clipped()

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Text(project.title).font(.headline)
                        Spacer()
                        if let s = project.approvalStatus, s != .approved {
                            ProjectApprovalChip(status: s)
                        }
                        if project.featured { FeaturedBadge() }
                    }
                    if let desc = project.description, !desc.isEmpty {
                        Text(desc).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                    HStack(spacing: 8) {
                        if let cat = project.category { SpecialtyTag(text: cat) }
                        if let cost = project.costRangeText {
                            Label(cost, systemImage: "dollarsign.circle")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let weeks = project.durationWeeks {
                            Label("\(weeks) wk", systemImage: "clock")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(14)
            }
        }
    }
}

/// Small status chip surfaced on portfolio cards when an admin hasn't yet
/// approved (or has rejected) a project. The card is still tappable so the
/// owner can edit and resubmit.
struct ProjectApprovalChip: View {
    let status: ApprovalStatus

    private var tint: Color { status == .rejected ? .orange : .blue }

    var body: some View {
        Label(status.label, systemImage: status.systemImage)
            .font(.system(size: 10, weight: .semibold))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(tint.opacity(0.15))
            .foregroundStyle(tint)
            .clipShape(Capsule())
    }
}

// MARK: - Create / edit project

/// One sheet for both adding and editing a portfolio project. Pass `project: nil`
/// to create, or an existing project to edit it. `onSave` receives the created
/// or updated project so the list can update in place.
struct PortfolioEditorSheet: View {
    let businessId: String
    let project: PortfolioProject?
    let onSave: (PortfolioProject) -> Void
    /// Optional — when present and editing an existing project, the editor
    /// surfaces a visible Delete button. The parent removes the row from its
    /// list when this fires (the editor already dismissed the sheet).
    var onDelete: ((String) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var description: String
    @State private var category: String
    @State private var costMin: String
    @State private var costMax: String
    @State private var weeks: String
    @State private var isSaving = false
    @State private var isDeleting = false
    @State private var showDeleteConfirm = false
    @State private var error: String?

    // Image editing state. `imageUrls` mirrors the project's photos so the
    // owner can delete in place; `picker` drives the PhotosPicker; `uploading`
    // shows a spinner during the multipart upload.
    @State private var imageUrls: [String]
    @State private var picker: [PhotosPickerItem] = []
    @State private var uploading = false

    // Optional "before" photos for a Before & After. Paired by order with the
    // result photos above.
    @State private var beforeImageUrls: [String]
    @State private var beforePicker: [PhotosPickerItem] = []
    @State private var uploadingBefore = false

    // For NEW projects there's no projectId to upload against yet, so picked
    // photos are staged here as JPEG data and uploaded right after the project
    // is created (see `save()`).
    @State private var newPicker: [PhotosPickerItem] = []
    @State private var stagedImages: [Data] = []

    private var isEditing: Bool { project != nil }

    init(businessId: String, project: PortfolioProject?,
         onSave: @escaping (PortfolioProject) -> Void,
         onDelete: ((String) -> Void)? = nil) {
        self.businessId = businessId
        self.project = project
        self.onSave = onSave
        self.onDelete = onDelete
        _title = State(initialValue: project?.title ?? "")
        _description = State(initialValue: project?.description ?? "")
        _category = State(initialValue: project?.category ?? "")
        _costMin = State(initialValue: project?.costMin.map { "\($0)" } ?? "")
        _costMax = State(initialValue: project?.costMax.map { "\($0)" } ?? "")
        _weeks = State(initialValue: project?.durationWeeks.map { "\($0)" } ?? "")
        _imageUrls = State(initialValue: project?.imageUrls ?? [])
        _beforeImageUrls = State(initialValue: project?.beforeImageUrls ?? [])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Project") {
                    TextField("Title (e.g. Modern Kitchen Remodel)", text: $title)
                    TextField("Category (e.g. Kitchen)", text: $category)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section("Cost range") {
                    HStack {
                        Text("$")
                        TextField("Min", text: $costMin).keyboardType(.numberPad)
                        Text("–")
                        TextField("Max", text: $costMax).keyboardType(.numberPad)
                    }
                }
                Section("Timeline") {
                    HStack {
                        TextField("Duration", text: $weeks).keyboardType(.numberPad)
                        Text("weeks").foregroundStyle(.secondary)
                    }
                }
                if isEditing {
                    photosSection
                    beforePhotosSection
                } else {
                    newPhotosSection
                }
                if let project, let s = project.approvalStatus, s != .approved {
                    Section {
                        Label(s.label, systemImage: s.systemImage)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(s == .rejected ? .orange : .blue)
                        if s == .rejected, let r = project.rejectionReason, !r.isEmpty {
                            Text(r).font(.caption).foregroundStyle(.secondary)
                        } else if s == .pending {
                            Text("This project is waiting for an admin to approve it. It won't be visible on your public profile yet.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }
                if isEditing && onDelete != nil {
                    Section {
                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            HStack {
                                if isDeleting { ProgressView() }
                                Label("Delete project", systemImage: "trash")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .disabled(isDeleting)
                    } footer: {
                        Text("Permanently removes this project from your portfolio. Photos stay in cloud storage but aren't shown anywhere.")
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Project" : "New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() }
                    else {
                        Button(isEditing ? "Save" : "Add") { Task { await save() } }
                            .bold().disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .alert("Delete this project?", isPresented: $showDeleteConfirm) {
                Button("Delete", role: .destructive) { Task { await deleteProject() } }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This can't be undone.")
            }
        }
    }

    private func deleteProject() async {
        guard let project, let onDelete else { return }
        isDeleting = true
        error = nil
        do {
            try await APIService.shared.deletePortfolioProject(
                businessId: businessId, projectId: project.id)
            onDelete(project.id)
            dismiss()
        } catch {
            isDeleting = false
            self.error = error.localizedDescription
        }
    }

    // MARK: - Photos editor

    /// Photos picker for a NEW project. Photos are staged locally (we don't have
    /// a projectId to upload against yet) and uploaded right after the project is
    /// created on save. Thumbnails render straight from the picked data.
    private var newPhotosSection: some View {
        Section {
            if !stagedImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(stagedImages.enumerated()), id: \.offset) { idx, data in
                            ZStack(alignment: .topTrailing) {
                                if let ui = UIImage(data: data) {
                                    Image(uiImage: ui).resizable().scaledToFill()
                                        .frame(width: 96, height: 96)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                                Button {
                                    stagedImages.remove(at: idx)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(.white, .black.opacity(0.7))
                                }
                                .padding(4)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            PhotosPicker(selection: $newPicker, maxSelectionCount: 10, matching: .images) {
                Label("Add photos", systemImage: "photo.on.rectangle.angled")
            }
            .onChange(of: newPicker) { _, items in
                guard !items.isEmpty else { return }
                Task { await stagePicked(items) }
            }
        } header: {
            Text("Photos")
        } footer: {
            Text("Photos upload when you add the project.")
        }
    }

    /// Load picked items into JPEG data staged for upload after creation.
    private func stagePicked(_ items: [PhotosPickerItem]) async {
        var loaded: [Data] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                loaded.append(UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data)
            }
        }
        stagedImages.append(contentsOf: loaded)
        newPicker = []
    }

    /// Grid of existing photos with per-photo delete + a PhotosPicker for
    /// adding more. Used when editing — uploads happen immediately against the
    /// existing projectId.
    private var photosSection: some View {
        Section("Photos") {
            if !imageUrls.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(imageUrls, id: \.self) { url in
                            ZStack(alignment: .topTrailing) {
                                AsyncImage(url: URL(string: url)) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: {
                                    Color(.systemGray5)
                                }
                                .frame(width: 96, height: 96)
                                .clipShape(RoundedRectangle(cornerRadius: 10))

                                Button {
                                    Task { await deleteImage(url) }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(.white, .black.opacity(0.7))
                                }
                                .padding(4)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Text("No photos yet. Add a few before resubmitting — they're the first thing homeowners look at.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            PhotosPicker(selection: $picker, maxSelectionCount: 10, matching: .images) {
                HStack {
                    Label(uploading ? "Uploading…" : "Add photos", systemImage: "photo.on.rectangle.angled")
                    Spacer()
                    if uploading { ProgressView() }
                }
            }
            .disabled(uploading)
            .onChange(of: picker) { _, items in
                guard !items.isEmpty else { return }
                Task { await uploadPicked(items, type: "after") }
            }
        }
    }

    /// Optional Before & After: contractors can add "before" photos that pair
    /// with the results above, shown as Before & After in their profile + the
    /// Inspiration feed.
    private var beforePhotosSection: some View {
        Section {
            if !beforeImageUrls.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(beforeImageUrls, id: \.self) { url in
                            ZStack(alignment: .topTrailing) {
                                AsyncImage(url: URL(string: url)) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: { Color(.systemGray5) }
                                .frame(width: 96, height: 96)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                Button {
                                    Task { await deleteImage(url) }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title3).foregroundStyle(.white, .black.opacity(0.7))
                                }
                                .padding(4)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            PhotosPicker(selection: $beforePicker, maxSelectionCount: 10, matching: .images) {
                HStack {
                    Label(uploadingBefore ? "Uploading…" : "Add 'before' photos", systemImage: "photo.badge.plus")
                    Spacer()
                    if uploadingBefore { ProgressView() }
                }
            }
            .disabled(uploadingBefore)
            .onChange(of: beforePicker) { _, items in
                guard !items.isEmpty else { return }
                Task { await uploadPicked(items, type: "before") }
            }
        } header: {
            Text("Before & After (optional)")
        } footer: {
            Text("Add the \u{201C}before\u{201D} shots that match your results above — before/afters stand out in the Inspiration feed.")
        }
    }

    /// Convert PhotosPicker items to JPEG `Data`, upload them in one multipart
    /// POST, and merge the server's updated `imageUrls` into our state. The
    /// onSave callback is also fired so the list view rebinds in place.
    private func uploadPicked(_ items: [PhotosPickerItem], type: String) async {
        guard let project else { return }
        let isBefore = type == "before"
        if isBefore { uploadingBefore = true } else { uploading = true }
        defer {
            if isBefore { uploadingBefore = false; beforePicker = [] }
            else { uploading = false; picker = [] }
        }

        var payloads: [Data] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                payloads.append(data)
            }
        }
        guard !payloads.isEmpty else { return }
        do {
            let updated = try await APIService.shared.uploadPortfolioImages(
                businessId: businessId, projectId: project.id, images: payloads, type: type)
            apply(updated)
            onSave(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteImage(_ url: String) async {
        guard let project else { return }
        do {
            let updated = try await APIService.shared.deletePortfolioImage(
                businessId: businessId, projectId: project.id, url: url)
            apply(updated)
            onSave(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ p: PortfolioProject) {
        imageUrls = p.imageUrls
        beforeImageUrls = p.beforeImageUrls ?? []
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }
        let desc = description.isEmpty ? nil : description
        let cat = category.isEmpty ? nil : category
        let lo = Int(costMin.filter(\.isNumber))
        let hi = Int(costMax.filter(\.isNumber))
        let wk = Int(weeks.filter(\.isNumber))
        do {
            var saved: PortfolioProject
            if let project {
                saved = try await APIService.shared.updatePortfolioProject(
                    businessId: businessId, projectId: project.id,
                    title: title, description: desc, category: cat,
                    costMin: lo, costMax: hi, durationWeeks: wk)
            } else {
                saved = try await APIService.shared.createPortfolioProject(
                    businessId: businessId,
                    title: title, description: desc, category: cat,
                    costMin: lo, costMax: hi, durationWeeks: wk)
                // Upload any photos staged before the project existed.
                if !stagedImages.isEmpty {
                    saved = try await APIService.shared.uploadPortfolioImages(
                        businessId: businessId, projectId: saved.id, images: stagedImages)
                }
            }
            onSave(saved)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
