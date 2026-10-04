import client from "../redis/client.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const script1 = fs.readFileSync(
  path.join(__dirname, '..', 'algorithms', 'tokenBucket.lua'),
  'utf8'
);

const script2 = fs.readFileSync(
  path.join(__dirname, '..', 'algorithms', 'slidingWindow.lua'),
  'utf8'
);

client.defineCommand("tokenBucket", {
    numberOfKeys: 2,
    lua: script1
});

client.defineCommand("slidingWindow", {
    numberOfKeys: 2,
    lua: script2
});

export function rateLimiter(algorithm, options) {
    return async function (req, res, next) {
        const route = req.route?.path ?? req.path;
        const key = `rl:${req.apiKey}:${route}`;

        try {
            let allowed, remaining, retryAfter;
            
            if (algorithm === "tokenBucket") {
                [allowed, remaining, retryAfter] = await client.tokenBucket(
                    `${key}:tokens`,
                    `${key}:lastRefill`,
                    options.limit,
                    options.refillRate
                );
                res.setHeader('X-RateLimit-limit',options.limit);
                res.setHeader('X-RateLimit-Refill-Rate',`${options.refillRate}/sec`);
            } 
            else if (algorithm === "slidingWindow") {
                [allowed, remaining, retryAfter] = await client.slidingWindow(
                    `${key}:windowStart`,
                    `${key}:requests`,
                    options.window,
                    options.limit
                );
                res.setHeader('X-RateLimit-Limit',options.limit);
                res.setHeader('X-RateLimit-Remaining',remaining);
            }
            else {
                throw new Error(`Unknown rate limiting algorithm: ${algorithm}`);
            }
            
            if (!allowed) {
                res.setHeader('X-RateLimit-retryAfter',retryAfter);
                return res.status(429).send("Too many requests");
            }

            next();

        } catch (err) {
            if (options.failMode === "open") {
                return next();
            }
            if (options.failMode === "closed") {
                return res.status(503).send("Rate limiter unavailable");
            }
            next(err);
        }
    };
}