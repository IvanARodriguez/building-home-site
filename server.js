const express = require('express');
const path = require('path');
const {
	SESClient,
	SendEmailCommand,
	SendRawEmailCommand,
} = require('@aws-sdk/client-ses');
const multer = require('multer');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const MailComposer = require('mailcomposer');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure local environment variable injection works in production
// (Requires installing 'dotenv' via: npm install dotenv)
require('dotenv').config();

// Configure view processing parameters
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Structural Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // Safe parser for incoming contact submissions

// ==========================================================================
// ANTI-SPAM DEFINITION
// ==========================================================================
// Limits an IP address to a maximum of 3 requests per 15 minutes to completely break automated bot waves.
const contactLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 3,
	message:
		'Too many consultation requests sent from this IP network footprint. Please try again shortly.',
	standardHeaders: true,
	legacyHeaders: false,
});

// ==========================================================================
// AWS SES CLIENT SETUP
// ==========================================================================
const sesClient = new SESClient({
	region: process.env.AWS_REGION || 'us-east-2',
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	},
});

// ==========================================================================
// EXPRESS ROUTING ENGINE
// ==========================================================================

// 1. Home Page Route (Regional Focus Enabled)
app.get('/', (req, res) => {
	const seo = {
		title: 'Building Home | Luxury Home Construction & Renovations Tampa Bay',
		description:
			'Premium custom home construction, modern renovations, and structural enhancements serving Brandon, Tampa, Clearwater, St. Pete, and Wesley Chapel, FL.',
		keywords:
			'home construction Tampa, home renovations Brandon FL, kitchen remodeling Clearwater, custom home builder Wesley Chapel, contemporary home additions St Pete',
	};
	res.render('index', { seo });
});

// 2. About Page Route
app.get('/about', (req, res) => {
	const seo = {
		title: 'About Our Builders | Building Home | Tampa Bay Construction Group',
		description:
			'Meet the contemporary design and structural engineering team at Building Home. Constructing modern homes and additions across Brandon, St. Pete, and Clearwater.',
		keywords:
			'custom home builders Brandon FL, modern architecture Tampa, residential general contractors Clearwater, construction management St Petersburg',
	};
	res.render('about', { seo });
});

// 3. Services Page Route
app.get('/services', (req, res) => {
	const seo = {
		title: 'Our Services | Custom Home Building & Remodeling Tampa Bay',
		description:
			'Explore our premium construction capabilities. General contracting services across Brandon, Tampa, Clearwater, St. Pete, and Wesley Chapel, FL.',
		keywords:
			'custom home builds Florida, home extensions Tampa, luxury kitchen remodeling Clearwater, open concept conversion St Pete, structural contractors Wesley Chapel',
	};
	res.render('services', { seo });
});

// Testimonials Page Route
app.get('/testimonials', (req, res) => {
	const seo = {
		title: 'Licensed General Contractor Reviews | Building Home Florida',
		description:
			'Read verified testimonials from property owners regarding our custom ground-up new construction, commercial builds, and structural engineering across Florida.',
		keywords:
			'general contractor reviews Florida, new construction testimonials, custom home builder, commercial building contractor',
	};

	const reviews = [
		{
			name: 'Ivan & Mariam',
			location: 'Wesley Chapel | New Tampa',
			service: 'High-Impact Hurricane Window Integration & Structural Finishes',
			quote:
				'We hired Building Home to replace all the windows throughout our home with high-impact hurricane glass and advanced UV protection. The entire construction execution process was incredibly streamlined, and the communication from their team was consistently proactive. The final structural finishes delivered by the crew were significantly better than the original finishes of the house itself.',
			date: 'June 2026',
		},
	];

	res.render('testimonials', { seo, reviews });
});

// 4. Contact Page Render Route
app.get('/contact', (req, res) => {
	const seo = {
		title: 'Contact Our Builders | Building Home | Schedule Consultation',
		description:
			'Connect with our custom building and remodeling team. Servicing Brandon, Tampa, Clearwater, St. Pete, and Wesley Chapel.',
		keywords: 'contractor consultation Tampa, quote home renovation Brandon',
	};
	res.render('contact', { seo, msg: null, err: null });
});

// 1. Define the storage engine
const storage = multer.memoryStorage();

// 2. Initialize the multer instance with your storage options (This was the missing step!)
const upload = multer({ storage: storage });

// 3. Create your specific single-file middleware field target
const uploadSingle = upload.single('blueprintUpload');

