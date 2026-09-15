import SwiftUI
import PhotosUI

// MARK: - Estimate tab (intro → form)

/// The Estimate tab opens on a value-prop landing that explains the AI cost
/// estimator and how it works, then leads into the photo/details form.
struct EstimationView: View {
    var body: some View {
        NavigationStack {
            EstimatorIntroView()
        }
    }
}

// MARK: - Intro / value-prop landing

/// Wrapper so a share code can drive `.sheet(item:)` (String isn't Identifiable).
private struct PresentedEstimateCode: Identifiable { let id = UUID(); let value: String }

private struct EstimatorIntroView: View {
    @State private var showCodeEntry = false
    @State private var codeInput = ""
    @State private var presentedCode: PresentedEstimateCode?

    // Explain the starting estimate and the details a contractor still needs to confirm.
    private let steps: [(icon: String, title: String, detail: String)] = [
        ("photo.badge.plus", "Add a few photos",
         "Snap or upload up to 5 photos of the space you want to renovate."),
        ("sparkles", "AI sizes up the work",
         "Uses visible details to suggest a starting scope. Measurements and site conditions still need checking."),
        ("list.bullet.rectangle.portrait", "Get an itemized range",
         "Review estimated costs, then discuss the work with a contractor."),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                hero
                cta
                disclaimer
                howItWorks
                codeEntryButton
            }
            .padding(20)
        }
        .background(Color(.systemBackground))
        .navigationTitle("Cost Estimator")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Enter your estimate code", isPresented: $showCodeEntry) {
            TextField("e.g. ABCD-2345", text: $codeInput)
                .textInputAutocapitalization(.characters)
            Button("View estimate") {
                let c = codeInput.trimmingCharacters(in: .whitespacesAndNewlines)
                if !c.isEmpty { presentedCode = PresentedEstimateCode(value: c) }
                codeInput = ""
            }
            Button("Cancel", role: .cancel) { codeInput = "" }
        } message: {
            Text("Saved an estimate on the web? Enter the code from that page to pull it up here.")
        }
        .sheet(item: $presentedCode) { code in
            SavedEstimateView(code: code.value)
                .environmentObject(TabRouter.shared)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "camera.viewfinder")
                .font(.largeTitle).foregroundStyle(Theme.primary)
                .frame(width: 64, height: 64)
                .background(Theme.primaryLight, in: RoundedRectangle(cornerRadius: 18))
            Text("Plan your renovation\nwith a clearer budget.")
                .font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
            Text("Add photos of your space for a starting cost range. Refine the details with a contractor when you’re ready.")
                .font(.body).foregroundStyle(.secondary)
            Label("Free · No commitment", systemImage: "checkmark.circle")
                .font(.subheadline.weight(.medium)).foregroundStyle(Theme.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
    }

    // New-install fallback for the saved-estimate handoff: type the code shown on
    // the web /e/<code> page.
    private var codeEntryButton: some View {
        Button { showCodeEntry = true } label: {
            Text("Have an estimate code from the web?")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primary)
        }
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("How it works").font(.headline)
            ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                HStack(alignment: .top, spacing: 14) {
                    ZStack {
                        Circle().fill(Theme.primaryLight).frame(width: 40, height: 40)
                        Image(systemName: step.icon)
                            .foregroundStyle(Theme.primary)
                            .font(.system(size: 17, weight: .semibold))
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(step.title).font(.subheadline.weight(.semibold))
                        Text(step.detail).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: Theme.cardShadow, radius: 12, y: 4)
    }

    private var cta: some View {
        NavigationLink {
            EstimatorFormView()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "wand.and.stars")
                Text("Start your estimate").font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity).frame(minHeight: 54)
            .padding(.vertical, 4)
            .background(Theme.primary)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Theme.primary.opacity(0.12), radius: 12, y: 6)
        }
    }

    private var disclaimer: some View {
        Text("Estimates are AI-generated guidance, not a formal quote. Final pricing comes from a contractor.")
            .font(.caption2).foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 8)
    }
}

// MARK: - Estimator form

