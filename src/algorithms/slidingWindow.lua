local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local windowMs = tonumber(ARGV[1]) * 1000
local limit = tonumber(ARGV[2])

local start = tonumber(redis.call('GET', KEYS[1]))

if not start or now - start >= windowMs then
  redis.call('SET', KEYS[1], now, 'PX', windowMs)
  redis.call('SET', KEYS[2], 0, 'PX', windowMs)
end

local retryAfter;

if start then
  retryAfter = start + windowMs - now;
else
  retryAfter = 0;
end
  
local remaining = limit - redis.call('GET',KEYS[2]);

local count = redis.call('INCR', KEYS[2])

if count > limit then
    return {0, remaining, retryAfter}
end

return {1, remaining, retryAfter}