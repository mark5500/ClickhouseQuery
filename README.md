# QueryBuilder

## Start ClickHouse

```
docker compose up -d
```

ClickHouse is available at `http://localhost:8123` (HTTP) and `localhost:9000` (native).
Credentials are in `.env` (default user `default` / password `changeme`).

## Run the TypeScript client

```
npm install
npm run dev
```

`src/index.ts` creates an `events` table, inserts a row, and queries it back using `@clickhouse/client`.
