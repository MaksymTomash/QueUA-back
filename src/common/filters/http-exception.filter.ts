import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as any).message
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';

    const errors =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      Array.isArray((exceptionResponse as any).message)
        ? (exceptionResponse as any).message
        : undefined;

    response.status(status).json({
      status_code: status,
      message: Array.isArray(message) ? 'Validation failed' : message,
      errors,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
