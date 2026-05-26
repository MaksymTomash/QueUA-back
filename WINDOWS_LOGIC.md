# Логіка роботи вікон (Windows)

## Сутність Window

```
id            UUID
department_id UUID → Department
service_id    UUID → QueueService   // яку послугу обробляє вікно
staff_id      UUID | null           // хто зараз сидить за вікном (null = нікого)
label         string                // "Вікно №1"
status        open | paused | closed
current_number int                  // номер талону, що зараз на табло (0 = нікого)
date          date                  // дата, на яку відкрито вікно (YYYY-MM-DD)
```

Вікно **прив'язане до конкретної послуги**. Вікно №1 може обслуговувати ПС, Вікно №2 — ЗП і т.д.

---

## Стан status

| Статус   | Що означає                                      |
|----------|-------------------------------------------------|
| `open`   | Вікно активне, приймає чергу                    |
| `paused` | Спеціаліст тимчасово призупинив прийом          |
| `closed` | Вікно закрите, не рахується при розрахунку capacity |

---

## API ендпоїнти

### GET /v1/windows?department_id=&date=
Публічний список вікон (без авторизації). Повертає масив вікон з полем `waiting_count` — скільки талонів зараз чекає в черзі цього вікна.

### POST /v1/windows (admin)
Створює нове вікно. Поля: `department_id`, `service_id`, `label`, `date`.

### POST /v1/windows/:id/join (staff/admin)
Спеціаліст **сідає за вікно**.
- Перевіряє, що вікно не зайняте іншим спеціалістом.
- Перевіряє, що спеціаліст має `StaffAssignment` для цього `department_id` + `service_id`.
- Встановлює `staff_id = поточний користувач`, `status = open`.
- Надсилає WebSocket подію `window.updated`.

### POST /v1/windows/:id/leave (staff/admin)
Спеціаліст **покидає вікно**.
- Дозволяє тільки якщо `staff_id == поточний користувач`.
- Скидає `staff_id = null`, `status = open`.
- Надсилає `window.updated`.

### POST /v1/windows/:id/pause (staff/admin)
Призупиняє прийом. Встановлює `status = paused`. Надсилає `window.updated`.

### POST /v1/windows/:id/resume (staff/admin)
Відновлює прийом. Встановлює `status = open`. Надсилає `window.updated`.

### POST /v1/windows/:id/call-next (staff/admin)
**Викликати наступного з черги.** Детально — нижче.

### GET /v1/windows/:id/queue (staff/admin)
Список талонів у статусі `waiting` для цього вікна (по `service_id` + `department_id`), сортовані за `ticket_number` ASC.

---

## Виклик наступного: POST /v1/windows/:id/call-next

Умови виконання:
1. Вікно існує.
2. `staff_id == поточний користувач` (не можна викликати з чужого вікна).
3. `status != paused`.

Алгоритм (у транзакції SELECT FOR UPDATE):
1. Шукає перший талон де:
   - `department_id` = вікна
   - `service_id` = вікна
   - `status = waiting`
   - `window_id IS NULL` (ще не призначений жодному вікну)
   - `scheduled_date = сьогодні`
   - сортування: `ticket_number ASC`
2. Якщо не знайдено — `404 Черга порожня`.
3. Привласнює талону: `window_id`, `staff_id`, `status = called`, `called_at = now`.
4. Оновлює вікно: `current_number = ticket_number` (відображається на табло).
5. Надсилає WebSocket: `queue.ticket_called` → табло показує новий номер.

---

## Пропускна здатність слоту (capacity)

Розраховується динамічно при бронюванні:
```
capacity = кількість відкритих вікон (status != closed) × floor(60 / estimated_duration_minutes)
```

Приклад: 2 вікна ПС × floor(60/20 хв) = 6 людей на годину.

Це означає, що **кожне нове вікно збільшує кількість місць** у слоті. Якщо закрити вікно — capacity зменшується.

---

## Табло: як вікно оновлює відображення

### При виклику (`call-next`)
- Бекенд встановлює `window.current_number = ticket_number`.
- Надсилає `queue.ticket_called` → табло отримує `{ window_id, prefix, ticket_number }` → оновлює картку та показує банер.

### При завершенні обслуговування (`complete`)
- Бекенд скидає `window.current_number = 0`.
- Надсилає `window.updated` з `current_number = 0`.
- Табло бачить `current_number === 0` → очищає відображення номера (показує `—`).

### WebSocket події
| Подія                  | Хто надсилає            | Що містить                          |
|------------------------|-------------------------|-------------------------------------|
| `queue.ticket_called`  | `callNextFromWindow`    | `{ window_id, prefix, ticket_number, ... }` |
| `window.updated`       | join/leave/pause/resume/complete | весь об'єкт вікна            |
| `queue.ticket_updated` | cancel/start/complete/miss | весь об'єкт талону              |
| `queue.ticket_issued`  | book/issueManual        | весь об'єкт талону                  |

Підписка на кімнату: клієнт надсилає `subscribe:department` з `{ department_id }` → отримує всі події для цього відділення.

---

## Права доступу

| Дія              | Ролі              | Додаткова умова                                      |
|------------------|-------------------|------------------------------------------------------|
| Переглянути вікна | всі (без токена) | —                                                    |
| Створити вікно   | admin             | —                                                    |
| join / leave     | staff, admin      | staff має `StaffAssignment` (department + **service**) |
| pause / resume   | staff, admin      | `staff_id == поточний user`                          |
| call-next        | staff, admin      | `staff_id == поточний user`, вікно не на паузі       |
| start ticket     | staff, admin      | `ticket.staff_id == поточний user`                   |
| complete ticket  | staff, admin      | `ticket.staff_id == поточний user`                   |
| miss ticket      | staff, admin      | якщо статус `called` → `ticket.staff_id == поточний user` |

---

## StaffAssignment: чому важливо

`StaffAssignment` — запис у таблиці, що каже: "цей спеціаліст призначений до послуги X у відділенні Y".

При `join` бекенд викликає:
```typescript
isAssigned(win.department_id, staffId, win.service_id)
```

Тобто спеціаліст **може сісти за вікно тільки якщо має призначення саме до тієї послуги**, яку обслуговує це вікно. Одне призначення для ПС не дає права сісти за вікно ЗП.

---

## Питання: чи може ivanova.m@queua.ua зайняти Вікно №2?

**Залежить від того, яку послугу обслуговує Вікно №2.**

Іванова Марина має `StaffAssignment` для послуги **ПС** (Паспортна служба) у ЦНАП Шевченківського.

- Якщо Вікно №2 — **ПС**: ✅ може зайняти.
- Якщо Вікно №2 — **ЗП** (або будь-яка інша послуга): ❌ отримає `403 Ви не призначені до цієї послуги у цьому відділенні`.

Щоб перевірити — подивись `service_id` вікна №2 у БД:
```sql
SELECT label, service_id, status FROM windows WHERE label = 'Вікно №2';
SELECT name, ticket_prefix FROM services WHERE id = '<service_id>';
```

Або через API (з токеном адміна):
```
GET /v1/windows?department_id=<shev_id>
```
