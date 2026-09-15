# Onboarding state checks

Run from the repository root on macOS:

```sh
swiftc -parse-as-library ios/RenovateConnect/RenovateConnect/Services/OnboardingProgress.swift ios/OnboardingChecks/OnboardingProgressChecks.swift -o /tmp/renovate-onboarding-checks
/tmp/renovate-onboarding-checks
```

Uses a temporary UserDefaults suite to verify completion, logout-safe persistence, account and role separation, guest-to-homeowner handoff, administrator exclusion, legacy migration, and contractor checklist state. Does not modify app preferences or the API database.
