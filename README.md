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

async function main() {
  const client = await ONQLClient.create('localhost', 5656);

  // Execute a query
  const result = await client.sendRequest('onql', JSON.stringify({
    db: 'mydb',
    table: 'users',
    query: 'name = "John"'
  }));
  console.log(result.payload);

  // Subscribe to live updates
  const rid = await client.subscribe('', 'name = "John"', (rid, keyword, payload) => {
    console.log('Update:', payload);
  });

  // Unsubscribe
  await client.unsubscribe(rid);

  await client.close();
}

main();
```

## API Reference

### `ONQLClient.create(host, port, options)`

Creates and returns a connected client instance.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `host` | `string` | `"localhost"` | Server hostname |
| `port` | `number` | `5656` | Server port |
| `options.timeout` | `number` | `10000` | Default request timeout in ms |
| `options.dataLimit` | `number` | `16777216` | Max buffer size in bytes (16 MB) |

### `client.sendRequest(keyword, payload, timeout?)`

Sends a request and waits for a response.

### `client.subscribe(onquery, query, callback)`

Opens a streaming subscription. Returns the subscription ID.

### `client.unsubscribe(rid)`

Stops receiving events for a subscription.

### `client.close()`

Closes the connection.

## Direct ORM-style API

In addition to the raw `sendRequest` protocol, the client exposes convenience
methods that build the standard payload envelopes for common operations and
unwrap the server's `{error, data}` response automatically.

Call `client.setup(db)` once to bind a default database name; every subsequent
`insert` / `update` / `delete` / `onql` call will use it.

### `client.setup(db)`

Sets the default database. Returns `this` so calls can be chained.

```javascript
client.setup('mydb');
```

### `await client.insert(table, data)`

Insert one record or an array of records.

| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | `string` | Target table name |
| `data` | `object \| object[]` | A single record or array of records |

Returns the parsed `data` field from the server response. Throws if the server
returns an `error`.

```javascript
await client.insert('users', { name: 'John', age: 30 });
await client.insert('users', [{ name: 'A' }, { name: 'B' }]);
```

### `await client.update(table, data, query, opts?)`

Update records matching `query`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `table` | `string` | — | Target table |
| `data` | `object` | — | Fields to update |
| `query` | `object \| string` | — | Match query |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |
| `opts.ids` | `string[]` | `[]` | Explicit record IDs |

```javascript
await client.update('users', { age: 31 }, { name: 'John' });
await client.update('users', { active: false }, { id: 'u1' }, { protopass: 'admin' });
```

### `await client.delete(table, query, opts?)`

Delete records matching `query`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `table` | `string` | — | Target table |
| `query` | `object \| string` | — | Match query |
| `opts.protopass` | `string` | `"default"` | Proto-pass profile |
| `opts.ids` | `string[]` | `[]` | Explicit record IDs |

```javascript
await client.delete('users', { active: false });
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
const rows = await client.onql('select * from users where age > 18');
```

### `client.build(query, ...values)`

Replace `$1`, `$2`, … placeholders with values. Strings are automatically
double-quoted; numbers and booleans are inlined verbatim.

```javascript
const q = client.build('select * from users where name = $1 and age > $2', 'John', 18);
// -> 'select * from users where name = "John" and age > 18'
const rows = await client.onql(q);
```

### Full example

```javascript
const { ONQLClient } = require('onql-client');

(async () => {
  const client = await ONQLClient.create({ host: 'localhost', port: 5656 });
  client.setup('mydb');

  await client.insert('users', { name: 'John', age: 30 });

  const adults = await client.onql(
    client.build('select * from users where age >= $1', 18)
  );
  console.log(adults);

  await client.update('users', { age: 31 }, { name: 'John' });
  await client.delete('users', { name: 'John' });

  await client.close();
})();
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
