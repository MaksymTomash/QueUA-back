# Вимоги до бекенду (фронтенд → бекенд)

Файл для синхронізації між фронтом та беком. Фронт вже реалізує UI — бек має підтримати ці ендпоінти/зміни.

---

## 1. GET /tickets — додати фільтр `staff_id`

**Поточно:** `GET /tickets?department_id=&window_id=&date=&status=&page=&page_size=`  
**Потрібно:** додати `staff_id` (UUID, optional)

**Чому:**  
- Сторінка "Продуктивність" показує статистику конкретного спеціаліста (кількість оброблених, пропущених, сьогоднішні).  
- Наразі фронт завантажує всі талони відділення і фільтрує по `staff_id` на клієнті — неефективно при великому обсязі.

**Очікувана поведінка:**  
```
GET /v1/tickets?staff_id=<uuid>&date=2026-05-27
→ повертає тільки талони де tickets.staff_id = staff_id
```

---

## 2. GET /users — додати фільтр `search` (ім'я / email)

**Поточно:** `GET /users?role=&page=&page_size=`  
**Потрібно:** додати `search` (string, optional) — часткове співпадіння по `first_name`, `last_name`, `email`

**Чому:**  
- Сторінка "Видати талон вручну" має дозволяти пошук клієнта.  
- Наразі `GET /users` повертає всіх, фільтрація на клієнті — не масштабується.  
- Також необхідно для "Аудит талонів" — пошук по імені клієнта / персоналу.

**Очікувана поведінка:**
```
GET /v1/users?role=citizen&search=Іваненко
→ повертає відфільтрованих користувачів (ILIKE '%Іваненко%' по full_name або email)
```

---

## 3. GET /users — доступ для role=staff

**Поточно:** endpoint доступний тільки `admin`.  
**Потрібно:** `staff` може читати список користувачів з роллю `citizen` (для пошуку клієнта при ручній видачі талону) та `staff` (для перегляду колег).

**Варіант обмеження:**  
- `staff` може викликати `GET /users?role=citizen` або `GET /users?role=staff` — але **не** `GET /users` без фільтру за роллю.  
- Альтернативно: новий ендпоінт `GET /users/search?q=&role=` доступний для `staff`.

---

## 4. POST /tickets/manual — додати `client_id` (optional)

**Поточно:** `{ window_id, service_id }` — `client_id` не підтримується, талон завжди анонімний.  
**Потрібно:** `{ window_id, service_id, client_id?: string }` — якщо клієнт знайдений через пошук, прив'язати талон до нього.

**Чому:**  
- Спеціаліст має можливість обрати конкретного клієнта при ручній видачі.  
- Це дозволяє клієнту бачити талон в особистому кабінеті (`GET /tickets/active`).

---

## 5. GET /staff/me/assignments — новий ендпоінт (або розширення)

**Потрібно:** ендпоінт, що повертає всі `StaffAssignment` для поточного авторизованого спеціаліста.

**Чому:**  
- Наразі щоб знайти відділення спеціаліста, фронт робить `GET /departments`, потім `GET /departments/:id/staff` для кожного — N+1 запитів.  
- `GET /staff/me/assignments` → `[{ department_id, department: DepartmentDto, service_id, service: ServiceDto, ... }]`

**Альтернатива:** розширити `GET /users/me` — додати поле `assignments: StaffAssignmentDto[]`.

---

## 6. GET /ratings/performance/:staffId — розширення відповіді

**Поточно:**
```json
{
  "staff_id": "...",
  "average_score": 4.8,
  "ratings_count": 47,
  "tickets_served": 235,
  "average_serving_time_ms": 720000
}
```
**Потрібно додати:**
```json
{
  ...,
  "tickets_missed": 12,
  "tickets_today": 8,
  "tickets_this_month": 67
}
```

**Чому:**  
- Сторінка "Продуктивність" показує кількість пропущених клієнтів.  
- Наразі фронт не може отримати цю цифру без `staff_id` фільтру на `GET /tickets`.

---

## 7. GET /windows/:id/queue — включити `called` та `serving` статуси

**Поточно:** повертає тільки `status = 'waiting'`.  
**Потрібно:** повертати також `status IN ('called', 'serving')` для даного `window_id`.

**Чому:**  
- Після `POST /windows/:id/call-next` талон переходить в `called`.  
- `GET /windows/:id/queue` більше не включає цей талон, і фронт не може визначити "активний" стан.  
- **Workaround:** фронт зберігає `activeTicket` в пам'яті і відновлює через `GET /tickets?window_id=&status=called,serving` при перезавантаженні — але це крихке рішення.

**Ідеальне рішення:** `GET /windows/:id/queue` повертає `{ waiting: TicketDto[], active: TicketDto | null }`, де `active` — поточний `called` або `serving` талон вікна.

---

## 8. Збагачення відповідей (enrichment)

**Поточно:** всі ендпоінти повертають "сирі" сутності з тільки ID:
- `ticket.service_id` — але не `service_name`
- `ticket.department_id` — але не `department_name`
- `ticket.client_id` — але не `client: UserDto`
- `ticket.staff_id` — але не `staff: UserDto`

**Бажаний мінімум збагачення для `GET /tickets/:id` (staff/admin):**
```json
{
  ...,
  "service": { "id": "...", "name": "Паспортна служба", ... },
  "department": { "id": "...", "name": "ЦНАП Шевченківського", ... },
  "client": { "id": "...", "first_name": "...", "last_name": "...", ... } | null,
  "staff": { "id": "...", "first_name": "...", "last_name": "...", ... } | null
}
```

**Для `GET /tickets` (list):** мінімум — `service_name` і `department_name` рядком (щоб не робити N+1 запити на фронті).

**Наразі фронт обходить це через `LookupService`** (кешує всі послуги/відділення та збагачує клієнтсайд) — але це не масштабується і не дає даних про клієнта/персонал у списку.

---

## 9. GET /departments/:id/staff — перевірити доступ для role=staff

**Поточно:** вимагає `staff` або `admin` — **ОК**.  
**Примітка:** Переконатися що `StaffAssignment` у відповіді включає `staff: UserDto` та `service: ServiceDto` (вже є — підтвердити в продакшн middleware).

---

## Підсумок пріоритетів

| # | Ендпоінт | Пріоритет | Опис |
|---|----------|-----------|------|
| 1 | `GET /tickets?staff_id=` | 🔴 High | Продуктивність, аудит по спеціалісту |
| 2 | `GET /users?search=` + staff доступ | 🔴 High | Пошук клієнта при ручній видачі |
| 3 | `POST /tickets/manual` + `client_id` | 🟡 Medium | Прив'язка ручного талону до клієнта |
| 4 | `GET /staff/me/assignments` | 🟡 Medium | Визначення відділення спеціаліста |
| 5 | `GET /ratings/performance/:id` розширення | 🟡 Medium | Статистика пропущених/сьогодні |
| 6 | `GET /windows/:id/queue` + active | 🔴 High | Відновлення стану called/serving |
| 7 | Ticket enrichment (list + detail) | 🟢 Low | UX — зараз обходиться LookupService |
