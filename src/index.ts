// src/index.ts - COMPLETE BACKEND WITH SESSION FIX (FULLY FIXED)
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { toNodeHandler } from 'better-auth/node';
import Stripe from 'stripe';
dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;

// =====================================================
// HELPER FUNCTION FOR OBJECT ID
// =====================================================
const createIdQuery = (id: string) => {
    try {
        return { _id: new ObjectId(id) };
    } catch {
        return { _id: id as any };
    }
};

// =====================================================
// MONGODB CONNECTION - OPTIMIZED FOR VERCEL
// =====================================================
let client: MongoClient;
let db: Db;
let isConnected = false;
let connectionPromise: Promise<Db> | null = null;

const connectDB = async (): Promise<Db> => {
    if (db && isConnected) {
        return db;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    connectionPromise = (async () => {
        try {
            if (!MONGODB_URI) {
                throw new Error('MONGODB_URI is not defined in environment variables');
            }

            console.log('📦 Connecting to MongoDB...');

            if (!client) {
                client = new MongoClient(MONGODB_URI, {
                    maxPoolSize: 1,
                    minPoolSize: 1,
                    socketTimeoutMS: 30000,
                    connectTimeoutMS: 10000,
                    serverSelectionTimeoutMS: 5000,
                    retryWrites: true,
                    retryReads: true,
                });
            }

            await client.connect();
            console.log('✅ MongoDB Connected successfully');

            db = client.db(DB_NAME);
            isConnected = true;
            console.log(`📁 Using database: ${DB_NAME}`);

            await db.command({ ping: 1 });
            console.log('✅ MongoDB ping successful');

            return db;
        } catch (error) {
            console.error('❌ MongoDB connection error:', error);
            isConnected = false;
            connectionPromise = null;
            throw error;
        }
    })();

    return connectionPromise;
};

const getDB = (): Db => {
    if (!db) {
        throw new Error('Database not initialized. Call connectDB() first.');
    }
    return db;
};

// =====================================================
// HELPER FUNCTIONS
// =====================================================

const generateComplaintId = (): string => {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `CMP-${year}-${random}`;
};

const generateAppId = (): string => {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `APP-${year}-${random}`;
};

// =====================================================
// TRANSACTION HELPER
// =====================================================

const createTransaction = async (
    type: 'connection_fee' | 'bill_payment' | 'refund' | 'adjustment',
    category: string,
    amount: number,
    status: 'completed' | 'pending' | 'failed' | 'refunded',
    paymentMethod: 'stripe' | 'cash' | 'bank_transfer' | 'mobile_banking',
    consumerName: string,
    meterNo: string,
    referenceId: string,
    description: string
) => {
    try {
        const transactionsCollection = db.collection('transactions');
        const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

        const transaction = {
            transactionId,
            type,
            category,
            amount,
            status,
            paymentMethod,
            consumerName,
            meterNo,
            referenceId,
            description,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: status === 'completed' ? new Date() : null,
        };

        await transactionsCollection.insertOne(transaction);
        console.log(`✅ Transaction created: ${transactionId} for ${referenceId}`);
        return transaction;
    } catch (error) {
        console.error('❌ Error creating transaction:', error);
        return null;
    }
};

// =====================================================
// INITIALIZE COLLECTIONS
// =====================================================

const initializeCollections = async () => {
    try {
        await connectDB();
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        const collectionsToCreate = [
            'transactions',
            'payment_sessions',
            'bills',
            'consumers',
            'meters',
            'complaints',
            'connection_applications',
            'substations',
            'user',
            'session',
            'account',
            'verification'
        ];

        for (const name of collectionsToCreate) {
            if (!collectionNames.includes(name)) {
                await db.createCollection(name);
                console.log(`✅ ${name} collection created`);
            }
        }

        console.log('✅ All collections initialized');
    } catch (error) {
        console.error('Error initializing collections:', error);
    }
};

// =====================================================
// EXPRESS APP
// =====================================================
const app: Application = express();

// =====================================================
// ✅ CORS CONFIGURATION
// =====================================================
app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin) return callback(null, true);
            const allowedOrigins = [
                'http://localhost:3000',
                'http://localhost:3001',
                'https://wzpdcl-client.vercel.app',
                'https://wzpdcl-client-git-main-mehedypusts-projects.vercel.app',
            ];
            if (allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie'],
        exposedHeaders: ['Set-Cookie'],
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// ✅ ROOT ROUTE - Welcome message
// =====================================================
app.get('/', (req: Request, res: Response) => {
    res.json({
        success: true,
        message: 'WZPDCL Backend API is running',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        endpoints: {
            health: '/api/health',
            auth: '/api/auth',
            complaints: '/api/complaints',
            meters: '/api/meters',
            bills: '/api/billing/bills',
            consumers: '/api/billing/consumers',
            applications: '/api/connection-applications',
        }
    });
});

// =====================================================
// ✅ BETTER AUTH SETUP - COMPLETE FIXED VERSION
// =====================================================
let auth: any = null;
let authHandler: any = null;

const initAuth = async () => {
    if (authHandler) return authHandler;

    try {
        await connectDB();
        console.log('📦 Initializing Better Auth...');

        const { betterAuth } = await import('better-auth');
        const { mongodbAdapter } = await import('better-auth/adapters/mongodb');
        const { toNodeHandler } = await import('better-auth/node');

        auth = betterAuth({
            secret: BETTER_AUTH_SECRET,
            baseURL: BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app',
            database: mongodbAdapter(getDB()),
            emailAndPassword: {
                enabled: true,
            },
            socialProviders: {
                google: {
                    clientId: process.env.GOOGLE_CLIENT_ID || '',
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
                    scope: ['email', 'profile'],
                },
            },
            user: {
                additionalFields: {
                    mobile: { type: 'string', required: false },
                    nidNo: { type: 'string', required: false },
                    userType: { type: 'string', required: false },
                    feederName: { type: 'string', required: false },
                    meterNo: { type: 'string', required: false },
                    meters: { type: 'json', required: false },
                    claimedMeters: { type: 'json', required: false },
                    profileImage: { type: 'string', required: false },
                    role: { type: 'string', required: false },
                    isActive: { type: 'boolean', required: false },
                    address: { type: 'string', required: false },
                },
            },
            trustedOrigins: [
                'http://localhost:3000',
                'http://localhost:3001',
                'https://wzpdcl-client.vercel.app',
                'https://wzpdcl-client-git-main-mehedypusts-projects.vercel.app',
            ],
            advanced: {
                cookiePrefix: 'wzpdcl',
                useSecureCookies: process.env.NODE_ENV === 'production', // ✅ FIXED
                sameSite: 'lax',
            },
        });

        authHandler = toNodeHandler(auth);
        console.log('✅ Better Auth initialized successfully');
        return authHandler;
    } catch (error) {
        console.error('❌ Better Auth initialization failed:', error);
        return (req: Request, res: Response) => {
            res.status(503).json({
                success: false,
                message: 'Authentication service unavailable'
            });
        };
    }
};

// =====================================================
// BETTER AUTH SESSION MIDDLEWARE
// =====================================================

const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const session = await auth.api.getSession({
            headers: req.headers,
        });

        if (!session) {
            return res.status(401).json({
                success: false,
                message: 'Not authorized. Please login.',
            });
        }

        // @ts-ignore
        req.user = session.user;
        // @ts-ignore
        req.session = session;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({
            success: false,
            message: 'Invalid session. Please login again.',
        });
    }
};

const authorize = (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // @ts-ignore
        const userRole = req.user?.role;

        if (!userRole || !roles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to access this resource.',
            });
        }
        next();
    };
};

// =====================================================
// 1. HEALTH CHECK
// =====================================================
app.get('/api/health', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const collections = await db.listCollections().toArray();
        res.json({
            status: 'ok',
            message: 'WZPDCL Backend is running!',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: DB_NAME,
            collections: collections.map((c) => c.name),
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

// =====================================================
// 2. BETTER AUTH ROUTES
// =====================================================
app.use('/api/auth', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const handler = await initAuth();
        handler(req, res, next);
    } catch (error) {
        console.error('Better Auth error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication service unavailable',
        });
    }
});

// =====================================================
// 3. CUSTOM SIGN-UP WITH CONSUMER SYNC
// =====================================================

app.post('/api/auth/sign-up/email', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const consumersCollection = db.collection('consumers');
        const { email, mobile, nidNo, name, password, role, meterNo, feederName, consumerType, address } = req.body;

        console.log('📝 Registration request:', { email, mobile, nidNo, name });

        const existingUser = await userCollection.findOne({
            $or: [
                { email: { $regex: new RegExp(`^${email}$`, 'i') } },
                { mobile: { $regex: new RegExp(`^${mobile}$`, 'i') } },
                { nidNo: { $regex: new RegExp(`^${nidNo}$`, 'i') } }
            ]
        });

        if (existingUser) {
            let duplicateField = '';
            if (existingUser.email === email) duplicateField = 'Email';
            else if (existingUser.mobile === mobile) duplicateField = 'Mobile';
            else if (existingUser.nidNo === nidNo) duplicateField = 'NID';

            return res.status(400).json({
                success: false,
                message: `${duplicateField} already exists in the system`,
                error: {
                    field: duplicateField.toLowerCase(),
                    message: `${duplicateField} already exists`
                }
            });
        }

        const response = await auth.api.signUpEmail({
            body: {
                email,
                password,
                name,
                mobile,
                nidNo,
                role: role || 'consumer',
                isActive: true,
                meterNo: meterNo || '',
                feederName: feederName || '',
                consumerType: consumerType || 'residential',
                address: address || '',
            },
            headers: req.headers,
        });

        if (!response) {
            throw new Error('Failed to create user');
        }

        console.log('✅ User registered successfully:', response.user.id);

        const userId = response.user.id;

        let consumer = await consumersCollection.findOne({
            $or: [
                { email: { $regex: new RegExp(`^${email}$`, 'i') } },
                { mobile: { $regex: new RegExp(`^${mobile}$`, 'i') } },
                { nidNo: { $regex: new RegExp(`^${nidNo}$`, 'i') } }
            ]
        });

        if (consumer) {
            await consumersCollection.updateOne(
                { _id: consumer._id },
                {
                    $set: {
                        userId: userId,
                        isRegistered: true,
                        registeredBy: userId,
                        registeredAt: new Date(),
                        isActive: true,
                        name: name,
                        email: email,
                        mobile: mobile,
                        nidNo: nidNo,
                        address: address || consumer.address,
                        role: 'consumer',
                        updatedAt: new Date(),
                    }
                }
            );
            console.log(`✅ Existing consumer updated with user ID: ${userId}`);
        } else {
            const newConsumer = {
                name: name,
                email: email,
                mobile: mobile,
                nidNo: nidNo,
                address: address || '',
                consumerType: consumerType || 'residential',
                feederName: feederName || '',
                meterNo: meterNo || '',
                isActive: true,
                isClaimed: false,
                claimedBy: null,
                claimedAt: null,
                isRegistered: true,
                registeredBy: userId,
                registeredAt: new Date(),
                userId: userId,
                role: 'consumer',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await consumersCollection.insertOne(newConsumer);
            console.log(`✅ New consumer created for user: ${userId}`);
        }

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            data: response,
        });

    } catch (error: any) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Registration failed',
            error: error.message,
        });
    }
});

