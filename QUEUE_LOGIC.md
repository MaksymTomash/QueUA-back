# QueUA — Логіка черги та підключення фронтенду

## Зміст

1. [Загальна концепція](#1-загальна-концепція)
2. [Слоти та нумерація талонів](#2-слоти-та-нумерація-талонів)
3. [Два режими запису](#3-два-режими-запису)
4. [Повний флоу: громадянин](#4-повний-флоу-громадянин)
5. [Повний флоу: спеціаліст](#5-повний-флоу-спеціаліст)
6. [API — всі ендпоінти](#6-api--всі-ендпоінти)
7. [WebSocket — real-time оновлення](#7-websocket--real-time-оновлення)
8. [Підключення Angular фронтенду](#8-підключення-angular-фронтенду)
9. [Тестові акаунти](#9-тестові-акаунти)

---

## 1. Загальна концепція

**QueUA** — система електронної черги для ЦНАП (Центр надання адміністративних послуг).

### Ключові сутності

```
Відділення (Department)
  └── має послуги (через DepartmentServices)
       └── QueueService (паспорт, реєстрація, ФОП...)
  └── має вікна (Window)
       └── кожне вікно = 1 послуга + 1 спеціаліст

Талон (Ticket)
  └── прив'язаний до відділення + послуги
  └── window_id = NULL поки чел чекає (загальна черга)
  └── window_id призначається тільки коли спеціаліст натискає "наступний"
```

### Головне правило черги

**Черга — спільна на послугу + відділення.** Якщо є 3 вікна для паспортів — усі три тягнуть з однієї черги. Хто першим натиснув "наступний" — той і забрав клієнта.

---

## 2. Слоти та нумерація талонів

### Чому слоти?

Без слотів виникає проблема: якщо хтось записався на наступний тиждень і отримав номер #50, то walk-in отримає #51 — і буде чекати після людини яка прийде через тиждень.

### Як розраховуються слоти

```
Формула пропускної здатності:
capacity = кількість вікон × ⌊60 / тривалість_послуги_хв⌋

Приклад:
  Паспорт = 20 хв, 1 вікно → capacity = 1 × (60/20) = 3 особи/слот
  Соціальна допомога = 30 хв, 2 вікна → capacity = 2 × (60/30) = 4 особи/слот
```

### Нумерація за слотами

```
Відкриття ЦНАП: 08:00, capacity = 3

  Слот 08:00 → номери 1–3    (slot_index=0, start=0×3+1=1)
  Слот 09:00 → номери 4–6    (slot_index=1, start=1×3+1=4)
  Слот 10:00 → номери 7–9    (slot_index=2, start=2×3+1=7)
  Слот 11:00 → номери 10–12  (slot_index=3, start=3×3+1=10)
  ...

Якщо на 10:00 вже записані 2 особи (номери 7 і 8),
то наступний в цьому слоті отримає номер 9.
Якщо слот заповнений — повертається помилка 400.
```

### Сценарій з walk-in

```
14:30 — спеціаліст обслуговує ПС-29 (слот 11:00)
Наступний заброньований — ПС-50 (слот 17:00, хтось записався наперед)

Walk-in приходить зараз (14:30 → слот 14:00):
  → отримує перший вільний номер у слоті 14:00
  → наприклад ПС-37 (якщо слот 14:00 ще порожній)
  → НЕ ПС-51, бо ПС-50 — це взагалі інша година
```

---

## 3. Два режими запису

### Режим A: Жива черга (walk-in)

Громадянин приходить фізично або відкриває апп прямо зараз.

```json
POST /v1/tickets
{
  "department_id": "uuid",
  "service_id": "uuid"
  // scheduled_date і time_slot НЕ вказуються
}
```

Система сама визначає:
- `scheduled_date` = сьогодні
- `time_slot` = поточна година (наприклад зараз 14:30 → слот "14:00")
- Перевіряє що ЦНАП відкритий прямо зараз

### Режим B: Запис наперед

Громадянин записується на конкретну дату і час через апп.

```json
POST /v1/tickets
{
  "department_id": "uuid",
  "service_id": "uuid",
  "scheduled_date": "2026-05-30",
  "time_slot": "10:00"
}
```

Система:
- Перевіряє що це робочий день
- Перевіряє що слот не заповнений
- Видає номер відповідного слоту

### Як фронт показує слоти

```
GET /v1/tickets/slots?department_id=uuid&service_id=uuid&date=2026-05-30

Відповідь:
[
  { "time": "08:00", "capacity": 3, "booked": 3, "available": 0 },  ← заповнений
  { "time": "09:00", "capacity": 3, "booked": 1, "available": 2 },  ← є місця
  { "time": "10:00", "capacity": 3, "booked": 0, "available": 3 },  ← вільний
  ...
]
```

Фронт показує тільки слоти де `available > 0`.

---

## 4. Повний флоу: громадянин

### Крок 1: Реєстрація

```
POST /v1/auth/register
{
  "email": "user@gmail.com",
  "password": "Password123!",
  "first_name": "Василь",
  "last_name": "Шевченко"
}

← { access_token, refresh_token, user }
```

### Крок 2: Верифікація (опційно)

```
POST /v1/verifications
{
  "method": "online",           // або "in_person"
  "document_type": "passport",
  "document_number": "АА123456"
}

Статус: pending → спеціаліст схвалює → approved
Деякі послуги вимагають is_verified = true (наприклад паспортні)
```

### Крок 3: Вибір відділення і послуги

```
GET /v1/departments
← [{ id, name, address, city, working_hours, ... }]

GET /v1/departments/:id/services
← [{ id, department_id, service_id, service: { name, estimated_duration_minutes, ticket_prefix }, is_active }]
```

### Крок 4: Перегляд слотів і бронювання

```
GET /v1/tickets/slots?department_id=X&service_id=Y&date=2026-05-30
← [{ time, capacity, booked, available }]

POST /v1/tickets
{ "department_id": X, "service_id": Y, "scheduled_date": "2026-05-30", "time_slot": "10:00" }
← { id, prefix, ticket_number, time_slot, estimated_start_at, status: "waiting", ... }
```

Талон відображається як, наприклад, **ПС-7** (prefix + ticket_number).

### Крок 5: Відстеження черги (real-time)

```javascript
// Підписатись на WebSocket-оновлення свого талону
socket.emit('subscribe:ticket', { ticket_id: 'uuid' });
socket.on('queue.ticket_called', (ticket) => {
  // Показати: "Підійдіть до вікна №3!"
});

// Або перевіряти активний талон (polling)
GET /v1/tickets/active
← { ...ticket, position: 2 }  // position = скільки людей перед вами
```

### Крок 6: Оцінка після обслуговування

```
POST /v1/ratings/client
{
  "ticket_id": "uuid",
  "score": 5,
  "topic": "швидко",
  "comment": "Дуже задоволений"
}
```

---

## 5. Повний флоу: спеціаліст

### Крок 1: Вхід і приєднання до вікна

```
POST /v1/auth/login
{ "email": "ivanova.m@queua.ua", "password": "Staff1234!" }
← { access_token, refresh_token }

POST /v1/windows/:id/join
← { id, label, status: "open", staff_id: "мій id", waiting_count: 5 }

// WebSocket — відділення отримує: window.updated
```

### Крок 2: Виклик наступного

```
POST /v1/windows/:id/call-next
← { id, ticket_number, prefix, client_id, time_slot, ... }

// WebSocket:
// - Відділення (табло): queue.ticket_called
// - Клієнт (особисто): queue.ticket_called → "Підійдіть до вікна №1!"
```

Система автоматично бере **найменший номер** з сьогоднішніх waiting-талонів для цієї послуги у відділенні.

### Крок 3: Обслуговування

```
POST /v1/tickets/:id/start     ← починає обслуговування (статус: serving)
POST /v1/tickets/:id/complete  ← завершує (статус: completed, записується тривалість)
  { "notes": "Видано ID-картку", "service_result": "success" }

POST /v1/tickets/:id/miss      ← клієнт не прийшов (статус: missed)
```

### Крок 4: Оцінка клієнта

```
POST /v1/ratings/staff
{
  "ticket_id": "uuid",
  "score": 4,
  "topic": "пунктуальність",
  "comment": "Прийшов вчасно"
}
// Оновлює discipline_score клієнта (ковзне середнє)
```

### Крок 5: Пауза / завершення роботи

```
POST /v1/windows/:id/pause   ← пауза (нові виклики заблоковані)
POST /v1/windows/:id/resume  ← повернення
POST /v1/windows/:id/leave   ← кінець робочого дня
```

---

## 6. API — всі ендпоінти

### Авторизація
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| POST | `/auth/register` | публічний | Реєстрація |
| POST | `/auth/login` | публічний | Вхід |
| POST | `/auth/refresh` | публічний | Оновити токен |
| POST | `/auth/logout` | auth | Вихід |

### Відділення
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| GET | `/departments` | публічний | Всі відділення |
| GET | `/departments/:id` | публічний | Одне відділення |
| GET | `/departments/:id/services` | публічний | Послуги відділення |
| POST | `/departments/:id/services` | admin | Додати послугу |
| DELETE | `/departments/:id/services/:svcId` | admin | Прибрати послугу |
| POST | `/departments` | admin | Створити відділення |
| PATCH | `/departments/:id` | admin | Оновити |
| DELETE | `/departments/:id` | admin | Видалити |

### Послуги
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| GET | `/services` | публічний | Всі послуги |
| GET | `/services/:id` | публічний | Одна послуга |
| POST | `/services` | admin | Створити |
| PATCH | `/services/:id` | admin | Оновити |
| DELETE | `/services/:id` | admin | Видалити |

### Талони
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| GET | `/tickets/slots` | auth | Доступні слоти |
| POST | `/tickets` | citizen | Забронювати талон |
| GET | `/tickets/active` | citizen | Мій активний талон |
| GET | `/tickets/my` | citizen | Моя історія |
| POST | `/tickets/:id/cancel` | citizen | Скасувати |
| POST | `/tickets/manual` | staff | Ручна видача |
| GET | `/tickets` | staff | Всі талони (фільтри) |
| POST | `/tickets/:id/start` | staff | Почати обслуговування |
| POST | `/tickets/:id/complete` | staff | Завершити |
| POST | `/tickets/:id/miss` | staff | Клієнт відсутній |

### Вікна
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| GET | `/windows` | auth | Список вікон |
| GET | `/windows/:id` | auth | Одне вікно |
| POST | `/windows/:id/join` | staff | Зайняти вікно |
| POST | `/windows/:id/leave` | staff | Залишити вікно |
| POST | `/windows/:id/pause` | staff | Пауза |
| POST | `/windows/:id/resume` | staff | Продовжити |
| POST | `/windows/:id/call-next` | staff | Викликати наступного |
| GET | `/windows/:id/queue` | staff | Черга вікна |

### Верифікації
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| POST | `/verifications` | citizen | Подати на верифікацію |
| GET | `/verifications` | staff | Всі верифікації |
| PATCH | `/verifications/:id/approve` | staff | Схвалити |
| PATCH | `/verifications/:id/reject` | staff | Відхилити |

### Оцінки
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| POST | `/ratings/client` | citizen | Оцінити спеціаліста |
| POST | `/ratings/staff` | staff | Оцінити клієнта |

### Звіти
| Метод | URL | Доступ | Опис |
|-------|-----|--------|------|
| GET | `/reports/summary` | admin | Зведена статистика |

---

## 7. WebSocket — real-time оновлення

### Підключення

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/queue');  // http, не ws!
```

### Підписки (клієнт → сервер)

```typescript
// Підписатись на всі події відділення (для табло)
socket.emit('subscribe:department', { department_id: 'uuid' });

// Підписатись на конкретний талон (для громадянина)
socket.emit('subscribe:ticket', { ticket_id: 'uuid' });

// Відписатись
socket.emit('unsubscribe:department', { department_id: 'uuid' });
socket.emit('unsubscribe:ticket', { ticket_id: 'uuid' });
```

### Події (сервер → клієнт)

| Подія | Коли | Кому |
|-------|------|------|
| `queue.ticket_issued` | Новий талон видано | room: `dept:{id}` |
| `queue.ticket_called` | Талон викликано до вікна | room: `dept:{id}` + `ticket:{id}` |
| `queue.ticket_updated` | Статус змінився (serving/completed/missed/cancelled) | room: `dept:{id}` + `ticket:{id}` |
| `window.updated` | Вікно змінило стан (join/leave/pause/resume) | room: `dept:{id}` |
| `subscribed` | Підтвердження підписки | відправнику |

### Приклад в Angular

```typescript
// queue.service.ts
import { io, Socket } from 'socket.io-client';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class QueueSocketService {
  private socket: Socket;

  connect() {
    this.socket = io(`${environment.wsUrl}/queue`);
  }

  subscribeToDepartment(departmentId: string) {
    this.socket.emit('subscribe:department', { department_id: departmentId });
  }

  subscribeToTicket(ticketId: string) {
    this.socket.emit('subscribe:ticket', { ticket_id: ticketId });
  }

  onTicketCalled(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('queue.ticket_called', (ticket) => observer.next(ticket));
    });
  }

  onQueueUpdated(): Observable<any> {
    return new Observable(observer => {
      this.socket.on('queue.ticket_issued', (t) => observer.next(t));
      this.socket.on('queue.ticket_updated', (t) => observer.next(t));
    });
  }
}
```

---

## 8. Підключення Angular фронтенду

### environment.ts

```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/v1',
  wsUrl: 'http://localhost:3000',
};
```

### HTTP interceptor (додати токен)

```typescript
// auth.interceptor.ts
intercept(req: HttpRequest<any>, next: HttpHandler) {
  const token = localStorage.getItem('access_token');
  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }
  return next.handle(req);
}
```

### Оновлення токену (refresh)

При отриманні 401 — відправити:
```typescript
POST /v1/auth/refresh
{ "refresh_token": localStorage.getItem('refresh_token') }
← { access_token, refresh_token }
```

Зберегти нові токени і повторити оригінальний запит.

### Типова структура сервісу

```typescript
// departments.service.ts
@Injectable({ providedIn: 'root' })
export class DepartmentsService {
  private base = `${environment.apiUrl}/departments`;

  getDepartments(): Observable<Department[]> {
    return this.http.get<Department[]>(this.base);
  }

  getDepartmentServices(deptId: string): Observable<DepartmentService[]> {
    return this.http.get<DepartmentService[]>(`${this.base}/${deptId}/services`);
  }
}

// tickets.service.ts
getSlots(departmentId: string, serviceId: string, date: string) {
  return this.http.get<Slot[]>(`${environment.apiUrl}/tickets/slots`, {
    params: { department_id: departmentId, service_id: serviceId, date }
  });
}

bookTicket(dto: BookTicketDto): Observable<Ticket> {
  return this.http.post<Ticket>(`${environment.apiUrl}/tickets`, dto);
}
```

---

## 9. Тестові акаунти

| Email | Пароль | Роль | Відділення |
|-------|--------|------|-----------|
| admin@queua.ua | Admin1234! | admin | — |
| ivanova.m@queua.ua | Staff1234! | staff | ЦНАП Шевченківський (паспорти, вікно №1) |
| petrenko.o@queua.ua | Staff1234! | staff | ЦНАП Шевченківський (закордонні, вікно №3) |
| kovalenko.t@queua.ua | Staff1234! | staff | ЦНАП Печерський (соціальна, вікно №1) |
| melnyk.a@queua.ua | Staff1234! | staff | ЦНАП Печерський (ФОП, вікно №3) |
| bondar.n@queua.ua | Staff1234! | staff | ЦНАП Печерський (кадастр, вікно №4) |
| shevchenko.v@gmail.com | User1234! | citizen | верифікований |
| kravchenko.o@gmail.com | User1234! | citizen | не верифікований |

### Скинути дані до початкового стану
```bash
npm run seed
```

### Swagger UI
```
http://localhost:3000/docs
```
