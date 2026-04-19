# ONQL Node.js Driver

Official Node.js client for the ONQL database server.

## Installation

### From npm

```bash
npm install onql-client
```

### From GitHub (latest `main`)

```bash
npm install github:ONQL/onqlclient-node
```

### Pinned to a release tag

```bash
npm install "github:ONQL/onqlclient-node#v1.0.0"
```

## Quick Start

```javascript
const { ONQLClient } = require('onql-client');

(async () => {
  const client = await ONQLClient.create({ host: 'localhost', port: 5656 });

  // Insert a single record
  await client.insert('mydb', 'users', { id: 'u1', name: 'John', age: 30 });

  // Read via ONQL expression
  const adults = await client.onql('mydb.users[age>18]');
  console.log(adults);

  // Update using a query
  await client.update(
    'mydb', 'users',
    { age: 31 },
    client.build('mydb.users[id=$1].id', 'u1')
  );

  // ...or using explicit ids
  await client.delete('mydb', 'users', '', { ids: ['u1'] });

  await client.close();
})();
```

## API Reference

### `ONQLClient.create(options)`

Creates and returns a connected client instance.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.host` | `string` | `"localhost"` | Server hostname |
| `options.port` | `number` | `5656` | Server port |
| `options.defaultTimeout` | `number` | `10` | Default request timeout in seconds |

### `client.sendRequest(keyword, payload, timeout?)`

Sends a raw request frame and waits for the response.

### `client.close()`

Closes the connection.

## Direct ORM-style API

On top of raw `sendRequest`, the client exposes convenience methods for the
common `insert` / `update` / `delete` / `onql` operations. Each one builds the
standard payload envelope for you and unwraps the `{error, data}` response —
throwing on a non-empty `error`, returning the decoded `data` otherwise.

`db` is passed explicitly to `insert` / `update` / `delete`. `onql` takes a
fully-qualified ONQL expression (which already includes the db name), so no
separate db argument is needed.

`query` arguments are **ONQL expression strings**, e.g.
`'mydb.users[id="u1"].id'` or `'mydb.orders[status="pending"]'`. Use
`client.build(template, ...values)` to substitute `$1, $2, ...` — strings get
double-quoted, numbers/booleans are inlined verbatim.

### `await client.insert(db, table, data)`

Insert a **single** record.

| Parameter | Type | Description |
|-----------|------|-------------|
| `db` | `string` | Database name |
| `table` | `string` | Target table |
| `data` | `object` | A single record object (not an array) |

```javascript
await client.insert('mydb', 'users', { id: 'u1', name: 'John', age: 30 });
```

### `await client.update(db, table, data, query, opts?)`

Update records matching `query` (or the explicit `opts.ids`).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `db` | `string` | — | Database name |
| `table` | `string` | — | Target table |
| `data` | `object` | — | Fields to update |
| `query` | `string` | — | ONQL query expression (e.g. `mydb.users[id="u1"].id`). Pass `""` when using `opts.ids`. |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |
| `opts.ids` | `string[]` | `[]` | Explicit record IDs (alternative to `query`) |

```javascript
// Via ONQL query
await client.update(
  'mydb', 'users',
  { age: 31 },
  client.build('mydb.users[id=$1].id', 'u1')
);

// Via explicit ids
await client.update('mydb', 'users', { age: 31 }, '', { ids: ['u1'] });

// With custom proto-pass
await client.update('mydb', 'users', { active: false },
  client.build('mydb.users[id=$1].id', 'u1'),
  { protopass: 'admin' });
```

### `await client.delete(db, table, query, opts?)`

Delete records matching `query` (or the explicit `opts.ids`). Same options
as `update`.

```javascript
await client.delete('mydb', 'users',
  client.build('mydb.users[id=$1].id', 'u1'));

await client.delete('mydb', 'users', '', { ids: ['u1'] });
```

### `await client.onql(query, opts?)`

Run a raw ONQL query. The server's `{error, data}` envelope is unwrapped.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | — | ONQL expression (e.g. `mydb.users[active="yes"]`) |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |
| `opts.ctxkey` | `string` | `""` | Context key |
| `opts.ctxvalues` | `string[]` | `[]` | Context values |

```javascript
const rows = await client.onql('mydb.users[age>18]');

// With $-placeholder interpolation:
const byName = await client.onql(
  client.build('mydb.users[name=$1]', 'John')
);
```

### `client.build(query, ...values)`

Replace `$1`, `$2`, … placeholders with values. Strings are automatically
double-quoted; numbers and booleans are inlined verbatim.

```javascript
const q = client.build('mydb.users[name=$1 and age>$2]', 'John', 18);
// -> 'mydb.users[name="John" and age>18]'
const rows = await client.onql(q);
```

## Protocol

The client communicates over TCP using a delimiter-based message format:

```
<request_id>\x1E<keyword>\x1E<payload>\x04
```

- `\x1E` — field delimiter
- `\x04` — end-of-message marker

## License

MIT
