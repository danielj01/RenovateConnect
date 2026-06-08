import Foundation
import Combine
import CoreLocation

/// Forward-geocoding for contractor profiles: turn an address into coordinates
/// on the device (so the API needs no geocoding service). Best-effort — returns
/// nil on failure, in which case the profile simply has no distance ranking.
enum Geocoder {
    static func coordinate(address: String?, city: String, state: String,
                           zip: String) async -> CLLocationCoordinate2D? {
        let line = [address, "\(city), \(state) \(zip)"]
            .compactMap { $0 }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        guard !line.isEmpty else { return nil }
        let placemarks = try? await CLGeocoder().geocodeAddressString(line)
        return placemarks?.first?.location?.coordinate
    }
}

/// Thin CoreLocation wrapper for "near me" search. Requests when-in-use
/// permission and resolves a single coordinate. Keep it simple: one-shot
/// requests, no continuous tracking.
@MainActor
final class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: CLLocationCoordinate2D? = nil
    @Published var authorizationStatus: CLAuthorizationStatus
    @Published var isResolving = false
    /// Set when permission was denied/restricted so the UI can guide the user.
    @Published var denied = false

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer // city-level is plenty
    }

    /// Request permission (if needed) and resolve the current coordinate once.
    /// Returns nil if denied or unavailable.
    func requestLocation() async -> CLLocationCoordinate2D? {
        denied = false
        switch manager.authorizationStatus {
        case .denied, .restricted:
            denied = true
            return nil
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            // The delegate resumes resolution once authorization is granted.
        default:
            break
        }
        isResolving = true
        return await withCheckedContinuation { cont in
            self.continuation = cont
            self.manager.requestLocation()
        }
    }

    private func finish(_ coord: CLLocationCoordinate2D?) {
        isResolving = false
        if let coord { coordinate = coord }
        continuation?.resume(returning: coord)
        continuation = nil
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        Task { @MainActor in
            self.authorizationStatus = status
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                manager.requestLocation()
            case .denied, .restricted:
                self.denied = true
                self.finish(nil)
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coord = locations.last?.coordinate
        Task { @MainActor in self.finish(coord) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }
}