// =====================================================
// 4. CHANGE PASSWORD
// =====================================================

app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { currentPassword, newPassword } = req.body;

        console.log('📝 Change password request received');

        let session;
        try {
            session = await auth.api.getSession({
                headers: req.headers,
            });
        } catch (sessionError) {
            console.error('❌ Session error:', sessionError);
        }

        if (!session || !session.user) {
            const cookieHeader = req.headers.cookie;
            if (cookieHeader) {
                const cookies = cookieHeader.split(';').reduce((acc: any, cookie) => {
                    const [key, value] = cookie.trim().split('=');
                    acc[key] = value;
                    return acc;
                }, {});

                const sessionToken = cookies['better-auth.session'];
                if (sessionToken) {
                    try {
                        const parts = sessionToken.split('.');
                        if (parts.length === 3) {
                            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                            if (payload.user && payload.user.id) {
                                session = { user: payload.user };
                            }
                        }
                    } catch (decodeError) {
                        console.error('❌ Decode error:', decodeError);
                    }
                }
            }
        }

        if (!session || !session.user) {
            console.log('❌ No session found');
            return res.status(401).json({
                success: false,
                message: 'Unauthorized. Please login again.',
            });
        }

        const userId = session.user.id;
        console.log(`👤 User ID: ${userId}`);

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required',
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 8 characters',
            });
        }

        const query = createIdQuery(userId);

        const user = await userCollection.findOne(query);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        console.log('🔐 Verifying current password...');

        const bcrypt = require('bcryptjs');
        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect',
            });
        }

        console.log('✅ Password verified, hashing new password...');

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await userCollection.updateOne(
            query,
            {
                $set: {
                    password: hashedPassword,
                    updatedAt: new Date(),
                },
            }
        );

        console.log('✅ Password updated successfully');

        res.json({
            success: true,
            message: 'Password updated successfully',
        });
    } catch (error) {
        console.error('❌ Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =====================================================
// 5. COMPLAINT ROUTES
// =====================================================

app.post('/api/complaints', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');

        const {
            meterNo,
            subject,
            category,
            description,
            priority,
            feederName,
            transformerNo,
            contactNumber,
            address,
            consumerId,
            consumerName,
        } = req.body;

        if (!meterNo || !subject || !category || !description || !feederName ||
            !transformerNo || !contactNumber || !address) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be filled',
            });
        }

        let complaintId = generateComplaintId();
        let existing = await complaintsCollection.findOne({ complaintId });
        while (existing) {
            complaintId = generateComplaintId();
            existing = await complaintsCollection.findOne({ complaintId });
        }

        const newComplaint = {
            complaintId,
            meterNo,
            subject,
            category,
            description,
            priority: priority || 'medium',
            status: 'pending',
            feederName,
            transformerNo,
            contactNumber,
            address,
            consumerId: consumerId || 'unknown',
            consumerName: consumerName || 'Unknown Consumer',
            assignedTo: null,
            resolvedAt: null,
            remarks: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await complaintsCollection.insertOne(newComplaint);

        res.status(201).json({
            success: true,
            message: 'Complaint submitted successfully',
            data: {
                ...newComplaint,
                _id: result.insertedId,
            },
        });

    } catch (error) {
        console.error('Create complaint error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit complaint',
        });
    }
});

app.get('/api/complaints/consumer/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');
        const { consumerId } = req.params;

        const complaints = await complaintsCollection
            .find({ consumerId })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            data: complaints,
        });
    } catch (error) {
        console.error('Get complaints error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch complaints',
        });
    }
});

app.get('/api/complaints/meter/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');
        const { meterNo } = req.params;

        const complaints = await complaintsCollection
            .find({ meterNo })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            data: complaints,
        });
    } catch (error) {
        console.error('Get complaints error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch complaints',
        });
    }
});

app.get('/api/complaints/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');
        const { status, priority, page = 1, limit = 10 } = req.query;

        const filter: any = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const skip = (Number(page) - 1) * Number(limit);

        const [complaints, total] = await Promise.all([
            complaintsCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .toArray(),
            complaintsCollection.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: complaints,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (error) {
        console.error('Get all complaints error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch complaints',
        });
    }
});

app.get('/api/complaints/:id', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');
        const { id } = req.params;

        let complaint;
        if (id.startsWith('CMP-')) {
            complaint = await complaintsCollection.findOne({ complaintId: id });
        } else {
            try {
                complaint = await complaintsCollection.findOne({ _id: new ObjectId(id) });
            } catch {
                complaint = await complaintsCollection.findOne({ complaintId: id });
            }
        }

        if (!complaint) {
            return res.status(404).json({
                success: false,
                message: 'Complaint not found',
            });
        }

        res.json({
            success: true,
            data: complaint,
        });
    } catch (error) {
        console.error('Get complaint error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch complaint',
        });
    }
});

app.patch('/api/complaints/:id/status', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');
        const { id } = req.params;
        const { status, assignedTo, remarks } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required',
            });
        }

        const updateData: any = {
            status,
            updatedAt: new Date(),
        };
        if (assignedTo) updateData.assignedTo = assignedTo;
        if (remarks) updateData.remarks = remarks;
        if (status === 'solved' || status === 'rejected') {
            updateData.resolvedAt = new Date();
        }

        const result = await complaintsCollection.updateOne(
            { complaintId: id },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Complaint not found',
            });
        }

        const updated = await complaintsCollection.findOne({ complaintId: id });

        res.json({
            success: true,
            message: `Complaint ${status}`,
            data: updated,
        });
    } catch (error) {
        console.error('Update complaint error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update complaint',
        });
    }
});

app.delete('/api/complaints/:id', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const complaintsCollection = db.collection('complaints');
        const { id } = req.params;

        const result = await complaintsCollection.deleteOne({ complaintId: id });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Complaint not found',
            });
        }

        res.json({
            success: true,
            message: 'Complaint deleted successfully',
        });
    } catch (error) {
        console.error('Delete complaint error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete complaint',
        });
    }
});

// =====================================================
// 6. CONNECTION APPLICATION ROUTES
// =====================================================

app.post('/api/connection-applications', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');

        const {
            applicantName,
            email,
            mobile,
            nidNo,
            address,
            connectionType,
            loadRequired,
            voltageLevel,
            purpose,
            feederName,
            transformerNo,
            poleNumber,
            nearestLandmark,
            tinNumber,
            tradeLicense,
            plotNumber,
            holdingNumber,
            remarks,
            consumerId,
            feeAmount,
        } = req.body;

        if (!applicantName || !email || !mobile || !nidNo || !address ||
            !connectionType || !loadRequired || !purpose || !feederName) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be filled',
            });
        }

        let applicationId = generateAppId();
        let existing = await applicationsCollection.findOne({ applicationId });
        while (existing) {
            applicationId = generateAppId();
            existing = await applicationsCollection.findOne({ applicationId });
        }

        const newApplication = {
            applicationId,
            applicantName,
            email,
            mobile,
            nidNo,
            address,
            connectionType,
            loadRequired: Number(loadRequired),
            voltageLevel: voltageLevel || '220',
            purpose,
            feederName,
            transformerNo: transformerNo || '',
            poleNumber: poleNumber || '',
            nearestLandmark: nearestLandmark || '',
            tinNumber: tinNumber || '',
            tradeLicense: tradeLicense || '',
            plotNumber: plotNumber || '',
            holdingNumber: holdingNumber || '',
            remarks: remarks || '',
            consumerId: consumerId || 'unknown',
            status: 'pending_payment',
            paymentStatus: 'pending',
            feeAmount: feeAmount || 5000,
            assignedMeterNo: null,
            implementedAt: null,
            xenRemarks: null,
            connectionWingRemarks: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await applicationsCollection.insertOne(newApplication);

        res.status(201).json({
            success: true,
            message: 'Application submitted successfully',
            data: {
                ...newApplication,
                _id: result.insertedId,
            },
        });

    } catch (error) {
        console.error('Create application error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit application',
        });
    }
});

app.get('/api/connection-applications/consumer/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const { consumerId } = req.params;

        const applications = await applicationsCollection
            .find({ consumerId })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            data: applications,
        });
    } catch (error) {
        console.error('Get applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch applications',
        });
    }
});

app.get('/api/connection-applications/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const { status, page = 1, limit = 10 } = req.query;

        const filter: any = {};
        if (status) filter.status = status;

        const skip = (Number(page) - 1) * Number(limit);

        const [applications, total] = await Promise.all([
            applicationsCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .toArray(),
            applicationsCollection.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: applications,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (error) {
        console.error('Get all applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch applications',
        });
    }
});