private struct EstimatorFormView: View {
    @State private var showAIConsent = false
    // Pops this view off the NavigationStack it was pushed onto (back to
    // EstimatorIntroView) — distinct from EstimationResultView's own
    // \.dismiss, which closes its sheet. SwiftUI resolves each to the right
    // action for how that particular view was presented.
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @FocusState private var detailsFocused: Bool
    @State private var isImportingPhotos = false
    @EnvironmentObject private var auth: AuthStore
    @State private var selectedItems: [PhotosPickerItem] = []
    // One source of truth for both sources. The library picker used to replace
    // this outright, which would have silently dropped a camera photo the
    // moment someone also picked from their library — both now append.
    @State private var selectedImages: [UIImage] = []
    @State private var showCamera = false
    private let maxPhotos = 5
    @State private var roomType = ""
    // Mid-range by default: the most common choice, and it means the estimate
    // comes back narrow out of the box rather than only once someone finds
    // this control. Pinning the finish level is what removes most of the
    // low–high spread (see FINISH_GUIDANCE in the API's services/ai.js).
    @State private var costTier: CostTier = .medium
    @State private var description = ""
    @State private var estimation: Estimation?
    @State private var isLoading = false
    // Flips true once the real network call has actually succeeded, so the
    // loading screen can visibly finish the bar instead of freezing mid-fill
    // and vanishing the instant the response lands.
    @State private var loadingComplete = false
    @State private var error: String?

    let roomTypes = ["Kitchen", "Bathroom", "Living Room", "Bedroom", "Basement", "Garage", "Exterior", "Other"]

