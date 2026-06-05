# RenovateConnect — Engineering Walkthrough

A guided tour of how this app is built, organized so you can read it end-to-end
once and then come back as a reference. Assumes you've written code before but
maybe not in this exact stack. Where I introduce a term that has weight in
modern engineering vocabulary, I'll italicize it the first time so you know
"this is a thing people say."

---

## 1. The stack at 30,000 feet

RenovateConnect is a two-sided marketplace: homeowners (**CLIENT**s) discover
contractors (**BUSINESS**es), and the platform makes money on the transactions
that flow through it — an 8% commission charged on top of in-app payments
(quote deposits and milestone escrow) via Stripe Connect. Add a third actor —
the **ADMIN** — who approves new listings before they hit search and grants the
**verified** trust badge that earns top placement.

> Historical note: the platform originally monetized via per-lead fees and paid
> "promoted listings." Both were fully retired (code + DB columns removed) in
> favor of the transaction-commission + verification model above. You won't find
> `isPromoted`, lead-fee billing, or saved-card-on-file anywhere in the codebase.

Three pieces make it run:

| Layer        | What it is                                            | Where it lives             |
| ------------ | ----------------------------------------------------- | -------------------------- |
| **API**      | Node.js + Express REST server, Prisma ORM, Postgres   | `api/`                     |
| **iOS app**  | SwiftUI client, talks to the API over HTTPS           | `ios/RenovateConnect/`     |
| **Infra**    | Postgres (Prisma migrations), S3 (photos), Stripe, APNs, Anthropic | `.env`-configured |

Everything is *stateless* on the server (no session cookies, no in-memory user
state); the iOS app holds a **JWT** in the Keychain and sends it on every
request as `Authorization: Bearer <token>`. The server validates the JWT,
pulls the user out, and serves the response. Pure REST, no GraphQL, no
WebSockets — we poll for new messages and rely on push notifications for
real-time-ish behavior.

### Why this stack

- **Express** is boring on purpose. Routing, middleware, done. Zero magic, so
  there's nothing to learn that won't transfer.
- **Prisma** gives us a *typed* schema (`schema.prisma`) that generates a JS
  client. We never write SQL by hand for normal queries; migrations are
  hand-authored SQL files so we control exactly what hits the database.
- **SwiftUI** is Apple's declarative UI framework. View structs describe what
  the UI looks like as a function of state; the framework re-renders when state
  changes. Conceptually similar to React.
- **JWT + Keychain** is the standard mobile auth pattern for stateless APIs.
  Server signs the token; client stores it securely; both sides are happy.

---

## 2. Repository layout

```
renovate-connect/
├── api/                              Node.js backend
│   ├── prisma/
│   │   ├── schema.prisma             Single source of truth for the DB
│   │   ├── migrations/               Hand-authored timestamped SQL
│   │   └── seed.js                   Idempotent demo data + admin account
│   ├── src/
│   │   ├── app.js                    Express composition root
│   │   ├── middleware/               auth.js, upload.js (multer)
│   │   ├── routes/                   One file per resource (REST)
│   │   ├── services/                 Cross-cutting: db, push, ai, stripe…
│   │   └── utils/
│   └── tests/                        Jest + supertest, one file per feature
│
├── ios/RenovateConnect/RenovateConnect/
│   ├── App/                          @main entry point
│   ├── Models/Models.swift           Codable structs mirroring API JSON
│   ├── Services/                     APIService, AuthStore, stores
│   ├── Views/                        SwiftUI screens grouped by domain
│   └── Utils/                        Theme, helpers
│
└── docs/                             Older reference docs (less complete than this one)
```

The mental model: **the schema is upstream of everything**. Touch
`schema.prisma`, write a migration, regenerate the Prisma client, expose the
new field through a route, mirror it in `Models.swift`, surface it in a view.

---

## 3. The backend, top to bottom

### 3.1 The composition root — `api/src/app.js`

Every Express app has one entry file that wires middleware and mounts routes
in order. Ours:

