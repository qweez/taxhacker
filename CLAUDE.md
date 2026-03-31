# TaxHacker — Deutsche Buchhaltungsplattform

## Architektur

- **Framework:** Next.js 15 (App Router, Server Actions, Turbopack)
- **Datenbank:** PostgreSQL + Prisma ORM
- **UI:** Tailwind CSS + shadcn/ui (Radix primitives)
- **Tests:** Vitest (ESM-kompatibel, `__tests__/*.test.ts`)
- **Sprache:** TypeScript strict mode, alle Imports via `@/` Alias
- **Auth:** Better Auth
- **Zielgruppe:** Deutsche Unternehmen (GmbH, UG, Einzelunternehmen, Freiberufler)

## Projektstruktur

```
app/(app)/apps/banking/     → Banking-Dashboard (Sidebar-Navigation)
  actions.ts                → Alle Server Actions (45+)
  components/               → UI-Panels (booking-mask, bwa-panel, sage-panel, etc.)
app/(app)/onboarding/       → 6-Schritte Onboarding Wizard
lib/                        → Business-Logik (EINE Implementierung pro Feature)
  fints/                    → FinTS-Client, DATEV, USt, EÜR, ZUGFeRD, XRechnung
  erpnext/                  → ERPNext REST API (client, sync, account-mapping)
  sage/                     → Sage 7.1 Exporte (Buchungsstapel, Stammdaten, GDPdU)
  bwa.ts, ebilanz.ts        → BWA Report, E-Bilanz XBRL
  dunning.ts, open-items.ts → Mahnwesen, Offene Posten
  manual-booking.ts         → Buchungsmaske + Sitzungen
  asset-accounting.ts       → Anlagenbuchhaltung (AfA, GWG)
  elster-ustva.ts           → UStVA Elster XML
  inflation.ts              → VPI-basierte Inflationsanpassung
  gobd.ts                   → GoBD-Compliance (Festschreibung, Stornobuchung)
prisma/schema.prisma        → Datenbankschema (12+ Modelle)
__tests__/                  → 433+ Tests (Vitest)
```

## Konventionen

### Code-Stil
- Alle user-facing Texte auf **Deutsch**
- Server Actions enden auf `*Action` und leben in `actions.ts`
- Mock-Objekte in Tests verwenden `as any` statt vollständige Typen
- Keine `lib/integrations/` — alles in `lib/erpnext/`, `lib/sage/`, etc.
- EINE kanonische Implementierung pro Feature — keine Duplikate

### Deutsche Buchhaltung
- **SKR04** ist Standard für GmbH/UG, SKR03 für Einzelunternehmen
- **GoBD-Pflicht:** Festschreibung (isLocked), Stornobuchung statt Löschen, Audit-Log
- **§14 UStG:** Rechnungsnummer, USt-IdNr, Leistungsdatum Pflicht
- **§288 BGB:** Verzugszinsen = Basiszins (2.27%) + 5% (B2C) / 9% (B2B)
- Beträge in **Cent** (Integer), niemals Float für Geld
- Datumsformat: DD.MM.YYYY für Benutzer, ISO für DB/API

### Prisma
- Neue Modelle: `@map("snake_case")` für DB-Spalten, `@db.Uuid` für IDs
- Self-Relations brauchen `@unique` auf Foreign Keys
- Migration-Ordner: `YYYYMMDDNNNNNN_beschreibung/migration.sql`
- Nach Schema-Änderung: `npx prisma generate` ausführen

### Tests
- Framework: Vitest mit `vi.mock("@/lib/db")` für Prisma
- Datei: `__tests__/feature-name.test.ts`
- Mock prisma vor Import: `vi.mock(...)` dann `import { ... }`
- Alle Tests müssen bestehen vor Push: `npx vitest run`

## Server / Deployment

- **Hetzner:** 91.98.44.114 (2 vCPU, 4GB RAM, Ubuntu 24.04)
- **Deploy-Pfad:** /opt/taxhacker
- **Port:** 7331 (dev), 3000 (prod)
- **Remote API:** POST http://91.98.44.114:7888/exec (Auth: Bearer sb-hetzner-2026)
- **Telegram Bot:** @Groodt_bot (Token in env)

## Verbotene Muster

- NIEMALS `lib/integrations/` erstellen — Duplikat-Falle
- NIEMALS Float für Geldbeträge
- NIEMALS Transaktionen löschen — nur Stornobuchung (GoBD)
- NIEMALS `git push --force` auf main/master
- NIEMALS englische Labels in der UI (Zielgruppe ist deutsch)
- NIEMALS secrets in committed Code