app.get('/api/connection-applications/:id', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const { id } = req.params;

        let application;
        if (id.startsWith('APP-')) {
            application = await applicationsCollection.findOne({ applicationId: id });
        } else {
            try {
                application = await applicationsCollection.findOne({ _id: new ObjectId(id) });
            } catch {
                application = await applicationsCollection.findOne({ applicationId: id });
            }
        }

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        res.json({
            success: true,
            data: application,
        });
    } catch (error) {
        console.error('Get application error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch application',
        });
    }
});

app.patch('/api/connection-applications/:id/status', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const { id } = req.params;
        const { status, xenRemarks } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required',
            });
        }

        const updateData: any = {
            status,
            updatedAt: new Date(),
        };
        if (xenRemarks) updateData.xenRemarks = xenRemarks;

        const result = await applicationsCollection.updateOne(
            { applicationId: id },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        const updated = await applicationsCollection.findOne({ applicationId: id });

        res.json({
            success: true,
            message: `Application ${status}`,
            data: updated,
        });
    } catch (error) {
        console.error('Update application error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update application',
        });
    }
});

app.patch('/api/connection-applications/:id/implement', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const metersCollection = db.collection('meters');
        const { id } = req.params;
        const { assignedMeterNo, connectionWingRemarks } = req.body;

        if (!assignedMeterNo) {
            return res.status(400).json({
                success: false,
                message: 'Meter number is required',
            });
        }

        const existingMeter = await metersCollection.findOne({ meterNo: assignedMeterNo });
        if (existingMeter) {
            return res.status(400).json({
                success: false,
                message: 'Meter number already exists',
            });
        }

        const result = await applicationsCollection.updateOne(
            { applicationId: id },
            {
                $set: {
                    status: 'implemented',
                    assignedMeterNo,
                    connectionWingRemarks: connectionWingRemarks || '',
                    implementedAt: new Date(),
                    updatedAt: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        await metersCollection.insertOne({
            meterNo: assignedMeterNo,
            status: 'active',
            createdAt: new Date(),
        });

        const updated = await applicationsCollection.findOne({ applicationId: id });

        res.json({
            success: true,
            message: 'Connection implemented successfully',
            data: updated,
        });
    } catch (error) {
        console.error('Implement connection error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to implement connection',
        });
    }
});

app.delete('/api/connection-applications/:id', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const { id } = req.params;

        const result = await applicationsCollection.deleteOne({ applicationId: id });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        res.json({
            success: true,
            message: 'Application deleted successfully',
        });
    } catch (error) {
        console.error('Delete application error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete application',
        });
    }
});

// =====================================================
// 7. CONNECTION WING ROUTES
// =====================================================

app.get('/api/connection-wing/applications', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');

        const applications = await applicationsCollection
            .find({})
            .sort({ updatedAt: -1 })
            .toArray();

        console.log(`📦 Connection Wing: Found ${applications.length} total applications`);

        res.json({
            success: true,
            data: applications,
        });
    } catch (error) {
        console.error('Get wing applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch applications',
        });
    }
});

app.patch('/api/connection-wing/applications/:id/status', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const { id } = req.params;
        const { status, connectionWingRemarks } = req.body;

        console.log(`🔍 Updating application ${id} to status: ${status}`);

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required',
            });
        }

        const validStatuses = ['forwarded_to_wing', 'team_sent', 'connection_completed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Allowed: forwarded_to_wing, team_sent, connection_completed',
            });
        }

        const updateData: any = {
            status,
            updatedAt: new Date(),
        };
        if (connectionWingRemarks) updateData.connectionWingRemarks = connectionWingRemarks;

        const result = await applicationsCollection.updateOne(
            { applicationId: id },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        const updated = await applicationsCollection.findOne({ applicationId: id });
        console.log(`✅ Application ${id} updated to ${status}`);

        res.json({
            success: true,
            message: `Application ${status}`,
            data: updated,
        });
    } catch (error) {
        console.error('Update wing application error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update application',
        });
    }
});

// =====================================================
// ASSIGN METER TO APPLICATION
// =====================================================
app.post('/api/connection-wing/applications/:id/assign-meter', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const metersCollection = db.collection('meters');
        const userCollection = db.collection('user');
        const { id } = req.params;
        const {
            meterNo,
            meterSerialNo,
            meterType,
            manufacturer,
            feederName,
            connectionDate,
            consumerType,
            initialReading,
            specialNote,
            consumerName,
            address,
            mobile,
            email,
            connectionWingRemarks
        } = req.body;

        console.log(`🔍 Assigning meter to application: ${id}`);
        console.log(`📦 Meter No: ${meterNo}`);

        if (!meterNo) {
            return res.status(400).json({
                success: false,
                message: 'Meter number is required',
            });
        }

        const application = await applicationsCollection.findOne({ applicationId: id });
        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        const existingMeter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (existingMeter) {
            if (!existingMeter.isClaimed) {
                await metersCollection.updateOne(
                    { meterNo },
                    {
                        $set: {
                            consumerName: consumerName || application.applicantName,
                            email: email || application.email,
                            mobile: mobile || application.mobile,
                            address: address || application.address,
                            consumerType: consumerType || application.connectionType,
                            feederName: feederName || application.feederName,
                            status: 'active',
                            isClaimed: true,
                            claimedBy: application.consumerId,
                            claimedAt: new Date(),
                            userId: application.consumerId,
                            updatedAt: new Date(),
                        }
                    }
                );
                console.log(`✅ Existing meter ${meterNo} updated and claimed`);
            } else {
                return res.status(400).json({
                    success: false,
                    message: `Meter ${meterNo} is already claimed`,
                });
            }
        } else {
            const meterData = {
                meterNo: meterNo.trim(),
                meterSerialNo: meterSerialNo || '',
                meterType: meterType || 'single_phase',
                manufacturer: manufacturer || '',
                consumerName: consumerName || application.applicantName,
                address: address || application.address,
                mobile: mobile || application.mobile,
                email: email || application.email,
                consumerType: consumerType || application.connectionType,
                feederName: feederName || application.feederName,
                transformerNo: application.transformerNo,
                status: 'active',
                initialReading: Number(initialReading) || 0,
                currentReading: Number(initialReading) || 0,
                lastReadingDate: new Date(),
                isClaimed: true,
                claimedBy: application.consumerId,
                claimedAt: new Date(),
                userId: application.consumerId,
                connectionDate: connectionDate ? new Date(connectionDate) : new Date(),
                specialNote: specialNote || '',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await metersCollection.insertOne(meterData);
            console.log(`✅ New meter ${meterNo} created and assigned`);
        }

        await applicationsCollection.updateOne(
            { applicationId: id },
            {
                $set: {
                    status: 'implemented',
                    assignedMeterNo: meterNo,
                    implementedAt: new Date(),
                    connectionWingRemarks: connectionWingRemarks || 'Meter assigned and connection completed',
                    updatedAt: new Date(),
                }
            }
        );

        if (application.consumerId && application.consumerId !== 'unknown') {
            try {
                const userQuery = createIdQuery(application.consumerId);
                const user = await userCollection.findOne(userQuery);
                if (user) {
                    let userMeters = user.meters || [];
                    if (!userMeters.includes(meterNo)) {
                        userMeters.push(meterNo);
                        await userCollection.updateOne(
                            userQuery,
                            {
                                $set: {
                                    meterNo: userMeters[0] || meterNo,
                                    meters: userMeters,
                                    updatedAt: new Date(),
                                }
                            }
                        );
                        console.log(`✅ Meter ${meterNo} added to user's list`);
                    }
                }
            } catch (userError) {
                console.log('⚠️ Could not update user, but meter was assigned:', userError);
            }
        }

        const updated = await applicationsCollection.findOne({ applicationId: id });

        res.json({
            success: true,
            message: 'Meter assigned successfully',
            data: {
                application: updated,
                meterNo: meterNo,
            },
        });

    } catch (error) {
        console.error('❌ Assign meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to assign meter',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =====================================================
// 8. METER ROUTES
// =====================================================

app.get('/api/meters/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const metersCollection = db.collection('meters');
        const userCollection = db.collection('user');
        const billsCollection = db.collection('bills');

        const meters = await metersCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        const currentMonth = new Date().toLocaleString('default', { month: 'long' });
        const currentYear = new Date().getFullYear().toString();
        const currentBillingMonth = `${currentMonth} ${currentYear}`;

        const enrichedMeters = await Promise.all(
            meters.map(async (meter) => {
                let userInfo = {
                    name: 'N/A',
                    email: 'N/A',
                    mobile: 'N/A',
                    address: 'N/A',
                    isRegistered: false,
                };

                if (meter.isClaimed && meter.claimedBy) {
                    try {
                        const query = createIdQuery(meter.claimedBy);
                        const user = await userCollection.findOne(query);
                        if (user) {
                            userInfo = {
                                name: user.name || meter.consumerName || 'N/A',
                                email: user.email || 'N/A',
                                mobile: user.mobile || 'N/A',
                                address: user.address || meter.address || 'N/A',
                                isRegistered: true,
                            };
                        }
                    } catch (error) {
                        console.error(`Error fetching user for meter ${meter.meterNo}:`, error);
                    }
                }

                let billStatus = 'pending';
                let existingBill: any = null;

                try {
                    existingBill = await billsCollection.findOne({
                        meterNo: meter.meterNo,
                        billingMonth: currentBillingMonth,
                    });

                    if (existingBill) {
                        billStatus = existingBill.status || 'generated';
                    }
                } catch (error) {
                    console.error(`Error checking bill for meter ${meter.meterNo}:`, error);
                }

                return {
                    ...meter,
                    userInfo,
                    billStatus,
                    billId: existingBill?.billId || null,
                    billAmount: existingBill?.grandTotal || existingBill?.totalAmount || null,
                };
            })
        );

        res.json({
            success: true,
            data: enrichedMeters,
            total: enrichedMeters.length,
        });

    } catch (error) {
        console.error('❌ Get all meters error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch meters',
        });
    }
});

