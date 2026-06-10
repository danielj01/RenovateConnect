import SwiftUI

/// Plain-language explanation of the Sponsored slot, opened from the ⓘ next
/// to the "Sponsored" header in search. This is our ad-disclosure surface:
/// it states what's paid, what isn't, and what paid placement can never buy.
/// Keep the promises here in sync with the search implementation — they're
/// the public version of the monetization guardrails in CLAUDE.md.
struct SponsoredDisclosureSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Label("About Sponsored results", systemImage: "megaphone.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.primary)

                    point(icon: "dollarsign.circle",
                          title: "What \"Sponsored\" means",
                          body: "Contractors with a Pro subscription can appear in this clearly-labeled spot at the top of search. That's the only thing the subscription changes about search.")

                    point(icon: "list.number",
                          title: "Regular results are never for sale",
                          body: "The list below the Sponsored section is ranked only by verification and customer rating. Paying never moves a contractor up in the regular results — and not paying never moves one down.")

                    point(icon: "checkmark.seal",
                          title: "Verification can't be bought",
                          body: "The Verified badge comes from our review of a contractor's license and insurance documents. It is never part of any paid product.")

                    point(icon: "shuffle",
                          title: "The spot rotates",
                          body: "Eligible contractors rotate through the Sponsored spots so the same few don't always lead. Sponsored contractors still have to meet the same listing standards as everyone else.")
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Sponsored")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func point(icon: String, title: String, body text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Theme.primary)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
