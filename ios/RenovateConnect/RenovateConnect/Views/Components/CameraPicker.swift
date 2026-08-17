import SwiftUI
import UIKit

/// Camera capture for SwiftUI. `PhotosPicker` only reads the existing library,
/// and SwiftUI still ships no native camera view, so this wraps
/// `UIImagePickerController` — the supported route to the system camera.
///
/// Requires `NSCameraUsageDescription` (set in the project's build settings);
/// without it the app is terminated the moment the camera is touched, rather
/// than showing a permission prompt.
struct CameraPicker: UIViewControllerRepresentable {
    /// Handed the captured image. Not called when the user cancels.
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    /// False in the Simulator and on the rare device with no usable camera —
    /// callers hide the entry point rather than presenting a picker that would
    /// come up empty.
    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        // Rear camera: people are photographing a room, not themselves.
        if UIImagePickerController.isCameraDeviceAvailable(.rear) {
            picker.cameraDevice = .rear
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, dismiss: { dismiss() })
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onCapture: (UIImage) -> Void
        private let dismiss: () -> Void

        init(onCapture: @escaping (UIImage) -> Void, dismiss: @escaping () -> Void) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // .editedImage is only present when allowsEditing is on; fall back
            // to the original so a capture is never silently dropped.
            if let image = (info[.editedImage] ?? info[.originalImage]) as? UIImage {
                onCapture(image)
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}
