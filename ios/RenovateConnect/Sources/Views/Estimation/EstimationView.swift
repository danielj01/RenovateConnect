import SwiftUI
import PhotosUI

struct EstimationView: View {
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var selectedImages: [UIImage] = []
    @State private var roomType = ""
    @State private var description = ""
    @State private var estimation: Estimation?
    @State private var isLoading = false
    @State private var error: String?

    let roomTypes = ["Kitchen", "Bathroom", "Living Room", "Bedroom", "Basement", "Garage", "Exterior", "Other"]

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Cost Estimator")
            .sheet(item: $estimation) { est in
                EstimationResultView(estimation: est)
            }
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
            estimation = try await APIService.shared.createEstimation(
                images: imageData,
                roomType: roomType.isEmpty ? nil : roomType,
                description: description.isEmpty ? nil : description
            )
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct EstimationResultView: View {
    let estimation: Estimation
    @Environment(\.dismiss) private var dismiss

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
