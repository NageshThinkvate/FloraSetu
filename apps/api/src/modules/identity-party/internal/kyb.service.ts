import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { assertOrgAccess } from './policies';

// Phase 7 (ADR-014): structured KYB rejection/correction reason codes.
export const KYB_REJECTION_REASONS = new Set([
  'CORRECTION_REQUIRED', 'DOCUMENT_ILLEGIBLE', 'DOCUMENT_EXPIRED',
  'DETAILS_MISMATCH', 'INELIGIBLE', 'OTHER'
]);

@Injectable()
export class KybService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService
  ) {}

  async submit(
    orgId: string,
    documents: { docType: 'GST' | 'PAN' | 'TRADE_LICENSE' | 'BANK_PROOF' | 'OTHER'; objectKey: string; contentType: string; byteSize: number }[]
  ): Promise<{ submitted: number }> {
    const ctx = RequestContext.get();
    assertOrgAccess(ctx, orgId);
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'At least one document is required');
    }
    return this.db.withTransaction(async (client) => {
      for (const doc of documents) {
        const media = await client.query<{ id: string }>(
          `INSERT INTO core.media_objects (org_id, bucket, object_key, content_type, byte_size)
           VALUES ($1, 'kyb', $2, $3, $4) RETURNING id`,
          [orgId, doc.objectKey, doc.contentType, doc.byteSize]
        );
        await client.query(
          `INSERT INTO identity.documents (org_id, doc_type, media_object_id, uploaded_by)
           VALUES ($1, $2, $3, $4)`,
          [orgId, doc.docType, media.rows[0].id, ctx.userId]
        );
      }
      const updated = await client.query<{ kyb_status: string }>(
        `UPDATE identity.organizations SET kyb_status = 'IN_REVIEW', version = version + 1, updated_at = now()
         WHERE id = $1 AND kyb_status IN ('NOT_STARTED','REJECTED') RETURNING kyb_status`,
        [orgId]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'KYB already in review or verified');
      }
      await client.query(
        `INSERT INTO identity.verification_history (org_id, subject_type, from_status, to_status, actor_user_id)
         VALUES ($1, 'ORGANIZATION', NULL, 'IN_REVIEW', $2)`,
        [orgId, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'org.kyb.submit', objectType: 'organization', objectId: orgId,
        after: { documentCount: documents.length }
      });
      await this.outbox.emit(client, {
        aggregateType: 'organization', aggregateId: orgId, type: 'party.kyb.updated',
        payload: { orgId, toStatus: 'IN_REVIEW' }
      });
      return { submitted: documents.length };
    });
  }

  // Phase 7 (ADR-014): REJECTED always requires a structured reason code;
  // CORRECTION_REQUIRED additionally requires a note explaining what to fix.
  // The state machine is unchanged — correction = REJECTED + reason_code, and the
  // organization resubmits through the existing REJECTED → IN_REVIEW path.
  async review(orgId: string, decision: 'VERIFIED' | 'REJECTED', reasonCode?: string, note?: string): Promise<void> {
    const ctx = RequestContext.get();
    if (decision === 'REJECTED') {
      if (!reasonCode || !KYB_REJECTION_REASONS.has(reasonCode)) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'A structured reason code is required when rejecting', {
          allowed: [...KYB_REJECTION_REASONS]
        });
      }
      if (reasonCode === 'CORRECTION_REQUIRED' && !note?.trim()) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Explain what the organization must correct');
      }
    }
    await this.db.withTransaction(async (client) => {
      const current = await client.query<{ kyb_status: string }>(
        `SELECT kyb_status FROM identity.organizations WHERE id = $1 FOR UPDATE`,
        [orgId]
      );
      if (current.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
      }
      if (current.rows[0].kyb_status !== 'IN_REVIEW') {
        throw new ApiException(409, 'CONFLICT', 'Only in-review organizations can be decided');
      }
      await client.query(
        `UPDATE identity.organizations SET kyb_status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
        [orgId, decision]
      );
      await client.query(
        `UPDATE identity.documents SET status = $2, reviewed_by = $3, reviewed_at = now()
         WHERE org_id = $1 AND status = 'PENDING'`,
        [orgId, decision, ctx.userId]
      );
      await client.query(
        `INSERT INTO identity.verification_history (org_id, subject_type, from_status, to_status, actor_user_id, note, reason_code)
         VALUES ($1, 'ORGANIZATION', 'IN_REVIEW', $2, $3, $4, $5)`,
        [orgId, decision, ctx.userId, note ?? null, decision === 'REJECTED' ? reasonCode : null]
      );
      await this.audit.record(client, {
        action: 'org.kyb.review', objectType: 'organization', objectId: orgId,
        after: { decision, reasonCode: decision === 'REJECTED' ? reasonCode : null, note }
      });
      await this.outbox.emit(client, {
        aggregateType: 'organization', aggregateId: orgId, type: 'party.kyb.updated',
        payload: { orgId, toStatus: decision }
      });
    });
    await this.audit.recordSecurity('privileged.kyb.review', 'WARN', { orgId, decision });
  }

  async history(orgId: string): Promise<{ items: unknown[] }> {
    assertOrgAccess(RequestContext.get(), orgId);
    const result = await this.db.query(
      `SELECT subject_type, subject_id, from_status, to_status, actor_user_id, note, reason_code, created_at
       FROM identity.verification_history WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }
}
