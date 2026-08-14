import SwiftUI
import CoreLocation

/// First-run setup for a contractor who has registered but hasn't created their
/// business profile yet. Without a profile the dashboard/leads/portfolio tabs
/// have nothing to show (the API returns 404), so we gate the business tab bar
/// on this form. On success we reload the user — which now includes the linked
/// business — and MainTabView swaps this for the Profile Strength checklist.
///
/// Staged as 3 short steps (what you do → where you work → license & details)
/// rather than one long form — same fields and validation as before, just
/// chunked so it doesn't read as a wall of text on first open.
struct BusinessProfileSetupView: View {
    @EnvironmentObject private var auth: AuthStore

    @State private var step = 0
    private let totalSteps = 3

    @State private var companyName = ""
    @State private var description = ""
    @State private var city = ""
    @State private var state = ""
    @State private var zipCode = ""
    @State private var selectedSpecialties: Set<String> = []
    @State private var yearsInBusiness = ""
    @State private var licenseNumber = ""
    @State private var website = ""
    @State private var address = ""

    @State private var isSaving = false
    @State private var error: String?

    private let specialties = ["Kitchen", "Bathroom", "Basement", "Roofing",
                               "Flooring", "Painting", "HVAC", "Electrical", "Plumbing"]

    private var canProceedStep1: Bool {
        !companyName.trimmed.isEmpty && !description.trimmed.isEmpty && !selectedSpecialties.isEmpty
    }
    private var canProceedStep2: Bool {
        !city.trimmed.isEmpty && state.trimmed.count == 2 && !zipCode.trimmed.isEmpty
    }
    private var canSubmit: Bool { !licenseNumber.trimmed.isEmpty }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                stepHeader
                Form {
                    switch step {
                    case 0: stepOne
                    case 1: stepTwo
                    default: stepThree
                    }

                    if let error {
                        Section {
                            Text(error).font(.subheadline).foregroundStyle(.red)
                                .listRowBackground(Color.clear)
                        }
                    }
                }
                bottomBar
            }
            .navigationTitle("Set up your business")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out", role: .destructive) { auth.logout() }
                        .font(.footnote)
                }
            }
        }
    }

    // MARK: - Steps

    private var stepOne: some View {
        Group {
            Section {
                Text("Tell homeowners about your business. You can refine these details anytime from your profile.")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
            Section("Business") {
                TextField("Company name", text: $companyName)
                TextField("What you do", text: $description, axis: .vertical)
                    .lineLimit(3...6)
            }
            Section("Specialties") {
                ForEach(specialties, id: \.self) { spec in
                    Button {
                        if selectedSpecialties.contains(spec) {
                            selectedSpecialties.remove(spec)
                        } else {
                            selectedSpecialties.insert(spec)
                        }
                    } label: {
                        HStack {
                            Text(spec).foregroundStyle(.primary)
                            Spacer()
                            if selectedSpecialties.contains(spec) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Theme.primary)
                            }
                        }
                    }
                }
            }
        }
    }

    private var stepTwo: some View {
        Section {
            TextField("City", text: $city)
                .textInputAutocapitalization(.words)
            TextField("State (e.g. TX)", text: $state)
                .textInputAutocapitalization(.characters)
                .onChange(of: state) { _, newValue in
                    state = String(newValue.uppercased().prefix(2))
                }
            TextField("ZIP code", text: $zipCode)
                .keyboardType(.numbersAndPunctuation)
            TextField("Street address (optional)", text: $address)
        } header: {
            Text("Location")
        } footer: {
            Text("This is how homeowners find you in \u{201C}near me\u{201D} search — it won't be shown as your exact address.")
        }
    }

    private var stepThree: some View {
        Group {
            Section {
                TextField("Contractor license number", text: $licenseNumber)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            } header: {
                Text("License")
            } footer: {
                Text("Required. Your license number is shown on your public profile — the law requires it to appear on contractor listings.")
            }

            Section("Details (optional)") {
                TextField("Years in business", text: $yearsInBusiness)
                    .keyboardType(.numberPad)
                TextField("Website (https://…)", text: $website)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
        }
    }

    // MARK: - Chrome

    private var stepHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Step \(step + 1) of \(totalSteps)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(stepTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.primary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.systemGray5)).frame(height: 5)
                    Capsule().fill(Theme.primary)
                        .frame(width: geo.size.width * (Double(step + 1) / Double(totalSteps)), height: 5)
                        .animation(.easeInOut(duration: 0.25), value: step)
                }
            }
            .frame(height: 5)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 4)
    }

    private var stepTitle: String {
        switch step {
        case 0: return "What you do"
        case 1: return "Where you work"
        default: return "License"
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 12) {
            if step > 0 {
                Button {
                    withAnimation { step -= 1 }
                } label: {
                    Text("Back").font(.headline).frame(maxWidth: .infinity).frame(height: 50)
                }
                .buttonStyle(.bordered)
            }

            Button {
                if step < totalSteps - 1 {
                    withAnimation { step += 1 }
                } else {
                    Task { await submit() }
                }
            } label: {
                HStack {
                    if isSaving { ProgressView().tint(.white) }
                    Text(step < totalSteps - 1 ? "Next" : "Create profile").font(.headline)
                }
                .frame(maxWidth: .infinity).frame(height: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.primary)
            .disabled(!canProceedCurrentStep || isSaving)
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 16)
        .background(.bar)
    }

    private var canProceedCurrentStep: Bool {
        switch step {
        case 0: return canProceedStep1
        case 1: return canProceedStep2
        default: return canSubmit
        }
    }

    private func submit() async {
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let trimmedWebsite = website.trimmed
            // Geocode the address so the new contractor appears in "near me" search.
            let coord = await Geocoder.coordinate(
                address: address.trimmed.isEmpty ? nil : address.trimmed,
                city: city.trimmed, state: state.trimmed, zip: zipCode.trimmed)
            _ = try await APIService.shared.createBusiness(
                companyName: companyName.trimmed,
                description: description.trimmed,
                city: city.trimmed,
                state: state.trimmed,
                zipCode: zipCode.trimmed,
                specialties: Array(selectedSpecialties),
                yearsInBusiness: Int(yearsInBusiness.trimmed),
                licenseNumber: licenseNumber.trimmed,
                website: trimmedWebsite.isEmpty ? nil : trimmedWebsite,
                address: address.trimmed.isEmpty ? nil : address.trimmed,
                lat: coord?.latitude,
                lng: coord?.longitude
            )
            // Re-hydrate the user so currentUser.business is populated; MainTabView
            // then swaps this setup screen for the Profile Strength checklist.
            await auth.loadMe()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
