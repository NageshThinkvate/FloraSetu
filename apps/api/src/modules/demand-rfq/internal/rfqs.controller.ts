import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { RfqsService } from './rfqs.service';
import { QuotesService } from './quotes.service';
import { AwardsService } from './awards.service';
import { ClarificationsService } from './clarifications.service';
import {
  CancelDto, CreateAwardDto, CreateClarificationDto, DeclineInvitationDto,
  PublishRfqDto, RespondClarificationDto, ReviseQuotationDto, SubmitQuotationDto
} from './dto';

@Controller('demand')
@UseGuards(RbacGuard)
export class RfqsController {
  constructor(
    private readonly rfqs: RfqsService,
    private readonly quotes: QuotesService,
    private readonly awards: AwardsService,
    private readonly clarifications: ClarificationsService
  ) {}

  // ---- RFQ lifecycle (buyer) ----

  @Post('requirements/:id/publish-rfq')
  @RequirePermission('rfq.publish')
  publish(@Param('id') id: string, @Body() dto: PublishRfqDto, @Headers('idempotency-key') idemKey?: string) {
    return this.rfqs.publish(id, dto, idemKey);
  }

  @Get('rfqs')
  @RequirePermission('rfq.read')
  listMine() {
    return this.rfqs.listMine();
  }

  @Get('rfqs/inbox')
  @RequirePermission('rfq.read')
  inbox() {
    return this.rfqs.inbox();
  }

  @Get('rfqs/:id')
  @RequirePermission('rfq.read')
  get(@Param('id') id: string) {
    return this.rfqs.get(id);
  }

  @Post('rfqs/:id/cancel')
  @RequirePermission('rfq.publish')
  cancel(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.rfqs.cancel(id, dto);
  }

  // ---- Supplier invitation responses ----

  @Post('rfqs/:id/viewed')
  @RequirePermission('rfq.read')
  markViewed(@Param('id') id: string) {
    return this.rfqs.markViewed(id);
  }

  @Post('rfqs/:id/intend')
  @RequirePermission('quote.submit')
  intend(@Param('id') id: string) {
    return this.rfqs.intend(id);
  }

  @Post('rfqs/:id/decline')
  @RequirePermission('rfq.read')
  decline(@Param('id') id: string, @Body() dto: DeclineInvitationDto) {
    return this.rfqs.decline(id, dto);
  }

  // ---- Clarifications ----

  @Post('rfqs/:id/clarifications')
  @RequirePermission('rfq.read')
  postClarification(@Param('id') id: string, @Body() dto: CreateClarificationDto) {
    return this.clarifications.post(id, dto);
  }

  @Get('rfqs/:id/clarifications')
  @RequirePermission('rfq.read')
  listClarifications(@Param('id') id: string) {
    return this.clarifications.list(id);
  }

  @Post('clarifications/:id/respond')
  @RequirePermission('rfq.read')
  respondClarification(@Param('id') id: string, @Body() dto: RespondClarificationDto) {
    return this.clarifications.respond(id, dto);
  }

  // ---- Quotations ----

  @Post('rfqs/:id/quotes')
  @RequirePermission('quote.submit')
  submitQuote(@Param('id') id: string, @Body() dto: SubmitQuotationDto, @Headers('idempotency-key') idemKey?: string) {
    return this.quotes.submit(id, dto, idemKey);
  }

  @Get('quotes')
  @RequirePermission('quote.read')
  listMyQuotes() {
    return this.quotes.listMine();
  }

  @Get('quotes/:id')
  @RequirePermission('quote.read')
  getQuote(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Post('quotes/:id/revise')
  @RequirePermission('quote.submit')
  reviseQuote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviseQuotationDto, @Headers('idempotency-key') idemKey?: string) {
    return this.quotes.revise(id, dto, idemKey);
  }

  // ---- Evaluation & award (buyer) ----

  @Get('rfqs/:id/comparison')
  @RequirePermission('quote.evaluate')
  comparison(@Param('id') id: string) {
    return this.quotes.comparison(id);
  }

  @Post('rfqs/:id/awards')
  @RequirePermission('award.create')
  createAward(@Param('id') id: string, @Body() dto: CreateAwardDto, @Headers('idempotency-key') idemKey?: string) {
    return this.awards.create(id, dto, idemKey);
  }

  @Get('rfqs/:id/awards')
  @RequirePermission('award.read')
  listAwards(@Param('id') id: string) {
    return this.awards.listForRfq(id);
  }

  @Post('awards/:id/prepare-order')
  @RequirePermission('award.read')
  prepareOrder(@Param('id') id: string) {
    return this.awards.prepareOrderConversion(id);
  }
}
