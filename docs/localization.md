# Interface localization

The interface supports Vietnamese (`vi`, the default), English (`en`), and Japanese (`ja`). `LocaleProvider` shares the active locale and `t(key, values)` with client components. The `travel-plan-locale` first-party cookie lasts one year; the root layout reads it for server rendering. Changing languages updates the interface and document language without changing route URLs.

## Adding interface copy

Add a flat, descriptive key in the relevant catalog (`lib/i18n*.mjs`), with entries for all three languages. Use identical interpolation parameters in each translation. Render with `useLocale().t`; pass `intlLocale` to native `Intl` date/time formatting and specify `hour12: false` for travel times.

Translate labels, accessibility names, statuses, confirmations, and locally owned errors. Keep trip titles, descriptions, stored values, user input, invitation drafts/emails, and assistant responses as authored. Activity type labels may translate, but option values and icon lookup keys must retain their original values. Compiler-generated batch summaries are interface copy and are reconstructed from the proposed operations at render time.

Use `localizedMetadata` for server route titles. The native language selector keeps full language names in its menu and shows compact ISO labels in narrow utility areas.

## Verification

`scripts/i18n.test.mjs` checks locale normalization, catalog parity, interpolation parameters, static key references, date formatting, and activity labels. The localization browser tests exercise persistence, client navigation, draft preservation, notification statuses, batch/proposal/evidence review, and translated surfaces at 320×760, 1440×900, and 1920×1080. Run these alongside the existing Vietnamese feature and responsive tests.

The implementation uses the existing React setup and native `Intl`, as required by this feature's scope; it introduces no localization dependency, URL convention, or database changes.