app.get('/api/meters/check-assignment/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const { meterNo } = req.params;

        const consumersCollection = db.collection('consumers');
        const userCollection = db.collection('user');

        const consumer = await consumersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (consumer) {
            return res.json({
                success: true,
                data: {
                    isAssigned: true,
                    assignedTo: {
                        name: consumer.name || 'Unknown',
                        email: consumer.email || 'Unknown',
                        id: consumer._id.toString(),
                        type: 'consumer'
                    },
                    assignedAt: consumer.createdAt,
                    message: `Meter is assigned to consumer ${consumer.name}`
                }
            });
        }

        const user = await userCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (user) {
            return res.json({
                success: true,
                data: {
                    isAssigned: true,
                    assignedTo: {
                        name: user.name || 'Unknown',
                        email: user.email || 'Unknown',
                        id: user._id.toString(),
                        type: 'user'
                    },
                    assignedAt: user.createdAt,
                    message: `Meter is assigned to user ${user.name}`
                }
            });
        }

        return res.json({
            success: true,
            data: {
                isAssigned: false,
                message: 'Meter is available'
            }
        });

    } catch (error) {
        console.error('Check meter assignment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check meter assignment',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

app.get('/api/meters/check-availability/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const metersCollection = db.collection('meters');
        const { meterNo } = req.params;

        console.log(`🔍 Checking meter availability: ${meterNo}`);

        if (!meterNo || meterNo.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Meter number is required'
            });
        }

        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo.trim()}$`, 'i') }
        });

        if (meter) {
            console.log(`❌ Meter ${meterNo} already exists`);
            return res.json({
                success: true,
                data: {
                    exists: true,
                    isAvailable: false,
                    message: 'This meter number already exists in the system',
                    consumerName: meter.consumerName || 'Unknown',
                    claimedBy: meter.isClaimed ? meter.claimedBy || 'Already claimed' : 'Not claimed yet',
                    status: meter.status || 'unknown',
                    feederName: meter.feederName || '',
                    consumerType: meter.consumerType || 'residential',
                    meterType: meter.meterType || 'single_phase',
                    manufacturer: meter.manufacturer || '',
                }
            });
        } else {
            console.log(`✅ Meter ${meterNo} is available`);
            return res.json({
                success: true,
                data: {
                    exists: false,
                    isAvailable: true,
                    message: 'This meter number is available and can be added'
                }
            });
        }

    } catch (error) {
        console.error('Check meter availability error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check meter availability',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

app.post('/api/connection-wing/add-meter', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const {
            meterNo,
            meterSerialNo,
            meterType,
            manufacturer,
            feederName,
            connectionDate,
            consumerType,
            initialReading,
            specialNote,
            consumerName,
            address,
            mobile,
            email,
        } = req.body;

        if (!meterNo || !feederName || !connectionDate) {
            return res.status(400).json({
                success: false,
                message: 'Meter number, feeder, and connection date are required',
            });
        }

        const metersCollection = db.collection('meters');

        const existingMeter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo.trim()}$`, 'i') }
        });

        if (existingMeter) {
            return res.status(400).json({
                success: false,
                message: 'Meter number already exists',
            });
        }

        const newMeter = {
            meterNo: meterNo.trim(),
            meterSerialNo: meterSerialNo || '',
            meterType: meterType || 'single_phase',
            manufacturer: manufacturer || '',
            consumerName: consumerName || 'Pending',
            feederName: feederName,
            connectionDate: new Date(connectionDate),
            consumerType: consumerType || 'residential',
            address: address || '',
            mobile: mobile || '',
            email: email || '',
            initialReading: Number(initialReading) || 0,
            currentReading: Number(initialReading) || 0,
            status: 'pending_claim',
            isClaimed: false,
            claimedBy: null,
            claimedAt: null,
            specialNote: specialNote || '',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await metersCollection.insertOne(newMeter);

        res.status(201).json({
            success: true,
            message: 'Meter added successfully. Consumer can now claim it during registration.',
            data: {
                ...newMeter,
                _id: result.insertedId,
            },
        });

    } catch (error) {
        console.error('Add meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add meter',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

app.get('/api/meters/available', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const metersCollection = db.collection('meters');

        const meters = await metersCollection
            .find({
                isClaimed: false,
                status: 'pending_claim'
            })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            data: meters,
        });
    } catch (error) {
        console.error('Get available meters error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available meters',
        });
    }
});

app.get('/api/meters/search/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const metersCollection = db.collection('meters');
        const consumersCollection = db.collection('consumers');
        const { meterNo } = req.params;

        console.log(`🔍 Searching for meter: ${meterNo}`);

        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found in the system'
            });
        }

        if (meter.isClaimed) {
            return res.status(400).json({
                success: false,
                message: 'This meter is already claimed'
            });
        }

        const consumer = await consumersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        const responseData = {
            ...meter,
            consumerName: consumer?.name || meter.consumerName || 'Pending',
            consumerType: consumer?.consumerType || meter.consumerType || 'residential',
            address: consumer?.address || meter.address || '',
            isClaimed: meter.isClaimed || false,
        };

        console.log(`✅ Meter found: ${meterNo}`);

        res.json({
            success: true,
            data: responseData,
        });

    } catch (error) {
        console.error('Search meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search meter',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

app.get('/api/meters/check-availability-for-user/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const metersCollection = db.collection('meters');
        const consumersCollection = db.collection('consumers');
        const userCollection = db.collection('user');
        const { meterNo } = req.params;
        const userId = req.query.userId as string;

        console.log(`🔍 Checking meter availability for user: ${meterNo}, userId: ${userId}`);

        if (!meterNo) {
            return res.status(400).json({
                success: false,
                message: 'Meter number is required'
            });
        }

        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found in the system'
            });
        }

        if (meter.isClaimed) {
            if (meter.claimedBy === userId) {
                return res.json({
                    success: true,
                    data: {
                        isAvailable: false,
                        isAlreadyClaimed: true,
                        message: 'You have already claimed this meter'
                    }
                });
            }
            return res.json({
                success: true,
                data: {
                    isAvailable: false,
                    isAlreadyClaimed: false,
                    message: 'This meter is already claimed by another user'
                }
            });
        }

        const consumer = await consumersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        res.json({
            success: true,
            data: {
                isAvailable: true,
                isAlreadyClaimed: false,
                message: 'Meter is available for claiming',
                meter: {
                    ...meter,
                    consumerName: consumer?.name || meter.consumerName || 'Pending',
                    consumerType: consumer?.consumerType || meter.consumerType || 'residential',
                    address: consumer?.address || meter.address || '',
                }
            }
        });

    } catch (error) {
        console.error('Check meter availability error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check meter availability',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

app.post('/api/meters/claim', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const metersCollection = db.collection('meters');
        const userCollection = db.collection('user');
        const { meterNo, consumerId, consumerName, email, mobile } = req.body;

        if (!meterNo || !consumerId) {
            return res.status(400).json({
                success: false,
                message: 'Meter number and consumer ID are required',
            });
        }

        const meter = await metersCollection.findOne({
            meterNo,
            isClaimed: false,
            status: 'pending_claim',
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found or already claimed',
            });
        }

        const existingUser = await userCollection.findOne({ meterNo });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'This meter is already assigned to another user',
            });
        }

        await metersCollection.updateOne(
            { meterNo },
            {
                $set: {
                    isClaimed: true,
                    claimedBy: consumerId,
                    claimedAt: new Date(),
                    status: 'active',
                    consumerName: consumerName || meter.consumerName,
                    email: email || meter.email,
                    mobile: mobile || meter.mobile,
                    updatedAt: new Date(),
                },
            }
        );

        const userQuery = createIdQuery(consumerId);
        await userCollection.updateOne(
            userQuery,
            {
                $set: {
                    meterNo,
                    feederName: meter.feederName,
                    userType: 'existing_consumer',
                    isActive: true,
                    updatedAt: new Date(),
                },
            }
        );

        const updatedMeter = await metersCollection.findOne({ meterNo });

        res.json({
            success: true,
            message: 'Meter claimed successfully!',
            data: updatedMeter,
        });

    } catch (error) {
        console.error('Claim meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to claim meter',
        });
    }
});

