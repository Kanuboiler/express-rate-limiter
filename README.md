# Distributed Rate Limiter

A Redis-backed distributed rate limiter middleware for Express.js.

Supports **Token Bucket** and **Sliding Window** algorithms, with atomic rate-limit checks implemented using **Redis Lua scripts**.

The limiter works across multiple Node.js/Express servers because the rate-limit state is stored in Redis rather than in the memory of an individual server.

---

## Features

- 🚦 Token Bucket rate limiting
- 🪟 Sliding Window rate limiting
- ⚡ Atomic Redis operations using Lua scripts
- 🌐 Distributed rate limiting across multiple Express servers
- 🔑 Per-API-key rate limiting
- 🛣️ Per-route rate limiting
- 📊 Rate-limit response headers
- 🔄 Configurable fail-open / fail-closed behavior
- 📦 Designed to be used as Express middleware
- 🧩 Redis support through `ioredis`

---

## How It Works

The middleware generates a Redis key based on the API key and route:

```text
rl:<apiKey>:<route>
```

For example:

```text
rl:user123:/api/users
```

The actual Redis keys used by the algorithms are derived from this key.

For Token Bucket:

```text
rl:user123:/api/users:tokens
rl:user123:/api/users:lastRefill
```

For Sliding Window:

```text
rl:user123:/api/users:windowStart
rl:user123:/api/users:requests
```

Because the state is stored in Redis, multiple application servers can share the same rate-limit state.

For example:

```text
                 ┌───────────────┐
                 │     Client    │
                 └───────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
       ┌──────▼──────┐       ┌──────▼──────┐
       │ Express     │       │ Express     │
       │ Server 1    │       │ Server 2    │
       └──────┬──────┘       └──────┬──────┘
              │                     │
              └──────────┬──────────┘
                         │
                  ┌──────▼──────┐
                  │    Redis    │
                  │             │
                  │ Rate-limit  │
                  │   state     │
                  └─────────────┘
```

This means a limit of `5 requests` is shared across Server 1 and Server 2 rather than giving each server its own limit of 5.

---

You also need a running Redis server.

---

# Basic Usage

```javascript
import express from "express";
import { rateLimiter } from "<./src/middleware/ratelimiter.js>";

const app = express();

const limiter = rateLimiter("tokenBucket", {
    limit: 10,
    refillRate: 2,
    failMode: "closed"
});

app.get("/api/users",limiter, (req, res) => {
    res.json({
        message: "Request allowed"
    });
});

app.listen(3000);
```
// as it requires the route, we cant use it with app.use()
---

# Token Bucket

The Token Bucket algorithm maintains a bucket containing tokens.

Each request consumes one token.

Tokens are periodically refilled at the configured refill rate.

Example:

```javascript
const limiter = rateLimiter("tokenBucket", {
    limit: 10,
    refillRate: 2,
    failMode: "closed"
});
```

Configuration:

| Option | Description |
|---|---|
| `limit` | Maximum number of tokens in the bucket |
| `refillRate` | Number of tokens added per second |
| `failMode` | What happens when Redis/rate limiting fails |

With:

```javascript
{
    limit: 10,
    refillRate: 2
}
```

the bucket can contain at most 10 tokens and receives 2 tokens per second.

---

# Sliding Window

The Sliding Window algorithm limits the number of requests during a moving time window.

Example:

```javascript
const limiter = rateLimiter("slidingWindow", {
    limit: 100,
    window: 60,
    failMode: "closed"
});
```

Configuration:

| Option | Description |
|---|---|
| `limit` | Maximum requests allowed |
| `window` | Window duration |
| `failMode` | What happens when Redis/rate limiting fails |

For example:

```javascript
{
    limit: 100,
    window: 60
}
```

allows up to 100 requests during the configured 60-second window.

---

# Rate-Limit Headers

The middleware exposes rate-limit information through HTTP response headers.

Depending on the algorithm, headers include:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Refill-Rate
X-RateLimit-retryAfter
```

When the rate limit is exceeded, the middleware returns:

```http
HTTP/1.1 429 Too Many Requests
```

with:

```text
X-RateLimit-retryAfter
```

indicating when the client should retry.

---

# Fail Modes

Redis is an external dependency, so the middleware provides two failure modes.

## Fail Open

```javascript
const limiter = rateLimiter("tokenBucket", {
    limit: 10,
    refillRate: 2,
    failMode: "open"
});
```

If Redis or the rate limiter fails, the request is allowed to continue:

```text
Redis failure
     ↓
Rate limiter fails
     ↓
Request continues
```

This prioritizes availability.

---

## Fail Closed

```javascript
const limiter = rateLimiter("tokenBucket", {
    limit: 10,
    refillRate: 2,
    failMode: "closed"
});
```

If Redis or the rate limiter fails, the request is rejected:

```http
503 Service Unavailable
```

This prioritizes protection over availability.

---

# Per-API-Key and Per-Route Limiting

The middleware generates a rate-limit key using:

```javascript
const route = req.route?.path ?? req.path;