```js
const app = express();

app.use(helmet());                       // security headers
app.use(cors());                         // permissive CORS — fine for a mobile-only client
app.use(morgan('dev'));                  // request logging

// Stripe webhooks need the raw request body to verify signatures,
// so they're mounted BEFORE the JSON parser. Order matters in middleware.
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.use('/auth', authRoutes);
app.use('/businesses', businessRoutes);
// … one mount per resource
app.use('/admin', adminRoutes);
```

A couple of patterns worth naming:

- **Middleware order is semantic, not cosmetic.** `helmet` first, parser
  before routes that need parsed bodies, webhooks before the parser because
  Stripe's signature verification needs the raw bytes. Get this wrong and the
  Stripe webhook silently fails — common production bug.
- **Global error handler** at the bottom converts Zod validation errors into
  clean 400s and everything else into a 500 with the message. This means
  individual routes can just `throw` (or call `next(err)`) and get consistent
  responses.

### 3.2 Auth — `middleware/auth.js`

Two exports:

```js
authMiddleware(req, res, next)    // verifies JWT, attaches req.user
requireRole(...allowedRoles)      // returns a middleware that 403s the wrong role
```

Usage on a route:

```js
router.get('/dashboard',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  async (req, res, next) => { /* … */ });
```

This is *role-based access control* (RBAC) in its simplest form. We have three
roles — `CLIENT`, `BUSINESS`, `ADMIN` — defined in the Prisma `Role` enum.
The middleware is dumb on purpose: it doesn't know about the resource, only
the role. *Resource ownership* (e.g. "this business owns this portfolio
project") is enforced inside the route handler via a helper like
`requireBusinessOwner(req, res)`.

The JWT payload is `{ id, role }` — that's it. We sign with `JWT_SECRET` and
verify with the same secret on every request. There are no refresh tokens; the
token has a long expiry and the client re-logs-in when it expires.

### 3.3 Prisma — schema → migrations → client

`schema.prisma` is the source of truth for the DB. A taste:

```prisma
enum Role {
  CLIENT
  BUSINESS
  ADMIN
}

model Business {
  id              String    @id @default(cuid())
  userId          String    @unique
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyName     String
  // … many columns elided
  approvalStatus  ApprovalStatus @default(PENDING)
  rejectionReason String?
  portfolio       PortfolioProject[]
}
```

Three things to internalize:

1. **Migrations are hand-authored SQL** in
   `prisma/migrations/YYYYMMDDHHMMSS_name/migration.sql`. We don't use
   `prisma migrate dev` (which auto-generates); we write the SQL ourselves so
   we know exactly what runs in production. The Prisma CLI just applies them
   in order via `npx prisma migrate deploy`.
2. **`npx prisma generate`** regenerates the typed client from the schema.
   Run it after every schema change so the JS client knows about new fields.
3. **`cuid()`** gives us collision-resistant string IDs (instead of auto-
   incrementing ints). They're URL-safe, don't leak row counts, and are easy
   to log.

The migration we shipped for the approval workflow is a good example of the
pattern:

```sql
-- prisma/migrations/20260603110000_approval_workflow/migration.sql
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Business"
  ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- Backfill existing rows so live data isn't suddenly hidden.
UPDATE "Business" SET "approvalStatus" = 'APPROVED', "reviewedAt" = NOW();
```

Note the **backfill**: when you add a `NOT NULL` column with a non-trivial
semantic meaning, you almost always need to retro-apply it to existing rows.
The schema's `default(PENDING)` is for *new* rows; the `UPDATE` statement
handles the rows that existed before this migration ran. Forgetting this is
how production search results disappear at 2am.

### 3.4 Route convention — one file per resource

Every file in `src/routes/` is an Express `Router`. They follow REST:

```
GET    /businesses           — search / list (public)
GET    /businesses/:id       — read one (public, owner-aware)
POST   /businesses           — create (BUSINESS role)
PUT    /businesses/:id       — update (owner only)
PATCH  /businesses/:id/verify — toggle a single field (ADMIN)
```

Two non-obvious conventions:

- **Specific paths come before parametric ones.** `GET /dashboard` is declared
  *before* `GET /:id` so Express doesn't try to look up a business with id
  `"dashboard"`. This is a classic Express footgun.
- **Public reads parse the JWT optionally** to enable owner-aware behavior
  without requiring auth. The business detail route does this:

  ```js
  let viewerId = null, viewerRole = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      viewerId = payload.id;
      viewerRole = payload.role;
    } catch { /* ignore */ }
  }
  ```

  The route is public, but if the caller *did* send a token we use it to (a)
  skip self-views in analytics and (b) let the owner see their own pending
  listing.

### 3.5 Validation with Zod

Every request body that isn't trivial goes through a *Zod* schema. Example:

```js
const portfolioSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  costMin: z.number().int().min(0).optional(),
  imageUrls: z.array(z.string()).optional(),
});

router.post('/:id/portfolio', /* auth */ async (req, res, next) => {
  try {
    const data = portfolioSchema.parse(req.body);   // throws on invalid
    const project = await db.portfolioProject.create({ data });
    res.status(201).json(project);
  } catch (err) { next(err); }
});
```

The global error handler in `app.js` catches `ZodError` and turns it into a
readable `400 { error: "Required (title)" }`. The route handler stays clean —
no validation boilerplate, no manual `if (!req.body.title)`.

`.partial()` makes every field optional, which is exactly what you want for a
PUT/PATCH that allows partial updates.

### 3.6 The services layer

Anything that talks to the outside world (S3, Stripe, Anthropic, APNs) lives
in `src/services/` so route handlers stay focused on shaping responses.

| File              | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `db.js`           | Singleton PrismaClient. Import this everywhere.        |
| `storage.js`      | S3 uploads. `uploadImage(buffer, mimetype) → URL`.     |
| `ai.js`           | Anthropic SDK wrapper for the chatbot + estimator.     |
| `stripe.js`       | Stripe SDK wrapper: invoices, customers, checkout.     |
| `push.js`         | APNs HTTP/2 push delivery + per-user prefs check.      |
| `activity.js`     | Persists in-app activity feed entries (push twins).    |
| `savedSearch.js`  | Notifies homeowners when a new matching contractor signs up. |

Using `storage.uploadImage` as a tiny example of the pattern:

```js
// services/storage.js
const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET;

async function uploadImage(buffer, mimetype) {
  const key = `uploads/${crypto.randomUUID()}.jpg`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimetype,
  }));
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}
```

Route code never imports `@aws-sdk/client-s3` directly. If we swap to
CloudFlare R2 tomorrow, one file changes.

### 3.7 Multipart uploads

For photo uploads we use **multer** as middleware. It parses
`multipart/form-data` (the encoding browsers and apps use for file uploads)
and attaches `req.files` to the request:

```js
// middleware/upload.js
const upload = multer({
  storage: multer.memoryStorage(),                   // hold in RAM, not disk
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    cb(file.mimetype.startsWith('image/') ? null : new Error('Only image files'), true);
  },
});

// routes/businesses.js
router.post(
  '/:id/portfolio/:projectId/images',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  upload.array('images', 10),         // up to 10 files, field name "images"
  async (req, res, next) => {
    const urls = await Promise.all(req.files.map((f) => uploadImage(f.buffer, f.mimetype)));
    // …append urls to project.imageUrls
  }
);
```

`memoryStorage()` is fine here because we immediately stream the bytes to S3.
If we were processing huge files we'd use disk storage to avoid OOM.

### 3.8 Webhooks — the asymmetric part

Most routes are request-response. **Webhooks** are when *they* call *us*. The
canonical example: a homeowner completes Stripe Checkout and Stripe notifies us
via `POST /webhooks/stripe` (`checkout.session.completed`) so we can flip the
`Payment` to `SUCCEEDED` (and, for escrow, the `Milestone` to `FUNDED`) in our DB.

Two things make webhooks awkward:

1. **Signature verification** — we need the raw request body (bytes, not
   parsed JSON) to verify Stripe's HMAC signature. That's why `webhookRoutes`
   is mounted *before* `express.json()` in `app.js`.
2. **Idempotency** — Stripe retries on failure, so the same event can arrive
   twice. Our handler is written so processing the same event twice is a no-op
   (we check the payment/milestone status before flipping it).

### 3.9 Testing

Jest + supertest. The pattern:

```js
// tests/admin.test.js
const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createAdmin } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

test('approving a business makes it public', async () => {
  const { business } = await createBusiness({ approvalStatus: 'PENDING' });
  const { token } = await createAdmin();

  const res = await request(app)
    .post(`/admin/businesses/${business.id}/approve`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.approvalStatus).toBe('APPROVED');
});
```

Key infrastructure:

- **`tests/globalSetup.js`** runs once at suite startup. It runs
  `prisma db push` against the `renovate_connect_test` database so the schema
  is in sync.
- **`tests/helpers.js`** exposes `resetDb()` (wipes all tables in FK order
  between tests), `createBusiness()` / `createClient()` / `createAdmin()`
  factories, and `tokenFor(user)` for signing test JWTs.
- **`npm test`** is the only command. It runs `jest --runInBand --forceExit`.
  `--runInBand` serializes tests so they don't fight over the same Postgres
  rows. Never run `npx jest` — it skips the wrapper.

External services are *mocked* at the module boundary:

```js
// tests/portfolioImages.test.js
jest.mock('../src/services/storage', () => {
  let n = 0;
  return { uploadImage: jest.fn(async () => `https://cdn.test/image-${++n}.jpg`) };
});
```

This is the standard mocking pattern: replace the whole module with a stub so
nothing reaches AWS during tests. The same trick works for Stripe and APNs.

### 3.10 Seeding — `prisma/seed.js`

Run via `node prisma/seed.js`. It's **idempotent** — running it twice is
safe — because it uses `prisma.user.upsert({ where: { email }, update: {}, create: { … } })`.
That pattern is worth remembering: upsert with an empty `update` block means
"create if missing, otherwise leave alone."

The seed creates 8 demo contractors, their portfolios, reviews, and one admin
account (`admin@renovateconnect.dev`, password `Password123!`). All demo data
is pre-marked APPROVED so the marketplace is immediately browsable.

---

## 4. The iOS app, top to bottom

### 4.1 SwiftUI in one paragraph

In SwiftUI, views are **structs** that describe their content as a function of
state. When state changes, the framework re-runs `body` and diffs the output
to update the screen — same idea as React's render. State that triggers
re-renders is marked with property wrappers (`@State`, `@StateObject`,
`@EnvironmentObject`, `@Published`). View structs are cheap to create and
destroy; they're recipes, not the actual UI.

### 4.2 The entry point — `App/RenovateConnectApp.swift`

```swift
@main
struct RenovateConnectApp: App {
    @StateObject private var auth = AuthStore()
    @StateObject private var notifications = NotificationManager()

