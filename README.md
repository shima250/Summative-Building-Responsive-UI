# Tracky — Student Finance Tracker

**Chosen theme:** Student Finance Tracker. An accessible, responsive app built with vanilla HTML, CSS, and JavaScript for students to track income, expenses, budgets, and spending patterns.

**Contact:** [e.shima@alustudent.com](mailto:e.shima@alustudent.com)

- **GitHub profile:** [shima250](https://github.com/shima250).
- **Repository URL:** [Summative-Building-Responsive-UI](https://github.com/shima250/Summative-Building-Responsive-UI).
- **GitHub Pages URL:** [Open Tracky](https://shima250.github.io/Summative-Building-Responsive-UI/).
- **Demo video:** 

Add your actual demo video link before submitting. The assignment requires **GitHub Pages** hosting.

## Run locally

Open `index.html` in a modern browser. No dependencies or build step are required. Alternatively, from the project directory:

```sh
python3 -m http.server 8000
```

Visit <http://localhost:8000>. Use the same browser and address each time to retain access to the same local data. Google Fonts supplies the optional Geist font; the system font fallback works without a connection.

## Features

- About/contact, dashboard, transaction records, add/edit forms, budget, and settings sections.
- Overall balance, monthly income/expenses, total record count, sum of recorded amounts, top expense category by amount, and a labeled seven-day expense chart.
- Recurring monthly cap and category limits, with polite remaining-funds and assertive overage announcements.
- Add and edit transactions with unique IDs, creation/update timestamps, date, category, payment method, and original currency.
- Expand **Edit inline** on a record to change its description, RWF amount, date, or category. Delete actions require confirmation.
- Live regex search across description, category, payment method, date, and base amount, with case toggle, safe text highlighting, and invalid-pattern messages.
- Sort all records by date, description A–Z/Z–A, or amount ascending/descending; filter by type, month, category, or payment method.
- Editable expense/income categories, including Food, Books, Transport, Entertainment, Fees, and Other.
- RWF base currency plus USD, EUR, GBP, KES, UGX, and TZS. Rates are manually editable, never fetched live.
- Automatic localStorage persistence, validated JSON backup import/export, spreadsheet CSV export, and sample data.
- Mobile navigation, desktop sidebar, light/dark/system themes, transitions, and reduced-motion support.

## Regex catalog

| Purpose | Pattern | Examples |
| --- | --- | --- |
| Description boundaries | `^\S(?:.*\S)?$` | Accept `Lunch at campus`; reject ` Lunch ` |
| Collapse repeated spaces before saving | ` {2,}` → one space | `Lunch  at campus` becomes `Lunch at campus` |
| Numeric input | `^(0\|[1-9]\d*)(\.\d{1,2})?$` | Accept `12.50`; reject `01`, `1,000`, `1.234`; transaction amounts must also be positive |
| Date shape | `^\d{4}-(0[1-9]\|1[0-2])-(0[1-9]\|[12]\d\|3[01])$` | Accept `2025-09-29`; reject `2025-13-01`; a calendar check also rejects February 30 |
| Category name | `^[A-Za-z]+(?:[ -][A-Za-z]+)*$` | Accept `School-books`; reject `Food2` or `Food & drinks` |
| Advanced: repeated words, back-reference | `\b(\w+)\s+\1\b` with `i` | Reject `coffee Coffee` in transaction descriptions |
| Search: cents | `\.\d{2}\b` | Matches searchable amount `12.50` |
| Search: beverages | `(coffee\|tea)` | Matches either keyword; case toggle controls capitalization |

Enter the pattern alone in Search, without surrounding `/` delimiters. The checkbox controls the `i` flag. Search compilation uses `try/catch`; an invalid pattern such as `[` shows an error and no results. Matching uses base amounts formatted to two decimal places, even when currency display formatting differs. Highlights use text nodes and `<mark>`, preserving text safely. Patterns are executed synchronously; use practical patterns for large datasets.

## Data and backups

The storage key is `tracky:data:v2`. All transaction amounts are stored in RWF, with up to two decimal places. The sum metric adds income and expense magnitudes; balance subtracts expenses from income. The top category and seven-day chart use expenses. Budgets apply to monthly expense totals.

```js
{
  id: "rec_0001",
  type: "expense",
  description: "Lunch at cafeteria",
  amount: 12.50,
  categoryId: "food",
  date: "2025-09-29",
  method: "cash",
  origAmount: null,
  origCurrency: "RWF",
  createdAt: 1759104000000,
  updatedAt: 1759104000000
}
```

Categories are stored separately and referenced by `categoryId`. Timestamps use epoch milliseconds. Editing preserves `id` and `createdAt` and updates `updatedAt`. Older local records without update timestamps are migrated when loaded.

In **Settings → Your data**, export a JSON backup or import one after confirmation. Imports validate the version, collection structure, unique IDs, record fields, category references, timestamps, budgets, currencies, and rates **before** replacing data. Invalid files leave current data intact. Imports replace rather than merge. CSV exports are for spreadsheets and cannot be restored as backups. [seed.json](seed.json) is a valid example backup; importing it replaces current data after confirmation.

There are no accounts or server storage. Clearing browser storage removes saved records; data does not sync across devices or browsers. If storage is blocked or full, the app announces the failure and offers export as a way to retain the session's data.

## Keyboard and accessibility

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Navigate controls; dialogs keep focus inside while open |
| First `Tab`, then `Enter` | Use the skip-to-content link |
| `N` | Add transaction when outside inputs and dialogs |
| `Enter` / `Space` | Activate buttons and expand inline editors |
| `Esc` | Close add/edit or confirmation dialog |
| `Enter` in category/rate/limit editor | Save the inline setting by leaving its input |

The app uses semantic landmarks and headings, labeled inputs, visible focus styles, `aria-current` navigation, live status/error regions, and text labels for chart values. Dialogs restore focus when closed; section navigation focuses the section heading. Main layout starts with mobile navigation and enhances at 768px, with additional 360px and 1024px rules. Motion respects `prefers-reduced-motion`.

## Tests

Open [index.html?tests=1](index.html?tests=1), or visit <http://localhost:8000/index.html?tests=1> while serving locally. When opening the file directly, append `?tests=1` to its address. Normal app visits do not run tests or display the test panel. It automatically runs **22 assertions**, including regex rules, leap dates, invalid patterns, case sensitivity, safe highlighting, zero-length matches, JSON round-trip, duplicate IDs, category references, timestamps, budgets, and rates. Results appear above the app with a pass count. The checks use isolated fixtures and do not edit your records. The separate test page was removed in favor of this mode; this differs from the rubric’s explicit request for a test-page filename.

Syntax checks, if Node.js is available:

```sh
node --check script.js
```

Validation/search assertions and simulated DOM checks passed during development. DOM checks covered add/edit, all sort modes, confirmation before deletion, saved state validation, cap overage messages, invalid import preservation, and confirmed valid import replacement. A full visual and keyboard audit in a real browser remains necessary; the development sandbox blocked browser launch.

Before submission, manually check 360px, 768px, and 1024px layouts, keyboard-only navigation, theme contrast, under/over-cap announcements, reload persistence, and valid/invalid file imports. Export a backup before testing replacement or erase actions.

## Files and submission

```text
index.html               Semantic sections, navigation, forms, dialogs
styles.css               Responsive layouts, themes, transitions, focus styles
script.js                App, validation, search, storage, and optional tests (IIFEs)
seed.json                Valid import example
README.md                Documentation, wireframes, and demo outline
```

Publish these static files from your repository using **GitHub Pages**, then put the repository and live Pages URLs above. Add your GitHub profile and actual demo video link before submitting. No framework, package installation, or build output is required.

## Wireframes

Mobile (360px):

```text
+---------------------------+
| Overview                  |
| Balance / income / spent  |
| Records / sum / category  |
| Seven-day spending bars   |
| Budget and category cards |
| Recent transaction cards  |
| About & contact           |
+---------------------------+
| Home | History | + | ...  |
+---------------------------+
```

Tablet/desktop (768px / 1024px):

```text
+---------------+-------------------------------------+
| Tracky        | Current section heading             |
| Add           | Summary cards / dashboard metrics   |
| About         | Seven-day chart and cap status      |
| Overview      | Budget progress | category spending |
| Transactions  | Recent transactions / record cards  |
| Budget        |                                     |
| Settings      | Footer / About & contact            |
+---------------+-------------------------------------+
```

Transactions contain a live regex search, case toggle, filters, date/description/amount sorting, record cards, and an expandable inline editor per record. A dialog provides full add/edit forms, including payment method and original currency. Settings contains editable categories, display currencies, manual rates, themes, and data tools.

## Suggested 2–3 minute demo

1. **0:00–0:20:** Introduce the Student Finance Tracker and show About/contact and dashboard metrics.
2. **0:20–0:55:** Add an expense; demonstrate an invalid number, repeated word, or invalid date and correct it. Show automatic stats updates and inline editing.
3. **0:55–1:25:** Search `coffee|tea`, toggle case sensitivity, enter `[` to show error handling, clear it, then sort descriptions and amounts.
4. **1:25–1:50:** Set a monthly cap below spending to show overage; raise it to show remaining funds and the seven-day chart.
5. **1:50–2:15:** Change display currency and a manual rate. Export JSON and import it after explaining replacement confirmation. Reload to show persistence.
6. **2:15–2:45:** Show keyboard focus, mobile layout, theme switching, and passing tests in `index.html?tests=1`. Show the GitHub Pages URL.

Record the actual demonstration and add its link to README.md before submission.
