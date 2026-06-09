import SwiftUI
import PhotosUI
import UIKit

struct MessagingView: View {
    let conversation: Conversation
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var isSending = false
    @State private var otherLastReadAt: Date?
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var attachments: [Data] = []
    @State private var zoomed: ZoomedImage?
    @State private var reportTarget: ReportTargetSpec?
    @State private var showBlockConfirm = false
    @State private var blockError: String?
    @State private var didBlock = false
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var inbox: InboxStore
    @EnvironmentObject private var notifications: NotificationManager

    /// The user id on the other side of this thread. CLIENT viewers see the
    /// business owner's userId; BUSINESS viewers see the homeowner's clientId.
    private var otherUserId: String? {
        guard let me = auth.currentUser else { return nil }
        return me.role == .business ? conversation.clientId : conversation.business?.userId
    }

    /// The last message the current user sent (receipts only apply to your own).
    private var myLastMessage: ChatMessage? {
        messages.last { $0.senderId == auth.currentUser?.id }
    }

    /// Show a receipt only when the most recent message in the thread is mine.
    private var showsReceipt: Bool {
        messages.last?.senderId == auth.currentUser?.id && myLastMessage != nil
    }

    /// "Seen" once the other participant's last-read time is at or after my
    /// latest message; otherwise "Sent".
    private var receiptText: String {
        guard let sentAt = myLastMessage?.createdAt.iso8601Date else { return "Sent" }
        if let read = otherLastReadAt, read >= sentAt { return "Seen" }
        return "Sent"
    }

    private var canSend: Bool {
        !(input.trimmingCharacters(in: .whitespaces).isEmpty && attachments.isEmpty) && !isSending
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(messages) { msg in
                            let isMe = msg.senderId == auth.currentUser?.id
                            VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
                                if !msg.images.isEmpty {
                                    imageBubble(msg, isMe: isMe)
                                }
                                if msg.hasText {
                                    ChatBubble(text: msg.body, isUser: isMe)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: isMe ? .trailing : .leading)
                            .id(msg.id)
                        }

                        if showsReceipt {
                            HStack(spacing: 3) {
                                Image(systemName: receiptText == "Seen" ? "checkmark.circle.fill" : "checkmark.circle")
                                Text(receiptText)
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.trailing, 4)
                            .transition(.opacity)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            inputBar
        }
        .navigationTitle(conversation.business?.companyName ?? "Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(ModerationModifier(
            otherUserId: otherUserId,
            reportTarget: $reportTarget,
            showBlockConfirm: $showBlockConfirm,
            blockError: $blockError,
            didBlock: $didBlock,
            performBlock: { await performBlock() }
        ))
        .fullScreenCover(item: $zoomed) { z in
            ImageZoomView(url: z.url) { zoomed = nil }
        }
        .onChange(of: pickerItems) { _, items in
            Task { await loadAttachments(items) }
        }
        .task {
            await load()
            // Poll the other party's read state while the thread is open so the
            // "Seen" receipt updates live. Cancelled automatically on disappear.
            await pollReceipts()
        }
    }

    // MARK: - Subviews

    private var inputBar: some View {
        VStack(spacing: 8) {
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(attachments.enumerated()), id: \.offset) { idx, data in
                            if let ui = UIImage(data: data) {
                                Image(uiImage: ui)
                                    .resizable().scaledToFill()
                                    .frame(width: 56, height: 56)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(alignment: .topTrailing) {
                                        Button {
                                            attachments.remove(at: idx)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(.white, .black.opacity(0.5))
                                        }
                                        .padding(2)
                                    }
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            }

            HStack(spacing: 10) {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: 5, matching: .images) {
                    Image(systemName: "photo.on.rectangle.angled").font(.title3)
                }
                TextField("Message…", text: $input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                Button {
                    Task { await send() }
                } label: {
                    if isSending {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                }
                .disabled(!canSend)
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }

    private func imageBubble(_ msg: ChatMessage, isMe: Bool) -> some View {
        HStack {
            if isMe { Spacer(minLength: 40) }
            VStack(alignment: isMe ? .trailing : .leading, spacing: 6) {
                ForEach(msg.images, id: \.self) { urlStr in
                    Button { zoomed = ZoomedImage(url: urlStr) } label: {
                        AsyncImage(url: URL(string: urlStr)) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            case .failure:
                                Color(.systemGray5).overlay(Image(systemName: "photo").foregroundStyle(.secondary))
                            default:
                                Color(.systemGray6).overlay(ProgressView())
                            }
                        }
                        .frame(width: 200, height: 200)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                }
            }
            if !isMe { Spacer(minLength: 40) }
        }
    }

    // MARK: - Data

    private func load() async {
        messages = (try? await APIService.shared.getMessages(conversationId: conversation.id)) ?? []
        // Opening the thread marks it read; refresh the inbox badge.
        try? await APIService.shared.markConversationRead(conversationId: conversation.id)
        await inbox.refresh()
        await refreshReceipt()
    }

    private func loadAttachments(_ items: [PhotosPickerItem]) async {
        var datas: [Data] = []
        for item in items {
            if let raw = try? await item.loadTransferable(type: Data.self),
               let jpeg = Self.downscaledJPEG(raw) {
                datas.append(jpeg)
            }
        }
        attachments = datas
    }

    private func send() async {
        let body = input.trimmingCharacters(in: .whitespaces)
        let imgs = attachments
        guard !body.isEmpty || !imgs.isEmpty else { return }
        input = ""
        attachments = []
        pickerItems = []
        isSending = true
        defer { isSending = false }
        do {
            let msg = imgs.isEmpty
                ? try await APIService.shared.sendMessage(conversationId: conversation.id, body: body)
                : try await APIService.shared.sendMessage(conversationId: conversation.id, body: body, images: imgs)
            withAnimation { messages.append(msg) }
            // First real engagement → a great moment to ask for push permission.
            notifications.considerPriming()
        } catch {
            // Restore the text so a failed send isn't silently lost.
            input = body
        }
    }

    /// Downscale to keep uploads well under the server's 10MB/file cap.
    private static func downscaledJPEG(_ data: Data, maxDimension: CGFloat = 2000) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let size = image.size
        let scale = min(1, maxDimension / max(size.width, size.height))
        if scale >= 1 { return image.jpegData(compressionQuality: 0.7) }
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
        return resized.jpegData(compressionQuality: 0.7)
    }

    /// Pull the latest read timestamps and keep the receipt for the *other*
    /// participant (the one who would have "seen" my messages).
    private func refreshReceipt() async {
        guard let fresh = try? await APIService.shared.getConversation(id: conversation.id) else { return }
        let stamp = auth.currentUser?.role == .client
            ? fresh.businessLastReadAt
            : fresh.clientLastReadAt
        withAnimation { otherLastReadAt = stamp?.iso8601Date }
    }

    private func pollReceipts() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(5))
            if Task.isCancelled { break }
            await refreshReceipt()
        }
    }

    private func performBlock() async {
        guard let uid = otherUserId else { return }
        do {
            try await APIService.shared.block(userId: uid)
            await inbox.refresh()
            didBlock = true
        } catch {
            blockError = error.localizedDescription
        }
    }
}

