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

  // Insert a record
  await client.insert('mydb.users', { id: 'u1', name: 'John', age: 30 });

  // Query
  const adults = await client.onql('select * from mydb.users where age > 18');
  console.log(adults);

  // Update and delete by path
  await client.update('mydb.users.u1', { age: 31 });
  await client.delete('mydb.users.u1');

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

Sends a raw request frame and waits for the response. Returns an object with
`request_id`, `source`, and `payload`.

### `client.close()`

Closes the connection.

## Direct ORM-style API

On top of raw `sendRequest`, the client exposes convenience methods that build
the standard payload envelopes for `insert` / `update` / `delete` / `onql` and
unwrap the server's `{error, data}` response — throwing if the server returned
a non-empty `error`, returning the decoded `data` otherwise.

The `path` argument is a **dotted string** identifying what you're operating
on:

| Path shape | Meaning |
|------------|---------|
| `"mydb.users"` | The `users` table in database `mydb` (used by `insert`) |
| `"mydb.users.u1"` | The record with id `u1` in `mydb.users` (used by `update` / `delete`) |

### `await client.insert(path, data)`

Insert a **single** record.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Table path, e.g. `"mydb.users"` |
| `data` | `object` | A single record object (not an array) |

```javascript
await client.insert('mydb.users', { id: 'u1', name: 'John', age: 30 });
```

### `await client.update(path, data, opts?)`

Update the record at `path`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | — | Record path, e.g. `"mydb.users.u1"` |
| `data` | `object` | — | Fields to update |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |

```javascript
await client.update('mydb.users.u1', { age: 31 });
await client.update('mydb.users.u1', { active: false }, { protopass: 'admin' });
```

### `await client.delete(path, opts?)`

Delete the record at `path`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | — | Record path, e.g. `"mydb.users.u1"` |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |

```javascript
await client.delete('mydb.users.u1');
```

### `await client.onql(query, opts?)`

Run a raw ONQL query. The server's `{error, data}` envelope is unwrapped — the
returned value is the decoded `data` payload.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | — | ONQL query text |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |
| `opts.ctxkey` | `string` | `""` | Context key |
| `opts.ctxvalues` | `string[]` | `[]` | Context values |

```javascript
const rows = await client.onql('select * from mydb.users where age > 18');
```

### `client.build(query, ...values)`

Replace `$1`, `$2`, … placeholders with values. Strings are automatically
double-quoted; numbers and booleans are inlined verbatim.

```javascript
const q = client.build(
  'select * from mydb.users where name = $1 and age > $2',
  'John', 18
);
// -> 'select * from mydb.users where name = "John" and age > 18'
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