    var body: some Scene {
        WindowGroup {
            if auth.currentUser == nil {
                LoginView()
            } else {
                MainTabView()
            }
        }
        .environmentObject(auth)
        .environmentObject(notifications)
    }
}
```

`@main` tells Swift "this is the app." `@StateObject` instantiates an
ObservableObject *once* and owns its lifetime; `.environmentObject(auth)`
puts it on the SwiftUI environment so any child view can pull it out with
`@EnvironmentObject private var auth: AuthStore`. This is *dependency
injection* the SwiftUI way — no DI container needed.

The conditional at the top (`if auth.currentUser == nil`) is how routing-by-
role works. When `auth.currentUser` flips from `nil` to a value, the whole
tree swaps from `LoginView()` to `MainTabView()`. No `NavigationStack`
gymnastics needed.

### 4.3 AuthStore — single source of truth for the signed-in user

```swift
@MainActor
final class AuthStore: ObservableObject {
    @Published var currentUser: User?

    var isBusiness: Bool { currentUser?.role == .business }
    var isAdmin: Bool { currentUser?.role == .admin }
    var myBusinessId: String? { currentUser?.business?.id }
}
```

- **`@MainActor`** says "every method on this class runs on the main thread."
  SwiftUI reads `@Published` properties on the main thread; this annotation
  prevents accidental cross-thread writes.
- **`@Published var currentUser`** is the reactive bit. Any view that reads
  `auth.currentUser` re-renders when it changes.
- The JWT itself lives in the **Keychain**, not in this object. We keep
  secrets in the OS-managed encrypted store, never in `UserDefaults`.

### 4.4 APIService — the HTTP layer

One singleton, one private generic `request<T: Decodable>` method that does
the URLSession dance and decodes JSON:

```swift
class APIService {
    static let shared = APIService()
    private let base = URL(string: "http://192.168.11.212:3000")!
    var token: String?

