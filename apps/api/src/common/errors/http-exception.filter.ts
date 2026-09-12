import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException, buildErrorEnvelope, ErrorCode } from './error-envelope';
import { RequestContext, } from '../request-context';
import { TRACE_HEADER } from '../tracing/trace.middleware';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId =
      RequestContext.maybeGet()?.traceId ?? req.header(TRACE_HEADER) ?? 'unknown';

    if (exception instanceof ApiException) {
      res.status(exception.status).json(buildErrorEnvelope(exception.code, exception.message, traceId, exception.details));
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode = status === 400 ? 'VALIDATION_FAILED' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR';
      res.status(status).json(buildErrorEnvelope(code, exception.message, traceId));
      return;
    }
    res.status(500).json(buildErrorEnvelope('INTERNAL_ERROR', 'Unexpected error', traceId));
  }
}
