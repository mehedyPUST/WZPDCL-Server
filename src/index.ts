// src/index.ts - Complete Backend with all routes
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { toNodeHandler } from 'better-auth/node';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';

dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'WZPDCL-Database';
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'your-secret-key-min-32-characters-long!';
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';

// =====================================================
// MONGODB CONNECTION
// =====================================================
let client: MongoClient;
let db: Db;

const connectDB = async (): Promise<Db> => {
    if (db) return db;

    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ MongoDB Connected successfully');

    db = client.db(DB_NAME);
    console.log(`📁 Using database: ${DB_NAME}`);
    return db;
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

// Generate Complaint ID
const generateComplaintId = (): string => {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `CMP-${year}-${random}`;
};

// Generate Application ID
const generateAppId = (): string => {
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `APP-${year}-${random}`;
};

// =====================================================
// EXPRESS APP
// =====================================================
const app: Application = express();

app.use(
    cors({
        origin: ['http://localhost:3000', 'http://localhost:3001', true],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// MIDDLEWARE: Auth
// =====================================================
const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
        // @ts-ignore
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

// =====================================================
// BETTER AUTH SETUP
// =====================================================
let authHandler: any = null;

const initAuth = async () => {
    if (authHandler) return authHandler;

    try {
        await connectDB();
        console.log('📦 Initializing Better Auth...');

        const auth = betterAuth({
            secret: BETTER_AUTH_SECRET,
            baseURL: BETTER_AUTH_URL,
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
                    userType: {
                        type: 'string',
                        enum: ['existing_consumer', 'applicant_new_connection'],
                        required: false,
                    },
                    feederName: { type: 'string', required: false },
                    meterNo: { type: 'string', required: false },
                    profileImage: { type: 'string', required: false },
                    role: {
                        type: 'string',
                        enum: ['consumer', 'applicant', 'admin', 'xen', 'connection_wing', 'complaint_manager', 'billing_wings'],
                        default: 'consumer',
                    },
                    isActive: { type: 'boolean', default: true },
                },
            },
            trustedOrigins: ['http://localhost:3000', 'http://localhost:5000'],
            advanced: {
                cookiePrefix: 'wzpdcl',
                disableCSRF: true,
            },
        });

        authHandler = toNodeHandler(auth);
        console.log('✅ Better Auth initialized successfully');
        return authHandler;
    } catch (error) {
        console.error('❌ Better Auth initialization failed:', error);
        throw error;
    }
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
// 3. COMPLAINT ROUTES
// =====================================================

// 3.1 Create Complaint
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

// 3.2 Get Consumer Complaints
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

// 3.3 Get Complaints by Meter
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

// 3.4 Get All Complaints
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

// 3.5 Get Single Complaint
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


// =====================================================
// STRIPE PAYMENT ROUTES
// =====================================================

// ✅ Create Payment Session
// =====================================================
// STRIPE PAYMENT ROUTES
// =====================================================

// ✅ Create Payment Session
app.post('/api/create-payment-session', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const { applicationId, amount, consumerId, consumerName, email, description } = req.body;

        console.log('📦 Payment request received:', { applicationId, amount, consumerId });

        if (!applicationId || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Application ID and amount are required',
            });
        }

        // Check if application exists
        const applicationsCollection = db.collection('connection_applications');
        const application = await applicationsCollection.findOne({ applicationId });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        // ✅ Check if Stripe secret key exists
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            console.error('❌ STRIPE_SECRET_KEY not found in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Payment service not configured',
            });
        }

        // ✅ Initialize Stripe
        const stripe = require('stripe')(stripeSecretKey);

        // ✅ Create checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'bdt',
                        product_data: {
                            name: `New Connection Fee - ${applicationId}`,
                            description: description || `New connection application fee for ${applicationId}`,
                        },
                        unit_amount: Math.round(amount * 100), // Stripe uses paisa/cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/payment-success?session_id={CHECKOUT_SESSION_ID}&app_id=${applicationId}`,
            cancel_url: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/payment-cancel?app_id=${applicationId}`,
            metadata: {
                applicationId,
                consumerId: consumerId || 'unknown',
                consumerName: consumerName || 'Unknown',
            },
            customer_email: email || undefined,
        });

        console.log('✅ Stripe session created:', session.id);

        // Store payment session in database
        await db.collection('payment_sessions').insertOne({
            sessionId: session.id,
            applicationId,
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

// ✅ Payment Success Callback (for frontend)
app.get('/api/payment-success', async (req: Request, res: Response) => {
    try {
        const { session_id, app_id } = req.query;

        console.log('✅ Payment success callback:', { session_id, app_id });

        // Update application status
        if (app_id) {
            await db.collection('connection_applications').updateOne(
                { applicationId: app_id },
                {
                    $set: {
                        status: 'payment_done',
                        paymentStatus: 'paid',
                        updatedAt: new Date(),
                    },
                }
            );
        }

        // Redirect to my-connections page
        res.redirect(`${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/my-connections?payment=success`);

    } catch (error) {
        console.error('Payment success error:', error);
        res.redirect(`${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/my-connections?payment=failed`);
    }
});

// ✅ Payment Cancel Callback
app.get('/api/payment-cancel', async (req: Request, res: Response) => {
    const { app_id } = req.query;
    console.log('❌ Payment cancelled:', { app_id });
    res.redirect(`${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/my-connections?payment=cancelled`);
});



// =====================================================
// PAYMENT VERIFICATION ROUTE
// =====================================================

// ✅ Payment Verification Route
app.post('/api/payment-verify', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const { sessionId, applicationId } = req.body;

        console.log('🔍 Verifying payment:', { sessionId, applicationId });

        if (!sessionId && !applicationId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID or Application ID is required',
            });
        }

        const applicationsCollection = db.collection('connection_applications');

        // Check if application exists and already paid
        const application = await applicationsCollection.findOne({ applicationId });

        if (application && application.status === 'payment_done') {
            return res.json({
                success: true,
                message: 'Payment already verified',
                data: application,
            });
        }

        // Update application to payment_done
        if (applicationId) {
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

        // If we have sessionId but no applicationId
        if (sessionId) {
            // Check payment_sessions collection
            const paymentSessionsCollection = db.collection('payment_sessions');
            const paymentSession = await paymentSessionsCollection.findOne({ sessionId });

            if (paymentSession && paymentSession.applicationId) {
                // Update the application
                const result = await applicationsCollection.updateOne(
                    { applicationId: paymentSession.applicationId },
                    {
                        $set: {
                            status: 'payment_done',
                            paymentStatus: 'paid',
                            updatedAt: new Date(),
                        },
                    }
                );

                if (result.matchedCount > 0) {
                    const updated = await applicationsCollection.findOne({
                        applicationId: paymentSession.applicationId
                    });
                    return res.json({
                        success: true,
                        message: 'Payment verified successfully',
                        data: updated,
                    });
                }
            }

            // Update payment session status
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

// ✅ Stripe Webhook (to confirm payment)


// 3.6 Update Complaint Status
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

// 3.7 Delete Complaint
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
// 4. CONNECTION APPLICATION ROUTES
// =====================================================

// 4.1 Create New Connection Application
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

// 4.2 Get Consumer Applications
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

// 4.3 Get All Applications
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

// 4.4 Get Single Application
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

// 4.5 Update Application Status (XEN)
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

// 4.6 Implement Connection (Connection Wing)
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

// 4.7 Delete Application
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
// 5. ADMIN ROUTES
// =====================================================
app.get('/api/admin/users', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// 6. CONSUMER ROUTES
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
// 7. XEN ROUTES
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
// 8. 404 HANDLER
// =====================================================
app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// =====================================================
// 9. ERROR HANDLER
// =====================================================
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('❌ Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// =====================================================
// START SERVER
// =====================================================
const startServer = async () => {
    try {
        await connectDB();
        console.log('✅ Database ready');
        await initAuth();

        app.listen(PORT, () => {
            console.log(`\n🚀 Server running at http://localhost:${PORT}`);
            console.log(`📁 Database: ${DB_NAME}`);
            console.log(`📡 Health: http://localhost:${PORT}/api/health`);
            console.log(`🔐 Better Auth: http://localhost:${PORT}/api/auth`);
            console.log(`\n📋 Complaint Routes:`);
            console.log(`  POST /api/complaints - Create complaint`);
            console.log(`  GET /api/complaints/all - All complaints`);
            console.log(`  GET /api/complaints/consumer/:id - Consumer complaints`);
            console.log(`  GET /api/complaints/meter/:meterNo - Complaints by meter`);
            console.log(`  GET /api/complaints/:id - Single complaint`);
            console.log(`  PATCH /api/complaints/:id/status - Update status`);
            console.log(`  DELETE /api/complaints/:id - Delete complaint`);
            console.log(`\n📋 Connection Application Routes:`);
            console.log(`  POST /api/connection-applications - Create application`);
            console.log(`  GET /api/connection-applications/all - All applications`);
            console.log(`  GET /api/connection-applications/consumer/:id - Consumer applications`);
            console.log(`  GET /api/connection-applications/:id - Single application`);
            console.log(`  PATCH /api/connection-applications/:id/status - Update status`);
            console.log(`  PATCH /api/connection-applications/:id/implement - Implement connection`);
            console.log(`  DELETE /api/connection-applications/:id - Delete application\n`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

export { app, connectDB, getDB };