const key = `rl:${req.apiKey}:${route}`;
```

This means different API keys and routes can have independent limits.

For example:

```text
rl:user123:/api/users
rl:user123:/api/orders
rl:user456:/api/users
```

These represent different rate-limit buckets/windows.

---

# Distributed Rate Limiting

The important difference between this middleware and a simple in-memory rate limiter is that the state is stored in Redis.

An in-memory limiter might behave like this:

```text
Server 1 → 5 requests
Server 2 → 5 requests

Total = 10 requests
```

even if the intended limit is 5.

With Redis:

```text
Server 1 ──┐
           ├──> Redis → shared counter/state
Server 2 ──┘
```

both servers operate on the same rate-limit state.

Therefore:

```text
Limit = 5

Server 1 → 3 requests
Server 2 → 2 requests

Total → 5 requests
```

The next request is rejected.

---

# Why Lua?

The rate-limit check and update need to happen atomically.

For example, a naive implementation could do:

```text
1. Read current tokens
2. Check whether a token is available
3. Decrease tokens
4. Save the new value
```

With multiple servers or concurrent requests, two requests could read the same value before either one updates it.

Redis Lua scripts allow the read/check/update operation to execute as one atomic operation inside Redis.

Conceptually:

```text
Request
   ↓
Redis Lua Script
   │
   ├── Read state
   ├── Calculate new state
   ├── Check limit
   ├── Update state
   └── Return result
   ↓
Middleware
```

The Lua scripts used by this project are:

```text
algorithms/
├── tokenBucket.lua
└── slidingWindow.lua
```

---

# Project Structure

```text
.
├── algorithms/
│   ├── tokenBucket.lua
│   └── slidingWindow.lua
│
├── middleware/
│   └── rateLimiter.js
│
├── redis/
│   └── client.js
│
├── package.json
├── README.md
└── ...
```

---

# Redis Connection

The project uses `ioredis` to communicate with Redis.

The Lua scripts are registered as custom Redis commands:

```javascript
client.defineCommand("tokenBucket", {
    numberOfKeys: 2,
    lua: script1
});

client.defineCommand("slidingWindow", {
    numberOfKeys: 2,
    lua: script2
});
```

The middleware can then execute:

```javascript
await client.tokenBucket(...);
```

or:

```javascript
await client.slidingWindow(...);
```

---

# Example: Two Express Servers

Suppose you have:

```text
Server 1: localhost:3000
Server 2: localhost:3001
Redis:    localhost:6379
```

Both servers use:

```javascript
const limiter = rateLimiter("tokenBucket", {
    limit: 5,
    refillRate: 1,
    failMode: "closed"
});
```

Requests:

```text
Request 1 → Server 1 → Redis
Request 2 → Server 2 → Redis
Request 3 → Server 1 → Redis
Request 4 → Server 2 → Redis
Request 5 → Server 1 → Redis
Request 6 → Server 2 → Redis → 429
```

The limit is shared between the servers.

---

# API

## `rateLimiter(algorithm, options)`

### Parameters

### `algorithm`

Supported values:

```javascript
"tokenBucket"
```

or:

```javascript
"slidingWindow"
```

### `options`

Options depend on the selected algorithm.

### Token Bucket

```javascript
{
    limit: number,
    refillRate: number,
    failMode: "open" | "closed"
}
```

### Sliding Window

```javascript
{
    limit: number,
    window: number,
    failMode: "open" | "closed"
}
```

---

# Error Handling

If an unsupported algorithm is supplied:

```javascript
rateLimiter("unknown", options);
```

the middleware reports:

```text
Unknown rate limiting algorithm: unknown
```

If Redis becomes unavailable, behavior depends on `failMode`.

---

# Development

Clone the repository:

```bash
git clone <your-repository-url>

cd <your-repository>
```

Install dependencies:

```bash
npm install
```

Start Redis:

```bash
redis-server
```

Run the project:

```bash
npm run dev
```

---

# Testing

The distributed behavior can be tested by running multiple Express servers against the same Redis instance.

For example:

```text
Client
  │
  ├── Server 1 ──┐
  │              │
  └── Server 2 ──┼── Redis
                 │
```

Send requests to both servers and verify that the combined request count respects the configured limit.

---

# Limitations / Future Improvements

Potential improvements include:

- Configurable key-generation strategy
- IP-based rate limiting
- Custom API-key extraction
- Multiple requests per operation
- Better standardized `Retry-After` handling
- More precise rate-limit headers
- Redis Cluster support
- Configurable Redis key prefixes
- TypeScript support
- Automated test suite
- Benchmarking
- More rate-limiting algorithms
- npm package distribution

---

# License

MIT License

Copyright (c) 2026 <GANESH JAIN>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```