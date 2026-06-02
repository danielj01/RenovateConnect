import SwiftUI

struct PortfolioManagerView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var projects: [PortfolioProject] = []
    @State private var isLoading = true
    @State private var showAdd = false

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
            .background(Color(.systemGroupedBackground))
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
                AddPortfolioSheet(businessId: auth.myBusinessId ?? "") { new in
                    projects.insert(new, at: 0)
                }
            }
        }
    }

    private var grid: some View {
        ScrollView {
            VStack(spacing: 14) {
                ForEach(projects) { project in
                    PortfolioCard(project: project)
                        .contextMenu {
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
                    HStack {
                        Text(project.title).font(.headline)
                        Spacer()
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

// MARK: - Add project

struct AddPortfolioSheet: View {
    let businessId: String
    let onCreate: (PortfolioProject) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var category = ""
    @State private var costMin = ""
    @State private var costMax = ""
    @State private var weeks = ""
    @State private var isSaving = false

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
            }
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() }
                    else {
                        Button("Add") { Task { await save() } }
                            .bold().disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        if let project = try? await APIService.shared.createPortfolioProject(
            businessId: businessId,
            title: title,
            description: description.isEmpty ? nil : description,
            category: category.isEmpty ? nil : category,
            costMin: Int(costMin.filter(\.isNumber)),
            costMax: Int(costMax.filter(\.isNumber)),
            durationWeeks: Int(weeks.filter(\.isNumber))
        ) {
            onCreate(project)
            dismiss()
        }
    }
}
