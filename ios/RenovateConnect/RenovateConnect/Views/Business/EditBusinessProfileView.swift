import SwiftUI
import CoreLocation

/// Lets a contractor edit their existing business profile. Mirrors
/// BusinessProfileSetupView but pre-fills from the current profile and PUTs the
/// update. On success we reload the user so the rest of the app reflects the
/// edited details, then dismiss.
struct EditBusinessProfileView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    let business: Business

    @State private var companyName: String
    @State private var description: String
    @State private var city: String
    @State private var state: String
    @State private var zipCode: String
    @State private var selectedSpecialties: Set<String>
    @State private var yearsInBusiness: String
    @State private var licenseNumber: String
    @State private var website: String
    @State private var address: String

    @State private var isSaving = false
    @State private var error: String?

    private let specialties = ["Kitchen", "Bathroom", "Basement", "Roofing",
                               "Flooring", "Painting", "HVAC", "Electrical", "Plumbing"]

    init(business: Business) {
        self.business = business
        _companyName = State(initialValue: business.companyName)
        _description = State(initialValue: business.description)
        _city = State(initialValue: business.city)
        _state = State(initialValue: business.state)
        _zipCode = State(initialValue: business.zipCode ?? "")
        _selectedSpecialties = State(initialValue: Set(business.specialties))
        _yearsInBusiness = State(initialValue: business.yearsInBusiness > 0 ? String(business.yearsInBusiness) : "")
        _licenseNumber = State(initialValue: business.licenseNumber ?? "")
        _website = State(initialValue: business.website ?? "")
        _address = State(initialValue: business.address ?? "")
    }

    private var canSubmit: Bool {
        !companyName.trimmed.isEmpty &&
        !description.trimmed.isEmpty &&
        !city.trimmed.isEmpty &&
        state.trimmed.count == 2 &&
        !zipCode.trimmed.isEmpty &&
        !selectedSpecialties.isEmpty
    }

    var body: some View {
        Form {
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
        }
        .navigationTitle("Edit profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView()
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSubmit)
                }
            }
        }
    }

    private func save() async {
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let trimmedWebsite = website.trimmed
            // Geocode the address so the contractor shows up in "near me" search.
            let coord = await Geocoder.coordinate(
                address: address.trimmed.isEmpty ? nil : address.trimmed,
                city: city.trimmed, state: state.trimmed, zip: zipCode.trimmed)
            _ = try await APIService.shared.updateBusiness(
                id: business.id,
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
            await auth.loadMe()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
