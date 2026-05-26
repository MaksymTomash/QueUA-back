import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

// Тест використовує seed-дані: admin@queua.ua, ivanova.m@queua.ua, ЦНАП Шевченківського
describe('Queue flow (e2e)', () => {
  let app: INestApplication;

  let citizenToken: string;
  let staffToken: string;
  let adminToken: string;
  let departmentId: string;
  let serviceId: string;
  let windowId: string;
  let ticketId: string;

  const citizenEmail = `q-e2e-${Date.now()}@test.ua`;

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

    // Логін seed-акаунтів
    const [adminRes, staffRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'admin@queua.ua', password: 'Admin1234!' }),
      request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'ivanova.m@queua.ua', password: 'Staff1234!' }),
    ]);
    adminToken = adminRes.body.access_token;
    staffToken = staffRes.body.access_token;

    // Реєструємо тестового громадянина
    const citizenRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: citizenEmail, password: 'Test123!', first_name: 'Черга', last_name: 'Тест' });
    citizenToken = citizenRes.body.access_token;

    // Знаходимо ЦНАП Шевченківського і послугу ПС
    const depts = await request(app.getHttpServer()).get('/v1/departments');
    const shev = depts.body.find((d: any) => d.name.includes('Шевченків'));
    departmentId = shev.id;

    const svcs = await request(app.getHttpServer()).get('/v1/services');
    const passport = svcs.body.find((s: any) => s.ticket_prefix === 'ПС');
    serviceId = passport.id;

    // Знаходимо Вікно №1 (ПС)
    const wins = await request(app.getHttpServer())
      .get(`/v1/windows?department_id=${departmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const win1 = wins.body.find((w: any) => w.label === 'Вікно №1');
    windowId = win1.id;
  }, 30000);

  afterAll(async () => {
    const ds = app.get(DataSource);
    await ds.query(
      `DELETE FROM tickets WHERE client_id::text = (SELECT id::text FROM users WHERE email = $1)`,
      [citizenEmail],
    );
    await ds.query(`DELETE FROM users WHERE email = $1`, [citizenEmail]);
    await app.close();
  });

  // ─── Відділення та послуги ─────────────────────────────────────────────────

  it('GET /v1/departments — публічний список відділень', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/departments')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('name');
  });

  it('GET /v1/services — публічний список послуг', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/services')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const ps = res.body.find((s: any) => s.ticket_prefix === 'ПС');
    expect(ps).toBeDefined();
  });

  // ─── Бронювання талону ────────────────────────────────────────────────────

  it('POST /v1/tickets — 400 без авторизації', async () => {
    await request(app.getHttpServer())
      .post('/v1/tickets')
      .send({ department_id: departmentId, service_id: serviceId })
      .expect(401);
  });

  it('POST /v1/tickets — бронює талон на майбутній слот', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    const res = await request(app.getHttpServer())
      .post('/v1/tickets')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ department_id: departmentId, service_id: serviceId, scheduled_date: date, time_slot: '10:00' })
      .expect(201);

    expect(res.body.prefix).toBe('ПС');
    expect(res.body.ticket_number).toBeGreaterThan(0);
    expect(res.body.status).toBe('waiting');
    ticketId = res.body.id;
  });

  it('POST /v1/tickets — 400 при повторному бронюванні (активний талон)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    await request(app.getHttpServer())
      .post('/v1/tickets')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ department_id: departmentId, service_id: serviceId, scheduled_date: date, time_slot: '11:00' })
      .expect(400);
  });

  it('GET /v1/tickets/active — повертає активний талон', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/tickets/active')
      .set('Authorization', `Bearer ${citizenToken}`)
      .expect(200);

    expect(res.body.id).toBe(ticketId);
    expect(res.body.status).toBe('waiting');
  });

  // ─── Скасування ───────────────────────────────────────────────────────────

  it('POST /v1/tickets/:id/cancel — громадянин скасовує талон', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/tickets/${ticketId}/cancel`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .expect(201);

    expect(res.body.status).toBe('cancelled');
  });

  // ─── Повний цикл: бронювання → виклик → start → complete → оцінка ─────────

  describe('повний цикл обслуговування', () => {
    let cycleTicketId: string;

    it('citizen бронює новий талон (попередній скасовано)', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .post('/v1/tickets')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({ department_id: departmentId, service_id: serviceId, scheduled_date: today, time_slot: '09:00' })
        .expect(201);

      expect(res.body.status).toBe('waiting');
      expect(res.body.window_id).toBeNull();
      cycleTicketId = res.body.id;
    });

    it('POST /v1/windows/:id/call-next — повертає талон зі статусом called', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/windows/${windowId}/call-next`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);

      expect(res.body.status).toBe('called');
      expect(res.body.window_id).toBe(windowId);
      cycleTicketId = res.body.id;
    });

    it('staff стартує обслуговування', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/tickets/${cycleTicketId}/start`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(201);

      expect(res.body.status).toBe('serving');
      expect(res.body.serving_started_at).not.toBeNull();
    });

    it('staff завершує обслуговування', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/tickets/${cycleTicketId}/complete`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ service_result: 'success', notes: 'e2e test' })
        .expect(201);

      expect(res.body.status).toBe('completed');
      expect(res.body.completed_at).not.toBeNull();
    });

    it('citizen оцінює спеціаліста після завершення', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/ratings/client')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({ ticket_id: cycleTicketId, score: 5, topic: 'швидко' })
        .expect(201);

      expect(res.body.score).toBe(5);
      expect(res.body.type).toBe('client');
    });
  });
});
