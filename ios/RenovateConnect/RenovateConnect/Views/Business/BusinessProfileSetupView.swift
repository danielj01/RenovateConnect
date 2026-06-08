import SwiftUI
import CoreLocation

/// First-run setup for a contractor who has registered but hasn't created their
/// business profile yet. Without a profile the dashboard/leads/portfolio tabs
/// have nothing to show (the API returns 404), so we gate the business tab bar
/// on this form. On success we reload the user — which now includes the linked
/// business — and MainTabView swaps in the full tab bar.
struct BusinessProfileSetupView: View {
    @EnvironmentObject private var auth: AuthStore

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

    private var canSubmit: Bool {
        !companyName.trimmed.isEmpty &&
        !description.trimmed.isEmpty &&
        !city.trimmed.isEmpty &&
        state.trimmed.count == 2 &&
        !zipCode.trimmed.isEmpty &&
        !selectedSpecialties.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
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

                Section("Location") {
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
                }

                Section("Details (optional)") {
                    TextField("Years in business", text: $yearsInBusiness)
                        .keyboardType(.numberPad)
                    TextField("License number", text: $licenseNumber)
                    TextField("Website (https://…)", text: $website)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                if let error {
                    Section {
                        Text(error).font(.subheadline).foregroundStyle(.red)
                            .listRowBackground(Color.clear)
                    }
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            Spacer()
                            if isSaving { ProgressView().tint(.white) }
                            Text("Create profile").font(.headline)
                            Spacer()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primary)
                    .disabled(!canSubmit || isSaving)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                } footer: {
                    Button(role: .destructive) {
                        auth.logout()
                    } label: {
                        Text("Sign out").font(.footnote)
                    }
                    .padding(.top, 8)
                }
            }
            .navigationTitle("Set up your business")
            .navigationBarTitleDisplayMode(.inline)
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
                licenseNumber: licenseNumber.trimmed.isEmpty ? nil : licenseNumber.trimmed,
                website: trimmedWebsite.isEmpty ? nil : trimmedWebsite,
                address: address.trimmed.isEmpty ? nil : address.trimmed,
                lat: coord?.latitude,
                lng: coord?.longitude
            )
            // Re-hydrate the user so currentUser.business is populated; MainTabView
            // then swaps this setup screen for the full contractor tab bar.
            await auth.loadMe()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