app.post('/contact', contactLimiter, uploadSingle, async (req, res) => {
	const { name, email, phone, service, budget, message, mid_initial_hp } =
		req.body;
	const defaultContactSeo = { title: 'Contact Our Builders | Building Home' };
	const uploadedFile = req.file; // This holds the file buffer, name, and size data

	// 1. ANTI-SPAM: Honeypot Verification
	if (mid_initial_hp) {
		console.warn('Spam blocked via honeypot.');
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: 'Thank you! Your parameters have been safely stored.',
			err: null,
		});
	}

	// 2. SERVER-SIDE FIELD VALIDATION LAYER
	if (!name || !email || !phone || !service || !budget || !message) {
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: null,
			err: 'Validation Breakdown: All required project fields must be filled out completely.',
		});
	}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!emailRegex.test(email)) {
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: null,
			err: 'Invalid formatting syntax detected on the email input field.',
		});
	}

	// 3. TEXT SANITIZATION & CLEANUP
	const cleanName = name.replace(/[^\w\s.-]/g, '').trim();
	const cleanPhone = phone.replace(/[<>]/g, '').trim();
	const cleanMessage = message
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.trim();
	const logoUrl = 'https://cdn.buildinghomeco.com/logo.png';

	// ==========================================================================
	// EMAIL TEMPLATE A: CLIENT WELCOME CONFIRMATION
	// ==========================================================================
	const clientHtmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Consultation Initialized</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 40px 20px;">
            <tr>
                <td align="center">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03); border: 1px solid #e2e8f0;">
                        <tr>
                            <td align="center" style="background-color: #1a2e40; padding: 25px 20px; border-bottom: 4px solid #d4af37;">
                                <img src="${logoUrl}" alt="Building Home Logo" width="110" style="display: block; border: 0; max-width: 100%; height: auto;">
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 40px 30px;">
                                <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 800; color: #1a2e40;">Project Consultation Logged</h1>
                                <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #64748b;">Hello ${cleanName},</p>
                                <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #64748b;">Thank you for contacting Building Home. We have securely received your design specs, plans, and target financial parameters. A regional project coordinator is reviewing your details.</p>
                                
                                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #edf2f7; margin-bottom: 24px; padding: 20px;">
                                    <tr><td style="padding-bottom: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Selected Focus Profile</td></tr>
                                    <tr><td style="padding-bottom: 16px; font-size: 15px; font-weight: 600; color: #1a2e40;">${service}</td></tr>
                                    <tr><td style="padding-bottom: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Targeted Investment Range</td></tr>
                                    <tr><td style="padding-bottom: 16px; font-size: 15px; font-weight: 700; color: #d4af37;">${budget}</td></tr>
                                    <tr><td style="padding-bottom: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Plan Attachment Status</td></tr>
                                    <tr><td style="padding-bottom: 16px; font-size: 14px; font-weight: 600; color: #1e293b;">${uploadedFile ? 'Document Uploaded Successfully' : 'No Document Attached'}</td></tr>
                                    <tr><td style="padding-bottom: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em;">Your Description Overview</td></tr>
                                    <tr><td style="font-size: 14px; line-height: 1.6; color: #475569; font-style: italic;">"${cleanMessage}"</td></tr>
                                </table>

                                <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #1e293b;"><strong>Next Phase Steps</strong></p>
                                <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.6; color: #64748b;">We will reach out to you via telephone at <strong>${cleanPhone}</strong> or at this email address within 24–48 hours to confirm scheduling requirements.</p>
                                
                                <p style="margin: 0; font-size: 15px; font-weight: 700; color: #1a2e40;">The Building Home Construction Group</p>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="background-color: #0f172a; padding: 20px; font-size: 11px; color: #64748b;">
                                &copy; ${new Date().getFullYear()} Building Home. All rights reserved.
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `;

	// ==========================================================================
	// EMAIL TEMPLATE B: OWNER ACTION DASHBOARD (WITH FILE STATUS LINK)
	// ==========================================================================
	const ownerHtmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Project Lead Dispatch</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f1f5f9; padding: 40px 20px;">
            <tr>
                <td align="center">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 650px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #cbd5e1;">
                        <tr>
                            <td style="background-color: #1a2e40; padding: 20px 30px; border-bottom: 4px solid #d4af37; display: flex; justify-content: space-between; align-items: center;">
                                <img src="${logoUrl}" alt="Building Home Logo" width="110" style="display: block; border: 0;">
                                <span style="background-color: rgba(214, 175, 55, 0.15); color: #d4af37; font-size: 11px; font-weight: 800; padding: 6px 12px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.05em; margin-left: auto;">New Project Target</span>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 35px;">
                                <h2 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 800; color: #1a2e40;">Project Parameters Dispatched</h2>
                                <p style="margin: 0 0 25px 0; font-size: 14px; color: #64748b;">A fresh project blueprint request has cleared security layers:</p>
                                
                                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 30px; font-size: 15px;">
                                    <tr>
                                        <td width="35%" style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">Lead Name:</td>
                                        <td width="65%" style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 600;">${cleanName}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">Secure Email:</td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #1a2e40; font-weight: 600;"><a href="mailto:${email}" style="color: #1a2e40; text-decoration: underline;">${email}</a></td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">Phone Contact:</td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #1a2e40; font-weight: 600;"><a href="tel:${cleanPhone}" style="color: #1a2e40; text-decoration: none;">${cleanPhone}</a></td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">Scope Profile:</td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 600;">${service}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">Target Budget:</td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #d4af37; font-weight: 700;">${budget}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">Plan Attached:</td>
                                        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 600;">${uploadedFile ? `Yes (${uploadedFile.originalname})` : 'No blueprint attached'}</td>
                                    </tr>
                                </table>

                                <div style="background-color: #f8fafc; border-left: 4px solid #1a2e40; padding: 20px; border-radius: 0 8px 8px 0; border: 1px solid #edf2f7; margin-bottom: 30px;">
                                    <h4 style="margin: 0 0 10px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; letter-spacing: 0.05em;">Detailed Project Description:</h4>
                                    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${cleanMessage}</p>
                                </div>

                                <div style="text-align: center;">
                                    <a href="mailto:${email}?subject=Re: Building Home Consultation - ${service}" style="display: inline-block; background-color: #1a2e40; color: #ffffff; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; padding: 14px 28px; border-radius: 6px; text-decoration: none;">Reply Instantly via Email</a>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="background-color: #0f172a; padding: 15px; font-size: 11px; color: #475569;">
                                Internal Dispatch Capture Engine • AWS SES MIME Raw Engine
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `;

	try {
		// 4. USE MAILCOMPOSER TO COMPILE RAW MIME STRINGS Safely
		const ownerMailConfig = {
			from: process.env.NOTIFICATION_EMAIL,
			to: process.env.NOTIFICATION_RECEIVER,
			subject: `Project Scope Request from ${cleanName}`,
			html: ownerHtmlBody,
			replyTo: email,
			headers: {
				'X-Auto-Response-Suppress': 'All',
				Precedence: 'bulk',
			},
			attachments: uploadedFile
				? [
						{
							filename: uploadedFile.originalname,
							content: uploadedFile.buffer, // Pulled safely from Node.js memory
						},
					]
				: [],
		};

		const clientMailConfig = {
			from: process.env.NOTIFICATION_EMAIL,
			to: email,
			subject: `Consultation Received: ${service} Profile | Building Home`,
			html: clientHtmlBody,
		};

		const [rawOwnerEmail, rawClientEmail] = await Promise.all([
			new Promise((resolve, reject) => {
				new MailComposer(ownerMailConfig).build((err, message) => {
					if (err) return reject(err);
					resolve(message);
				});
			}),
			new Promise((resolve, reject) => {
				new MailComposer(clientMailConfig).build((err, message) => {
					if (err) return reject(err);
					resolve(message);
				});
			}),
		]);

		await Promise.all([
			sesClient.send(
				new SendRawEmailCommand({ RawMessage: { Data: rawOwnerEmail } }),
			),
			sesClient.send(
				new SendRawEmailCommand({ RawMessage: { Data: rawClientEmail } }),
			),
		]);
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: 'Submission Received! Your project parameters and files have been safely uploaded.',
			err: null,
		});
	} catch (error) {
		console.error(
			'Infrastructure Error during dual AWS SES Raw processing action:',
			error,
		);
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: null,
			err: 'An infrastructure communication error occurred during mail delivery. Please try again.',
		});
	}
});

// 5. Terms of Service Page Route
app.get('/terms', (req, res) => {
	const seo = {
		title: 'Terms of Service | Licensed Contractor Statutory Disclosures',
		description:
			'Review the regulatory framework, structural project insurance policies, and statutory compliance clauses for licensed operations under FL CBC1267326.',
		keywords:
			'building home terms, construction service conditions Florida, general contracting terms Tampa',
	};
	res.render('terms', { seo });
});

// Catch-all fallbacks: If route doesn't match, send back home safely
app.get('*all', (req, res) => {
	res.redirect('/');
});

// ==========================================================================
// RUN THE ENGINE
// ==========================================================================
app.listen(PORT, '0.0.0.0', () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