    var body: some View {
        Group {
            if isLoading {
                EstimateLoadingView(isComplete: $loadingComplete)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Tell us about your space")
                                .font(.title2.bold())
                            Text("Add a photo, then choose the finish you have in mind.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }

                        photosSection
                        roomSection
                        finishSection
                        detailsSection

                        if let error {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.subheadline).foregroundStyle(.red)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("estimate.error")
                        }
                    }
                    .padding(20)
                }
                .scrollDismissesKeyboard(.interactively)
                .background(Color(.systemGroupedBackground))
                .safeAreaInset(edge: .bottom, spacing: 0) { estimateAction }

            }
        }
        .navigationTitle("New Estimate")
        .navigationBarTitleDisplayMode(.inline)
        .tint(Theme.primary)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { detailsFocused = false }
            }
        }
        .onChange(of: selectedItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await appendPicked(items) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                selectedImages = Array((selectedImages + [image]).prefix(maxPhotos))
            }
            .ignoresSafeArea()
        }
        .sheet(item: $estimation, onDismiss: {
            // Once the result's been viewed and closed, pop back to the cost
            // estimator landing page rather than leaving a stale,
            // already-filled-in upload form sitting on the stack — there's no
            // reason to linger there once you have your number, and starting
            // a new estimate should start clean.
            dismiss()
        }) { est in
            EstimationResultView(estimation: est)
        }
    }

    private var photosSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Photos", systemImage: "photo.on.rectangle.angled").font(.headline)
                Spacer()
                Text("\(selectedImages.count) / \(maxPhotos)")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                    .accessibilityLabel("\(selectedImages.count) of \(maxPhotos) photos added")
            }

            if selectedImages.isEmpty {
                libraryPicker
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(Array(selectedImages.enumerated()), id: \.offset) { index, img in
                            Image(uiImage: img)
                                .resizable().scaledToFill()
                                .frame(width: 104, height: 104)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .overlay(alignment: .topTrailing) {
                                    Button { selectedImages.remove(at: index) } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.title3).foregroundStyle(.white, .black.opacity(0.7))
                                            .frame(width: 44, height: 44)
                                    }
                                    .accessibilityLabel("Remove photo \(index + 1)")
                                }
                        }
                    }
                }
                libraryPicker
            }

            if CameraPicker.isAvailable {
                Button { showCamera = true } label: {
                    Label("Take a photo", systemImage: "camera")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(isPhotoLimitReached || isImportingPhotos)
            }
            Text(isPhotoLimitReached ? "All five photos added. Remove one to replace it." : "One wide shot is enough to start. Add details from other angles if you have them.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var libraryPicker: some View {
        PhotosPicker(selection: $selectedItems,
                     maxSelectionCount: max(1, maxPhotos - selectedImages.count),
                     matching: .images) {
            VStack(spacing: 10) {
                if selectedImages.isEmpty {
                    Image(systemName: "photo.badge.plus")
                        .font(.system(size: 30, weight: .medium))
                    Text("Add room photos").font(.headline)
                    Text("Choose from your photo library")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Label("Add more photos", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                }
                if isImportingPhotos { ProgressView("Adding photos…") }
            }
            .foregroundStyle(Theme.primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, selectedImages.isEmpty ? 24 : 12)
            .padding(.horizontal, 16)
            .background(Theme.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(Theme.primary.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [6, 5]))
            }
        }
        .accessibilityLabel("Choose from library")
        .disabled(isPhotoLimitReached || isImportingPhotos)
    }

    private var roomSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeading("Room", optional: true)
            Picker("Room type", selection: $roomType) {
                Text("Not specified").tag("")
                ForEach(roomTypes, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private var finishSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeading("Finish level")
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 10))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
            layout {
                ForEach(CostTier.allCases) { tier in
                    Button { costTier = tier } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(tier.dollars).font(.headline)
                                Spacer(minLength: 4)
                                Image(systemName: costTier == tier ? "checkmark.circle.fill" : "circle")
                                    .font(.subheadline)
                            }
                            Text(tier.label).font(.subheadline.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .foregroundStyle(costTier == tier ? Theme.primary : Color.primary)
                        .frame(maxWidth: .infinity, minHeight: dynamicTypeSize.isAccessibilitySize ? 44 : 64, alignment: .topLeading)
                        .padding(12)
                        .background(costTier == tier ? Theme.primary.opacity(0.08) : Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16)
                                .strokeBorder(costTier == tier ? Theme.primary : Color.primary.opacity(0.08), lineWidth: costTier == tier ? 1.5 : 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(tier.label) finish")
                    .accessibilityAddTraits(costTier == tier ? .isSelected : [])
                    .accessibilityIdentifier("estimate.finish.\(tier.rawValue)")
                }
            }
            Text(costTier.estimateHint)
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeading("What would you like to change?", optional: true)
            TextField("For example, replace the cabinets and keep the current layout…", text: $description, axis: .vertical)
                .font(.body).lineLimit(3...6)
                .focused($detailsFocused)
                .accessibilityLabel("Project details")
                .padding(16)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func sectionHeading(_ title: String, optional: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            if optional { Text("Optional").font(.caption).foregroundStyle(.secondary) }
        }
    }

    private var estimateAction: some View {
        VStack(spacing: 8) {
            Button {
                detailsFocused = false
                showAIConsent = true
            } label: {
                Label("Get AI estimate", systemImage: "sparkles")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .padding(.horizontal, 12)
                    .foregroundStyle(selectedImages.isEmpty || isImportingPhotos ? Color.secondary : .white)
                    .background(selectedImages.isEmpty || isImportingPhotos ? Color(.tertiarySystemFill) : Theme.primary, in: RoundedRectangle(cornerRadius: 16))
            }
            .disabled(selectedImages.isEmpty || isImportingPhotos)
            .accessibilityIdentifier("estimate.submit")
            .alert("Send these photos to AI?", isPresented: $showAIConsent) {
                Button("Send to AI") { Task { await submit() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your selected photos, room type, project description, and finish level will be sent to NVIDIA to generate an estimate. If needed, they may also be sent to Anthropic as a fallback. Only send photos you have permission to share. Cancel to keep them unsent.")
            }
            Text(selectedImages.isEmpty ? "Add at least one photo to continue" : "AI guidance · Final pricing comes from your contractor")
                .font(.caption).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 12)
        .background(.regularMaterial)
    }

    private var isPhotoLimitReached: Bool { selectedImages.count >= maxPhotos }

    /// Load the picked library items and append them. `selectedItems` is reset
    /// afterwards so picking the same photo again still registers as a change
    /// (same pattern as the portfolio editor).
    private func appendPicked(_ items: [PhotosPickerItem]) async {
        guard !isImportingPhotos else { return }
        isImportingPhotos = true
        defer { isImportingPhotos = false }
        var loaded: [UIImage] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let img = UIImage(data: data) {
                loaded.append(img)
            }
        }
        selectedImages = Array((selectedImages + loaded).prefix(maxPhotos))
        if loaded.count < items.count { error = "Some photos couldn’t be opened. Try selecting them again." }
        else { error = nil }
        selectedItems = []
    }

    private func submit() async {
        guard !selectedImages.isEmpty, !isLoading, !isImportingPhotos else { return }
        isLoading = true
        loadingComplete = false
        error = nil
        defer { isLoading = false }
        do {
            let imageData = selectedImages.compactMap { $0.jpegData(compressionQuality: 0.7) }
            let rt = roomType.isEmpty ? nil : roomType
            let desc = description.isEmpty ? nil : description
            if auth.isLoggedIn {
                estimation = try await APIService.shared.createEstimation(
                    images: imageData, roomType: rt, description: desc, costTier: costTier)
                // Push priming used to fire right here, but that races another
                // sheet (EstimationResultView, below) against MainTabView's own
                // .sheet(isPresented: $notifications.showPriming) — two sheet
                // presentations from different points in the hierarchy landing
                // near-simultaneously, which SwiftUI doesn't handle cleanly:
                // one wins and the other silently never appears (looked like
                // the estimate "going back to the upload screen" instead of
                // showing a result). Moved to EstimationResultView's
                // .onDisappear so it only fires once that sheet is actually
                // gone, not while it's trying to present.
            } else {
                // Guest path: run the estimate without an account, wrap the result
                // in a throwaway Estimation so the result UI is identical.
                let result = try await APIService.shared.guestEstimation(
                    images: imageData, roomType: rt, description: desc, costTier: costTier)
                estimation = Estimation(
                    id: UUID().uuidString,
                    imageUrls: [],
                    roomType: rt,
                    description: desc,
                    result: result,
                    createdAt: ISO8601DateFormatter().string(from: Date())
                )
            }
            // Let the bar visibly reach 100% before this view disappears,
            // rather than cutting away mid-animation. The animate() loop only
            // notices isComplete when it wakes from its own 300ms sleep, so
            // this needs enough margin for that worst case plus the 300ms
            // fill animation itself — 650ms covers both comfortably.
            loadingComplete = true
            try? await Task.sleep(nanoseconds: 650_000_000)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Loading state

/// A determinate-looking progress bar that isn't actually tracking real
/// progress (the API gives no intermediate signal) — it glides toward, but
/// never quite reaches, 93% and holds there for as long as the request takes,
/// so a slow response (this can run 15–40+ seconds depending on provider)
/// reads as "still working" instead of frozen. `isComplete` is a binding
/// rather than a plain value so the "jump to 100%" reaction sees the live
/// flag, not a stale copy from when the view first appeared.
///
/// See `climb()` for why the motion is computed here per frame rather than
/// handed to SwiftUI as one long `withAnimation`.
private struct EstimateLoadingView: View {
    @Binding var isComplete: Bool
    @State private var progress: Double = 0
    @State private var messageIndex = 0
    @State private var iconPulse = false

    private let messages = [
        "Analyzing your photos…",
        "Identifying materials and condition…",
        "Estimating labor and material costs…",
        "Pricing out the details…",
        "Wrapping up your estimate…",
    ]

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle().fill(Theme.primaryLight).frame(width: 90, height: 90)
                Image(systemName: "sparkles")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(Theme.primary)
                    .scaleEffect(iconPulse ? 1.12 : 0.92)
                    .animation(
                        .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                        value: iconPulse
                    )
            }
            .onAppear { iconPulse = true }

            VStack(spacing: 10) {
                Text(isComplete ? "Done!" : messages[messageIndex])
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .contentTransition(.opacity)
                    .animation(.easeInOut(duration: 0.25), value: isComplete)
                    .animation(.easeInOut(duration: 0.25), value: messageIndex)
                if !isComplete {
                    Text("This usually takes under a minute.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .transition(.opacity)
                }
            }
            .frame(height: 50)

            VStack(spacing: 8) {
                ProgressView(value: progress)
                    .tint(Theme.primary)
                    .frame(maxWidth: 260)
                Text("\(Int(progress * 100))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .task { await climb() }
        .onChange(of: isComplete) { _, done in
            guard done else { return }
            withAnimation(.easeOut(duration: 0.3)) { progress = 1.0 }
        }
    }

    /// Drives the bar frame by frame off an explicit easing curve rather than
    /// handing SwiftUI one long `withAnimation`.
    ///
    /// That was the original approach and it did not work: `withAnimation` sets
    /// the state value immediately and only interpolates *animatable rendered
    /// properties*, so `ProgressView` snapped rather than honouring a
    /// 22-second curve, and the `Text` percentage — which reads the state
    /// directly and isn't animatable at all — never moved off its start value.
    /// Computing the eased value here means the bar and the number are the same
    /// real state, updated together, which is also exactly how the web
    /// estimator does it.
    private func climb() async {
        let start = Date()
        while !Task.isCancelled && !isComplete {
            let elapsed = Date().timeIntervalSince(start)
            let t = min(elapsed / Self.climbSeconds, 1)
            // easeOutCubic — front-loaded, so a typical ~20s response already
            // reads as nearly done rather than sitting mid-bar when it lands.
            progress = (1 - pow(1 - t, 3)) * Self.climbTarget

            let index = min(Int(elapsed / Self.messageEvery), messages.count - 1)
            if index != messageIndex {
                withAnimation(.easeInOut(duration: 0.25)) { messageIndex = index }
            }

            // Parked at the target. Nothing left to move until the request
            // lands, which `onChange(of: isComplete)` picks up.
            if t >= 1 { break }
            try? await Task.sleep(nanoseconds: 16_000_000) // ~60fps
        }
    }

    /// Seconds to glide from empty to `climbTarget`.
    private static let climbSeconds: Double = 22
    /// Where the bar parks and waits. Never 1.0 — the request isn't done yet.
    private static let climbTarget: Double = 0.93
    private static let messageEvery: Double = 3.2
}

/// Loads a web-saved estimate by its share code (the estimator handoff —
/// universal link `/e/<code>` or the manual "enter code" fallback) and presents
/// it with the standard result view.
struct SavedEstimateView: View {
    let code: String
    @State private var estimation: Estimation?
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let estimation {
            EstimationResultView(estimation: estimation)
        } else {
            NavigationStack {
                Group {
                    if let error {
                        ContentUnavailableState(error: error) { await load() }
                    } else {
                        ProgressView("Loading your estimate…")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle("Saved estimate")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        error = nil
        do {
            estimation = try await APIService.shared.sharedEstimate(code: code)
        } catch {
            self.error = "We couldn’t find that estimate. Check the code and try again."
        }
    }
}

struct EstimationResultView: View {
    let estimation: Estimation
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var router: TabRouter
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager

    // Only pre-filter Explore when the estimate's room type maps onto an
    // actual contractor trade/specialty — "Kitchen"/"Bathroom"/"Basement" line
    // up directly with BusinessSearchView's specialty chips, but a room like
    // "Bedroom" or "Garage" doesn't correspond to one trade, and guessing one
    // (e.g. defaulting to "Flooring") would misdirect the search rather than
    // help it. Nil here just means Explore opens unfiltered, same as today.
    private var matchingSpecialty: String? {
        guard let roomType = estimation.roomType else { return nil }
        return ["Kitchen", "Bathroom", "Basement"].first { $0 == roomType }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Summary") {
                    Text(estimation.result.summary)
                }
                Section("Cost breakdown") {
                    ForEach(estimation.result.lineItems) { item in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(item.item).font(.subheadline)
                                Text(item.unit).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(formatted(item.low)) – \(formatted(item.high))")
                                .font(.subheadline.monospacedDigit())
                        }
                    }
                }
                Section("Total estimate") {
                    HStack {
                        Text("Low").foregroundStyle(.secondary)
                        Spacer()
                        Text(formatted(estimation.result.totalLow)).bold()
                    }
                    HStack {
                        Text("High").foregroundStyle(.secondary)
                        Spacer()
                        Text(formatted(estimation.result.totalHigh)).bold()
                    }
                }
                Section("Confidence: \(estimation.result.confidence.capitalized)") {
                    Text(estimation.result.notes).font(.caption).foregroundStyle(.secondary)
                }

                // Bridge the post-estimate cliff: send the user straight to
                // contractors instead of letting the result dead-end.
                Section {
                    Button {
                        router.pendingSearchSpecialty = matchingSpecialty
                        dismiss()
                        router.selection = TabRouter.explore
                    } label: {
                        Label("Find contractors for this project", systemImage: "magnifyingglass")
                            .fontWeight(.semibold)
                    }
                }
            }
            .navigationTitle("Estimate")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        // A completed, viewed estimate is a high-value moment — a good time to
        // prime notification permission (so we can tell them "your estimate is
        // ready" on a future one). Fired on disappear, not while this sheet is
        // presenting: doing it earlier raced this sheet against MainTabView's
        // own .sheet(isPresented: $notifications.showPriming) — two sheets
        // from different points in the hierarchy landing at once, which
        // silently drops one of them instead of showing both in sequence.
        .onDisappear {
            if auth.isLoggedIn { notifications.considerPriming() }
        }
    }

    private func formatted(_ value: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = estimation.result.currency
        return f.string(from: NSNumber(value: value)) ?? "$\(Int(value))"
    }
}
