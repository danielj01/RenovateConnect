import SwiftUI
import PhotosUI
import UIKit

/// Contractor-side composer for the Inspiration feed.
///
/// Before this existed the feed could only mirror `PortfolioProject` rows, so
/// posting anything meant filing a completed project with a cost range and a
/// duration. A post is the lightweight path: a title, a caption, and an
/// ordered set of slides people swipe through. It never touches the profile's
/// price tier, which stays derived from real completed work.
///
/// Posts go through the same admin gate as portfolio projects — new ones are
/// PENDING, and editing an approved one puts it back in the queue (enforced
/// server-side in routes/inspirationPosts.js), so the status badge here is
/// showing the truth rather than guessing.
///
/// Hosted inside `PortfolioManagerView`'s navigation stack, which owns the
/// Projects / Inspiration segmented control and the "+" toolbar button.
struct InspirationPostsList: View {
    let businessId: String
    @Binding var showAdd: Bool

    @State private var posts: [InspirationPost] = []
    @State private var isLoading = true
    @State private var editing: InspirationPost?
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if posts.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showAdd) {
            InspirationPostEditorSheet(businessId: businessId, post: nil) { saved in
                posts.insert(saved, at: 0)
            }
        }
        .sheet(item: $editing) { post in
            InspirationPostEditorSheet(
                businessId: businessId,
                post: post,
                onSave: { saved in
                    if let i = posts.firstIndex(where: { $0.id == saved.id }) { posts[i] = saved }
                },
                onDelete: { id in posts.removeAll { $0.id == id } }
            )
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let error {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
                ForEach(posts) { post in
                    Button { editing = post } label: {
                        InspirationPostCard(post: post)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { editing = post } label: { Label("Edit", systemImage: "pencil") }
                        Button(role: .destructive) {
                            Task { await delete(post) }
                        } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 46)).foregroundStyle(.secondary)
            Text("Post straight to Inspiration").font(.headline)
            Text("Share a few photos of work in progress, a material you love, or a finished detail. Homeowners swipe through them in the Inspiration feed and can tap through to you — no full project write-up needed.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 32)
            Button { showAdd = true } label: {
                Label("Create a post", systemImage: "plus")
                    .font(.headline).frame(maxWidth: .infinity).frame(height: 50)
            }
            .buttonStyle(.borderedProminent).tint(Theme.primary)
            .padding(.horizontal, 40).padding(.top, 6)
        }
    }

    private func load() async {
        defer { isLoading = false }
        do {
            posts = try await APIService.shared.inspirationPosts(businessId: businessId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete(_ post: InspirationPost) async {
        do {
            try await APIService.shared.deleteInspirationPost(businessId: businessId, postId: post.id)
            posts.removeAll { $0.id == post.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Card

private struct InspirationPostCard: View {
    let post: InspirationPost

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 0) {
                if let first = post.imageUrls.first {
                    ZStack(alignment: .topTrailing) {
                        AsyncImage(url: URL(string: first)) { phase in
                            switch phase {
                            case .success(let image): image.resizable().scaledToFill()
                            case .failure: Color(.systemGray5).overlay(Image(systemName: "photo").foregroundStyle(.secondary))
                            default: Color(.systemGray6).overlay(ProgressView())
                            }
                        }
                        .frame(height: 170)
                        .frame(maxWidth: .infinity)
                        .clipped()

                        if post.imageUrls.count > 1 {
                            HStack(spacing: 3) {
                                Image(systemName: "square.stack.fill").font(.caption2)
                                Text("\(post.imageUrls.count)").font(.caption2.weight(.bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 4)
                            .background(.black.opacity(0.45), in: Capsule())
                            .padding(8)
                        }
                    }
                } else {
                    // A post with no slides can't reach the feed — say so here
                    // rather than letting the contractor wonder why it never
                    // shows up after approval.
                    HStack(spacing: 8) {
                        Image(systemName: "photo.badge.plus").foregroundStyle(.secondary)
                        Text("No photos yet — add at least one to appear in the feed")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Color(.systemGray6))
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(post.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                    if let caption = post.caption, !caption.isEmpty {
                        Text(caption).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    HStack(spacing: 8) {
                        if let category = post.category, !category.isEmpty {
                            Text(category).font(.caption2)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color(.systemGray6), in: Capsule())
                        }
                        if let cost = post.costRangeText {
                            Text(cost).font(.caption.weight(.semibold)).foregroundStyle(Theme.primary)
                        }
                        Spacer(minLength: 0)
                        if let status = post.approvalStatus {
                            Label(status.label, systemImage: status.systemImage)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(statusColor(status))
                        }
                    }
                    if post.approvalStatus == .rejected, let reason = post.rejectionReason, !reason.isEmpty {
                        Text(reason).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(14)
            }
        }
    }

    private func statusColor(_ status: ApprovalStatus) -> Color {
        switch status {
        case .approved: return Theme.success
        case .rejected: return .orange
        case .pending:  return .blue
        }
    }
}

// MARK: - Editor

private struct InspirationPostEditorSheet: View {
    let businessId: String
    let post: InspirationPost?
    var onSave: (InspirationPost) -> Void
    /// Present only when editing — the parent drops the row when this fires.
    var onDelete: ((String) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var caption: String
    @State private var category: String
    @State private var costMin: String
    @State private var costMax: String
    @State private var isSaving = false
    @State private var isDeleting = false
    @State private var showDeleteConfirm = false
    @State private var error: String?

    // Slides on an existing post upload immediately against its id.
    @State private var imageUrls: [String]
    @State private var picker: [PhotosPickerItem] = []
    @State private var uploading = false

    // Optional "before" shots, paired by order with the slides above.
    @State private var beforeImageUrls: [String]
    @State private var beforePicker: [PhotosPickerItem] = []
    @State private var uploadingBefore = false

    // A NEW post has no id to upload against yet, so picked photos are staged
    // as JPEG data and uploaded right after it's created (see `save()`).
    @State private var newPicker: [PhotosPickerItem] = []
    @State private var stagedImages: [Data] = []

    private var isEditing: Bool { post != nil }

    init(businessId: String, post: InspirationPost?,
         onSave: @escaping (InspirationPost) -> Void,
         onDelete: ((String) -> Void)? = nil) {
        self.businessId = businessId
        self.post = post
        self.onSave = onSave
        self.onDelete = onDelete
        _title = State(initialValue: post?.title ?? "")
        _caption = State(initialValue: post?.caption ?? "")
        _category = State(initialValue: post?.category ?? "")
        _costMin = State(initialValue: post?.costMin.map { "\($0)" } ?? "")
        _costMax = State(initialValue: post?.costMax.map { "\($0)" } ?? "")
        _imageUrls = State(initialValue: post?.imageUrls ?? [])
        _beforeImageUrls = State(initialValue: post?.befores ?? [])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title (e.g. Herringbone backsplash)", text: $title)
                    TextField("Caption", text: $caption, axis: .vertical)
                        .lineLimit(2...6)
                    TextField("Category (e.g. Kitchen)", text: $category)
                } header: {
                    Text("Post")
                } footer: {
                    Text("The caption shows under your name in the feed. Keep it short — people are swiping.")
                }

                Section {
                    HStack {
                        Text("$")
                        TextField("Min", text: $costMin).keyboardType(.numberPad)
                        Text("–")
                        TextField("Max", text: $costMax).keyboardType(.numberPad)
                    }
                } header: {
                    Text("Ballpark cost (optional)")
                } footer: {
                    Text("Shown on the post, and used when a homeowner taps \u{201C}Quote this\u{201D} — without it we run the AI estimator on your photo instead.")
                }

                if isEditing {
                    slidesSection
                    beforeSlidesSection
                } else {
                    newSlidesSection
                }

                if let post, let status = post.approvalStatus, status != .approved {
                    Section {
                        Label(status.label, systemImage: status.systemImage)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(status == .rejected ? .orange : .blue)
                        if status == .rejected, let reason = post.rejectionReason, !reason.isEmpty {
                            Text(reason).font(.caption).foregroundStyle(.secondary)
                        } else if status == .pending {
                            Text("This post is waiting for an admin to approve it. It won't appear in the Inspiration feed yet.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }

                if isEditing {
                    Section {
                        Text("Editing a live post sends it back for review before it returns to the feed.")
                            .font(.caption).foregroundStyle(.secondary)
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
                                Label("Delete post", systemImage: "trash")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .disabled(isDeleting)
                    } footer: {
                        Text("Permanently removes this post from the Inspiration feed. Photos stay in cloud storage but aren't shown anywhere.")
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Post" : "New Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() }
                    else {
                        Button(isEditing ? "Save" : "Post") { Task { await save() } }
                            .bold().disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .alert("Delete this post?", isPresented: $showDeleteConfirm) {
                Button("Delete", role: .destructive) { Task { await deletePost() } }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This can't be undone.")
            }
        }
    }

    // MARK: Slides

    /// Photos picker for a NEW post — staged locally (there's no post id to
    /// upload against yet) and uploaded right after it's created on save.
    private var newSlidesSection: some View {
        Section {
            if !stagedImages.isEmpty {
                thumbnailStrip {
                    ForEach(Array(stagedImages.enumerated()), id: \.offset) { idx, data in
                        ZStack(alignment: .topTrailing) {
                            if let ui = UIImage(data: data) {
                                Image(uiImage: ui).resizable().scaledToFill()
                                    .frame(width: 96, height: 96)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            removeButton { stagedImages.remove(at: idx) }
                        }
                    }
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
            Text("Slides")
        } footer: {
            Text("Photos upload when you post. They appear in order — swipe left and right in the feed.")
        }
    }

    private var slidesSection: some View {
        Section {
            if !imageUrls.isEmpty {
                thumbnailStrip {
                    ForEach(imageUrls, id: \.self) { url in
                        ZStack(alignment: .topTrailing) {
                            remoteThumbnail(url)
                            removeButton { Task { await deleteImage(url) } }
                        }
                    }
                }
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
        } header: {
            Text("Slides")
        } footer: {
            Text("Swiped left-to-right in the feed, in this order.")
        }
    }

    private var beforeSlidesSection: some View {
        Section {
            if !beforeImageUrls.isEmpty {
                thumbnailStrip {
                    ForEach(beforeImageUrls, id: \.self) { url in
                        ZStack(alignment: .topTrailing) {
                            remoteThumbnail(url)
                            removeButton { Task { await deleteImage(url) } }
                        }
                    }
                }
            }
            PhotosPicker(selection: $beforePicker, maxSelectionCount: 10, matching: .images) {
                HStack {
                    Label(uploadingBefore ? "Uploading…" : "Add \u{201C}before\u{201D} photos", systemImage: "photo.badge.plus")
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
            Text("Each \u{201C}before\u{201D} pairs with the slide in the same position, so viewers can flip that slide back and forth.")
        }
    }

    private func thumbnailStrip<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) { content() }.padding(.vertical, 4)
        }
    }

    private func remoteThumbnail(_ url: String) -> some View {
        AsyncImage(url: URL(string: url)) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            case .failure: Color(.systemGray5).overlay(Image(systemName: "photo").foregroundStyle(.secondary))
            default: Color(.systemGray6).overlay(ProgressView())
            }
        }
        .frame(width: 96, height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func removeButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill")
                .font(.title3)
                .foregroundStyle(.white, .black.opacity(0.7))
        }
        .buttonStyle(.plain)
        .padding(4)
    }

    // MARK: Actions

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

    private func uploadPicked(_ items: [PhotosPickerItem], type: String) async {
        guard let post else { return }
        let isBefore = type == "before"
        if isBefore { uploadingBefore = true } else { uploading = true }
        defer {
            if isBefore { uploadingBefore = false; beforePicker = [] }
            else { uploading = false; picker = [] }
        }

        var payloads: [Data] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                payloads.append(UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data)
            }
        }
        guard !payloads.isEmpty else { return }
        do {
            let updated = try await APIService.shared.uploadInspirationImages(
                businessId: businessId, postId: post.id, images: payloads, type: type)
            apply(updated)
            onSave(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteImage(_ url: String) async {
        guard let post else { return }
        do {
            let updated = try await APIService.shared.deleteInspirationImage(
                businessId: businessId, postId: post.id, url: url)
            apply(updated)
            onSave(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ p: InspirationPost) {
        imageUrls = p.imageUrls
        beforeImageUrls = p.befores
    }

    private func deletePost() async {
        guard let post, let onDelete else { return }
        isDeleting = true
        error = nil
        do {
            try await APIService.shared.deleteInspirationPost(businessId: businessId, postId: post.id)
            onDelete(post.id)
            dismiss()
        } catch {
            isDeleting = false
            self.error = error.localizedDescription
        }
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }
        let cap = caption.isEmpty ? nil : caption
        let cat = category.isEmpty ? nil : category
        let lo = Int(costMin.filter(\.isNumber))
        let hi = Int(costMax.filter(\.isNumber))
        do {
            var saved: InspirationPost
            if let post {
                saved = try await APIService.shared.updateInspirationPost(
                    businessId: businessId, postId: post.id,
                    title: title, caption: cap, category: cat, costMin: lo, costMax: hi)
            } else {
                saved = try await APIService.shared.createInspirationPost(
                    businessId: businessId,
                    title: title, caption: cap, category: cat, costMin: lo, costMax: hi)
                if !stagedImages.isEmpty {
                    saved = try await APIService.shared.uploadInspirationImages(
                        businessId: businessId, postId: saved.id, images: stagedImages)
                }
            }
            onSave(saved)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
