import Foundation
import Security

/// Minimal Keychain wrapper for small secrets (the auth token). The Keychain is
/// encrypted and excluded from unencrypted backups — unlike UserDefaults, which
/// stores values in a plain plist (OWASP MASVS: don't keep credentials/tokens in
/// UserDefaults). Items use kSecAttrAccessibleAfterFirstUnlock so background
/// refreshes still work after the first unlock, but the value isn't readable
/// while the device is locked.
enum Keychain {
    @discardableResult
    static func set(_ value: String, for account: String) -> Bool {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary) // upsert: clear any existing item first
        var attrs = base
        attrs[kSecValueData as String] = Data(value.utf8)
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(attrs as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else { return nil }
        return value
    }

    static func remove(_ account: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}

/// Single source of truth for the auth token. Reads transparently migrate any
/// token left in UserDefaults by older builds into the Keychain, so existing
/// signed-in users keep their session without re-authenticating.
enum AuthToken {
    private static let key = "authToken"

    static var value: String? {
        if let token = Keychain.get(key) { return token }
        // One-time migration from the previous UserDefaults storage.
        if let legacy = UserDefaults.standard.string(forKey: key) {
            Keychain.set(legacy, for: key)
            UserDefaults.standard.removeObject(forKey: key)
            return legacy
        }
        return nil
    }

    static func set(_ token: String) {
        Keychain.set(token, for: key)
        UserDefaults.standard.removeObject(forKey: key) // ensure no plaintext copy lingers
    }

    static func clear() {
        Keychain.remove(key)
        UserDefaults.standard.removeObject(forKey: key)
    }
}