    private func request<T: Decodable>(
        _ path: String, method: String = "GET", body: Encodable? = nil
    ) async throws -> T {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONEncoder().encode(body); /* + content-type */ }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed(/* … */)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    // Public surface:
    func myLeads() async throws -> [Lead] { try await request("leads") }
    func updateLead(id: String, status: LeadStatus, …) async throws -> Lead { … }
}
```

A few patterns to call out:

- **`async/await`** is Swift's modern concurrency. `try await api.myLeads()`
  reads like sync code but doesn't block the thread. Replaces callbacks and
  `Combine` for most API code.
- **Generics on the return type** mean we get type-safe JSON decoding in one
  place. The compiler infers `T` from the call site:
  `let leads: [Lead] = try await request("leads")`.
- **`Encodable` body parameter** lets us pass any struct, array, or
  `[String: String]` dictionary as the body without overloads.

For multipart uploads we drop down to manual URLRequest assembly because
JSON encoders don't speak multipart. See `uploadPortfolioImages` in
`Services/APIService.swift` for the pattern: assemble a boundary, write each
file part with `Content-Disposition: form-data; name="images"; filename="…"`,
write the trailer, set the `Content-Type` header to
`multipart/form-data; boundary=…`. Same shape as a browser form submission.

### 4.5 Codable models mirror the API

Every JSON model returned by the API has a Swift `struct` in `Models.swift`
that conforms to `Codable`:

```swift
struct Business: Codable, Identifiable {
    let id: String
    let companyName: String
    let specialties: [String]
    let averageRating: Double
    var portfolio: [PortfolioProject]?    // optional because not always included
    var approvalStatus: ApprovalStatus?
}