/// Identifies what's being reported, for `.sheet(item:)` presentation.
struct ReportTargetSpec: Identifiable {
    let type: ReportSheet.TargetType
    let targetId: String
    var id: String { "\(type.rawValue)-\(targetId)" }
}

/// Bundles the toolbar/menu + report sheet + block confirm/alerts in a
/// single ViewModifier so the body of MessagingView doesn't blow past the
/// SwiftUI type checker's complexity budget.
private struct ModerationModifier: ViewModifier {
    let otherUserId: String?
    @Binding var reportTarget: ReportTargetSpec?
    @Binding var showBlockConfirm: Bool
    @Binding var blockError: String?
    @Binding var didBlock: Bool
    let performBlock: () async -> Void

    func body(content: Content) -> some View {
        content
            .toolbar { toolbarContent }
            .sheet(item: $reportTarget) { spec in
                ReportSheet(targetType: spec.type, targetId: spec.targetId)
            }
            .confirmationDialog("Block this user?",
                                isPresented: $showBlockConfirm,
                                titleVisibility: .visible) {
                Button("Block", role: .destructive) { Task { await performBlock() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("They won't be able to message you, and this conversation will disappear from both sides.")
            }
            .alert("Couldn't block",
                   isPresented: Binding(get: { blockError != nil },
                                        set: { if !$0 { blockError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(blockError ?? "") }
            .alert("User blocked", isPresented: $didBlock) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("You can unblock them later from Profile → Blocked Users.")
            }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if let uid = otherUserId {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) {
                        reportTarget = ReportTargetSpec(type: .user, targetId: uid)
                    } label: {
                        Label("Report this user", systemImage: "flag")
                    }
                    Button(role: .destructive) { showBlockConfirm = true } label: {
                        Label("Block this user", systemImage: "hand.raised")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(Color(.label))
                }
                .accessibilityLabel("More options")
            }
        }
    }
}

/// Wrapper so an image URL can drive `.fullScreenCover(item:)`.
private struct ZoomedImage: Identifiable {
    let id = UUID()
    let url: String
}

/// Full-screen, pinch-to-dismiss-ish image viewer.
private struct ImageZoomView: View {
    let url: String
    let onClose: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            AsyncImage(url: URL(string: url)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Image(systemName: "photo").font(.largeTitle).foregroundStyle(.white.opacity(0.6))
                default:
                    ProgressView().tint(.white)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title)
                    .foregroundStyle(.white, .black.opacity(0.4))
                    .padding()
            }
            .accessibilityLabel("Close")
        }
        .onTapGesture { onClose() }
    }
}

private extension String {
    /// Parse an ISO-8601 timestamp (with or without fractional seconds) to Date.
    var iso8601Date: Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: self) ?? ISO8601DateFormatter().date(from: self)
    }
}