app.post('/api/meters/claim-for-consumer', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const userCollection = db.collection('user');
        const metersCollection = db.collection('meters');
        const { meterNo, userId } = req.body;

        if (!meterNo || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Meter number and user ID are required'
            });
        }

        const consumer = await consumersCollection.findOne({ meterNo });
        if (!consumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found with this meter number'
            });
        }

        if (consumer.isClaimed) {
            return res.status(400).json({
                success: false,
                message: 'This consumer is already claimed by another user'
            });
        }

        const userQuery = createIdQuery(userId);

        const user = await userCollection.findOne(userQuery);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        let userMeters = user.meters || [];
        let claimedMeters = user.claimedMeters || [];

        if (userMeters.includes(meterNo)) {
            return res.status(400).json({
                success: false,
                message: 'You have already claimed this meter'
            });
        }

        await consumersCollection.updateOne(
            { meterNo },
            {
                $set: {
                    isClaimed: true,
                    claimedBy: userId,
                    claimedAt: new Date(),
                    isRegistered: true,
                    registeredBy: userId,
                    registeredAt: new Date(),
                    userId: userId,
                    updatedAt: new Date(),
                }
            }
        );

        userMeters.push(meterNo);
        claimedMeters.push({
            meterNo: meterNo,
            claimedAt: new Date(),
            consumerId: consumer._id.toString(),
            consumerName: consumer.name,
            isPrimary: userMeters.length === 1,
            status: 'active'
        });

        await userCollection.updateOne(
            userQuery,
            {
                $set: {
                    name: user.name || consumer.name,
                    email: user.email || consumer.email,
                    mobile: user.mobile || consumer.mobile,
                    nidNo: user.nidNo || consumer.nidNo,
                    address: user.address || consumer.address,
                    meterNo: userMeters[0] || meterNo,
                    meters: userMeters,
                    claimedMeters: claimedMeters,
                    feederName: user.feederName || consumer.feederName,
                    consumerType: user.consumerType || consumer.consumerType,
                    userType: 'existing_consumer',
                    isActive: true,
                    updatedAt: new Date(),
                }
            }
        );

        await metersCollection.updateOne(
            { meterNo },
            {
                $set: {
                    isClaimed: true,
                    claimedBy: userId,
                    claimedAt: new Date(),
                    status: 'active',
                    consumerName: consumer.name,
                    userId: userId,
                    updatedAt: new Date(),
                }
            }
        );

        const updatedConsumer = await consumersCollection.findOne({ meterNo });
        const updatedUser = await userCollection.findOne(userQuery);
        const updatedMeter = await metersCollection.findOne({ meterNo });

        res.json({
            success: true,
            message: 'Meter claimed successfully!',
            data: {
                consumer: updatedConsumer,
                user: updatedUser,
                meter: updatedMeter,
                totalMeters: userMeters.length
            }
        });

    } catch (error) {
        console.error('Claim meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to claim meter',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

app.patch('/api/user/primary-meter', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { userId, meterNo } = req.body;

        if (!userId || !meterNo) {
            return res.status(400).json({
                success: false,
                message: 'User ID and meter number are required'
            });
        }

        const query = createIdQuery(userId);

        const user = await userCollection.findOne(query);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!user.meters || !user.meters.includes(meterNo)) {
            return res.status(400).json({
                success: false,
                message: 'Meter not found in user\'s list'
            });
        }

        await userCollection.updateOne(
            query,
            {
                $set: {
                    meterNo: meterNo,
                    updatedAt: new Date()
                }
            }
        );

        const claimedMeters = user.claimedMeters.map((m: any) => ({
            ...m,
            isPrimary: m.meterNo === meterNo
        }));

        await userCollection.updateOne(
            query,
            {
                $set: {
                    claimedMeters: claimedMeters,
                    updatedAt: new Date()
                }
            }
        );

        const updatedUser = await userCollection.findOne(query);

        res.json({
            success: true,
            message: 'Primary meter updated successfully',
            data: updatedUser
        });

    } catch (error) {
        console.error('Set primary meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to set primary meter',
        });
    }
});

app.get('/api/user/meters/:userId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const metersCollection = db.collection('meters');
        const { userId } = req.params;

        const query = createIdQuery(userId);

        const user = await userCollection.findOne(query);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const meters = user.meters || [];
        const claimedMeters = user.claimedMeters || [];

        const meterDetails = await metersCollection
            .find({ meterNo: { $in: meters } })
            .toArray();

        const sortedMeters = meterDetails.sort((a, b) => {
            if (a.meterNo === user.meterNo) return -1;
            if (b.meterNo === user.meterNo) return 1;
            return 0;
        });

        res.json({
            success: true,
            data: {
                meters: sortedMeters,
                claimedMeters: claimedMeters,
                primaryMeter: user.meterNo,
                totalMeters: meters.length
            }
        });

    } catch (error) {
        console.error('Get user meters error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch meters',
        });
    }
});

app.get('/api/consumers/status/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const { meterNo } = req.params;

        const consumer = await consumersCollection.findOne({ meterNo });
        if (!consumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found'
            });
        }

        res.json({
            success: true,
            data: {
                isClaimed: consumer.isClaimed || false,
                isRegistered: consumer.isRegistered || false,
                claimedBy: consumer.claimedBy || null,
                registeredBy: consumer.registeredBy || null,
                status: consumer.isRegistered ? 'Registered' : 'Pending Registration',
            }
        });

    } catch (error) {
        console.error('Get consumer status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch consumer status',
        });
    }
});

app.get('/api/consumers/check-unique', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const userCollection = db.collection('user');
        const { field, value } = req.query;

        console.log(`🔍 Checking uniqueness: ${field} = ${value}`);

        if (!field || !value) {
            return res.status(400).json({
                success: false,
                message: 'Field and value are required'
            });
        }

        const allowedFields = ['email', 'mobile', 'nidNo'];
        if (!allowedFields.includes(field as string)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid field. Allowed: email, mobile, nidNo'
            });
        }

        const existingConsumer = await consumersCollection.findOne({
            [field as string]: { $regex: new RegExp(`^${value}$`, 'i') }
        });

        if (existingConsumer) {
            return res.json({
                success: true,
                data: {
                    exists: true,
                    message: `${field} already exists in the system`
                }
            });
        }

        const existingUser = await userCollection.findOne({
            [field as string]: { $regex: new RegExp(`^${value}$`, 'i') }
        });

        if (existingUser) {
            return res.json({
                success: true,
                data: {
                    exists: true,
                    message: `${field} already exists in the system`
                }
            });
        }

        return res.json({
            success: true,
            data: {
                exists: false,
                message: `${field} is available`
            }
        });

    } catch (error) {
        console.error('Check unique error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check uniqueness',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =====================================================
// 9. BILLING WINGS ROUTES
// =====================================================

app.get('/api/billing/bills/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const billsCollection = db.collection('bills');
        const { status, month, page = 1, limit = 10 } = req.query;

        const filter: any = {};
        if (status) filter.status = status;
        if (month) filter.billingMonth = month;

        const skip = (Number(page) - 1) * Number(limit);

        const [bills, total] = await Promise.all([
            billsCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .toArray(),
            billsCollection.countDocuments(filter),
        ]);

        console.log(`📦 Found ${bills.length} bills`);

        res.json({
            success: true,
            data: bills,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (error) {
        console.error('Get all bills error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch bills',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

app.get('/api/billing/bills/consumer/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const billsCollection = db.collection('bills');
        const { consumerId } = req.params;

        const bills = await billsCollection
            .find({ consumerId })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            data: bills,
        });
    } catch (error) {
        console.error('Get consumer bills error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch bills',
        });
    }
});

app.get('/api/billing/bills/meter/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const billsCollection = db.collection('bills');
        const { meterNo } = req.params;

        const bills = await billsCollection
            .find({ meterNo })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            data: bills,
        });
    } catch (error) {
        console.error('Get meter bills error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch bills',
        });
    }
});

app.get('/api/billing/bills/:billId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const billsCollection = db.collection('bills');
        const { billId } = req.params;

        const bill = await billsCollection.findOne({ billId });

        if (!bill) {
            return res.status(404).json({
                success: false,
                message: 'Bill not found',
            });
        }

        res.json({
            success: true,
            data: bill,
        });
    } catch (error) {
        console.error('Get bill error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch bill',
        });
    }
});

app.patch('/api/billing/bills/:billId/pay', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const billsCollection = db.collection('bills');
        const { billId } = req.params;
        const { paymentMethod } = req.body;

        const result = await billsCollection.updateOne(
            { billId },
            {
                $set: {
                    status: 'paid',
                    isPaid: true,
                    paidAt: new Date(),
                    paymentMethod: paymentMethod || 'Online',
                    updatedAt: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bill not found',
            });
        }

        const updatedBill = await billsCollection.findOne({ billId });

        res.json({
            success: true,
            message: 'Bill paid successfully',
            data: updatedBill,
        });
    } catch (error) {
        console.error('Pay bill error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to pay bill',
        });
    }
});

