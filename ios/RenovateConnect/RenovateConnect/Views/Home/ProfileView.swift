import SwiftUI
import UIKit

struct ProfileView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var notifications: NotificationManager
    @State private var pushEnabled = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let user = auth.currentUser {
                        // Avatar hero card
                        RCCard {
                            VStack(spacing: 14) {
                                ZStack(alignment: .bottomTrailing) {
                                    InitialsAvatar(name: user.name, size: 80)
                                        .clipShape(Circle())
                                        .overlay(Circle().stroke(.white, lineWidth: 3))
                                        .shadow(color: Theme.cardShadow, radius: 8)

                                    Circle()
                                        .fill(user.role == .business ? Theme.gold : Theme.primary)
                                        .frame(width: 22, height: 22)
                                        .overlay(
                                            Image(systemName: user.role == .business ? "briefcase.fill" : "person.fill")
                                                .font(.system(size: 10))
                                                .foregroundStyle(.white)
                                        )
                                }

                                VStack(spacing: 4) {
                                    Text(user.name).font(.title2.bold())
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

                        // Business card if applicable
                        if let biz = user.business {
                            RCCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    Label("Your Business", systemImage: "building.2.fill")
                                        .font(.headline)
                                        .foregroundStyle(Theme.primary)

                                    HStack(spacing: 14) {
                                        InitialsAvatar(name: biz.companyName, size: 48)
                                            .clipShape(RoundedRectangle(cornerRadius: 12))

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
                                        if biz.isPromoted { FeaturedBadge() }
                                    }
                                }
                                .padding(16)
                            }
                            .padding(.horizontal, 16)
                        }

                        // Notifications section
                        RCCard {
                            VStack(spacing: 0) {
                                Toggle(isOn: $pushEnabled) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "bell.fill")
                                            .foregroundStyle(Theme.primary).frame(width: 28)
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
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    Spacer(minLength: 40)
                }
                .padding(.top, 20)
            }
            .background(Color(.systemGroupedBackground))
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
