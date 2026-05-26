import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('App health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/departments — повертає 200 без авторизації', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/departments')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /v1/services — повертає 200 без авторизації', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/services')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /v1/users/me — 401 без токена', async () => {
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .expect(401);
  });
});
