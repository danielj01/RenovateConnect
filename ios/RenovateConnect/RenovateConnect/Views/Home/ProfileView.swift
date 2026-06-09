import SwiftUI
import UIKit
import PhotosUI

struct ProfileView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @State private var pushEnabled = true

    // Profile picture editing
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isUploadingAvatar = false

    // Name editing
    @State private var showNameEdit = false
    @State private var nameDraft = ""

    // Account deletion
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false

    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let user = auth.currentUser {
                        // Avatar hero card
                        RCCard {
                            VStack(spacing: 14) {
                                // Tappable avatar — pick a new photo from the
                                // library. The camera badge is the edit affordance.
                                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                                    ZStack(alignment: .bottomTrailing) {
                                        ProfileAvatar(avatarUrl: user.avatarUrl, name: user.name, size: 80)
                                            .overlay(Circle().stroke(.white, lineWidth: 3))
                                            .shadow(color: Theme.cardShadow, radius: 8)
                                            .opacity(isUploadingAvatar ? 0.5 : 1)
                                            .overlay {
                                                if isUploadingAvatar { ProgressView() }
                                            }

                                        Circle()
                                            .fill(Theme.primary)
                                            .frame(width: 26, height: 26)
                                            .overlay(
                                                Image(systemName: "camera.fill")
                                                    .font(.system(size: 11))
                                                    .foregroundStyle(.white)
                                            )
                                            .overlay(Circle().stroke(.white, lineWidth: 2))
                                    }
                                }
                                .buttonStyle(.plain)
                                .disabled(isUploadingAvatar)

                                VStack(spacing: 4) {
                                    HStack(spacing: 6) {
                                        Text(user.name).font(.title2.bold())
                                        Button {
                                            nameDraft = user.name
                                            showNameEdit = true
                                        } label: {
                                            Image(systemName: "pencil.circle.fill")
                                                .font(.title3)
                                                .foregroundStyle(Theme.primary)
                                        }
                                    }
                                    Text(user.email).font(.subheadline).foregroundStyle(.secondary)
                                    Text(user.role == .client ? "Homeowner" : "Business Owner")
                                        .font(.caption.weight(.medium))
                                        .padding(.horizontal, 12).padding(.vertical, 4)
                                        .background(Theme.primaryLight)
                                        .foregroundStyle(Theme.primary)
                                        .clipShape(Capsule())
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                        }
                        .padding(.horizontal, 16)

                        // My Projects hub — homeowners' return point for saved
                        // contractors and past estimates.
                        if user.role == .client {
                            NavigationLink {
                                MyProjectsView()
                            } label: {
                                RCCard {
                                    HStack(spacing: 12) {
                                        Image(systemName: "folder.fill")
                                            .foregroundStyle(Theme.primary).frame(width: 28)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("My Projects").font(.subheadline).foregroundStyle(.primary)
                                            Text("Saved contractors & estimates")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    .padding(16)
                                }
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 16)
                        }

                        // Appointments hub — both roles: homeowners track requests,
                        // contractors manage incoming bookings.
                        NavigationLink {
                            AppointmentsView()
                        } label: {
                            RCCard {
                                HStack(spacing: 12) {
                                    Image(systemName: "calendar")
                                        .foregroundStyle(Theme.primary).frame(width: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Appointments").font(.subheadline).foregroundStyle(.primary)
                                        Text(user.role == .client
                                             ? "Times you've requested with contractors"
                                             : "Requests from homeowners")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(16)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)

                        // Quotes hub — both roles: homeowners track estimate
                        // requests, contractors respond to incoming briefs.
                        NavigationLink {
                            QuotesView()
                        } label: {
                            RCCard {
                                HStack(spacing: 12) {
                                    Image(systemName: "doc.text.magnifyingglass")
                                        .foregroundStyle(Theme.primary).frame(width: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Quotes").font(.subheadline).foregroundStyle(.primary)
                                        Text(user.role == .client
                                             ? "Estimates you've requested"
                                             : "Project briefs from homeowners")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(16)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)

                        // Payments hub — both roles: homeowners review deposits
                        // they've paid, contractors the deposits they've received.
                        NavigationLink {
                            PaymentsView()
                        } label: {
                            RCCard {
                                HStack(spacing: 12) {
                                    Image(systemName: "creditcard.fill")
                                        .foregroundStyle(Theme.primary).frame(width: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Payments").font(.subheadline).foregroundStyle(.primary)
                                        Text(user.role == .client
                                             ? "Deposits you've paid"
                                             : "Deposits you've received")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(16)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)

                        // Business card if applicable
                        if let biz = user.business {
                            NavigationLink {
                                BusinessDetailView(businessId: biz.id)
                            } label: {
                                RCCard {
                                    VStack(alignment: .leading, spacing: 12) {
                                        HStack {
                                            Label("Your Business", systemImage: "building.2.fill")
                                                .font(.headline)
                                                .foregroundStyle(Theme.primary)
                                            Spacer()
                                            Image(systemName: "chevron.right")
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }

                                        HStack(spacing: 14) {
                                            BusinessAvatar(name: biz.companyName, logoUrl: biz.logoUrl,
                                                           size: 48, cornerRadius: 12)

                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(biz.companyName).font(.subheadline.bold())
                                                HStack(spacing: 3) {
                                                    Image(systemName: "mappin.circle.fill")
                                                        .foregroundStyle(Theme.primary.opacity(0.8)).font(.caption2)
                                                    Text("\(biz.city), \(biz.state)")
                                                        .font(.caption).foregroundStyle(.secondary)
                                                }
                                                StarRating(rating: biz.averageRating, count: biz.reviewCount)
                                            }
                                            Spacer()
                                            if biz.isVerified { VerifiedBadge() }
                                        }
                                    }
                                    .padding(16)
                                }
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 16)

                            NavigationLink {
                                EditBusinessProfileView(business: biz)
                            } label: {
                                RCCard {
                                    HStack(spacing: 12) {
                                        Image(systemName: "pencil")
                                            .font(.subheadline)
                                            .foregroundStyle(Theme.primary)
                                            .frame(width: 28, height: 28)
                                        Text("Edit business profile").font(.subheadline)
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    .padding(16)
                                }
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 16)
                        }

                        // Notifications section
                        RCCard {
                            VStack(spacing: 0) {
                                Toggle(isOn: $pushEnabled) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "bell.fill")
                                            .font(.subheadline)
                                            .foregroundStyle(Theme.primary)
                                            .frame(width: 28, height: 28)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Push Notifications").font(.subheadline)
                                            Text("New messages, leads, and updates")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .tint(Theme.primary)
                                .padding(16)

                                if notifications.authorizationStatus == .denied {
                                    Divider().padding(.horizontal, 16)
                                    Button {
                                        if let url = URL(string: UIApplication.openSettingsURLString) {
                                            UIApplication.shared.open(url)
                                        }
                                    } label: {
                                        HStack(spacing: 12) {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .foregroundStyle(Theme.gold).frame(width: 28)
                                            Text("Notifications are off in iOS Settings")
                                                .font(.caption).foregroundStyle(.secondary)
                                            Spacer()
                                            Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.secondary)
                                        }
                                        .padding(16)
                                    }
                                }

                                Divider().padding(.horizontal, 16)

                                NavigationLink {
                                    NotificationSettingsView()
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: "slider.horizontal.3")
                                            .foregroundStyle(Theme.primary).frame(width: 28)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Notification Preferences").font(.subheadline)
                                            Text("Choose which categories notify you")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    .padding(16)
                                }
                                .buttonStyle(.plain)

                                Divider().padding(.horizontal, 16)

                                NavigationLink {
                                    BlockedUsersView()
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: "hand.raised.fill")
                                            .foregroundStyle(Theme.primary).frame(width: 28)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Blocked Users").font(.subheadline)
                                            Text("Manage who can't contact you")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    .padding(16)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)

                        // Account section
                        RCCard {
                            VStack(spacing: 0) {
                                profileRow(icon: "person.fill", label: "Account Type",
                                           value: user.role == .client ? "Homeowner" : "Business")

                                Divider().padding(.horizontal, 16)

                                Button(role: .destructive) {
                                    auth.logout()
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: "rectangle.portrait.and.arrow.right")
                                            .foregroundStyle(.red).frame(width: 28)
                                        Text("Sign Out").foregroundStyle(.red)
                                        Spacer()
                                    }
                                    .padding(16)
                                }

                                Divider().padding(.horizontal, 16)

                                Button(role: .destructive) {
                                    showDeleteConfirm = true
                                } label: {
                                    HStack(spacing: 12) {
                                        if isDeleting {
                                            ProgressView().frame(width: 28)
                                        } else {
                                            Image(systemName: "trash.fill")
                                                .foregroundStyle(.red).frame(width: 28)
                                        }
                                        Text("Delete Account").foregroundStyle(.red)
                                        Spacer()
                                    }
                                    .padding(16)
                                }
                                .disabled(isDeleting)
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    Spacer(minLength: 40)
                }
                .padding(.top, 20)
            }
            .background(Color(.systemBackground))
            .navigationTitle("Profile")
            .task {
                pushEnabled = auth.currentUser?.pushEnabled ?? true
                await notifications.refreshStatus()
            }
            .onChange(of: pushEnabled) { _, newValue in
                Task {
                    await auth.setPushEnabled(newValue)
                    // Turning it on while iOS permission is undetermined → ask now.
                    if newValue, notifications.authorizationStatus == .notDetermined {
                        await notifications.requestAuthorization()
                    }
                }
            }
            .onChange(of: selectedPhoto) { _, item in
                guard let item else { return }
                Task { await uploadAvatar(item) }
            }
            .alert("Edit Name", isPresented: $showNameEdit) {
                TextField("Name", text: $nameDraft)
                Button("Cancel", role: .cancel) {}
                Button("Save") { Task { await saveName() } }
            } message: {
                Text("This is how you appear across RenovateConnect.")
            }
            .confirmationDialog("Delete account permanently?",
                                isPresented: $showDeleteConfirm,
                                titleVisibility: .visible) {
                Button("Delete My Account", role: .destructive) {
                    Task { await deleteAccount() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently erases your profile, messages, and history. This can't be undone.")
            }
            .alert("Something went wrong",
                   isPresented: Binding(get: { errorMessage != nil },
                                        set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Actions

    private func uploadAvatar(_ item: PhotosPickerItem) async {
        isUploadingAvatar = true
        defer { isUploadingAvatar = false; selectedPhoto = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Normalize through UIImage so we always send a JPEG the API accepts.
            let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data
            try await auth.uploadAvatar(jpeg)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveName() async {
        let trimmed = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != auth.currentUser?.name else { return }
        do {
            try await auth.updateName(trimmed)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteAccount() async {
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await auth.deleteAccount()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @ViewBuilder
    private func profileRow(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Theme.primary)
                .frame(width: 28)
            Text(label).font(.subheadline)
            Spacer()
            Text(value).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(16)
    }
}

// MARK: - Profile avatar

/// A circular user avatar that renders the remote `avatarUrl` when present and
/// falls back to colored initials while loading or when no picture is set.
struct ProfileAvatar: View {
    let avatarUrl: String?
    let name: String
    let size: CGFloat

    var body: some View {
        Group {
            if let avatarUrl, !avatarUrl.isEmpty, let url = URL(string: avatarUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .empty:
                        ZStack {
                            Theme.avatarColor(for: name).opacity(0.5)
                            ProgressView().tint(.white)
                        }
                    default:
                        InitialsAvatar(name: name, size: size)
                    }
                }
            } else {
                InitialsAvatar(name: name, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}