enum ApprovalStatus: String, Codable {
    case pending  = "PENDING"
    case approved = "APPROVED"
    case rejected = "REJECTED"
}
```

- **`Codable`** = `Encodable & Decodable`. The compiler synthesizes the
  serialization automatically as long as property names match the JSON keys.
- **`Identifiable`** (requires an `id` property) lets `ForEach` use the id as
  the row identity, so SwiftUI can diff lists efficiently.
- **`String` raw values on enums** matter because Postgres enums come over as
  uppercase strings. Mapping `case approved = "APPROVED"` keeps Swift idioms
  while matching the wire format.

The rule of thumb: **anything optional in the JSON should be `?` in Swift**.
If you make a non-optional field that turns out to be sometimes-missing,
decoding throws for the whole response and the screen goes blank.

### 4.6 Routing by role — `MainTabView`

```swift
var body: some View {
    Group {
        if auth.isAdmin       { adminTabs }
        else if auth.isBusiness { businessTabs }
        else                  { clientTabs }
    }
}
```

Three completely different tab bars depending on who's signed in:

| Role     | Tabs                                                    |
| -------- | ------------------------------------------------------- |
| CLIENT   | Explore · Estimate · AI Chat · Messages · Profile       |
| BUSINESS | Dashboard · Leads · Portfolio · Messages · Profile      |
| ADMIN    | Approvals · Explore · Messages · Profile                |

Each tab is just a SwiftUI view (`DashboardView()`, `AdminView()`, etc.) with
a `.tabItem { Label("…", systemImage: "…") }` modifier. Tabs are tagged by
integer (`.tag(0)`) so a central `TabRouter` object can programmatically
switch tabs in response to deep links or push notifications.

### 4.7 Views — folder structure mirrors features

```
Views/
├── Admin/AdminView.swift                      Approval queue
├── Auth/LoginView.swift, RegisterView.swift
├── Business/                                  Contractor-only screens
│   ├── DashboardView.swift                    Stats + approval banner
│   ├── LeadsView.swift                        + LeadDetailSheet (free CRM)
│   └── PortfolioManagerView.swift             + PortfolioEditorSheet
├── Chat/AIChatView.swift
├── Estimation/EstimationView.swift            Multipart image upload
├── Home/                                      Tab shells + project hub
│   ├── MainTabView.swift, GuestTabView.swift
│   └── MyProjectsView.swift, ProjectDetailView.swift   Escrow + timeline
├── Messaging/                                 Conversation list + thread
├── Notifications/NotificationCenterView.swift Activity feed + bell
├── Payments/PaymentsView.swift                Deposit/escrow history
└── Onboarding/OnboardingView.swift
```

**One feature, one or two files.** `LeadsView` defines the list, the row,
the status badge, and the detail sheet in the same file because they're a
unit. When you need a piece elsewhere you extract it; until then, locality
beats premature abstraction.

### 4.8 State management — the cheat sheet

| Wrapper                | Use when                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| `@State`               | Value owned by *this* view (e.g. a sheet's text field)                    |
| `@StateObject`         | Reference type (ObservableObject) instantiated by this view, owns it     |
| `@ObservedObject`      | Reference type *passed in*, owned elsewhere                              |
| `@EnvironmentObject`   | Reference type injected via `.environmentObject()` higher in the tree    |
| `@Binding`             | Two-way reference to state owned by a parent (e.g. `$isOn`)              |
| `@AppStorage("key")`   | `UserDefaults`-backed flag (booleans, small strings)                     |

Real example from `PortfolioEditorSheet`:

```swift
@State private var title: String              // owned here
@State private var picker: [PhotosPickerItem] // owned here
@State private var imageUrls: [String]        // owned here, init from project

