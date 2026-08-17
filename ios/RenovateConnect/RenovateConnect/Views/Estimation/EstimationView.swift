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

    // Outcome-first "how it works" — each step sells the benefit, not the spec.
    private let steps: [(icon: String, title: String, detail: String)] = [
        ("photo.badge.plus", "Add a few photos",
         "Snap or upload up to 5 photos of the space you want to renovate."),
        ("sparkles", "AI sizes up the work",
         "It reads materials, dimensions, and condition to scope the project."),
        ("list.bullet.rectangle.portrait", "Get an itemized range",
         "A line-by-line breakdown with a low–high total, in seconds."),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                hero
                perks
                howItWorks
                cta
                codeEntryButton
                disclaimer
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

    // New-install fallback for the saved-estimate handoff: type the code shown on
    // the web /e/<code> page.
    private var codeEntryButton: some View {
        Button { showCodeEntry = true } label: {
            Text("Have an estimate code from the web?")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primary)
        }
    }

    private var hero: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(.white.opacity(0.18)).frame(width: 84, height: 84)
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(.white)
            }
            VStack(spacing: 6) {
                Text("What will it cost?")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("Get a ballpark renovation estimate from a few photos — before you call a single contractor.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.92))
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28).padding(.horizontal, 20)
        .background(
            ZStack {
                Theme.gradient
                Circle().fill(.white.opacity(0.08)).frame(width: 200, height: 200).offset(x: -110, y: -70)
                Circle().fill(.white.opacity(0.06)).frame(width: 150, height: 150).offset(x: 120, y: 60)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: Theme.primary.opacity(0.30), radius: 16, y: 8)
    }

    private var perks: some View {
        HStack(spacing: 10) {
            perk("bolt.fill", "~30 seconds")
            perk("gift.fill", "Free")
            perk("checkmark.seal.fill", "No commitment")
        }
    }

    private func perk(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption2).foregroundStyle(Theme.primary)
            Text(text).font(.caption.weight(.semibold)).foregroundStyle(.primary)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Theme.primaryLight)
        .clipShape(Capsule())
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
                        Text(step.detail).font(.caption).foregroundStyle(.secondary)
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
            .frame(maxWidth: .infinity).frame(height: 54)
            .background(Theme.gradient)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Theme.primary.opacity(0.35), radius: 12, y: 6)
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
    // Pops this view off the NavigationStack it was pushed onto (back to
    // EstimatorIntroView) — distinct from EstimationResultView's own
    // \.dismiss, which closes its sheet. SwiftUI resolves each to the right
    // action for how that particular view was presented.
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthStore
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var selectedImages: [UIImage] = []
    @State private var roomType = ""
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
                Form {
                    Section("Photos (up to 5)") {
                        PhotosPicker(selection: $selectedItems, maxSelectionCount: 5, matching: .images) {
                            Label("Select photos", systemImage: "photo.badge.plus")
                        }
                        .onChange(of: selectedItems) { loadImages() }

                        if !selectedImages.isEmpty {
                            ScrollView(.horizontal) {
                                HStack {
                                    ForEach(Array(selectedImages.enumerated()), id: \.offset) { _, img in
                                        Image(uiImage: img)
                                            .resizable().aspectRatio(contentMode: .fill)
                                            .frame(width: 80, height: 80)
                                            .clipShape(RoundedRectangle(cornerRadius: 8))
                                    }
                                }
                            }
                        }
                    }

                    Section("Room type") {
                        Picker("Type", selection: $roomType) {
                            Text("Select…").tag("")
                            ForEach(roomTypes, id: \.self) { Text($0).tag($0) }
                        }
                    }

                    Section("Additional details (optional)") {
                        TextField("Describe what you'd like done…", text: $description, axis: .vertical)
                            .lineLimit(3...6)
                    }

                    if let error {
                        Section { Text(error).foregroundStyle(.red).font(.caption) }
                    }

                    Section {
                        Button("Get AI estimate") {
                            Task { await submit() }
                        }
                        .disabled(selectedImages.isEmpty)
                    }
                }
            }
        }
        .navigationTitle("New Estimate")
        .navigationBarTitleDisplayMode(.inline)
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

    private func loadImages() {
        Task {
            selectedImages = []
            for item in selectedItems {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let img = UIImage(data: data) {
                    selectedImages.append(img)
                }
            }
        }
    }

    private func submit() async {
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
                    images: imageData, roomType: rt, description: desc)
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
                    images: imageData, roomType: rt, description: desc)
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
