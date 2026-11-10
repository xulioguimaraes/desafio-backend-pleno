import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, ErrorCode } from '../errors/app-error';
import { isMongoUnavailableError } from '../mongo/mongo-errors';

interface ErrorBody {
  code: ErrorCode;
  message: string;
}

/**
 * Garante que TODA resposta de erro siga { code, message } em português,
 * inclusive erros que nascem fora dos controllers (JSON malformado no
 * body-parser, rota inexistente, Mongo fora do ar).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(exception);

    if (status >= 500) {
      // Só nome e mensagem: nunca o objeto de request (headers têm o segredo).
      const err = exception as Error;
      this.logger.error({ err_name: err?.name, err_message: err?.message }, 'erro não tratado');
    }

    response.status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ErrorBody] {
    if (exception instanceof AppError) {
      return [exception.status, { code: exception.code, message: exception.message }];
    }

    if (isMongoUnavailableError(exception)) {
      return [
        HttpStatus.SERVICE_UNAVAILABLE,
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Banco de dados indisponível. Tente novamente.',
        },
      ];
    }

    // Erros do body-parser (express) chegam com `type`.
    const type = (exception as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      return [
        HttpStatus.BAD_REQUEST,
        { code: 'INVALID_PAYLOAD', message: 'O corpo da requisição não é um JSON válido.' },
      ];
    }
    if (type === 'entity.too.large') {
      return [
        HttpStatus.PAYLOAD_TOO_LARGE,
        { code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição é grande demais.' },
      ];
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.NOT_FOUND) {
        return [status, { code: 'NOT_FOUND', message: 'Rota não encontrada.' }];
      }
      if (status === HttpStatus.BAD_REQUEST) {
        // Não usamos pipes de validação: o único 400 do Nest aqui é JSON malformado.
        return [
          status,
          { code: 'INVALID_PAYLOAD', message: 'O corpo da requisição não é um JSON válido.' },
        ];
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        return [
          status,
          { code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição é grande demais.' },
        ];
      }
    }

    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' },
    ];
  }
}