init(businessId: String, project: PortfolioProject?, …) {
    _imageUrls = State(initialValue: project?.imageUrls ?? [])
}
```

The leading underscore (`_imageUrls`) is how you assign to the *wrapper*
itself in `init`, not its value. The `State(initialValue:)` constructor seeds
the initial value from the passed-in project.

### 4.9 Async data loading + pull to refresh

The pattern, in three lines:

```swift
.task { await load() }              // runs once when the view appears
.refreshable { await load() }       // pull-to-refresh
.task(id: someId) { await load() }  // re-runs when someId changes
```

`load()` itself is just:

```swift
private func load() async {
    isLoading = true
    defer { isLoading = false }
    do { stats = try await APIService.shared.dashboard() }
    catch { error = error.localizedDescription }
}
```

`defer` runs at the end of the function regardless of how it exits — Swift's
version of `try/finally`. Indispensable for cleanup.

### 4.10 PhotosPicker + multipart upload

The new portfolio image editor uses Apple's `PhotosPicker`:

```swift
@State private var picker: [PhotosPickerItem] = []

PhotosPicker(selection: $picker, maxSelectionCount: 10, matching: .images) {
    Label("Add photos", systemImage: "photo.on.rectangle.angled")
}
.onChange(of: picker) { _, items in
    Task { await uploadPicked(items) }
}

