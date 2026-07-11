// src/index.ts - Complete Backend with all routes
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { toNodeHandler } from 'better-auth/node';
import bcrypt from 'bcryptjs';

dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;

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

    const collections = await db.listCollections().toArray();
    console.log('📂 Available collections:', collections.map(c => c.name));

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
// BETTER AUTH SETUP
// =====================================================
let auth: any = null;
let authHandler: any = null;

const initAuth = async () => {
    if (authHandler) return authHandler;

    try {
        await connectDB();
        console.log('📦 Initializing Better Auth...');

        auth = betterAuth({
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
                    meters: { type: 'array', required: false },
                    claimedMeters: { type: 'array', required: false },
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
// 3. COMPLAINT ROUTES
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
// 4. CONNECTION APPLICATION ROUTES
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
// 5. CONNECTION WING ROUTES
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

app.post('/api/connection-wing/applications/:id/assign-meter', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const applicationsCollection = db.collection('connection_applications');
        const metersCollection = db.collection('meters');
        const userCollection = db.collection('user');
        const { id } = req.params;
        const { meterNo, initialReading, connectionWingRemarks } = req.body;

        console.log(`🔍 Assigning meter to application: ${id}`);
        console.log(`📦 Meter No: ${meterNo}, Initial Reading: ${initialReading}`);

        if (!meterNo) {
            return res.status(400).json({
                success: false,
                message: 'Meter number is required',
            });
        }

        if (initialReading === undefined || initialReading === null) {
            return res.status(400).json({
                success: false,
                message: 'Initial meter reading is required',
            });
        }

        const application = await applicationsCollection.findOne({ applicationId: id });
        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found',
            });
        }

        const existingMeter = await metersCollection.findOne({ meterNo });
        if (existingMeter) {
            return res.status(400).json({
                success: false,
                message: 'Meter number already exists',
            });
        }

        const meterData = {
            meterNo,
            consumerName: application.applicantName,
            address: application.address,
            mobile: application.mobile,
            email: application.email,
            consumerType: application.connectionType,
            status: 'active',
            initialReading: Number(initialReading),
            currentReading: Number(initialReading),
            lastReadingDate: new Date(),
            feederName: application.feederName,
            transformerNo: application.transformerNo,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await metersCollection.insertOne(meterData);
        console.log(`✅ Meter ${meterNo} created`);

        const updateData = {
            status: 'implemented',
            assignedMeterNo: meterNo,
            implementedAt: new Date(),
            connectionWingRemarks: connectionWingRemarks || 'Meter assigned and connection completed',
            updatedAt: new Date(),
        };

        await applicationsCollection.updateOne(
            { applicationId: id },
            { $set: updateData }
        );
        console.log(`✅ Application ${id} marked as implemented`);

        if (application.consumerId && application.consumerId !== 'unknown') {
            try {
                await userCollection.updateOne(
                    { _id: new ObjectId(application.consumerId) },
                    {
                        $set: {
                            meterNo: meterNo,
                            feederName: application.feederName,
                        }
                    }
                );
                console.log(`✅ User ${application.consumerId} updated with meter ${meterNo}`);
            } catch (userError) {
                console.log('⚠️ Could not update user, but meter was assigned:', userError);
            }
        }

        const updated = await applicationsCollection.findOne({ applicationId: id });

        res.json({
            success: true,
            message: 'Meter assigned and connection completed successfully',
            data: {
                application: updated,
                meter: meterData,
            },
        });
    } catch (error) {
        console.error('Assign meter error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to assign meter',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =====================================================
// 6. METER ROUTES
// =====================================================

// ✅ CHECK METER ASSIGNMENT
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

// ✅ CHECK METER AVAILABILITY
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

// ✅ ADD METER
app.post('/api/connection-wing/add-meter', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const {
            meterNo,
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

        // ✅ First check in meters collection
        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found in the system'
            });
        }

        // ✅ Check if meter is already claimed
        if (meter.isClaimed) {
            return res.status(400).json({
                success: false,
                message: 'This meter is already claimed'
            });
        }

        // ✅ Check if there's a consumer associated with this meter
        const consumer = await consumersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        // ✅ Return meter with consumer info if available
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

        // ✅ Check in meters collection
        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found in the system'
            });
        }

        // ✅ Check if meter is already claimed
        if (meter.isClaimed) {
            // ✅ Check if claimed by this user
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

        // ✅ Check if there's a consumer associated
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

        await userCollection.updateOne(
            { _id: new ObjectId(consumerId) },
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

// ✅ CLAIM METER FOR CONSUMER - UPDATED with multiple meters support
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

        // ✅ Find the consumer
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

        // ✅ Find the user
        let userQuery;
        try {
            userQuery = { _id: new ObjectId(userId) };
        } catch {
            userQuery = { _id: userId };
        }

        const user = await userCollection.findOne(userQuery);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // ✅ Get user's existing meters
        let userMeters = user.meters || [];
        let claimedMeters = user.claimedMeters || [];

        // ✅ Check if meter already claimed by this user
        if (userMeters.includes(meterNo)) {
            return res.status(400).json({
                success: false,
                message: 'You have already claimed this meter'
            });
        }

        // ✅ Update consumer - mark as claimed
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

        // ✅ Add meter to user's meter list
        userMeters.push(meterNo);
        claimedMeters.push({
            meterNo: meterNo,
            claimedAt: new Date(),
            consumerId: consumer._id.toString(),
            consumerName: consumer.name,
            isPrimary: userMeters.length === 1, // First meter is primary
            status: 'active'
        });

        // ✅ Update user - keep existing data, add new meter
        await userCollection.updateOne(
            userQuery,
            {
                $set: {
                    // ✅ Only update name/email if first time (keep existing data)
                    name: user.name || consumer.name,
                    email: user.email || consumer.email,
                    mobile: user.mobile || consumer.mobile,
                    nidNo: user.nidNo || consumer.nidNo,
                    address: user.address || consumer.address,
                    meterNo: userMeters[0] || meterNo, // Keep first meter as primary
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

        // ✅ Update meter - mark as claimed
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

        let query;
        try {
            query = { _id: new ObjectId(userId) };
        } catch {
            query = { _id: userId };
        }

        const user = await userCollection.findOne(query);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // ✅ Check if meter belongs to user
        if (!user.meters || !user.meters.includes(meterNo)) {
            return res.status(400).json({
                success: false,
                message: 'Meter not found in user\'s list'
            });
        }

        // ✅ Update primary meter
        await userCollection.updateOne(
            query,
            {
                $set: {
                    meterNo: meterNo,
                    updatedAt: new Date()
                }
            }
        );

        // ✅ Update claimedMeters isPrimary flag
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

// ✅ GET USER'S ALL METERS
app.get('/api/user/meters/:userId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const userCollection = db.collection('user');
        const metersCollection = db.collection('meters');
        const { userId } = req.params;

        let query;
        try {
            query = { _id: new ObjectId(userId) };
        } catch {
            query = { _id: userId };
        }

        const user = await userCollection.findOne(query);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const meters = user.meters || [];
        const claimedMeters = user.claimedMeters || [];

        // ✅ Get full meter details
        const meterDetails = await metersCollection
            .find({ meterNo: { $in: meters } })
            .toArray();

        // ✅ Sort meters with primary first
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

// ✅ GET CONSUMER STATUS
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

// ✅ CHECK UNIQUE FIELD
app.get('/api/consumers/check-unique', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const userCollection = db.collection('user');
        const { field, value } = req.query;

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
// 7. BILLING WINGS ROUTES
// =====================================================

// ✅ GET ALL BILLS
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

// ✅ GET BILLS BY CONSUMER
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

// ✅ GET BILLS BY METER
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

// ✅ GET SINGLE BILL
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

// ✅ PAY BILL
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

// ✅ GENERATE BILL
app.post('/api/billing/generate-bill', async (req: Request, res: Response) => {
    try {
        await connectDB();

        const {
            meterNo,
            consumerName,
            consumerType,
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
            consumerId,
        } = req.body;

        if (!meterNo || !consumerName || !previousReading || !currentReading || !billingMonth || !dueDate) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be filled',
            });
        }

        const billsCollection = db.collection('bills');

        const existingBill = await billsCollection.findOne({
            meterNo,
            billingMonth,
        });

        if (existingBill) {
            return res.status(400).json({
                success: false,
                message: 'Bill already exists for this meter and month',
            });
        }

        const billId = `B-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}`;

        const newBill = {
            billId,
            meterNo,
            consumerName,
            consumerType,
            previousReading: Number(previousReading),
            currentReading: Number(currentReading),
            unitsConsumed: Number(unitsConsumed),
            ratePerUnit: Number(ratePerUnit),
            totalAmount: Number(totalAmount),
            billingMonth,
            dueDate,
            unpaidAmount: Number(unpaidAmount) || 0,
            lateFee: Number(lateFee) || 0,
            grandTotal: Number(grandTotal) || Number(totalAmount),
            status: 'unpaid',
            consumerId: consumerId || 'unknown',
            isPaid: false,
            paidAt: null,
            paymentMethod: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await billsCollection.insertOne(newBill);

        if (consumerId && consumerId !== 'unknown') {
            try {
                const userCollection = db.collection('user');
                let query;
                try {
                    query = { _id: new ObjectId(consumerId) };
                } catch {
                    query = { _id: consumerId };
                }

                const userExists = await userCollection.findOne(query);
                if (userExists) {
                    await userCollection.updateOne(
                        query,
                        {
                            $set: {
                                lastBillingMonth: billingMonth,
                                lastReading: Number(currentReading),
                                updatedAt: new Date(),
                            },
                        }
                    );
                }
            } catch (updateError) {
                console.log('⚠️ Could not update user, but bill was created:', updateError);
            }
        }

        try {
            const metersCollection = db.collection('meters');
            const meterExists = await metersCollection.findOne({ meterNo });
            if (meterExists) {
                await metersCollection.updateOne(
                    { meterNo },
                    {
                        $set: {
                            previousReading: Number(previousReading),
                            currentReading: Number(currentReading),
                            lastBillingMonth: billingMonth,
                            updatedAt: new Date(),
                        },
                    }
                );
            }
        } catch (meterError) {
            console.log('⚠️ Could not update meter, but bill was created:', meterError);
        }

        const savedBill = await billsCollection.findOne({ _id: result.insertedId });

        res.status(201).json({
            success: true,
            message: 'Bill generated successfully',
            data: savedBill,
        });

    } catch (error) {
        console.error('Generate bill error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate bill',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// =====================================================
// 8. CONSUMER ROUTES (Billing)
// =====================================================

// ✅ GET ALL CONSUMERS
app.get('/api/billing/consumers/all', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');

        const consumers = await consumersCollection
            .find({})
            .sort({ name: 1 })
            .toArray();

        console.log(`👥 Found ${consumers.length} consumers`);

        const processedConsumers = consumers.map((consumer: any) => ({
            ...consumer,
            _id: consumer._id ? consumer._id.toString() : null,
            id: consumer._id ? consumer._id.toString() : null,
            isClaimed: consumer.isClaimed || false,
            isRegistered: consumer.isRegistered || false,
            status: consumer.isRegistered ? 'Registered' : 'Pending',
        }));

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

// ✅ GET SINGLE CONSUMER
app.get('/api/billing/consumers/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const { consumerId } = req.params;

        let query;
        try {
            query = { _id: new ObjectId(consumerId) };
        } catch {
            query = { _id: consumerId };
        }

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

// ✅ ADD CONSUMER (No user creation)
app.post('/api/connection-wing/add-consumer', async (req: Request, res: Response) => {
    try {
        await connectDB();

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

        if (!name || !email || !mobile || !nidNo || !address || !meterNo) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, mobile, NID, address, and meter number are required',
            });
        }

        const consumersCollection = db.collection('consumers');
        const metersCollection = db.collection('meters');

        // ✅ Check for duplicates
        const existingConsumer = await consumersCollection.findOne({
            $or: [
                { email: { $regex: new RegExp(`^${email}$`, 'i') } },
                { mobile: { $regex: new RegExp(`^${mobile}$`, 'i') } },
                { nidNo: { $regex: new RegExp(`^${nidNo}$`, 'i') } },
                { meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') } }
            ]
        });

        if (existingConsumer) {
            let duplicateField = '';
            if (existingConsumer.email === email) duplicateField = 'email';
            else if (existingConsumer.mobile === mobile) duplicateField = 'mobile';
            else if (existingConsumer.nidNo === nidNo) duplicateField = 'NID';
            else if (existingConsumer.meterNo === meterNo) duplicateField = 'meter';

            return res.status(400).json({
                success: false,
                message: `${duplicateField} already exists in the system`,
            });
        }

        // ✅ Check if meter exists
        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found. Please add the meter first.',
            });
        }

        if (meter.isClaimed) {
            return res.status(400).json({
                success: false,
                message: 'This meter is already claimed by another consumer',
            });
        }

        const newConsumer = {
            name,
            email,
            mobile,
            nidNo,
            address,
            consumerType: consumerType || 'residential',
            feederName: feederName || meter.feederName || '',
            meterNo: meterNo,
            isActive: isActive !== undefined ? isActive : true,
            isClaimed: false,
            claimedBy: null,
            claimedAt: null,
            isRegistered: false,
            registeredBy: null,
            registeredAt: null,
            userId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await consumersCollection.insertOne(newConsumer);

        res.status(201).json({
            success: true,
            message: 'Consumer added successfully. They can claim this meter after registration.',
            data: {
                ...newConsumer,
                _id: result.insertedId,
                id: result.insertedId.toString(),
            },
        });

    } catch (error) {
        console.error('Add consumer error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add consumer',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// ✅ UPDATE CONSUMER
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

        let query;
        try {
            query = { _id: new ObjectId(consumerId) };
        } catch {
            query = { _id: consumerId };
        }

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
            updatedAt: new Date(),
        };

        await consumersCollection.updateOne(query, { $set: updateData });

        const updatedConsumer = await consumersCollection.findOne(query);

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

// ✅ DELETE CONSUMER
app.delete('/api/billing/consumers/:consumerId', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const billsCollection = db.collection('bills');
        const { consumerId } = req.params;

        let query;
        try {
            query = { _id: new ObjectId(consumerId) };
        } catch {
            query = { _id: consumerId };
        }

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

// ✅ GET CONSUMER SUMMARY
app.get('/api/billing/consumers/:consumerId/summary', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const consumersCollection = db.collection('consumers');
        const billsCollection = db.collection('bills');
        const { consumerId } = req.params;

        let query;
        try {
            query = { _id: new ObjectId(consumerId) };
        } catch {
            query = { _id: consumerId };
        }

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
// 9. ADMIN ROUTES
// =====================================================
app.get('/api/admin/users', async (req: Request, res: Response) => {
    try {
        await connectDB();
        const users = await db.collection('user').find({}).project({ password: 0 }).toArray();
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// 10. CONSUMER ROUTES
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
// 11. XEN ROUTES
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
// 12. TRANSACTION ROUTES
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
// 13. SUBSTATION ROUTES
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
// 14. PAYMENT ROUTES
// =====================================================

// backend/src/index.ts - আপডেটেড create-payment-session রাউট

// ✅ CREATE PAYMENT SESSION - Supports both Bill and Application
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

        // ✅ Check if either applicationId or billId is provided
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

        const stripe = require('stripe')(stripeSecretKey);

        // ✅ Determine payment type
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
            success_url: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/payment-success?session_id={CHECKOUT_SESSION_ID}&${paymentType}_id=${paymentId}`,
            cancel_url: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/payment-cancel?${paymentType}_id=${paymentId}`,
            metadata: {
                ...metadata,
                paymentType,
                consumerName: consumerName || 'Unknown',
            },
            customer_email: email || undefined,
        });

        console.log('✅ Stripe session created:', session.id);

        // ✅ Store payment session in database
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

// backend/src/index.ts - METER ROUTES সেকশনে যোগ করুন

// ✅ CHECK METER AVAILABILITY FOR USER (for claiming)
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

        // ✅ Check if meter exists
        const meter = await metersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        if (!meter) {
            return res.status(404).json({
                success: false,
                message: 'Meter not found in the system'
            });
        }

        // ✅ Check if meter is already claimed
        if (meter.isClaimed) {
            // Check if claimed by this user
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

        // ✅ Check if there's a consumer associated
        const consumer = await consumersCollection.findOne({
            meterNo: { $regex: new RegExp(`^${meterNo}$`, 'i') }
        });

        // ✅ Get meter details with consumer info
        const meterData = {
            ...meter,
            consumerName: consumer?.name || meter.consumerName || 'Pending',
            consumerType: consumer?.consumerType || meter.consumerType || 'residential',
            address: consumer?.address || meter.address || '',
            feederName: meter.feederName || '',
            isClaimed: meter.isClaimed || false,
        };

        res.json({
            success: true,
            data: {
                isAvailable: true,
                isAlreadyClaimed: false,
                message: 'Meter is available for claiming',
                meter: meterData
            }
        });

    } catch (error) {
        console.error('Check meter availability error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check meter availability',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});



app.get('/api/payment-success', async (req: Request, res: Response) => {
    try {
        const { session_id, app_id } = req.query;

        console.log('✅ Payment success callback:', { session_id, app_id });

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

        res.redirect(`${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/my-connections?payment=success`);

    } catch (error) {
        console.error('Payment success error:', error);
        res.redirect(`${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/my-connections?payment=failed`);
    }
});

app.get('/api/payment-cancel', async (req: Request, res: Response) => {
    const { app_id } = req.query;
    console.log('❌ Payment cancelled:', { app_id });
    res.redirect(`${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/dashboard/consumer/my-connections?payment=cancelled`);
});

// backend/src/index.ts - আপডেটেড payment-verify route

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

        // ✅ For New Connection Application
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

        // ✅ For Bill Payment
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

        // ✅ If sessionId is provided, find from payment_sessions
        if (sessionId) {
            const paymentSessionsCollection = db.collection('payment_sessions');
            const paymentSession = await paymentSessionsCollection.findOne({ sessionId });

            if (paymentSession) {
                // Check if it's for application or bill
                if (paymentSession.applicationId) {
                    // Handle application payment
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
                    // Handle bill payment
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
// 15. 404 HANDLER
// =====================================================
app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// =====================================================
// 16. ERROR HANDLER
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
            console.log(`\n📋 Routes:`);
            console.log(`  📌 Complaints - POST /api/complaints`);
            console.log(`  📌 Complaints - GET /api/complaints/all`);
            console.log(`  📌 Applications - POST /api/connection-applications`);
            console.log(`  📌 Applications - GET /api/connection-applications/all`);
            console.log(`  📌 Wing - GET /api/connection-wing/applications`);
            console.log(`  📌 Wing - POST /api/connection-wing/applications/:id/assign-meter`);
            console.log(`  📌 Wing - PATCH /api/connection-wing/applications/:id/status`);
            console.log(`  📌 Meters - GET /api/meters/check-assignment/:meterNo`);
            console.log(`  📌 Meters - GET /api/meters/check-availability/:meterNo`);
            console.log(`  📌 Meters - POST /api/connection-wing/add-meter`);
            console.log(`  📌 Meters - GET /api/meters/available`);
            console.log(`  📌 Meters - GET /api/meters/search/:meterNo`);
            console.log(`  📌 Meters - POST /api/meters/claim`);
            console.log(`  📌 Meters - POST /api/meters/claim-for-consumer`);
            console.log(`  📌 Users - GET /api/user/meters/:userId`);
            console.log(`  📌 Consumers - GET /api/consumers/status/:meterNo`);
            console.log(`  📌 Consumers - GET /api/consumers/check-unique`);
            console.log(`  📌 Billing - POST /api/billing/generate-bill`);
            console.log(`  📌 Billing - GET /api/billing/bills/all`);
            console.log(`  📌 Billing - GET /api/billing/bills/consumer/:consumerId`);
            console.log(`  📌 Billing - GET /api/billing/bills/meter/:meterNo`);
            console.log(`  📌 Billing - GET /api/billing/bills/:billId`);
            console.log(`  📌 Billing - PATCH /api/billing/bills/:billId/pay`);
            console.log(`  📌 Billing - GET /api/billing/consumers/all`);
            console.log(`  📌 Billing - GET /api/billing/consumers/:consumerId`);
            console.log(`  📌 Billing - PUT /api/billing/consumers/:consumerId`);
            console.log(`  📌 Billing - DELETE /api/billing/consumers/:consumerId`);
            console.log(`  📌 Billing - GET /api/billing/consumers/:consumerId/summary`);
            console.log(`  📌 Admin - GET /api/admin/users`);
            console.log(`  📌 Consumer - GET /api/consumer/bills/:meterNo`);
            console.log(`  📌 XEN - GET /api/xen/applications`);
            console.log(`  📌 Transactions - GET /api/transactions/all`);
            console.log(`  📌 Substations - GET /api/substations`);
            console.log(`  📌 Payment - POST /api/create-payment-session`);
            console.log(`  📌 Payment - POST /api/payment-verify\n`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

export { app, connectDB, getDB };