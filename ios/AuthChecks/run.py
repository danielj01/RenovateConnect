"""Exercise production AuthToken with unavailable and working Keychain storage."""
from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
source = (root / 'RenovateConnect/RenovateConnect/Services/Keychain.swift').read_text()
auth = source[source.index('enum AuthToken {'):]
stub = '''import Foundation
enum Keychain {
    static var available = false
    static var stored: String?
    @discardableResult static func set(_ value: String, for account: String) -> Bool {
        if available { stored = value }; return available
    }
    static func get(_ account: String) -> String? { available ? stored : nil }
    static func remove(_ account: String) { stored = nil }
}
'''
checks = '''
AuthToken.clear()
AuthToken.set("session-one")
assert(AuthToken.value == "session-one", "Failed persistence must not drop active login")
assert(UserDefaults.standard.string(forKey: "authToken") == nil)
AuthToken.set("session-two")
assert(AuthToken.value == "session-two", "New login must replace old token")
AuthToken.clear()
assert(AuthToken.value == nil, "Logout must clear in-memory credentials")
UserDefaults.standard.set("legacy", forKey: "authToken")
assert(AuthToken.value == "legacy")
assert(AuthToken.value == "legacy", "Migration must survive failed persistence")
assert(UserDefaults.standard.string(forKey: "authToken") == nil)
AuthToken.clear()
Keychain.available = true
Keychain.stored = "persisted"
assert(AuthToken.value == "persisted")
AuthToken.clear()
assert(Keychain.stored == nil && AuthToken.value == nil)
print("PASS: failed persistence, token replacement, logout, migration, persisted session")
'''
with tempfile.TemporaryDirectory() as directory:
    script = Path(directory) / 'main.swift'
    script.write_text(stub + auth + checks)
    binary = Path(directory) / 'auth-checks'
    subprocess.run(['swiftc', str(script), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
