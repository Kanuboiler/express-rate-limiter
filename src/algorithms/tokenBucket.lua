local tokens = tonumber(redis.call("GET", KEYS[1]))
local lastRefill = tonumber(redis.call("GET", KEYS[2]))

local t = redis.call("TIME")
local now = t[1] * 1000 + math.floor(t[2] / 1000)

if not tokens then
    tokens = tonumber(ARGV[1])
end

if not lastRefill then
    lastRefill = now
end

local elapsed = now - lastRefill

local refillRate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[1])

local newTokens = tokens + (elapsed / 1000) * refillRate

if newTokens > capacity then
    newTokens = capacity
end

if newTokens >= 1 then
    newTokens = newTokens - 1

    redis.call("SET", KEYS[1], newTokens)
    redis.call("SET", KEYS[2], now)

    return 1
else
    redis.call("SET", KEYS[1], newTokens)
    redis.call("SET", KEYS[2], now)

    return 0
end