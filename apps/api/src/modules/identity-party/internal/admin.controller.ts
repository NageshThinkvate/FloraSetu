import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminService, AuditFilters } from './admin.service';
import { KybService } from './kyb.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';

// Phase 7 (ADR-014): Admin Control Plane. Every endpoint is permission-gated; domain
// authorization stays in the services. Admin governs the platform — it never becomes
// a marketplace participant (no logistics execution, no claim adjudication, no finance).
@Controller('admin')
@UseGuards(RbacGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly kyb: KybService
  ) {}

  @Get('overview')
  @RequirePermission('admin.org.read')
  overview() {
    return this.admin.overview();
  }

  // ---------- KYB governance ----------

  @Get('kyb-queue')
  @RequirePermission('kyb.review')
  kybQueue() {
    return this.admin.kybQueue();
  }

  @Get('kyb/:orgId/detail')
  @RequirePermission('kyb.review')
  kybDetail(@Param('orgId') orgId: string) {
    return this.admin.kybReviewDetail(orgId);
  }

  @Post('kyb/:orgId/review')
  @RequirePermission('kyb.review')
  reviewKyb(
    @Param('orgId') orgId: string,
    @Body() body: { decision: 'VERIFIED' | 'REJECTED'; reasonCode?: string; note?: string }
  ) {
    return this.kyb.review(orgId, body.decision, body.reasonCode, body.note);
  }

  // ---------- Organization governance ----------

  @Get('orgs')
  @RequirePermission('admin.org.read')
  listOrgs() {
    return this.admin.listOrgs();
  }

  @Get('orgs/:id')
  @RequirePermission('admin.org.read')
  getOrg(@Param('id') id: string) {
    return this.admin.getOrgPrivileged(id);
  }

  @Post('orgs/:id/restrict')
  @RequirePermission('restriction.manage')
  restrict(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.admin.restrict(id, body.reason);
  }

  @Post('orgs/:id/lift')
  @RequirePermission('restriction.manage')
  lift(@Param('id') id: string) {
    return this.admin.lift(id);
  }

  // ---------- User & access governance ----------

  @Get('users')
  @RequirePermission('admin.user.read')
  listUsers(@Query('q') q?: string, @Query('status') status?: string) {
    return this.admin.listUsers(q, status);
  }

  @Post('users/:id/suspend')
  @RequirePermission('admin.user.manage')
  suspendUser(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.admin.suspendUser(id, body.reason);
  }

  @Post('users/:id/reactivate')
  @RequirePermission('admin.user.manage')
  reactivateUser(@Param('id') id: string) {
    return this.admin.reactivateUser(id);
  }

  // Read-only seeded role/permission matrix (ADR-014: no IAM designer).
  @Get('roles')
  @RequirePermission('admin.org.read')
  roles() {
    return this.admin.rolesMatrix();
  }

  // ---------- Security administration ----------

  @Get('security')
  @RequirePermission('audit.read')
  security() {
    return this.admin.securityOverview();
  }

  @Post('support-sessions')
  @RequirePermission('support.access')
  supportSession(@Body() body: { orgId: string; reason: string }) {
    return this.admin.createSupportGrant(body.orgId, body.reason);
  }

  // ---------- Audit inspection (immutable) ----------

  @Get('audit')
  @RequirePermission('audit.read')
  audit(@Query() query: AuditFilters) {
    return this.admin.auditTrail(query);
  }

  @Get('audit/export')
  @RequirePermission('audit.read')
  async auditExport(@Query() query: AuditFilters, @Res() res: Response): Promise<void> {
    const csv = await this.admin.auditCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="admin-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }
}
