const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { validationResult } = require('express-validator');


const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);


async function register(req, res) {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { username, email, password } = req.body;
        // check existing
        const existing = await db('users').where('email', email).orWhere('username', username).first();
        if (existing) return res.status(409).json({ message: 'User with that email or username already exists' });


        const hashed = await bcrypt.hash(password, SALT_ROUNDS);


        const [user] = await db('users').insert({ username, email, password: hashed }).returning(['id', 'username', 'email']);


        // create token
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });


        res.status(201).json({ user, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
}

async function login(req, res) {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { mobile } = req.body;
        const user = await db('users').where(function () {
            this.where('mobile', mobile);
        }).first();

        if (!user) {
            await db('users').insert({ mobile, otp: '1234' }).returning(['id', 'mobile', 'otp']);
        }
        return res.status(200).json({ message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
}

async function verifyOtp(req, res) {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { mobile, otp } = req.body;
        const user = await db('users').where(function () {
            this.where('mobile', mobile);
        }).first();

        const existing = await db('users').where('mobile', mobile).where('otp', otp).first();
        if (!existing) return res.status(409).json({ message: 'Wrong Otp' });

        const token = jwt.sign({ id: user.id, mobile: user.mobile }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
        // hide password
        res.json({ user, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
}
module.exports = { register, login, verifyOtp };