// =====================================================
// GENERATE BILL
// =====================================================
app.post('/api/billing/generate-bill', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const {
            meterNo,
            previousReading,
            currentReading,
            unitsConsumed,
            ratePerUnit,
            totalAmount,
            billingMonth,
            dueDate,
            unpaidAmount,
            lateFee,
            grandTotal,
        } = req.body;

        console.log('📦 Received bill generation request:', {
            meterNo,
            previousReading,
            currentReading,
            unitsConsumed,
            billingMonth,
            dueDate,
        });

        if (!meterNo) {
            return res.status(400).json({
                success: false,
                message: 'Meter number is required',
            });
        }

        if (!billingMonth) {
            return res.status(400).json({
                success: false,
                message: 'Billing month is required',
            });
        }

        if (!dueDate) {
            return res.status(400).json({
                success: false,
                message: 'Due date is required',
            });
        }

        if (previousReading === undefined || previousReading === null) {
            return res.status(400).json({
                success: false,
                message: 'Previous reading is required',
            });
        }

        if (currentReading === undefined || currentReading === null) {
            return res.status(400).json({
                success: false,
                message: 'Current reading is required',
            });
        }

        const metersCollection = db.collection('meters');
        const userCollection = db.collection('user');
        const billsCollection = db.collection('bills');

        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found',
            });
        }

        console.log(`🔍 Meter found: ${meter.meterNo}, isClaimed: ${meter.isClaimed}`);

        let consumerName: string = 'N/A';
        let consumerEmail: string = 'N/A';
        let consumerMobile: string = 'N/A';
        let consumerAddress: string = 'N/A';
        let consumerType: string = meter.consumerType || 'residential';
        let consumerId: string | null = null;
        let isRegisteredUser: boolean = false;

        if (meter.isClaimed && meter.claimedBy) {
            try {
                const query = createIdQuery(meter.claimedBy);
                const user = await userCollection.findOne(query);

                if (user) {
                    consumerName = user.name || meter.consumerName || 'N/A';
                    consumerEmail = user.email || 'N/A';
                    consumerMobile = user.mobile || 'N/A';
                    consumerAddress = user.address || meter.address || 'N/A';
                    consumerId = user._id.toString();
                    consumerType = user.consumerType || meter.consumerType || 'residential';
                    isRegisteredUser = true;
                    console.log(`✅ Meter ${meterNo} is claimed by registered user: ${consumerName}`);
                } else {
                    consumerName = meter.consumerName || 'N/A';
                    consumerEmail = meter.email || 'N/A';
                    consumerMobile = meter.mobile || 'N/A';
                    consumerAddress = meter.address || 'N/A';
                    console.log(`⚠️ Meter ${meterNo} is claimed but user not found in user collection`);
                }
            } catch (error) {
                console.error('Error fetching user:', error);
                consumerName = meter.consumerName || 'N/A';
                consumerEmail = meter.email || 'N/A';
                consumerMobile = meter.mobile || 'N/A';
                consumerAddress = meter.address || 'N/A';
            }
        } else {
            consumerName = 'N/A';
            consumerEmail = 'N/A';
            consumerMobile = 'N/A';
            consumerAddress = 'N/A';
            isRegisteredUser = false;
            console.log(`⚪ Meter ${meterNo} is not claimed. Bill will be generated with N/A.`);
        }

        const existingBill = await billsCollection.findOne({
            meterNo,
            billingMonth,
        });

        if (existingBill) {
            return res.status(400).json({
                success: false,
                message: `Bill already exists for meter ${meterNo} for ${billingMonth}`,
            });
        }

        const billId = `B-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}`;

        const newBill = {
            billId,
            meterNo,
            consumerName,
            consumerEmail,
            consumerMobile,
            consumerAddress,
            consumerType,
            consumerId,
            previousReading: Number(previousReading),
            currentReading: Number(currentReading),
            unitsConsumed: Number(unitsConsumed),
            ratePerUnit: Number(ratePerUnit),
            totalAmount: Number(totalAmount),
            unpaidAmount: Number(unpaidAmount) || 0,
            lateFee: Number(lateFee) || 0,
            grandTotal: Number(grandTotal) || Number(totalAmount),
            billingMonth,
            dueDate,
            status: 'unpaid',
            isPaid: false,
            paidAt: null,
            paymentMethod: null,
            isRegisteredUser,
            isClaimed: meter.isClaimed,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await billsCollection.insertOne(newBill);

        await metersCollection.updateOne(
            { meterNo },
            {
                $set: {
                    previousReading: Number(previousReading),
                    currentReading: Number(currentReading),
                    lastBillingMonth: billingMonth,
                    updatedAt: new Date(),
                }
            }
        );

        const savedBill = await billsCollection.findOne({ _id: result.insertedId });

        console.log(`✅ Bill ${billId} generated for meter ${meterNo}`);
        console.log(`📊 Consumer: ${consumerName} (${isRegisteredUser ? 'Registered' : meter.isClaimed ? 'Unregistered' : 'N/A'})`);
        console.log(`💰 Amount: ৳${Number(newBill.grandTotal).toLocaleString()}`);

        res.status(201).json({
            success: true,
            message: 'Bill generated successfully',
            data: savedBill,
            consumerInfo: {
                isRegisteredUser,
                isClaimed: meter.isClaimed,
                consumerName,
                consumerEmail,
                consumerMobile,
                consumerAddress,
            }
        });

    } catch (error) {
        console.error('❌ Generate bill error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate bill',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =====================================================
// 10. CONSUMER ROUTES (Billing)
// =====================================================

app.get('/api/billing/consumers/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');

        const consumers = await consumersCollection
            .find({
                role: 'consumer',
                isActive: true
            })
            .sort({ name: 1 })
            .toArray();

        console.log(`👥 Found ${consumers.length} active consumers`);

        const processedConsumers = consumers.map((consumer: any) => {
            let status = 'Pending Registration';
            if (consumer.isRegistered && consumer.isClaimed) {
                status = 'Registered & Claimed';
            } else if (consumer.isRegistered && !consumer.isClaimed) {
                status = 'Registered (Not Claimed)';
            } else if (!consumer.isRegistered && consumer.isClaimed) {
                status = 'Claimed (Not Registered)';
            } else {
                status = 'Pending Registration';
            }

            return {
                ...consumer,
                _id: consumer._id ? consumer._id.toString() : null,
                id: consumer._id ? consumer._id.toString() : null,
                isClaimed: consumer.isClaimed || false,
                isRegistered: consumer.isRegistered || false,
                hasMeter: !!(consumer.meterNo && consumer.meterNo !== ''),
                status: status,
                statusLabel: status,
                registrationStatus: consumer.isRegistered ? 'Registered' : 'Not Registered',
                meterStatus: consumer.isClaimed ? 'Claimed' : 'Not Claimed',
            };
        });

        res.json({
            success: true,
            data: processedConsumers,
        });
    } catch (error) {
        console.error('Get consumers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch consumers',
        });
    }
});

app.get('/api/billing/consumers/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const { consumerId } = req.params;

        const query = createIdQuery(consumerId);
        const consumer = await consumersCollection.findOne(query);

        if (!consumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found',
            });
        }

        res.json({
            success: true,
            data: {
                ...consumer,
                _id: consumer._id ? consumer._id.toString() : null,
                id: consumer._id ? consumer._id.toString() : null,
                status: consumer.isRegistered ? 'Registered' : 'Pending',
            },
        });
    } catch (error) {
        console.error('Get consumer error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch consumer',
        });
    }
});

app.put('/api/billing/consumers/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const { consumerId } = req.params;
        const {
            name,
            email,
            mobile,
            nidNo,
            address,
            consumerType,
            feederName,
            meterNo,
            isActive,
        } = req.body;

        const query = createIdQuery(consumerId);

        const existingConsumer = await consumersCollection.findOne(query);
        if (!existingConsumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found',
            });
        }

        const duplicateCheck = await consumersCollection.findOne({
            _id: { $ne: existingConsumer._id },
            $or: [
                { email: { $regex: new RegExp(`^${email}$`, 'i') } },
                { mobile: { $regex: new RegExp(`^${mobile}$`, 'i') } },
                { nidNo: { $regex: new RegExp(`^${nidNo}$`, 'i') } },
                { meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') } }
            ]
        });

        if (duplicateCheck) {
            let duplicateField = '';
            if (duplicateCheck.email === email) duplicateField = 'email';
            else if (duplicateCheck.mobile === mobile) duplicateField = 'mobile';
            else if (duplicateCheck.nidNo === nidNo) duplicateField = 'NID';
            else if (duplicateCheck.meterNo === meterNo) duplicateField = 'meter';

            return res.status(400).json({
                success: false,
                message: `${duplicateField} already exists for another consumer`,
            });
        }

        const updateData = {
            name: name || existingConsumer.name,
            email: email || existingConsumer.email,
            mobile: mobile || existingConsumer.mobile,
            nidNo: nidNo || existingConsumer.nidNo,
            address: address || existingConsumer.address,
            consumerType: consumerType || existingConsumer.consumerType,
            feederName: feederName || existingConsumer.feederName,
            meterNo: meterNo || existingConsumer.meterNo,
            isActive: isActive !== undefined ? isActive : existingConsumer.isActive,
            role: 'consumer',
            updatedAt: new Date(),
        };

        await consumersCollection.updateOne(query, { $set: updateData });

        const updatedConsumer = await consumersCollection.findOne(query);

        if (!updatedConsumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found after update',
            });
        }

        res.json({
            success: true,
            message: 'Consumer updated successfully',
            data: {
                ...updatedConsumer,
                _id: updatedConsumer._id ? updatedConsumer._id.toString() : null,
                id: updatedConsumer._id ? updatedConsumer._id.toString() : null,
            },
        });

    } catch (error) {
        console.error('Update consumer error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update consumer',
        });
    }
});

