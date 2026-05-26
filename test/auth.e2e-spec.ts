import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  const email = `e2e-${Date.now()}@test.ua`;
  const password = 'E2eTest123!';
  let accessToken: string;
  let refreshToken: string;

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

  // ─── Реєстрація ──────────────────────────────────────────────────────────────

  it('POST /v1/auth/register — створює нового громадянина', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password, first_name: 'Тест', last_name: 'E2E' })
      .expect(201);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe('citizen');

    accessToken  = res.body.access_token;
    refreshToken = res.body.refresh_token;
  });

  it('POST /v1/auth/register — 400 при реєстрації з тим самим email', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password, first_name: 'Dup', last_name: 'User' })
      .expect(409);
  });

  // ─── Вхід ────────────────────────────────────────────────────────────────────

  it('POST /v1/auth/login — повертає access і refresh токени', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.expires_in).toBe(3600);

    accessToken  = res.body.access_token;
    refreshToken = res.body.refresh_token;
  });

  it('POST /v1/auth/login — 401 при неправильному паролі', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'WrongPass999!' })
      .expect(401);
  });

  // ─── Захищений маршрут ────────────────────────────────────────────────────────

  it('GET /v1/users/me — повертає профіль з валідним токеном', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(email);
  });

  it('GET /v1/users/me — 401 без токена', async () => {
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .expect(401);
  });

  // ─── Рефреш ──────────────────────────────────────────────────────────────────

  it('POST /v1/auth/refresh — видає нову пару токенів', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.access_token).not.toBe(accessToken);

    accessToken  = res.body.access_token;
    refreshToken = res.body.refresh_token;
  });

  it('POST /v1/auth/refresh — 401 з невалідним токеном', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: 'invalid.token.here' })
      .expect(401);
  });

  // ─── Вихід ───────────────────────────────────────────────────────────────────

  it('POST /v1/auth/logout — інвалідує сесію', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('POST /v1/auth/refresh — 401 після logout', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(401);
  });
});
