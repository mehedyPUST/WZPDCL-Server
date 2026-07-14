// api/index.js
import app from '../dist/index.js';

// ✅ Global error handler for Vercel
export default async function handler(req, res) {
    console.log(`📝 ${req.method} ${req.url}`);
    console.log('🔍 Environment check:', {
        MONGODB_URI: process.env.MONGODB_URI ? '✅ Set' : '❌ Not Set',
        DB_NAME: process.env.DB_NAME || '❌ Not Set',
        NODE_ENV: process.env.NODE_ENV || 'Not Set'
    });

    try {
        await app(req, res);
    } catch (error) {
        console.error('🚨 Handler error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}