app.delete('/api/billing/consumers/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const billsCollection = db.collection('bills');
        const { consumerId } = req.params;

        const query = createIdQuery(consumerId);

        const consumer = await consumersCollection.findOne(query);
        if (!consumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found',
            });
        }

        const bills = await billsCollection.find({ meterNo: consumer.meterNo }).toArray();
        if (bills.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete consumer. ${bills.length} bill(s) exist for this meter.`,
            });
        }

        await consumersCollection.deleteOne(query);

        res.json({
            success: true,
            message: 'Consumer deleted successfully',
        });

    } catch (error) {
        console.error('Delete consumer error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete consumer',
        });
    }
});

app.get('/api/billing/consumers/:consumerId/summary', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const billsCollection = db.collection('bills');
        const { consumerId } = req.params;

        const query = createIdQuery(consumerId);

        const consumer = await consumersCollection.findOne(query);
        if (!consumer) {
            return res.status(404).json({
                success: false,
                message: 'Consumer not found',
            });
        }

        const bills = await billsCollection
            .find({ meterNo: consumer.meterNo })
            .sort({ createdAt: -1 })
            .toArray();

        const totalBills = bills.length;
        const totalPaid = bills.filter(b => b.isPaid).reduce((sum, b) => sum + (b.grandTotal || 0), 0);
        const totalDue = bills.filter(b => !b.isPaid).reduce((sum, b) => sum + (b.grandTotal || 0), 0);
        const lastBill = bills.length > 0 ? bills[0] : null;
        const lastPayment = bills.filter(b => b.isPaid).sort((a, b) =>
            new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()
        )[0];

        res.json({
            success: true,
            data: {
                ...consumer,
                _id: consumer._id ? consumer._id.toString() : null,
                id: consumer._id ? consumer._id.toString() : null,
                billingSummary: {
                    totalBills,
                    totalPaid,
                    totalDue,
                    lastBill,
                    lastPaymentDate: lastPayment?.paidAt || null,
                },
            },
        });
    } catch (error) {
        console.error('Get consumer summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch consumer summary',
        });
    }
});

// =====================================================
// 11. ADMIN USER MANAGEMENT ROUTES
// =====================================================

app.get('/api/admin/users', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');

        const users = await userCollection
            .find({})
            .project({ password: 0 })
            .sort({ createdAt: -1 })
            .toArray();

        console.log(`👥 Found ${users.length} users`);

        res.json({
            success: true,
            data: users,
        });
    } catch (error) {
        console.error('❌ Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
        });
    }
});

app.get('/api/admin/users/:userId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { userId } = req.params;

        const query = createIdQuery(userId);
        const user = await userCollection.findOne(query, { projection: { password: 0 } });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('❌ Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user',
        });
    }
});

app.patch('/api/admin/users/:userId/status', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { userId } = req.params;
        const { isActive } = req.body;

        if (isActive === undefined) {
            return res.status(400).json({
                success: false,
                message: 'isActive field is required',
            });
        }

        const query = createIdQuery(userId);

        const result = await userCollection.updateOne(
            query,
            {
                $set: {
                    isActive: isActive,
                    updatedAt: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const updatedUser = await userCollection.findOne(query, { projection: { password: 0 } });

        res.json({
            success: true,
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: updatedUser,
        });
    } catch (error) {
        console.error('❌ Update user status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user status',
        });
    }
});

app.patch('/api/admin/users/:userId/role', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { userId } = req.params;
        const { role } = req.body;

        if (!role) {
            return res.status(400).json({
                success: false,
                message: 'Role is required',
            });
        }

        const validRoles = ['admin', 'xen', 'connection_wing', 'complaint_manager', 'billing_wings', 'consumer', 'applicant'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Allowed: ' + validRoles.join(', '),
            });
        }

        const query = createIdQuery(userId);

        const result = await userCollection.updateOne(
            query,
            {
                $set: {
                    role: role,
                    updatedAt: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const updatedUser = await userCollection.findOne(query, { projection: { password: 0 } });

        res.json({
            success: true,
            message: `User role updated to ${role}`,
            data: updatedUser,
        });
    } catch (error) {
        console.error('❌ Update user role error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user role',
        });
    }
});

app.put('/api/admin/users/:userId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { userId } = req.params;
        const {
            name,
            email,
            mobile,
            nidNo,
            role,
            isActive,
            meterNo,
            feederName,
            address,
        } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                success: false,
                message: 'Name and email are required',
            });
        }

        const query = createIdQuery(userId);

        const existingUser = await userCollection.findOne({
            email: { $regex: new RegExp(`^${email}$`, 'i') },
            _id: { $ne: query._id },
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists for another user',
            });
        }

        const updateData: any = {
            name,
            email,
            mobile: mobile || '',
            nidNo: nidNo || '',
            role: role || 'consumer',
            isActive: isActive !== undefined ? isActive : true,
            meterNo: meterNo || '',
            feederName: feederName || '',
            address: address || '',
            updatedAt: new Date(),
        };

        const result = await userCollection.updateOne(
            query,
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const updatedUser = await userCollection.findOne(query, { projection: { password: 0 } });

        res.json({
            success: true,
            message: 'User updated successfully',
            data: updatedUser,
        });
    } catch (error) {
        console.error('❌ Update user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user',
        });
    }
});

app.delete('/api/admin/users/:userId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const consumersCollection = db.collection('consumers');
        const { userId } = req.params;

        const query = createIdQuery(userId);

        const user = await userCollection.findOne(query);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (user.role === 'admin') {
            const adminCount = await userCollection.countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete the last admin user',
                });
            }
        }

        await userCollection.deleteOne(query);

        await consumersCollection.updateMany(
            { userId: userId },
            {
                $set: {
                    userId: null,
                    isRegistered: false,
                    registeredBy: null,
                    registeredAt: null,
                    updatedAt: new Date(),
                },
            }
        );

        res.json({
            success: true,
            message: 'User deleted successfully',
        });
    } catch (error) {
        console.error('❌ Delete user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user',
        });
    }
});

app.patch('/api/admin/users/bulk', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const { userIds, isActive } = req.body;

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'User IDs array is required',
            });
        }

        const objectIds = userIds.map((id: string) => {
            try {
                return new ObjectId(id);
            } catch {
                return id as any;
            }
        });

        const result = await userCollection.updateMany(
            { _id: { $in: objectIds } },
            {
                $set: {
                    isActive: isActive,
                    updatedAt: new Date(),
                },
            }
        );

        res.json({
            success: true,
            message: `${result.modifiedCount} user(s) ${isActive ? 'activated' : 'deactivated'}`,
            data: {
                matched: result.matchedCount,
                modified: result.modifiedCount,
            },
        });
    } catch (error) {
        console.error('❌ Bulk update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to perform bulk operation',
        });
    }
});

app.delete('/api/admin/users/bulk', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const consumersCollection = db.collection('consumers');
        const { userIds } = req.body;

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'User IDs array is required',
            });
        }

        const objectIds = userIds.map((id: string) => {
            try {
                return new ObjectId(id);
            } catch {
                return id as any;
            }
        });

        const adminUsers = await userCollection.find({
            _id: { $in: objectIds },
            role: 'admin',
        }).toArray();

        if (adminUsers.length > 0) {
            const adminCount = await userCollection.countDocuments({ role: 'admin' });
            if (adminCount <= adminUsers.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete all admin users',
                });
            }
        }

        const result = await userCollection.deleteMany({
            _id: { $in: objectIds },
        });

        await consumersCollection.updateMany(
            { userId: { $in: userIds } },
            {
                $set: {
                    userId: null,
                    isRegistered: false,
                    registeredBy: null,
                    registeredAt: null,
                    updatedAt: new Date(),
                },
            }
        );

        res.json({
            success: true,
            message: `${result.deletedCount} user(s) deleted`,
            data: {
                deleted: result.deletedCount,
            },
        });
    } catch (error) {
        console.error('❌ Bulk delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete users',
        });
    }
});

app.post('/api/admin/users', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const consumersCollection = db.collection('consumers');
        const {
            name,
            email,
            mobile,
            nidNo,
            password,
            role,
            meterNo,
            feederName,
            address,
            consumerType,
        } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, and password are required',
            });
        }

        const existingUser = await userCollection.findOne({
            $or: [
                { email: { $regex: new RegExp(`^${email}$`, 'i') } },
                { mobile: { $regex: new RegExp(`^${mobile}$`, 'i') } },
            ],
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email or mobile already exists',
            });
        }

        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            name,
            email,
            mobile: mobile || '',
            nidNo: nidNo || '',
            password: hashedPassword,
            role: role || 'consumer',
            isActive: true,
            meterNo: meterNo || '',
            feederName: feederName || '',
            address: address || '',
            consumerType: consumerType || 'residential',
            meters: meterNo ? [meterNo] : [],
            claimedMeters: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await userCollection.insertOne(newUser);
        const userId = result.insertedId.toString();

        const existingConsumer = await consumersCollection.findOne({
            $or: [
                { email: { $regex: new RegExp(`^${email}$`, 'i') } },
                { mobile: { $regex: new RegExp(`^${mobile}$`, 'i') } },
            ],
        });

        if (!existingConsumer) {
            const newConsumer = {
                name,
                email,
                mobile: mobile || '',
                nidNo: nidNo || '',
                address: address || '',
                consumerType: consumerType || 'residential',
                feederName: feederName || '',
                meterNo: meterNo || '',
                isActive: true,
                isClaimed: false,
                claimedBy: null,
                claimedAt: null,
                isRegistered: true,
                registeredBy: userId,
                registeredAt: new Date(),
                userId: userId,
                role: 'consumer',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await consumersCollection.insertOne(newConsumer);
        }

        const createdUser = await userCollection.findOne(
            { _id: result.insertedId },
            { projection: { password: 0 } }
        );

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: createdUser,
        });
    } catch (error) {
        console.error('❌ Create user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user',
        });
    }
});

// =====================================================
// 12. CONSUMER BILLS
// =====================================================

app.get('/api/consumer/bills/:meterNo', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const { meterNo } = req.params;
        const bills = await db.collection('bills').find({ meterNo }).toArray();
        res.json({ success: true, data: bills });
    } catch (error) {
        console.error('Get bills error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// 13. XEN ROUTES
// =====================================================

app.get('/api/xen/applications', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applications = await db.collection('connection_applications').find({}).toArray();
        res.json({ success: true, data: applications });
    } catch (error) {
        console.error('Get applications error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// 14. TRANSACTION ROUTES
// =====================================================

app.get('/api/transactions/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const transactionsCollection = db.collection('transactions');
        const { type, status, page = 1, limit = 10 } = req.query;

        const filter: any = {};
        if (type) filter.type = type;
        if (status) filter.status = status;

        const skip = (Number(page) - 1) * Number(limit);

        const [transactions, total] = await Promise.all([
            transactionsCollection
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .toArray(),
            transactionsCollection.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: transactions,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    } catch (error) {
        console.error('Get all transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions',
        });
    }
});

app.get('/api/transactions/:id', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const transactionsCollection = db.collection('transactions');
        const { id } = req.params;

        const transaction = await transactionsCollection.findOne({ transactionId: id });
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found',
            });
        }

        res.json({
            success: true,
            data: transaction,
        });
    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction',
        });
    }
});

// =====================================================
// 15. SUBSTATION ROUTES
// =====================================================

app.get('/api/substations', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const substationsCollection = db.collection('substations');
        const substations = await substationsCollection
            .find({})
            .sort({ name: 1 })
            .toArray();

        res.json({
            success: true,
            data: substations,
        });
    } catch (error) {
        console.error('Get substations error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch substations',
        });
    }
});

app.get('/api/substations/:id', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const substationsCollection = db.collection('substations');
        const { id } = req.params;

        let substation;
        try {
            substation = await substationsCollection.findOne({ _id: new ObjectId(id) });
        } catch {
            substation = await substationsCollection.findOne({ id: id });
        }

        if (!substation) {
            return res.status(404).json({
                success: false,
                message: 'Substation not found',
            });
        }

        res.json({
            success: true,
            data: substation,
        });
    } catch (error) {
        console.error('Get substation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch substation',
        });
    }
});

// =====================================================
// 16. PAYMENT ROUTES
// =====================================================

app.post('/api/create-payment-session', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const {
            applicationId,
            billId,
            amount,
            consumerId,
            consumerName,
            email,
            description
        } = req.body;

        console.log('📦 Payment request received:', { applicationId, billId, amount, consumerId });

        if (!applicationId && !billId) {
            return res.status(400).json({
                success: false,
                message: 'Application ID or Bill ID is required',
            });
        }

        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Amount is required',
            });
        }

        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            console.error('❌ STRIPE_SECRET_KEY not found in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Payment service not configured',
            });
        }


        const stripe = new Stripe(stripeSecretKey);

        let paymentType = '';
        let paymentId = '';
        let productName = '';
        let metadata: any = {};

        if (applicationId) {
            paymentType = 'application';
            paymentId = applicationId;
            productName = `New Connection Fee - ${applicationId}`;
            metadata = { applicationId, consumerId: consumerId || 'unknown' };
        } else if (billId) {
            paymentType = 'bill';
            paymentId = billId;
            productName = `Electricity Bill - ${billId}`;
            metadata = { billId, consumerId: consumerId || 'unknown' };
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'bdt',
                        product_data: {
                            name: productName,
                            description: description || `${paymentType} payment for ${paymentId}`,
                        },
                        unit_amount: Math.round(amount * 100),
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer/payment-success?session_id={CHECKOUT_SESSION_ID}&${paymentType}_id=${paymentId}`,
            cancel_url: `${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer/payment-cancel?${paymentType}_id=${paymentId}`,
            metadata: {
                ...metadata,
                paymentType,
                consumerName: consumerName || 'Unknown',
            },
            customer_email: email || undefined,
        });

        console.log('✅ Stripe session created:', session.id);

        await db.collection('payment_sessions').insertOne({
            sessionId: session.id,
            applicationId: applicationId || null,
            billId: billId || null,
            paymentType,
            amount,
            status: 'pending',
            createdAt: new Date(),
        });

        res.json({
            success: true,
            url: session.url,
        });

    } catch (error: any) {
        console.error('❌ Stripe payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment session',
            error: error.message,
        });
    }
});

