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
    @EnvironmentObject private var notifications: NotificationManager
    @EnvironmentObject private var auth: AuthStore
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var selectedImages: [UIImage] = []
    @State private var roomType = ""
    @State private var description = ""
    @State private var estimation: Estimation?
    @State private var isLoading = false
    @State private var error: String?

    let roomTypes = ["Kitchen", "Bathroom", "Living Room", "Bedroom", "Basement", "Garage", "Exterior", "Other"]

    var body: some View {
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
                    Button {
                        Task { await submit() }
                    } label: {
                        if isLoading {
                            HStack { ProgressView(); Text("Analyzing photos…") }
                        } else {
                            Text("Get AI estimate")
                        }
                    }
                    .disabled(selectedImages.isEmpty || isLoading)
                }
            }
            .navigationTitle("New Estimate")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $estimation) { est in
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
        error = nil
        defer { isLoading = false }
        do {
            let imageData = selectedImages.compactMap { $0.jpegData(compressionQuality: 0.7) }
            let rt = roomType.isEmpty ? nil : roomType
            let desc = description.isEmpty ? nil : description
            if auth.isLoggedIn {
                estimation = try await APIService.shared.createEstimation(
                    images: imageData, roomType: rt, description: desc)
                // A completed estimate is a high-value moment — a good time to prime
                // notification permission (so we can tell them "your estimate is ready").
                notifications.considerPriming()
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
        } catch {
            self.error = error.localizedDescription
        }
    }
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
    }

    private func formatted(_ value: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = estimation.result.currency
        return f.string(from: NSNumber(value: value)) ?? "$\(Int(value))"
    }
}
