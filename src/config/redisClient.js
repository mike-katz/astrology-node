const Redis = require('ioredis');
require('dotenv').config();

let client;

exports.initializeRedis = () => {
  client = new Redis(process.env.REDIS_URL);
  console.log('Connected to Redis');
  client.on('error', (err) => console.log('Redis Client Error', err));
};

exports.setCache = (key, value, ttlSeconds = null) => {
  if (ttlSeconds) {
    return client.set(key, value, 'EX', ttlSeconds);
  }
  return client.set(key, value);
};

exports.incr = (key) => client.incr(key);

exports.decr = (key) => client.decr(key);

exports.getCache = (key) => client.get(key);

exports.deleteKey = (key) => client.del(key);

exports.setHashCache = (hashKey, key, value) => {
  client.hset(hashKey, key, value);
};

exports.getHashCache = (hashKey, key) => client.hget(hashKey, key);

exports.deleteHashKey = (hashKey, key) => client.hdel(hashKey, key);

exports.getHashKeys = (hashKey) => client.hkeys(hashKey);

exports.getAllData = (hashKey) => client.hgetall(hashKey);

exports.getAllValues = (hashKey) => client.hvals(hashKey);
