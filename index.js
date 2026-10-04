import client from "./src/redis/client.js";

import express from "express";

const app = express();

import {rateLimiter} from "./src/middleware/ratelimiter.js";

const limiter = rateLimiter("slidingWindow",{
    limit: 5,
    window: 60,
    refillRate: 2,
    failMode: "open"
});

app.get("/route",limiter,(req,res,next)=>{
    res.send("hello world2");
});

app.listen(process.env.PORT);