app.get('/api/payment-success', async (req: Request, res: Response) => {
    try {
        const { session_id, app_id, bill_id } = req.query;

        console.log('✅ Payment success callback:', { session_id, app_id, bill_id });

        const transactionsCollection = db.collection('transactions');

        if (app_id) {
            const applicationsCollection = db.collection('connection_applications');

            await applicationsCollection.updateOne(
                { applicationId: app_id },
                {
                    $set: {
                        status: 'payment_done',
                        paymentStatus: 'paid',
                        updatedAt: new Date(),
                    },
                }
            );

            const application = await applicationsCollection.findOne({ applicationId: app_id });
            if (application) {
                const transaction = {
                    transactionId: `TXN-${Date.now()}`,
                    type: 'connection_fee',
                    category: 'New Connection Fee',
                    amount: application.feeAmount || 5000,
                    status: 'completed',
                    paymentMethod: 'stripe',
                    consumerName: application.applicantName || 'Unknown',
                    meterNo: application.meterNo || 'N/A',
                    referenceId: app_id,
                    description: `New connection fee payment for ${app_id}`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    completedAt: new Date(),
                };
                await transactionsCollection.insertOne(transaction);
                console.log('✅ Transaction created for connection fee:', app_id);
            }

            return res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer/my-connections?payment=success`);
        }

        if (bill_id) {
            const billsCollection = db.collection('bills');

            await billsCollection.updateOne(
                { billId: bill_id },
                {
                    $set: {
                        status: 'paid',
                        isPaid: true,
                        paidAt: new Date(),
                        paymentMethod: 'Stripe',
                        updatedAt: new Date(),
                    },
                }
            );

            const bill = await billsCollection.findOne({ billId: bill_id });
            if (bill) {
                const transaction = {
                    transactionId: `TXN-${Date.now()}`,
                    type: 'bill_payment',
                    category: 'Monthly Bill Payment',
                    amount: bill.totalAmount || 0,
                    status: 'completed',
                    paymentMethod: 'stripe',
                    consumerName: bill.consumerName || 'Unknown',
                    meterNo: bill.meterNo || 'N/A',
                    referenceId: bill_id,
                    description: `Bill payment for ${bill_id} - ${bill.billingMonth || ''}`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    completedAt: new Date(),
                };
                await transactionsCollection.insertOne(transaction);
                console.log('✅ Transaction created for bill payment:', bill_id);
            }

            return res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer/my-bills?payment=success`);
        }

        res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer`);

    } catch (error) {
        console.error('Payment success error:', error);
        res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer?payment=failed`);
    }
});

app.get('/api/payment-cancel', async (req: Request, res: Response) => {
    const { app_id, bill_id } = req.query;
    console.log('❌ Payment cancelled:', { app_id, bill_id });

    if (app_id) {
        res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer/my-connections?payment=cancelled`);
    } else if (bill_id) {
        res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer/my-bills?payment=cancelled`);
    } else {
        res.redirect(`${process.env.BETTER_AUTH_URL || 'https://wzpdcl-server.vercel.app'}/dashboard/consumer`);
    }
});

app.post('/api/payment-verify', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const { sessionId, applicationId, billId } = req.body;

        console.log('🔍 Verifying payment:', { sessionId, applicationId, billId });

        if (!sessionId && !applicationId && !billId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID, Application ID, or Bill ID is required',
            });
        }

        if (applicationId) {
            const applicationsCollection = db.collection('connection_applications');
            const application = await applicationsCollection.findOne({ applicationId });

            if (application && application.status === 'payment_done') {
                return res.json({
                    success: true,
                    message: 'Payment already verified',
                    data: application,
                });
            }

            const result = await applicationsCollection.updateOne(
                { applicationId },
                {
                    $set: {
                        status: 'payment_done',
                        paymentStatus: 'paid',
                        updatedAt: new Date(),
                    },
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const updated = await applicationsCollection.findOne({ applicationId });
            return res.json({
                success: true,
                message: 'Payment verified successfully',
                data: updated,
            });
        }

        if (billId) {
            const billsCollection = db.collection('bills');
            const bill = await billsCollection.findOne({ billId });

            if (bill && bill.status === 'paid') {
                return res.json({
                    success: true,
                    message: 'Payment already verified',
                    data: bill,
                });
            }

            const result = await billsCollection.updateOne(
                { billId },
                {
                    $set: {
                        status: 'paid',
                        isPaid: true,
                        paidAt: new Date(),
                        paymentMethod: 'Stripe',
                        updatedAt: new Date(),
                    },
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Bill not found',
                });
            }

            const updated = await billsCollection.findOne({ billId });
            return res.json({
                success: true,
                message: 'Payment verified successfully',
                data: updated,
            });
        }

        if (sessionId) {
            const paymentSessionsCollection = db.collection('payment_sessions');
            const paymentSession = await paymentSessionsCollection.findOne({ sessionId });

            if (paymentSession) {
                if (paymentSession.applicationId) {
                    const applicationsCollection = db.collection('connection_applications');
                    await applicationsCollection.updateOne(
                        { applicationId: paymentSession.applicationId },
                        {
                            $set: {
                                status: 'payment_done',
                                paymentStatus: 'paid',
                                updatedAt: new Date(),
                            },
                        }
                    );
                    const updated = await applicationsCollection.findOne({
                        applicationId: paymentSession.applicationId
                    });
                    return res.json({
                        success: true,
                        message: 'Payment verified successfully',
                        data: updated,
                    });
                } else if (paymentSession.billId) {
                    const billsCollection = db.collection('bills');
                    await billsCollection.updateOne(
                        { billId: paymentSession.billId },
                        {
                            $set: {
                                status: 'paid',
                                isPaid: true,
                                paidAt: new Date(),
                                paymentMethod: 'Stripe',
                                updatedAt: new Date(),
                            },
                        }
                    );
                    const updated = await billsCollection.findOne({
                        billId: paymentSession.billId
                    });
                    return res.json({
                        success: true,
                        message: 'Payment verified successfully',
                        data: updated,
                    });
                }
            }

            await paymentSessionsCollection.updateOne(
                { sessionId },
                {
                    $set: {
                        status: 'completed',
                        completedAt: new Date(),
                    },
                }
            );
        }

        return res.status(404).json({
            success: false,
            message: 'Payment not found',
        });

    } catch (error: any) {
        console.error('❌ Payment verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify payment',
            error: error.message,
        });
    }
});

// =====================================================
// 17. 404 HANDLER
// =====================================================
app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// =====================================================
// 18. ERROR HANDLER
// =====================================================
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('❌ Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// =====================================================
// ✅ VERCEL EXPORT - This is required for Vercel deployment
// =====================================================
export default app;

// =====================================================
// ✅ LOCAL DEVELOPMENT SERVER - Only runs in development
// =====================================================
if (process.env.NODE_ENV !== 'production') {
    const startServer = async () => {
        try {
            await connectDB();
            console.log('✅ Database ready');
            await initializeCollections();
            await initAuth();

            app.listen(PORT, () => {
                console.log(`\n🚀 Server running at http://localhost:${PORT}`);
                console.log(`📁 Database: ${DB_NAME}`);
                console.log(`📡 Health: http://localhost:${PORT}/api/health`);
                console.log(`🔐 Better Auth: http://localhost:${PORT}/api/auth`);
                console.log(`\n📋 Routes:`);
                console.log(`  📌 Auth - POST /api/auth/sign-up/email`);
                console.log(`  📌 Auth - POST /api/auth/change-password`);
                console.log(`  📌 Complaints - CRUD operations`);
                console.log(`  📌 Applications - CRUD operations`);
                console.log(`  📌 Connection Wing - Applications management`);
                console.log(`  📌 Meters - CRUD and availability checks`);
                console.log(`  📌 Billing - Bills and consumers management`);
                console.log(`  📌 Admin - User management with roles`);
                console.log(`  📌 Transactions - List and view`);
                console.log(`  📌 Substations - List and view`);
                console.log(`  📌 Payment - Stripe integration`);
                console.log(`\n✅ Server started successfully!\n`);
            });
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    };

    startServer();
}

export { app, connectDB, getDB };