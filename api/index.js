// api/index.js - ES Module version
import app from '../dist/index.js';

export default async function handler(req, res) {
    console.log(`📝 ${req.method} ${req.url}`);

    try {
        await app(req, res);
    } catch (error) {
        console.error('🚨 Handler error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message
        });
    }
}