private func uploadPicked(_ items: [PhotosPickerItem]) async {
    var payloads: [Data] = []
    for item in items {
        if let data = try? await item.loadTransferable(type: Data.self) {
            payloads.append(data)
        }
    }
    let updated = try await APIService.shared.uploadPortfolioImages(
        businessId: businessId, projectId: project.id, images: payloads)
    imageUrls = updated.imageUrls
}
```

`loadTransferable(type: Data.self)` is Apple's modern API for pulling raw
bytes out of a `PhotosPickerItem`. It hands us the JPEG buffer we POST via
multipart to the backend.

---

## 5. End-to-end feature walkthroughs

Picking three features that hit every layer.

### 5.1 The payment flow — how a quote becomes revenue

This is the core business loop. Revenue comes from a commission on in-app
payments, *not* from leads (leads are a free CRM pipeline — see below). Follow
the data for the deposit case:

1. **Contractor onboards Stripe Connect.** Before they can receive money they
   complete `/payments/connect/*` onboarding; the backend tracks
   `Business.stripeAccountId` + `payoutsEnabled`. No payouts enabled, no
   accepting deposits.
2. **Client accepts a quote** and pays the deposit. The backend creates a
   hosted Stripe Checkout session as a **destination charge**: the deposit is
   10% of the quote midpoint (floored at $50), and the platform's 8% commission
   rides along as the Stripe `application_fee_amount` (fee *on top*). The client
   is sent to the Checkout URL (opened in `SafariView`).
3. **Settlement is webhook-driven**, not inline. When Checkout completes, Stripe
   posts `checkout.session.completed`; `routes/webhooks.js` verifies the
   signature, flips the `Payment` row to `SUCCEEDED`, and the funds (minus our
   fee) land in the contractor's connected account.
4. **Refunds** (`POST /payments/:id/refund`, contractor or admin) are full and
   reverse the transfer + application fee.

The **milestone escrow** flow (section 5.4-style staged payments) is the same
machinery with one twist: instead of a destination charge, funds are *held on
the platform* when funded, then released to the contractor via a transfer when
the homeowner approves the completed work — or auto-released 7 days after the
contractor submits proof. Same 8% fee-on-top, same webhook-driven settlement.

**Where do leads fit?** When a client first messages a contractor, the backend
still creates a `Lead` row (`POST /conversations`), but it's no longer billed —
it's the contractor's free CRM pipeline (`NEW → CONTACTED → CONVERTED → CLOSED`)
in `LeadsView`, plus a push + activity-feed entry. The conversation is what
eventually leads to a quote, and the quote is what eventually earns revenue.

Files involved: `routes/payments.js`, `routes/projects.js` (escrow),
`routes/webhooks.js`, `services/stripe.js`, `routes/messages.js`,
`routes/leads.js`, `services/push.js`, `QuotesView.swift`,
`ProjectDetailView.swift`, `LeadsView.swift`.

### 5.2 The approval workflow — gating new content

The simplest possible CMS pattern, applied here to both business listings and
portfolio projects.

- **Schema**: `approvalStatus` defaults to PENDING on every new row.
- **Public read endpoints** filter `where: { approvalStatus: 'APPROVED' }`.
- **Owner-aware reads** check the optional JWT and skip the filter for the
  owner (so they can preview their own pending stuff) and admins.
- **`/admin/pending`** returns everything in `PENDING` state; the iOS
  `AdminView` renders it as two sections (Listings, Projects) with approve/
  reject buttons.
- **Approval/rejection** is just a row update: set status, stamp `reviewedAt`,
  optionally store a `rejectionReason`. The owner sees the reason in the
  editor sheet so they know what to fix.

Worth noting: the very first migration backfills all *existing* rows to
APPROVED so the moment we ship this, nothing disappears from search. Without
that backfill, every live contractor would vanish when the new code deployed.

### 5.3 Search impressions — fire-and-forget analytics

A small example of a common pattern: side-effects that shouldn't slow the
user-facing response.

```js
// routes/businesses.js — GET /
const [businesses, total] = await Promise.all([…]);

// Count one impression per listing shown on this page. Fire and forget —
// never block the response on analytics writes.
if (businesses.length > 0) {
  db.business.updateMany({
    where: { id: { in: businesses.map(b => b.id) } },
    data: { searchImpressions: { increment: 1 } },
  }).catch(() => {});
}

res.json({ businesses, total, page, limit });
```

Key idioms:

- **No `await`.** We kick off the update and immediately return the response.
- **`.catch(() => {})`** swallows any error. If analytics writes fail, search
  still works.
- **`{ increment: 1 }`** is Prisma's atomic-counter syntax — it generates
  `SET searchImpressions = searchImpressions + 1` in SQL, so concurrent
  requests don't race.

The dashboard surfaces these numbers next to `profileViews`, which is tracked
on the detail route the same way (and skips the owner's own views via the
optional JWT parse).

---

## 6. How a feature actually gets built

Every feature in this repo went through roughly the same arc. Use this as a
playbook when you want to add the next one:

1. **Schema first.** Add fields to `schema.prisma`. Write a timestamped
   migration in `prisma/migrations/`. Run
   `npx prisma migrate deploy && npx prisma generate`. Backfill if you're
   adding NOT NULL columns with semantics.
2. **Route + Zod schema.** Drop into `routes/<resource>.js`. Add the
   endpoint. Validate the body with Zod. Use `authMiddleware` and
   `requireRole` as needed. Touch a service file if you need to talk to S3,
   Stripe, Anthropic, or APNs.
3. **Tests.** Write a `tests/<feature>.test.js`. Use `createBusiness` /
   `createClient` / `createAdmin` helpers. Cover the role gate (403),
   ownership (another user's 403), validation (400), and the happy path
   (200/201). Mock external services at the module boundary.
4. **iOS model.** Mirror the new fields in `Models/Models.swift`. New
   optional fields are `?`. New enums are `String, Codable` with raw values
   matching the API.
5. **iOS APIService method.** One async function per endpoint. Reuse the
   generic `request<T>` helper unless you need multipart.
6. **iOS view.** Add or extend a SwiftUI view. `.task { await load() }` for
   initial load, `.refreshable` for pull-to-refresh, `@State` for local stuff,
   `@EnvironmentObject` for cross-cutting stores.
7. **Run `npm test`** in `api/`. If green, commit.
8. **Commit message** captures the *why* and the moving parts, not just a
   list of changed files. End with the
   `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer.

When you skip step 1, you'll regret it. The schema is the contract; once it's
right the rest is mechanical.

---

## 7. Vocabulary you can drop in conversation

Terms that come up constantly when discussing this codebase, with the meaning
they have *here*:

- **Composition root** — the single file that wires everything together
  (`app.js`). Mature codebases minimize logic in it.
- **Middleware chain** — the ordered list of functions every request flows
  through. Order is semantic; getting it wrong silently breaks things.
- **RBAC (role-based access control)** — coarse-grained authorization by
  user role. Our `requireRole('ADMIN')` is textbook RBAC.
- **Resource ownership** — the orthogonal check: not "is this user an admin"
  but "does this user own this *specific* row." We do it inline.
- **Idempotent** — running the same operation twice produces the same end
  state. Webhooks, seeds, and the rejection-reason-clearing on re-approve
  are all idempotent here.
- **Optimistic UI** — updating the local state immediately, before the
  server confirms, for snappy interactions. We use it sparingly (most flows
  await the server response).
- **Fire-and-forget** — kicking off a side effect without awaiting it. The
  impression counter is the textbook example.
- **Source of truth** — wherever the canonical value lives. The schema is
  the source of truth for data shape; `AuthStore.currentUser` is the source
  of truth for "who's signed in."
- **Dependency injection** — handing collaborators *in* rather than having
  code reach out for them. `.environmentObject(auth)` is SwiftUI's DI.
- **Backfill** — running a one-time data update so historic rows conform to
  a new schema constraint.
- **Cold start** — the very first launch (no cache, possibly no auth). The
  app handles cold-start deep links and pending pushes from `MainTabView`'s
  `.task`.
- **Reactive rendering** — UI that re-renders automatically when its inputs
  change. SwiftUI's `@Published` and React's `useState` are the same idea.
- **Codable** — Swift's protocol for "this type can be serialized to/from a
  data format" (almost always JSON in this app).

---

## 8. Where to read next

In rough priority order if you want to deep-dive code paths:

1. **`api/src/app.js`** + **`api/src/middleware/auth.js`** — 10 minutes to
   internalize how every request gets handled.
2. **`api/prisma/schema.prisma`** — the whole data model on one page. If you
   know this, you know the app.
3. **`api/src/routes/businesses.js`** — the largest route file, hits every
   pattern (public, owner-only, admin-only, multipart, analytics).
4. **`api/tests/admin.test.js`** + **`api/tests/portfolio.test.js`** — the
   testing patterns to copy when you add a feature.
5. **`ios/RenovateConnect/RenovateConnect/Services/APIService.swift`** —
   every HTTP call the app makes lives here, in order.
6. **`ios/RenovateConnect/RenovateConnect/Views/Home/MainTabView.swift`** —
   the tree's root after sign-in; shows the role routing in 30 lines.
7. **`ios/RenovateConnect/RenovateConnect/Views/Business/PortfolioManagerView.swift`** —
   a non-trivial editor: form, image picker, multipart upload, delete with
   confirmation, approval status surfacing. Pretty representative.

Once those click, you can read anything else in the repo without needing the
map.
