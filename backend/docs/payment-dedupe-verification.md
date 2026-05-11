# Payment idempotency / duplicate-protection verification

**Verified during the data-integrity hardening phase (2026-05-11).**
This is a status report — the protections were already in place from
prior work; this audit confirms they're complete and correct.

## Protection layers

The platform applies **three** independent defenses against duplicate
payment writes. All three live inside `recordPaymentInner` in
`backend/src/fees/fees.service.ts` (lines 884-1027):

### 1. Pre-flight idempotency check (`fees.service.ts:892-902`)

Every `POST /payments` call accepts an optional `clientRequestId` on
`CreatePaymentDto`. Before doing anything else the service runs:

```ts
if (dto.clientRequestId) {
  const existing = await this.prisma.payment.findFirst({
    where: { schoolId, clientRequestId: dto.clientRequestId },
  });
  if (existing) {
    this.logger.log(`idempotent replay → returning existing payment id=${existing.id}`);
    return existing;
  }
}
```

A network retry (frontend offline-replay, browser-tab refresh during
pending submit) reaches this check first and returns the original
row instead of creating a second.

### 2. Database unique constraint (`schema.prisma`)

`Payment` has a unique index on `(schoolId, clientRequestId)`. Even
if two concurrent requests pass the pre-flight check at the same
millisecond, the second one's INSERT crashes with Prisma `P2002`.

### 3. P2002 race-loser recovery (`fees.service.ts:1007-1019`)

When the unique-constraint violation fires for `clientRequestId`,
the catch block re-fetches the row that won the race and returns
**that** instead of throwing:

```ts
if (dto.clientRequestId && targetList.some(t => t.includes('clientRequestId'))) {
  const existing = await this.prisma.payment.findFirst({
    where: { schoolId, clientRequestId: dto.clientRequestId },
  });
  if (existing) {
    this.logger.log(`idempotency race resolved → returning existing payment id=${existing.id}`);
    return existing;
  }
}
```

This is the critical "strict idempotency" guarantee — under contention
the API still returns the same payment for the same client-request-id.

## End-to-end scenarios verified

| Scenario | Outcome |
|---|---|
| Operator double-clicks "Save payment" | Layer 1 catches the second; one Payment row, one receipt number. |
| Frontend retries on transient 5xx (api.ts retry) | Layer 1 catches; same row returned. |
| Offline queue replay after reconnect | Layer 1 catches; same row returned. |
| Two browser tabs submit the same draft simultaneously | Layer 1 misses the race; Layer 2 throws P2002; Layer 3 returns the winner's row. |
| `clientRequestId` omitted entirely | Layer 1 skipped; receipt-number race is handled by a separate retry loop (see `fees.service.ts:984-1027`). No idempotency in this case — the contract is "send a clientRequestId for safety". |

## Audit trail

Every successful payment emits two log lines:

1. `recorded payment id=… receipt=…` — the create succeeded.
2. `idempotent replay → returning existing payment id=…` (or
   `idempotency race resolved → …`) — when a dedupe hit fired.

Grep `backend.log | grep "idempotent\|idempotency race"` to see how
often dedupe is firing in production. Any non-zero count is healthy
— it means the protection is doing its job.

## What's NOT covered (deliberate)

- **Payment without `clientRequestId`**: documented above. The
  frontend always sends one (see `frontend/lib/fees.ts`); curl /
  third-party callers that omit it accept the consequences.
- **Mutating an existing payment after the dedupe window**: out
  of scope — payments are append-only by design; refunds are a
  separate Payment row, not an UPDATE.

## No changes shipped this phase

The verification confirmed no service-layer changes are needed. The
data-integrity phase ships:

- the typed-confirmation `ConfirmDestructiveActionDialog` primitive
  (already applies to delete-student, delete-teacher, bulk
  attendance — and is available for any future "delete payment" or
  "refund payment" UI surface)
- the soft-delete audit (separate doc)
- the marks-publication lock + audit
- the bulk-attendance audit emit
