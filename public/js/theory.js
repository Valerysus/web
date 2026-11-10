'use strict';

/**
 * Стислі відповіді на 23 питання з Reports.txt.
 * Рендеряться в акордеон на вкладці «Теорія до захисту».
 */

const THEORY = [
  {
    n: 1,
    q: 'Огляд HTML. Розбір документа браузером. DOM',
    a: `<p>HTML — декларативна мова розмітки, що описує <em>структуру</em> документа, а не його вигляд.</p>
    <p><b>Конвеєр обробки:</b></p>
    <ul>
      <li><b>Parsing</b> — байтовий потік → символи (за charset) → токени → вузли DOM. Парсер толерантний до помилок: некоректна розмітка не «ламає» сторінку, а виправляється за алгоритмом.</li>
      <li><b>DOM (Document Object Model)</b> — дерево вузлів: елементи, текстові вузли, коментарі. Корінь — <code>document</code>.</li>
      <li><b>CSSOM</b> — окреме дерево стилів; разом із DOM утворює render tree.</li>
      <li><b>Layout (reflow)</b> — обчислення геометрії; <b>Paint</b> — растеризація; <b>Composite</b> — склеювання шарів на GPU.</li>
    </ul>
    <p><b>Важливо:</b> <code>&lt;script&gt;</code> без <code>defer</code>/<code>async</code> блокує парсинг, бо може викликати <code>document.write</code>. Тому скрипти ставлять у кінець або з <code>defer</code>.</p>
    <p><b>У нашому проєкті:</b> DOM — це картки задач, які ми оновлюємо з WebSocket-повідомлень без перезавантаження сторінки.</p>`
  },
  {
    n: 2,
    q: 'HTML5 та новіші версії: відмінності',
    a: `<ul>
      <li><b>Семантика:</b> <code>header, nav, main, section, article, aside, footer, figure</code> замість суцільних <code>div</code>.</li>
      <li><b>Мультимедіа без плагінів:</b> <code>&lt;video&gt;</code>, <code>&lt;audio&gt;</code>, <code>&lt;canvas&gt;</code>, SVG.</li>
      <li><b>Форми:</b> типи <code>email, number, date, range</code>, атрибути <code>required, pattern, min, max, step</code> — валідація без JS.</li>
      <li><b>Storage:</b> localStorage, sessionStorage, IndexedDB.</li>
      <li><b>Мережа:</b> WebSocket, Server-Sent Events, Fetch API, CORS.</li>
      <li><b>Прибрано:</b> <code>font, center, frameset, applet</code>; застарілі атрибути презентації.</li>
      <li><b>Новіше (Living Standard):</b> <code>dialog</code>, <code>template</code>, <code>picture</code>, lazy-loading <code>loading="lazy"</code>, Web Components (Custom Elements + Shadow DOM).</li>
    </ul>
    <p>HTML5 — це «Living Standard» (WHATWG), без фіксованих версій; зміни вносяться постійно.</p>`
  },
  {
    n: 3,
    q: 'HTTP протокол та його методи',
    a: `<p>HTTP — прикладний протокол «запит-відповідь» поверх TCP (HTTP/3 — поверх QUIC/UDP). Текстовий (до HTTP/2) і stateless.</p>
    <p><b>Структура запиту:</b> метод, шлях, версія, заголовки, тіло.</p>
    <ul>
      <li><b>GET</b> — отримати ресурс, без тіла, ідемпотентний, кешується.</li>
      <li><b>POST</b> — створити ресурс / передати дані, не ідемпотентний.</li>
      <li><b>PUT</b> — повністю замінити ресурс, ідемпотентний.</li>
      <li><b>PATCH</b> — часткове оновлення.</li>
      <li><b>DELETE</b> — видалити, ідемпотентний.</li>
      <li><b>HEAD</b> — як GET, але без тіла відповіді (перевірка існування/метаданих).</li>
      <li><b>OPTIONS</b> — можливості ресурсу; використовується в CORS preflight.</li>
    </ul>
    <p><b>Коди:</b> 2xx успіх, 3xx перенаправлення, 4xx помилка клієнта, 5xx помилка сервера.</p>
    <p><b>У проєкті:</b> <code>POST /api/jobs</code> — створити задачу (201), <code>GET /api/jobs</code> — історія, <code>POST /api/jobs/:id/cancel</code> — скасування, 422 — невалідні вхідні дані, 429 — перевищено ліміт.</p>`
  },
  {
    n: 4,
    q: 'HTTP/1.0, HTTP/1.1, HTTP/2, HTTP/3',
    a: `<ul>
      <li><b>HTTP/1.0 (1996):</b> нове TCP-з'єднання на кожен ресурс, немає <code>Host</code>, немає keep-alive → великі накладні витрати на handshake.</li>
      <li><b>HTTP/1.1 (1997):</b> persistent connections (<code>Connection: keep-alive</code>), конвеєризація, обов'язковий <code>Host</code>, кешування, Range-запити. Проблема — <b>HOL blocking</b> на рівні HTTP: відповіді йдуть строго по черзі.</li>
      <li><b>HTTP/2 (2015):</b> бінарний framing layer, <b>мультиплексування</b> потоків в одному TCP-з'єднанні, стиснення заголовків <b>HPACK</b>, пріоритезація, Server Push. HOL на рівні HTTP усунено, але залишився на рівні TCP (втрата пакета блокує всі потоки).</li>
      <li><b>HTTP/3 (2022):</b> транспорт <b>QUIC поверх UDP</b>, незалежні потоки → HOL усунено повністю, стиснення заголовків <b>QPACK</b>, швидке рукостискання 0-RTT/1-RTT, <b>connection migration</b> (зміна Wi-Fi → LTE без розриву).</li>
    </ul>
    <p>Детальніше — у презентації <code>веб.pptx</code> (18 слайдів, порівняльна таблиця + питання до аудиторії).</p>`
  },
  {
    n: 5,
    q: 'HTTPS, SSL/TLS, підходи до шифрування',
    a: `<p>HTTPS = HTTP + TLS. Забезпечує <b>конфіденційність</b>, <b>цілісність</b> і <b>автентифікацію</b> сервера.</p>
    <ul>
      <li><b>Симетричне</b> шифрування (AES-GCM, ChaCha20) — швидке, для даних.</li>
      <li><b>Асиметричне</b> (RSA, ECDHE) — для обміну ключами та підпису.</li>
      <li><b>Гешування</b> (SHA-256) + MAC — цілісність.</li>
    </ul>
    <p><b>TLS 1.3 handshake:</b> ClientHello (key share) → ServerHello + сертифікат + Finished → 1-RTT, далі симетричний канал. TLS 1.2 — 2-RTT.</p>
    <p><b>Ланцюг довіри:</b> сертифікат підписаний CA → браузер перевіряє підпис, термін дії, домен (SAN), відкликання (OCSP/CRL).</p>
    <p><b>У проєкті:</b> самопідписаний сертифікат (selfsigned) для <code>localhost</code>, TLS-сервер на :8443, WebSocket через <b>WSS</b>. У продакшені — Let's Encrypt + HSTS.</p>`
  },
  {
    n: 6,
    q: 'WebSocket, протоколи WS та WSS',
    a: `<p>WebSocket — повнодуплексний канал поверх одного TCP-з'єднання. Починається як HTTP-запит з <code>Upgrade: websocket</code> та <code>Sec-WebSocket-Key</code>; сервер відповідає <code>101 Switching Protocols</code>.</p>
    <ul>
      <li><b>ws://</b> — без шифрування (порт 80), <b>wss://</b> — поверх TLS (443).</li>
      <li>Кадри: text/binary, control-кадри ping/pong/close.</li>
      <li>Менший overhead за polling: 2–6 байт заголовка проти повного HTTP-запиту.</li>
    </ul>
    <p><b>У проєкті:</b> <code>wss://localhost:8443/ws?token=JWT</code> — сервер пушить прогрес задачі (відсоток, етап, ітерація) та стан черги. Авторизація — JWT у query-параметрі, бо браузерний WebSocket API не дозволяє власні заголовки.</p>`
  },
  {
    n: 7,
    q: 'Трьохшарова архітектура vs двошарова',
    a: `<p><b>Двошарова (client–server):</b> клієнт містить і UI, і бізнес-логіку; сервер — лише дані. Проблеми: товстий клієнт, складно оновлювати, погана масштабованість.</p>
    <p><b>Трьохшарова:</b></p>
    <ul>
      <li><b>Presentation</b> — браузер (HTML/CSS/JS).</li>
      <li><b>Application / business logic</b> — сервери застосунків, обчислення, валідація, авторизація.</li>
      <li><b>Data</b> — БД (SQLite/PostgreSQL).</li>
    </ul>
    <p>Переваги: незалежне масштабування кожного шару, повторне використання логіки різними клієнтами, безпека (БД недоступна ззовні).</p>
    <p><b>У проєкті:</b> браузер → балансувальник → сервери застосунків → SQLite. Кожен шар можна масштабувати окремо.</p>`
  },
  {
    n: 8,
    q: 'REST архітектура',
    a: `<p>REST — архітектурний стиль (не протокол). Обмеження Філдінга:</p>
    <ul>
      <li><b>Client–server</b> — розділення відповідальності.</li>
      <li><b>Stateless</b> — кожен запит самодостатній (у нас — JWT у заголовку).</li>
      <li><b>Cacheable</b> — відповіді можна кешувати.</li>
      <li><b>Uniform interface</b> — ресурси адресуються URI, дії — HTTP-методами.</li>
      <li><b>Layered system</b> — балансувальник, проксі, кеш — прозорі для клієнта.</li>
      <li><b>Code on demand</b> (опційно).</li>
    </ul>
    <p><b>Приклад нашого API:</b></p>
    <ul>
      <li><code>POST /api/auth/login</code> → <code>{token}</code></li>
      <li><code>GET /api/jobs</code> → список задач</li>
      <li><code>POST /api/jobs</code> → створити</li>
      <li><code>POST /api/jobs/{id}/cancel</code> → скасувати</li>
      <li><code>GET /api/admin/overview</code> → метрики</li>
    </ul>`
  },
  {
    n: 9,
    q: 'Інструменти автоматизації DevOps',
    a: `<ul>
      <li><b>CI/CD:</b> GitHub Actions, GitLab CI, Jenkins — збірка, тести, деплой на кожен коміт.</li>
      <li><b>Контейнеризація:</b> Docker, Podman; <b>оркестрація</b> — Kubernetes, Docker Swarm.</li>
      <li><b>IaC:</b> Terraform, Ansible, Pulumi — інфраструктура як код.</li>
      <li><b>Моніторинг:</b> Prometheus + Grafana, Loki, Sentry.</li>
      <li><b>Логування:</b> ELK/EFK stack.</li>
      <li><b>Секрети:</b> Vault, SOPS.</li>
    </ul>
    <p><b>У проєкті:</b> <code>npm start</code> піднімає весь кластер; у продакшені це був би Docker Compose / K8s з health-check і rolling update.</p>`
  },
  {
    n: 10,
    q: 'Основи та особливості JavaScript',
    a: `<ul>
      <li><b>Динамічна типізація</b>, функції — об'єкти першого класу.</li>
      <li><b>Однопотоковий event loop</b>: call stack + task queue (macrotasks) + microtask queue (Promises).</li>
      <li><b>Асинхронність:</b> callbacks → Promises → async/await.</li>
      <li><b>Замикання (closure)</b> — функція «пам'ятає» лексичне оточення.</li>
      <li><b>Hoisting</b>, <code>var</code> vs <code>let/const</code> (TDZ, блокова область видимості).</li>
      <li><b>this</b> залежить від способу виклику; стрілкові функції беруть <code>this</code> з оточення.</li>
    </ul>
    <pre class="diagram">async function load() {
  const res = await fetch('/api/jobs', { headers: { Authorization: \`Bearer \${token}\` } });
  const { jobs } = await res.json();
  render(jobs);
}</pre>`
  },
  {
    n: 11,
    q: 'Клієнтський JavaScript: обмеження безпеки',
    a: `<p>Код у браузері <b>повністю під контролем користувача</b> — його не можна вважати довіреним.</p>
    <ul>
      <li><b>Same-Origin Policy</b> — скрипт з одного origin не читає дані іншого.</li>
      <li><b>CORS</b> — явний дозвіл сервера на cross-origin запити.</li>
      <li><b>CSP</b> — заборона inline-скриптів і сторонніх джерел (у нас задано заголовок).</li>
      <li><b>XSS</b> — ін'єкція скрипта; захист: екранування, <code>textContent</code> замість <code>innerHTML</code>, CSP.</li>
      <li><b>CSRF</b> — менш актуально з JWT у заголовку (не cookie).</li>
      <li><b>Немає доступу</b> до файлової системи, процесів, інших вкладок (крім postMessage).</li>
    </ul>
    <p><b>Висновок для проєкту:</b> клієнтська валідація — лише UX. Усі ліміти <b>повторно перевіряються на сервері</b> (<code>validateJobInput</code>), інакше ліміт обходиться через curl.</p>`
  },
  {
    n: 12,
    q: 'JavaScript, ООП, прототипи',
    a: `<p>JS використовує <b>прототипне</b> успадкування: об'єкт має приховане посилання <code>[[Prototype]]</code>; пошук властивості йде по ланцюжку прототипів до <code>null</code>.</p>
    <ul>
      <li><code>Object.create(proto)</code> — пряме задання прототипу.</li>
      <li><code>class</code> — синтаксичний цукор над прототипами (не справжні класи).</li>
      <li><code>new F()</code> — створює об'єкт, ставить прототип <code>F.prototype</code>, викликає конструктор.</li>
      <li>Інкапсуляція — <code>#private</code> поля (ES2022).</li>
    </ul>
    <pre class="diagram">class Job {
  #id;
  constructor(id, n) { this.#id = id; this.n = n; }
  get id() { return this.#id; }
}
class ComputeJob extends Job {
  constructor(id, n, iter) { super(id, n); this.iter = iter; }
}</pre>`
  },
  {
    n: 13,
    q: 'TypeScript: основи та особливості',
    a: `<p>TypeScript — надмножина JS зі статичною типізацією; компілюється в JS.</p>
    <ul>
      <li><b>Типи:</b> примітиви, <code>any/unknown/never</code>, масиви, кортежі, enum, union/intersection.</li>
      <li><b>Інтерфейси та type-аліаси</b>, generics, utility-типи (<code>Partial, Pick, Omit, Record</code>).</li>
      <li><b>Type narrowing</b> — звуження типів через <code>typeof</code>, <code>in</code>, discriminated unions.</li>
      <li><b>Строгий режим</b> <code>strict: true</code> — <code>strictNullChecks</code>, <code>noImplicitAny</code>.</li>
      <li>Компілятор <code>tsc</code>; у Node — <code>tsx</code>/<code>ts-node</code> або нативне стирання типів.</li>
    </ul>
    <pre class="diagram">type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
interface Job { id: string; status: JobStatus; progress: number; }</pre>
    <p>Переваги: помилки на етапі компіляції, автодоповнення, безпечний рефакторинг. Мінус — етап збірки.</p>`
  },
  {
    n: 14,
    q: 'Огляд Angular',
    a: `<p>Повноцінний фреймворк від Google (TypeScript-first).</p>
    <ul>
      <li><b>Компоненти</b> — шаблон + клас + стилі; <b>директиви</b>; <b>pipes</b>.</li>
      <li><b>DI (dependency injection)</b> — вбудований контейнер залежностей.</li>
      <li><b>RxJS</b> — реактивність на Observable.</li>
      <li><b>Модулі / standalone components</b>, Router, Forms (template-driven / reactive).</li>
      <li>Двостороннє зв'язування <code>[(ngModel)]</code>.</li>
    </ul>
    <pre class="diagram">@Component({ selector: 'app-job', template: '&lt;div&gt;{{ job.progress }}%&lt;/div&gt;' })
export class JobComponent { @Input() job!: Job; }</pre>
    <p>Плюси: структура «з коробки», сильна типізація. Мінуси: важчий поріг входу, більший бандл.</p>`
  },
  {
    n: 15,
    q: 'Огляд ElectronJS',
    a: `<p>Electron = Chromium (рендеринг) + Node.js (доступ до ОС) + власний main-процес. Дозволяє писати десктопні застосунки на веб-технологіях (VS Code, Slack, Discord).</p>
    <ul>
      <li><b>main process</b> — вікна, меню, файлова система.</li>
      <li><b>renderer process</b> — UI; ізольований, спілкується через IPC.</li>
      <li><b>preload</b> + <code>contextBridge</code> — безпечний місток API.</li>
    </ul>
    <p>Мінуси: розмір (~150 МБ), споживання RAM, потреба окремих оновлень.</p>`
  },
  {
    n: 16,
    q: 'Огляд React',
    a: `<ul>
      <li><b>Компонентний підхід</b>, JSX, однонаправлений потік даних (props вниз, події вгору).</li>
      <li><b>Virtual DOM</b> + reconciliation: порівняння дерев і мінімальні зміни реального DOM.</li>
      <li><b>Хуки:</b> <code>useState</code>, <code>useEffect</code>, <code>useMemo</code>, <code>useCallback</code>, <code>useRef</code>, <code>useContext</code>.</li>
      <li>Екосистема: React Router, Redux/Zustand, Next.js (SSR/SSG).</li>
    </ul>
    <pre class="diagram">function JobCard({ job }) {
  const [p, setP] = useState(job.progress);
  useEffect(() => setP(job.progress), [job.progress]);
  return &lt;div&gt;{p}%&lt;/div&gt;;
}</pre>
    <p>У цьому проєкті frontend зроблено на чистому JS (без збірки) — щоб запуск був однією командою; React дав би ту саму логіку, але з бандлером.</p>`
  },
  {
    n: 17,
    q: 'Django Web Framework',
    a: `<p>Python-фреймворк «batteries included», MVT-архітектура (Model–View–Template).</p>
    <ul>
      <li><b>ORM</b> — моделі як класи Python, міграції.</li>
      <li><b>Admin</b> — автогенерована адмінпанель (аналог нашої <code>/api/admin/*</code>).</li>
      <li><b>URLconf</b>, middleware, forms, вбудована авторизація.</li>
      <li><b>Django REST Framework</b> — серіалізатори, ViewSet, permissions.</li>
      <li>Захист «з коробки»: CSRF, XSS, SQL-injection через параметризовані запити ORM.</li>
    </ul>
    <pre class="diagram">class Job(models.Model):
    status = models.CharField(max_length=16, default='queued')
    n = models.IntegerField()
    progress = models.IntegerField(default=0)</pre>
    <p>Для трудомістких задач Django погано підходить для синхронних обчислень — потрібен Celery + Redis.</p>`
  },
  {
    n: 18,
    q: 'JavaScript ES6+ та відмінності',
    a: `<ul>
      <li><b>ES6 (2015):</b> <code>let/const</code>, стрілкові функції, класи, шаблонні рядки, деструктуризація, spread/rest, модулі <code>import/export</code>, Promise, Map/Set, Symbol, генератори.</li>
      <li><b>ES2017:</b> async/await, <code>Object.entries/values</code>.</li>
      <li><b>ES2018:</b> rest/spread для об'єктів, async iterators.</li>
      <li><b>ES2020:</b> optional chaining <code>?.</code>, nullish coalescing <code>??</code>, <code>BigInt</code>, <code>Promise.allSettled</code>.</li>
      <li><b>ES2021:</b> <code>replaceAll</code>, <code>Promise.any</code>, logical assignment <code>||=</code>.</li>
      <li><b>ES2022:</b> top-level await, <code>#private</code> поля, <code>.at()</code>.</li>
    </ul>
    <p>Сумісність забезпечують транспіляцією (Babel, esbuild) і polyfill-ами.</p>`
  },
  {
    n: 19,
    q: 'Node.js: особливості, Back End, приєднання до БД',
    a: `<ul>
      <li><b>V8 + libuv</b>: один потік JS, але неблокуючий I/O через event loop і thread pool.</li>
      <li><b>Event loop фази:</b> timers → pending callbacks → poll → check → close.</li>
      <li><b>Модулі:</b> CommonJS (<code>require</code>) та ESM (<code>import</code>).</li>
      <li><b>CPU-bound задачі блокують loop</b> → виносять у <code>worker_threads</code>, child_process або окремі сервіси. <em>Саме так зроблено в цьому проєкті.</em></li>
      <li><b>БД:</b> <code>pg</code> (PostgreSQL), <code>mysql2</code>, <code>mongoose</code> (MongoDB), <code>better-sqlite3</code> / вбудований <code>node:sqlite</code>.</li>
    </ul>
    <pre class="diagram">const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/app.db');
db.prepare('INSERT INTO jobs (id, n) VALUES (?, ?)').run(id, n);</pre>
    <p>Параметризовані запити <code>?</code> — захист від SQL-ін'єкцій.</p>`
  },
  {
    n: 20,
    q: 'Docker для розробки та підтримки вебзастосунків',
    a: `<ul>
      <li><b>Image</b> — незмінний зліпок (шари, кешуються); <b>container</b> — запущений екземпляр.</li>
      <li><b>Dockerfile</b> — інструкції збірки; <b>volume</b> — персистентні дані; <b>network</b> — ізольована мережа.</li>
      <li><b>docker compose</b> — багатоконтейнерне середовище (LB + N app + БД) однією командою.</li>
      <li>Переваги: однакове оточення dev/prod, швидкий старт, ізоляція, легке масштабування <code>--scale app=4</code>.</li>
    </ul>
    <pre class="diagram">services:
  lb:    { build: ., ports: ["8443:8443"] }
  app:   { build: ., deploy: { replicas: 2 } }
  db:    { image: postgres:16, volumes: ["pgdata:/var/lib/postgresql/data"] }</pre>
    <p>У цьому проєкті Docker не використовується (його немає в середовищі) — роль контейнерів виконують окремі процеси Node з власними портами, що дає той самий ефект горизонтального масштабування.</p>`
  },
  {
    n: 21,
    q: 'Kubernetes для оркестрації контейнерів',
    a: `<ul>
      <li><b>Pod</b> — мінімальна одиниця (1+ контейнер); <b>Deployment</b> — декларативне управління репліками.</li>
      <li><b>Service</b> — стабільна IP/DNS + балансування між подами; <b>Ingress</b> — зовнішній HTTP-вхід.</li>
      <li><b>HPA (Horizontal Pod Autoscaler)</b> — автомасштабування за CPU/RAM/метриками. <em>Аналог нашого <code>pool.autoscale()</code>.</em></li>
      <li><b>ConfigMap / Secret</b>, <b>liveness/readiness probes</b> (аналог <code>/health</code>).</li>
      <li>Self-healing: перезапуск невдалих подів, rolling update, відкат.</li>
    </ul>
    <p>K8s вирішує ті самі задачі, що й наш пул процесів, але на рівні інфраструктури та для багатьох машин.</p>`
  },
  {
    n: 22,
    q: 'Хмарні технології',
    a: `<ul>
      <li><b>Моделі:</b> IaaS (VM), PaaS (App Service, Heroku), SaaS, FaaS (Lambda, Cloud Functions).</li>
      <li><b>Провайдери:</b> AWS (EC2, S3, RDS, ELB), Azure (App Service, AKS), GCP (GCE, GKE, Cloud Run).</li>
      <li><b>Керовані сервіси:</b> БД, черги (SQS), кеш (ElastiCache), CDN (CloudFront).</li>
      <li><b>Автомасштабування:</b> Auto Scaling Group / VM Scale Set — підйом нових інстансів за метриками.</li>
      <li><b>Serverless</b> — платиш за виклики; обмежений час виконання (не підходить для довгих обчислень).</li>
    </ul>
    <p>Наша архітектура (LB + пул stateless app-серверів + спільна БД) — типова хмарна схема, готова до перенесення в AWS/Azure.</p>`
  },
  {
    n: 23,
    q: 'Terraform: розгортання середовищ на AWS/GCP/Azure',
    a: `<p>Terraform — інструмент <b>Infrastructure as Code</b> від HashiCorp. Описує ресурси декларативно (HCL), будує граф залежностей і приводить реальний стан до бажаного (<code>plan</code> → <code>apply</code>).</p>
    <ul>
      <li><b>Providers</b> — aws, azurerm, google.</li>
      <li><b>State</b> — файл стану (краще у S3 + DynamoDB lock).</li>
      <li><b>Modules</b> — перевикористовувані блоки.</li>
      <li><code>terraform plan</code> — dry-run, <code>apply</code> — застосувати, <code>destroy</code> — знести.</li>
    </ul>
    <pre class="diagram">resource "aws_instance" "app" {
  count         = 2
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.small"
  tags = { Name = "app-\${count.index}" }
}</pre>
    <p>Так розгортаються 2+ сервери застосунків і балансувальник — тобто вимога п.5 ТЗ на реальній інфраструктурі.</p>`
  }
];

/* ------------------------------------------------------------------ render */

function renderTheory() {
  const box = document.getElementById('theoryAccordion');
  if (!box) return;

  box.innerHTML = THEORY.map((item, i) => `
    <div class="acc-item${i === 0 ? ' open' : ''}">
      <button class="acc-head">
        <span><span class="num">${item.n}.</span>${item.q}</span>
        <span class="chev">▾</span>
      </button>
      <div class="acc-body">${item.a}</div>
    </div>`).join('');

  box.querySelectorAll('.acc-head').forEach((head) => {
    head.addEventListener('click', () => {
      head.parentElement.classList.toggle('open');
    });
  });
}

renderTheory();
