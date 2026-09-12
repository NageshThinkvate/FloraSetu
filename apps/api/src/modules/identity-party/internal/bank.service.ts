import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { assertOrgAccess, assertOrgAccessOrPlatform, assertSupplierSide, maskAccountNumber } from './policies';

// ADR-004: bank/payout changes are high-risk — immutable account history,
// PENDING_REVERIFICATION, payout freeze, dual approval, audited to both streams.
@Injectable()
export class BankService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService
  ) {}

  async createPayoutProfile(
    orgId: string,
    input: { accountRef: string; ifsc: string; accountNumber: string; holderName: string }
  ): Promise<{ changeRequestId: string; status: string }> {
    const ctx = RequestContext.get();
    assertOrgAccess(ctx, orgId);
    assertSupplierSide(ctx);
    return this.db.withTransaction(async (client) => {
      const account = await client.query<{ id: string }>(
        `INSERT INTO identity.bank_accounts (org_id, account_ref, ifsc, account_number_enc, holder_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, input.accountRef, input.ifsc, input.accountNumber, input.holderName]
      );
      const change = await client.query<{ id: string }>(
        `INSERT INTO identity.bank_change_requests (org_id, new_bank_account_id, status, payout_freeze)
         VALUES ($1, $2, 'PENDING_REVERIFICATION', true) RETURNING id`,
        [orgId, account.rows[0].id]
      );
      await client.query(
        `INSERT INTO identity.verification_history (org_id, subject_type, subject_id, from_status, to_status, actor_user_id)
         VALUES ($1, 'BANK', $2, NULL, 'PENDING_REVERIFICATION', $3)`,
        [orgId, change.rows[0].id, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'bank.change.request', objectType: 'bank_change_request', objectId: change.rows[0].id,
        after: { orgId, accountId: account.rows[0].id }
      });
      await this.outbox.emit(client, {
        aggregateType: 'bank_change_request', aggregateId: change.rows[0].id,
        type: 'party.bank.change.requested', payload: { orgId, requestId: change.rows[0].id }
      });
      return { changeRequestId: change.rows[0].id, status: 'PENDING_REVERIFICATION' };
    }).then(async (result) => {
      await this.audit.recordSecurity('high_risk.bank.change.requested', 'HIGH', {
        orgId, changeRequestId: result.changeRequestId
      });
      return result;
    });
  }

  // Masked reads only; account numbers never leave this context in cleartext via API.
  async listAccounts(orgId: string): Promise<{ items: unknown[] }> {
    assertOrgAccessOrPlatform(RequestContext.get(), orgId);
    const result = await this.db.query(
      `SELECT id, account_ref, ifsc, account_number_enc, holder_name, effective_from, superseded_by
       FROM identity.bank_accounts WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        account_ref: r.account_ref,
        ifsc: r.ifsc,
        account_number: maskAccountNumber(r.account_number_enc),
        holder_name: r.holder_name,
        effective_from: r.effective_from,
        superseded: r.superseded_by !== null
      }))
    };
  }

  async listChangeRequests(orgId: string): Promise<{ items: unknown[] }> {
    assertOrgAccessOrPlatform(RequestContext.get(), orgId);
    const result = await this.db.query(
      `SELECT id, status, payout_freeze, approver_1_id, approver_1_at, approver_2_id, approver_2_at, created_at
       FROM identity.bank_change_requests WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  async approve(orgId: string, requestId: string): Promise<{ status: string }> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{
        id: string; org_id: string; status: string; approver_1_id: string | null; new_bank_account_id: string;
      }>(
        `SELECT id, org_id, status, approver_1_id, new_bank_account_id
         FROM identity.bank_change_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const req = locked.rows[0];
      if (!req || req.org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Change request not found');
      }
      if (!['PENDING_REVERIFICATION', 'APPROVED_FIRST'].includes(req.status)) {
        throw new ApiException(409, 'CONFLICT', `Request is ${req.status}`);
      }
      if (req.status === 'APPROVED_FIRST' && req.approver_1_id === ctx.userId) {
        throw new ApiException(409, 'CONFLICT', 'Dual approval requires a second distinct approver');
      }
      const final = req.status === 'APPROVED_FIRST';
      const newStatus = final ? 'APPROVED_FINAL' : 'APPROVED_FIRST';
      await client.query(
        `UPDATE identity.bank_change_requests
         SET ${final ? 'approver_2_id' : 'approver_1_id'} = $2, ${final ? 'approver_2_at' : 'approver_1_at'} = now(),
             status = $3, payout_freeze = $4, updated_at = now()
         WHERE id = $1`,
        [requestId, ctx.userId, newStatus, !final]
      );
      if (final) {
        await client.query(
          `UPDATE identity.bank_accounts SET superseded_by = $2
           WHERE org_id = $1 AND superseded_by IS NULL AND id <> $2`,
          [orgId, req.new_bank_account_id]
        );
      }
      await client.query(
        `INSERT INTO identity.verification_history (org_id, subject_type, subject_id, from_status, to_status, actor_user_id)
         VALUES ($1, 'BANK', $2, $3, $4, $5)`,
        [orgId, requestId, req.status, newStatus, ctx.userId]
      );
      await this.audit.record(client, {
        action: final ? 'bank.change.approve.final' : 'bank.change.approve.first',
        objectType: 'bank_change_request', objectId: requestId,
        before: { status: req.status }, after: { status: newStatus }
      });
      return { status: newStatus };
    }).then(async (result) => {
      await this.audit.recordSecurity('high_risk.bank.change.approval', 'HIGH', {
        orgId, requestId, status: result.status
      });
      return result;
    });
  }
}
